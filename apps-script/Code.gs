/**
 * AIROS ESPOL · Reserva de entrevistas de aspirantes
 * Backend en Google Apps Script (aplicación web) sobre un Google Sheet privado.
 *
 * Pestañas del Sheet (las crea setup()):
 *   Horarios   id | fecha | hora | entrevistador | estado   (libre | ocupada | bloqueada)
 *   Reservas   codigo | slot_id | fecha | hora | entrevistador | nombres | apellidos |
 *              whatsapp | estado | creada | actualizada | cancelada_por
 *   Propuestas id | creada | nombres | apellidos | whatsapp | propuesta | estado
 *
 * Seguridad:
 *  - La clave del panel vive en Propiedades del script (PANEL_KEY) y se valida aquí.
 *  - Los endpoints públicos nunca devuelven datos personales ni el entrevistador.
 *  - Toda escritura pasa por LockService para evitar reservas dobles.
 */

/* ======================= Configuración ======================= */

var CONFIG = {
  ZONA: 'America/Guayaquil',
  DESFASE: '-05:00',                 // UTC-5, Ecuador no usa horario de verano
  HOJAS: { HORARIOS: 'Horarios', RESERVAS: 'Reservas', PROPUESTAS: 'Propuestas' },
  ENCABEZADOS: {
    Horarios: ['id', 'fecha', 'hora', 'entrevistador', 'estado'],
    Reservas: ['codigo', 'slot_id', 'fecha', 'hora', 'entrevistador', 'nombres', 'apellidos',
               'whatsapp', 'estado', 'creada', 'actualizada', 'cancelada_por'],
    Propuestas: ['id', 'creada', 'nombres', 'apellidos', 'whatsapp', 'propuesta', 'estado']
  },
  LIMITES: { nombres: 60, apellidos: 60, propuesta: 300 },
  MAX_CUERPO: 4000,                  // caracteres máximos de una petición
  ESPERA_LOCK_MS: 10000,
  MAX_INTENTOS_CLAVE: 8,             // intentos fallidos de clave por ventana
  VENTANA_CLAVE_S: 600,
  MAX_PROPUESTAS_PENDIENTES: 3       // por WhatsApp
};

// Las 18 horas de la semana del 19 al 22 de octubre de 2026: [id, fecha, hora].
// El entrevistador NO va en el código (el repo es público): se escribe a mano en la
// columna "entrevistador" de la pestaña Horarios del Sheet privado.
var HORARIOS_INICIALES = [
  ['h01', '2026-10-19', '17:00'], ['h02', '2026-10-19', '17:20'], ['h03', '2026-10-19', '17:40'],
  ['h04', '2026-10-19', '18:00'], ['h05', '2026-10-19', '18:30'],
  ['h06', '2026-10-19', '20:00'], ['h07', '2026-10-19', '20:30'],
  ['h08', '2026-10-20', '19:20'], ['h09', '2026-10-20', '19:40'], ['h10', '2026-10-20', '20:00'],
  ['h11', '2026-10-21', '20:00'], ['h12', '2026-10-21', '20:30'],
  ['h13', '2026-10-22', '19:00'], ['h14', '2026-10-22', '19:20'], ['h15', '2026-10-22', '19:40'],
  ['h16', '2026-10-22', '18:00'], ['h17', '2026-10-22', '18:30'], ['h18', '2026-10-22', '20:00']
];

/* ======================= Inicialización (ejecutar una vez) ======================= */

/**
 * Crea las tres pestañas con sus encabezados y carga las 18 horas.
 * Es seguro ejecutarla de nuevo: no duplica horas ni borra reservas.
 */
function setup() {
  var ss = abrirSheet_();
  Object.keys(CONFIG.ENCABEZADOS).forEach(function (nombre) {
    var enc = CONFIG.ENCABEZADOS[nombre];
    var hoja = ss.getSheetByName(nombre) || ss.insertSheet(nombre);
    hoja.getRange(1, 1, 1, enc.length).setValues([enc]).setFontWeight('bold').setBackground('#0D1B2A').setFontColor('#FFFFFF');
    hoja.setFrozenRows(1);
    // Todo como texto plano: evita que Sheets convierta "17:00" en hora o "+593..." en fórmula.
    hoja.getRange(1, 1, hoja.getMaxRows(), enc.length).setNumberFormat('@');
    hoja.autoResizeColumns(1, enc.length);
  });

  var horarios = ss.getSheetByName(CONFIG.HOJAS.HORARIOS);
  if (horarios.getLastRow() < 2) {
    var filas = HORARIOS_INICIALES.map(function (f) { return [f[0], f[1], f[2], '', 'libre']; });
    horarios.getRange(2, 1, filas.length, 5).setValues(filas);
  }
  horarios.getRange(2, 5, horarios.getMaxRows() - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['libre', 'ocupada', 'bloqueada'], true).setAllowInvalid(false).build());

  var hojaInicial = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (hojaInicial && ss.getSheets().length > 1 && hojaInicial.getLastRow() === 0) ss.deleteSheet(hojaInicial);

  if (!PropertiesService.getScriptProperties().getProperty('PANEL_KEY')) {
    Logger.log('FALTA la propiedad PANEL_KEY (Configuración del proyecto > Propiedades del script).');
  }
  Logger.log('Listo. Pestañas creadas y ' + HORARIOS_INICIALES.length + ' horas cargadas. Completa la columna entrevistador en Horarios.');
}

/**
 * Alternativa a escribir PANEL_KEY a mano: ejecútala pasando la clave en el parámetro.
 * (Desde el editor, edita la línea de abajo, ejecuta y luego vuelve a poner el texto de ejemplo.)
 */
function definirClavePanel() {
  var clave = 'ESCRIBE_AQUI_LA_CLAVE';
  if (clave === 'ESCRIBE_AQUI_LA_CLAVE' || clave.length < 8) throw new Error('Escribe una clave de al menos 8 caracteres.');
  PropertiesService.getScriptProperties().setProperty('PANEL_KEY', clave);
  Logger.log('PANEL_KEY guardada. Borra la clave de este archivo.');
}

/* ======================= Puntos de entrada ======================= */

// GET solo sirve para comprobar que el despliegue está vivo.
function doGet() {
  return json_({ ok: true, datos: { servicio: 'entrevistas-aspirantes-airos' } });
}

function doPost(e) {
  var resp;
  try {
    var texto = (e && e.postData && e.postData.contents) || '';
    if (texto.length > CONFIG.MAX_CUERPO) throw new ErrorApp('CUERPO_GRANDE', 'La solicitud es demasiado grande.');
    var cuerpo;
    try { cuerpo = JSON.parse(texto); } catch (x) { throw new ErrorApp('JSON_INVALIDO', 'Solicitud no válida.'); }
    if (!cuerpo || typeof cuerpo !== 'object') throw new ErrorApp('JSON_INVALIDO', 'Solicitud no válida.');
    resp = { ok: true, datos: enrutar_(cuerpo) };
  } catch (err) {
    if (err instanceof ErrorApp) {
      resp = { ok: false, codigo: err.codigo, error: err.message };
    } else {
      console.error(err && err.stack ? err.stack : err);
      resp = { ok: false, codigo: 'INTERNO', error: 'Ocurrió un error inesperado. Inténtalo de nuevo en un momento.' };
    }
  }
  return json_(resp);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function ErrorApp(codigo, mensaje) {
  this.codigo = codigo;
  this.message = mensaje;
}
ErrorApp.prototype = Object.create(Error.prototype);

function enrutar_(d) {
  switch (String(d.accion)) {
    // Públicas
    case 'horarios':   return { horarios: listarHorarios_() };
    case 'consultar':  return consultar_(d);
    case 'reservar':   return conLock_(function () { return reservar_(d); });
    case 'cancelar':   return conLock_(function () { return cancelar_(d); });
    case 'cambiar':    return conLock_(function () { return cambiar_(d); });
    case 'proponer':   return conLock_(function () { return proponer_(d); });
    // Panel (exigen clave)
    case 'panel_listar':   validarClave_(d.clave); return panelListar_();
    case 'panel_cancelar': validarClave_(d.clave); return conLock_(function () { return panelCancelar_(d); });
    case 'panel_atender':  validarClave_(d.clave); return conLock_(function () { return panelAtender_(d); });
    default: throw new ErrorApp('ACCION_INVALIDA', 'Acción no válida.');
  }
}

/**
 * Serializa todas las escrituras. Si dos personas piden la misma hora, la segunda
 * espera, ve la hora ocupada y recibe HORA_TOMADA. El flush ocurre ANTES de soltar
 * el candado para que la siguiente solicitud lea los datos ya escritos.
 */
function conLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.ESPERA_LOCK_MS)) {
    throw new ErrorApp('OCUPADO', 'Hay mucha gente reservando a la vez. Inténtalo otra vez en unos segundos.');
  }
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

/* ======================= Acceso al Sheet ======================= */

function abrirSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No hay Sheet. Crea el script desde el Sheet (Extensiones > Apps Script) o define SHEET_ID.');
  return ss;
}

function hoja_(nombre) {
  var h = abrirSheet_().getSheetByName(nombre);
  if (!h) throw new Error('Falta la pestaña ' + nombre + '. Ejecuta setup().');
  return h;
}

function normFecha_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, abrirSheet_().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  return String(v).trim();
}

function normHora_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, abrirSheet_().getSpreadsheetTimeZone(), 'HH:mm');
  var m = /^(\d{1,2}):(\d{2})/.exec(String(v).trim());
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : String(v).trim();
}

// Lee una pestaña como lista de objetos {…campos, _fila}.
function leer_(nombre) {
  var hoja = hoja_(nombre), enc = CONFIG.ENCABEZADOS[nombre];
  var ultima = hoja.getLastRow();
  if (ultima < 2) return [];
  var valores = hoja.getRange(2, 1, ultima - 1, enc.length).getValues();
  var filas = [];
  valores.forEach(function (fila, i) {
    if (fila.every(function (c) { return c === '' || c === null; })) return;
    var o = { _fila: i + 2 };
    enc.forEach(function (campo, j) { o[campo] = fila[j]; });
    filas.push(o);
  });
  return filas;
}

function aFila_(nombre, o) {
  return CONFIG.ENCABEZADOS[nombre].map(function (campo) { return o[campo] === undefined ? '' : o[campo]; });
}

function escribirFila_(nombre, o) {
  var enc = CONFIG.ENCABEZADOS[nombre];
  hoja_(nombre).getRange(o._fila, 1, 1, enc.length).setValues([aFila_(nombre, o)]);
}

function agregarFila_(nombre, o) {
  var hoja = hoja_(nombre), enc = CONFIG.ENCABEZADOS[nombre];
  var fila = hoja.getLastRow() + 1;
  hoja.getRange(fila, 1, 1, enc.length).setNumberFormat('@').setValues([aFila_(nombre, o)]);
}

function horarios_() {
  return leer_(CONFIG.HOJAS.HORARIOS).map(function (h) {
    return {
      _fila: h._fila, id: String(h.id).trim(), fecha: normFecha_(h.fecha), hora: normHora_(h.hora),
      entrevistador: String(h.entrevistador).trim(), estado: String(h.estado || 'libre').trim().toLowerCase()
    };
  }).filter(function (h) { return h.id; });
}

function reservas_() {
  return leer_(CONFIG.HOJAS.RESERVAS).map(function (r) {
    r.fecha = normFecha_(r.fecha); r.hora = normHora_(r.hora);
    r.estado = String(r.estado).trim().toLowerCase();
    r.slot_id = String(r.slot_id).trim();
    return r;
  });
}

function ahora_() { return Utilities.formatDate(new Date(), CONFIG.ZONA, "yyyy-MM-dd'T'HH:mm:ssXXX"); }

/* ======================= Validación y saneamiento ======================= */

function limpiarTexto_(v) {
  return String(v === null || v === undefined ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Evita que una celda de texto libre se interprete como fórmula.
function sinFormula_(t) { return /^[=+\-@]/.test(t) ? "'" + t : t; }

function validarNombre_(v, campo, etiqueta) {
  var t = limpiarTexto_(v);
  if (t.length < 2) throw new ErrorApp('DATOS_INVALIDOS', 'Escribe tus ' + etiqueta + '.');
  if (t.length > CONFIG.LIMITES[campo]) throw new ErrorApp('DATOS_INVALIDOS', 'Máximo ' + CONFIG.LIMITES[campo] + ' caracteres en ' + etiqueta + '.');
  if (!/^[\p{L}][\p{L}\s'’.\-]*$/u.test(t)) throw new ErrorApp('DATOS_INVALIDOS', 'Usa solo letras en ' + etiqueta + '.');
  return t;
}

// 09XXXXXXXX o +5939XXXXXXXX -> "+5939XXXXXXXX"; null si no es válido.
function normalizarWhatsapp_(v) {
  var s = String(v === null || v === undefined ? '' : v).replace(/[\s\-().]/g, '');
  var m = /^09(\d{8})$/.exec(s) || /^\+?5939(\d{8})$/.exec(s);
  return m ? '+5939' + m[1] : null;
}

function validarWhatsapp_(v) {
  var n = normalizarWhatsapp_(v);
  if (!n) throw new ErrorApp('DATOS_INVALIDOS', 'Escribe un número de Ecuador: 0991234567 o +593991234567.');
  return n;
}

// Clave de comparación: los últimos 9 dígitos (tolera que Sheets haya quitado el "+").
function claveWa_(w) { return String(w).replace(/\D/g, '').slice(-9); }

function sinTildes_(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function validarPersona_(d) {
  return {
    nombres: validarNombre_(d.nombres, 'nombres', 'nombres'),
    apellidos: validarNombre_(d.apellidos, 'apellidos', 'apellidos'),
    whatsapp: validarWhatsapp_(d.whatsapp)
  };
}

function validarSlotId_(v) {
  var id = String(v === undefined || v === null ? '' : v).trim();
  if (!/^[\w\-]{1,40}$/.test(id)) throw new ErrorApp('DATOS_INVALIDOS', 'Hora no válida.');
  return id;
}

/* ======================= Reglas de horarios ======================= */

function reservaActivaDe_(reservas, wa) {
  for (var i = 0; i < reservas.length; i++) {
    if (reservas[i].estado === 'activa' && claveWa_(reservas[i].whatsapp) === claveWa_(wa)) return reservas[i];
  }
  return null;
}

// Una hora está tomada si su estado no es "libre" O si hay una reserva activa sobre ella.
function slotTomado_(slot, reservas) {
  if (slot.estado !== 'libre') return true;
  return reservas.some(function (r) { return r.estado === 'activa' && r.slot_id === slot.id; });
}

function slotPasado_(slot) {
  var inicio = new Date(slot.fecha + 'T' + slot.hora + ':00' + CONFIG.DESFASE);
  return !isNaN(inicio.getTime()) && inicio.getTime() <= Date.now();
}

function buscarSlot_(horarios, id) {
  var s = horarios.filter(function (h) { return h.id === id; })[0];
  if (!s || s.estado === 'bloqueada') throw new ErrorApp('HORA_NO_EXISTE', 'Esa hora ya no está disponible. Elige otra.');
  return s;
}

function exigirDisponible_(slot, reservas) {
  if (slotTomado_(slot, reservas)) throw new ErrorApp('HORA_TOMADA', 'Esa hora acaba de ser tomada por otra persona. Elige otra de la lista.');
  if (slotPasado_(slot)) throw new ErrorApp('HORA_PASADA', 'Esa hora ya pasó. Elige otra de la lista.');
}

function fijarEstadoSlot_(slot, estado) {
  slot.estado = estado;
  hoja_(CONFIG.HOJAS.HORARIOS).getRange(slot._fila, 5).setValue(estado);
}

function generarCodigo_(reservas) {
  var letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', c, repetido;
  do {
    c = 'AIROS-';
    for (var i = 0; i < 5; i++) c += letras.charAt(Math.floor(Math.random() * letras.length));
    repetido = reservas.some(function (r) { return r.codigo === c; });
  } while (repetido);
  return c;
}

// Identifica la reserva propia con WhatsApp + nombres. El mensaje es genérico a propósito.
function buscarPropia_(reservas, d) {
  var wa = normalizarWhatsapp_(d.whatsapp);
  var nom = sinTildes_(limpiarTexto_(d.nombres));
  var r = (wa && nom) ? reservaActivaDe_(reservas, wa) : null;
  if (r) {
    var guardado = sinTildes_(r.nombres);
    if (guardado !== nom && guardado.indexOf(nom + ' ') !== 0 && nom.indexOf(guardado + ' ') !== 0) r = null;
  }
  if (!r) throw new ErrorApp('NO_ENCONTRADA', 'No encontramos una reserva activa con esos datos. Revisa tu WhatsApp y tu nombre.');
  return r;
}

// Cancela la reserva y libera su hora (solo si estaba marcada "ocupada").
function liberar_(reserva, quien, horarios) {
  reserva.estado = 'cancelada';
  reserva.cancelada_por = quien;
  reserva.actualizada = ahora_();
  escribirFila_(CONFIG.HOJAS.RESERVAS, reserva);
  var slot = horarios.filter(function (h) { return h.id === reserva.slot_id; })[0];
  if (slot && slot.estado === 'ocupada') fijarEstadoSlot_(slot, 'libre');
}

/* ======================= Acciones públicas ======================= */

// Solo id, fecha, hora y estado. Sin entrevistador ni datos personales.
function listarHorarios_() {
  var reservas = reservas_();
  return horarios_().filter(function (h) {
    return h.estado !== 'bloqueada' && !slotPasado_(h);
  }).map(function (h) {
    return { id: h.id, fecha: h.fecha, hora: h.hora, estado: slotTomado_(h, reservas) ? 'ocupada' : 'libre' };
  });
}

function reservar_(d) {
  if (d.sitio_web) return { codigo: 'AIROS-00000', fecha: '', hora: '' };   // señuelo anti-bots
  var p = validarPersona_(d), slotId = validarSlotId_(d.slot_id);
  var horarios = horarios_(), reservas = reservas_();

  if (reservaActivaDe_(reservas, p.whatsapp)) {
    throw new ErrorApp('YA_TIENE_RESERVA', 'Ese WhatsApp ya tiene una reserva activa. Entra a «Mi reserva» para cambiarla o cancelarla.');
  }
  var slot = buscarSlot_(horarios, slotId);
  exigirDisponible_(slot, reservas);

  var r = {
    codigo: generarCodigo_(reservas), slot_id: slot.id, fecha: slot.fecha, hora: slot.hora, entrevistador: slot.entrevistador,
    nombres: p.nombres, apellidos: p.apellidos, whatsapp: p.whatsapp, estado: 'activa',
    creada: ahora_(), actualizada: ahora_(), cancelada_por: ''
  };
  agregarFila_(CONFIG.HOJAS.RESERVAS, r);
  fijarEstadoSlot_(slot, 'ocupada');
  return { codigo: r.codigo, fecha: r.fecha, hora: r.hora };
}

function consultar_(d) {
  if (d.sitio_web) throw new ErrorApp('NO_ENCONTRADA', 'No encontramos una reserva activa con esos datos.');
  var r = buscarPropia_(reservas_(), d);
  return { codigo: r.codigo, fecha: r.fecha, hora: r.hora, nombres: r.nombres, apellidos: r.apellidos };
}

function cancelar_(d) {
  var reservas = reservas_(), r = buscarPropia_(reservas, d);
  liberar_(r, 'aspirante', horarios_());
  return {};
}

/**
 * Cambiar = tomar la hora nueva y liberar la anterior dentro del mismo candado.
 * Todas las validaciones van antes de escribir, así un fallo nunca deja al
 * aspirante sin hora ni con dos.
 */
function cambiar_(d) {
  var slotId = validarSlotId_(d.slot_id);
  var horarios = horarios_(), reservas = reservas_();
  var r = buscarPropia_(reservas, d);
  var nuevo = buscarSlot_(horarios, slotId);
  if (nuevo.id === r.slot_id) throw new ErrorApp('MISMA_HORA', 'Esa ya es tu hora reservada. Elige una distinta.');
  exigirDisponible_(nuevo, reservas);

  var anterior = horarios.filter(function (h) { return h.id === r.slot_id; })[0];
  r.slot_id = nuevo.id; r.fecha = nuevo.fecha; r.hora = nuevo.hora; r.entrevistador = nuevo.entrevistador;
  r.actualizada = ahora_();
  escribirFila_(CONFIG.HOJAS.RESERVAS, r);
  fijarEstadoSlot_(nuevo, 'ocupada');
  if (anterior && anterior.estado === 'ocupada') fijarEstadoSlot_(anterior, 'libre');
  return { codigo: r.codigo, fecha: r.fecha, hora: r.hora };
}

function proponer_(d) {
  if (d.sitio_web) return {};                                                 // señuelo anti-bots
  var p = validarPersona_(d);
  var texto = limpiarTexto_(d.propuesta);
  if (texto.length < 3) throw new ErrorApp('DATOS_INVALIDOS', 'Cuéntanos qué día y hora podrías.');
  if (texto.length > CONFIG.LIMITES.propuesta) throw new ErrorApp('DATOS_INVALIDOS', 'Máximo ' + CONFIG.LIMITES.propuesta + ' caracteres.');

  var pendientes = leer_(CONFIG.HOJAS.PROPUESTAS).filter(function (x) {
    return String(x.estado).trim() === 'pendiente' && claveWa_(x.whatsapp) === claveWa_(p.whatsapp);
  });
  if (pendientes.length >= CONFIG.MAX_PROPUESTAS_PENDIENTES) {
    throw new ErrorApp('DEMASIADAS_PROPUESTAS', 'Ya tienes varias propuestas pendientes. Te escribiremos por WhatsApp para coordinar.');
  }
  agregarFila_(CONFIG.HOJAS.PROPUESTAS, {
    id: 'p' + Utilities.getUuid().slice(0, 8), creada: ahora_(), nombres: p.nombres, apellidos: p.apellidos,
    whatsapp: p.whatsapp, propuesta: sinFormula_(texto), estado: 'pendiente'
  });
  return {};
}

/* ======================= Panel ======================= */

function compararSeguro_(a, b) {
  var n = Math.max(a.length, b.length), dif = a.length ^ b.length;
  for (var i = 0; i < n; i++) dif |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return dif === 0;
}

// Valida la clave en el servidor, con límite de intentos fallidos por ventana de tiempo.
function validarClave_(clave) {
  var cache = CacheService.getScriptCache();
  var intentos = Number(cache.get('intentos_clave') || 0);
  if (intentos >= CONFIG.MAX_INTENTOS_CLAVE) {
    throw new ErrorApp('BLOQUEADO', 'Demasiados intentos fallidos. Espera unos minutos.');
  }
  var real = PropertiesService.getScriptProperties().getProperty('PANEL_KEY');
  if (!real) throw new ErrorApp('SIN_CLAVE', 'El panel no está configurado: falta PANEL_KEY en las propiedades del script.');
  if (!compararSeguro_(String(clave === undefined || clave === null ? '' : clave).slice(0, 200), real)) {
    cache.put('intentos_clave', String(intentos + 1), CONFIG.VENTANA_CLAVE_S);
    throw new ErrorApp('CLAVE_INCORRECTA', 'La clave no es correcta.');
  }
  if (intentos) cache.remove('intentos_clave');
}

function panelListar_() {
  var horarios = horarios_(), reservas = reservas_();
  var slots = horarios.map(function (h) {
    var r = reservas.filter(function (x) { return x.estado === 'activa' && x.slot_id === h.id; })[0];
    return {
      id: h.id, fecha: h.fecha, hora: h.hora, entrevistador: h.entrevistador,
      estado: h.estado === 'bloqueada' ? 'bloqueada' : (r ? 'reservada' : 'libre'),
      reserva: r ? { codigo: r.codigo, nombres: r.nombres, apellidos: r.apellidos, whatsapp: String(r.whatsapp), creada: r.creada } : null
    };
  }).sort(function (a, b) {
    var ka = a.fecha + a.hora + a.entrevistador, kb = b.fecha + b.hora + b.entrevistador;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  var propuestas = leer_(CONFIG.HOJAS.PROPUESTAS).map(function (p) {
    return { id: String(p.id), creada: String(p.creada), nombres: p.nombres, apellidos: p.apellidos,
             whatsapp: String(p.whatsapp), propuesta: String(p.propuesta), estado: String(p.estado).trim() };
  });
  return {
    slots: slots,
    propuestas: propuestas,
    resumen: {
      reservas: slots.filter(function (s) { return s.estado === 'reservada'; }).length,
      libres: slots.filter(function (s) { return s.estado === 'libre'; }).length,
      propuestas: propuestas.filter(function (p) { return p.estado === 'pendiente'; }).length
    }
  };
}

function panelCancelar_(d) {
  var codigo = limpiarTexto_(d.codigo);
  var reservas = reservas_();
  var r = reservas.filter(function (x) { return x.codigo === codigo && x.estado === 'activa'; })[0];
  if (!r) throw new ErrorApp('NO_ENCONTRADA', 'Esa reserva ya no está activa.');
  liberar_(r, 'panel', horarios_());
  return {};
}

function panelAtender_(d) {
  var id = limpiarTexto_(d.id);
  var p = leer_(CONFIG.HOJAS.PROPUESTAS).filter(function (x) { return String(x.id) === id; })[0];
  if (!p) throw new ErrorApp('NO_ENCONTRADA', 'No se encontró la propuesta.');
  p.estado = 'atendida';
  escribirFila_(CONFIG.HOJAS.PROPUESTAS, p);
  return {};
}
