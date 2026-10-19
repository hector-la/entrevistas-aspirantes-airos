/*
 * Modo demo: imita el backend de Apps Script usando localStorage.
 * Mantiene las mismas reglas que Code.gs (una reserva activa por WhatsApp,
 * horas únicas, cancelar/cambiar con WhatsApp + nombre) para poder probar
 * todo el flujo sin servidor. Los datos viven solo en este navegador.
 * Se activa con DEMO_MODE: true en config.js.
 */
window.AIROS = window.AIROS || {};

(function (A) {
  "use strict";

  var CLAVE_LS = "airos_demo_v1";
  var RETARDO_MS = 250; // simula la latencia de red para ver los estados de carga

  // Las 18 horas de la semana del 19 al 22 de octubre de 2026 (id, fecha, hora, entrevistador).
  var H = "Entrevistador A", C = "Entrevistador B"; // nombres ficticios: los reales viven solo en el Sheet
  var HORARIOS_INICIALES = [
    ["h01", "2026-10-19", "17:00", H], ["h02", "2026-10-19", "17:20", H], ["h03", "2026-10-19", "17:40", H],
    ["h04", "2026-10-19", "18:00", C], ["h05", "2026-10-19", "18:30", C],
    ["h06", "2026-10-19", "20:00", C], ["h07", "2026-10-19", "20:30", C],
    ["h08", "2026-10-20", "19:20", H], ["h09", "2026-10-20", "19:40", H], ["h10", "2026-10-20", "20:00", H],
    ["h11", "2026-10-21", "20:00", C], ["h12", "2026-10-21", "20:30", C],
    ["h13", "2026-10-22", "19:00", H], ["h14", "2026-10-22", "19:20", H], ["h15", "2026-10-22", "19:40", H],
    ["h16", "2026-10-22", "18:00", C], ["h17", "2026-10-22", "18:30", C], ["h18", "2026-10-22", "20:00", C]
  ];

  var memoria = null; // respaldo si localStorage no está disponible

  function estadoInicial() {
    return {
      horarios: HORARIOS_INICIALES.map(function (f) {
        return { id: f[0], fecha: f[1], hora: f[2], entrevistador: f[3], estado: "libre" };
      }),
      reservas: [],
      propuestas: []
    };
  }

  // Siempre se lee fresco: así dos pestañas se "pisan" igual que dos personas en el servidor.
  function leer() {
    try {
      var t = localStorage.getItem(CLAVE_LS);
      if (t) return JSON.parse(t);
      var nuevo = estadoInicial();
      localStorage.setItem(CLAVE_LS, JSON.stringify(nuevo));
      return nuevo;
    } catch (e) {
      memoria = memoria || estadoInicial();
      return memoria;
    }
  }
  function guardar(db) {
    try { localStorage.setItem(CLAVE_LS, JSON.stringify(db)); } catch (e) { memoria = db; }
  }

  function err(codigo, mensaje) { return new A.ApiError(codigo, mensaje); }
  function respuesta(fn) {
    return new Promise(function (ok, no) {
      setTimeout(function () { try { ok(fn()); } catch (e) { no(e); } }, RETARDO_MS);
    });
  }

  function claveWa(w) { return String(w).replace(/\D/g, "").slice(-9); }
  function ahoraISO() { return new Date().toISOString(); }
  function copia(o) { return JSON.parse(JSON.stringify(o)); }

  function reservaActivaDe(db, wa) {
    return db.reservas.filter(function (r) { return r.estado === "activa" && claveWa(r.whatsapp) === claveWa(wa); })[0];
  }
  function slotTomado(db, slot) {
    return slot.estado !== "libre" || db.reservas.some(function (r) { return r.estado === "activa" && r.slot_id === slot.id; });
  }

  // Valida WhatsApp + nombre; si no coinciden con una reserva activa, mensaje genérico.
  function buscarPropia(db, d) {
    var wa = A.validar.normalizarWhatsapp(d.whatsapp);
    var nom = A.validar.quitarTildes(A.validar.limpiarTexto(d.nombres));
    var r = wa && nom ? reservaActivaDe(db, wa) : null;
    if (r) {
      var guardado = A.validar.quitarTildes(r.nombres);
      if (guardado !== nom && guardado.indexOf(nom + " ") !== 0 && nom.indexOf(guardado + " ") !== 0) r = null;
    }
    if (!r) throw err("NO_ENCONTRADA", "No encontramos una reserva activa con esos datos. Revisa tu WhatsApp y tu nombre.");
    return r;
  }

  function validarPersona(d) {
    var n = A.validar.nombres(d.nombres), a = A.validar.apellidos(d.apellidos), w = A.validar.whatsapp(d.whatsapp);
    if (n.error || a.error || w.error) throw err("DATOS_INVALIDOS", n.error || a.error || w.error);
    return { nombres: n.valor, apellidos: a.valor, whatsapp: w.valor };
  }

  function generarCodigo(db) {
    var letras = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", c;
    do {
      c = "AIROS-";
      for (var i = 0; i < 5; i++) c += letras.charAt(Math.floor(Math.random() * letras.length));
    } while (db.reservas.some(function (r) { return r.codigo === c; }));
    return c;
  }

  function slotPorId(db, id) {
    var s = db.horarios.filter(function (h) { return h.id === id; })[0];
    if (!s || s.estado === "bloqueada") throw err("HORA_NO_EXISTE", "Esa hora ya no está disponible. Elige otra.");
    return s;
  }
  function exigirLibre(db, s) {
    if (slotTomado(db, s)) throw err("HORA_TOMADA", "Esa hora acaba de ser tomada por otra persona. Elige otra de la lista.");
  }

  A.mock = {
    horarios: function () {
      return respuesta(function () {
        var db = leer();
        return db.horarios.filter(function (h) { return h.estado !== "bloqueada"; }).map(function (h) {
          return { id: h.id, fecha: h.fecha, hora: h.hora, estado: slotTomado(db, h) ? "ocupada" : "libre" };
        });
      });
    },

    reservar: function (d) {
      return respuesta(function () {
        if (d.sitio_web) return { codigo: "AIROS-00000", fecha: "", hora: "" };
        var p = validarPersona(d), db = leer();
        if (reservaActivaDe(db, p.whatsapp)) {
          throw err("YA_TIENE_RESERVA", "Ese WhatsApp ya tiene una reserva activa. Entra a «Mi reserva» para cambiarla o cancelarla.");
        }
        var s = slotPorId(db, String(d.slot_id));
        exigirLibre(db, s);
        var r = {
          codigo: generarCodigo(db), slot_id: s.id, fecha: s.fecha, hora: s.hora, entrevistador: s.entrevistador,
          nombres: p.nombres, apellidos: p.apellidos, whatsapp: p.whatsapp, estado: "activa",
          creada: ahoraISO(), actualizada: ahoraISO(), cancelada_por: ""
        };
        db.reservas.push(r);
        s.estado = "ocupada";
        guardar(db);
        return { codigo: r.codigo, fecha: r.fecha, hora: r.hora };
      });
    },

    consultar: function (d) {
      return respuesta(function () {
        var r = buscarPropia(leer(), d);
        return { codigo: r.codigo, fecha: r.fecha, hora: r.hora, nombres: r.nombres, apellidos: r.apellidos };
      });
    },

    cancelar: function (d) {
      return respuesta(function () {
        var db = leer(), r = buscarPropia(db, d);
        liberar(db, r, "aspirante");
        guardar(db);
        return {};
      });
    },

    // Cambiar = tomar la nueva y liberar la anterior en una sola operación.
    cambiar: function (d) {
      return respuesta(function () {
        var db = leer(), r = buscarPropia(db, d), nuevo = slotPorId(db, String(d.slot_id));
        if (nuevo.id === r.slot_id) throw err("MISMA_HORA", "Esa ya es tu hora reservada. Elige una distinta.");
        exigirLibre(db, nuevo);
        var anterior = db.horarios.filter(function (h) { return h.id === r.slot_id; })[0];
        if (anterior && anterior.estado === "ocupada") anterior.estado = "libre";
        nuevo.estado = "ocupada";
        r.slot_id = nuevo.id; r.fecha = nuevo.fecha; r.hora = nuevo.hora; r.entrevistador = nuevo.entrevistador;
        r.actualizada = ahoraISO();
        guardar(db);
        return { codigo: r.codigo, fecha: r.fecha, hora: r.hora };
      });
    },

    proponer: function (d) {
      return respuesta(function () {
        if (d.sitio_web) return {};
        var p = validarPersona(d), db = leer();
        var t = A.validar.texto(d.propuesta, "propuesta", "Cuéntanos qué día y hora podrías.");
        if (t.error) throw err("DATOS_INVALIDOS", t.error);
        var pendientes = db.propuestas.filter(function (x) { return x.estado === "pendiente" && claveWa(x.whatsapp) === claveWa(p.whatsapp); });
        if (pendientes.length >= 3) throw err("DEMASIADAS_PROPUESTAS", "Ya tienes varias propuestas pendientes. Te escribiremos por WhatsApp para coordinar.");
        db.propuestas.push({
          id: "p" + Date.now().toString(36), creada: ahoraISO(), nombres: p.nombres, apellidos: p.apellidos,
          whatsapp: p.whatsapp, propuesta: t.valor, estado: "pendiente"
        });
        guardar(db);
        return {};
      });
    },

    /* ---- Panel ---- */

    panelListar: function (clave) {
      return respuesta(function () {
        exigirClave(clave);
        var db = leer();
        var slots = db.horarios.map(function (h) {
          var r = db.reservas.filter(function (x) { return x.estado === "activa" && x.slot_id === h.id; })[0];
          return {
            id: h.id, fecha: h.fecha, hora: h.hora, entrevistador: h.entrevistador,
            estado: h.estado === "bloqueada" ? "bloqueada" : (r ? "reservada" : "libre"),
            reserva: r ? { codigo: r.codigo, nombres: r.nombres, apellidos: r.apellidos, whatsapp: r.whatsapp, creada: r.creada } : null
          };
        }).sort(function (a, b) { return (a.fecha + a.hora + a.entrevistador).localeCompare(b.fecha + b.hora + b.entrevistador); });
        var propuestas = copia(db.propuestas);
        return {
          slots: slots, propuestas: propuestas,
          resumen: {
            reservas: slots.filter(function (s) { return s.estado === "reservada"; }).length,
            libres: slots.filter(function (s) { return s.estado === "libre"; }).length,
            propuestas: propuestas.filter(function (p) { return p.estado === "pendiente"; }).length
          }
        };
      });
    },

    panelCancelar: function (clave, codigo) {
      return respuesta(function () {
        exigirClave(clave);
        var db = leer();
        var r = db.reservas.filter(function (x) { return x.codigo === codigo && x.estado === "activa"; })[0];
        if (!r) throw err("NO_ENCONTRADA", "Esa reserva ya no está activa.");
        liberar(db, r, "panel");
        guardar(db);
        return {};
      });
    },

    panelAtender: function (clave, id) {
      return respuesta(function () {
        exigirClave(clave);
        var db = leer();
        var p = db.propuestas.filter(function (x) { return x.id === id; })[0];
        if (!p) throw err("NO_ENCONTRADA", "No se encontró la propuesta.");
        p.estado = "atendida";
        guardar(db);
        return {};
      });
    },

    // Solo demo: borra los datos de prueba.
    reiniciar: function () {
      try { localStorage.removeItem(CLAVE_LS); } catch (e) { /* sin almacenamiento */ }
      memoria = null;
    }
  };

  function liberar(db, r, quien) {
    r.estado = "cancelada"; r.cancelada_por = quien; r.actualizada = ahoraISO();
    var s = db.horarios.filter(function (h) { return h.id === r.slot_id; })[0];
    if (s && s.estado === "ocupada") s.estado = "libre";
  }

  function exigirClave(clave) {
    var esperada = (window.AIROS_CONFIG || {}).DEMO_PANEL_KEY || "demo-airos";
    if (String(clave || "") !== esperada) throw err("CLAVE_INCORRECTA", "La clave no es correcta.");
  }
})(window.AIROS);
