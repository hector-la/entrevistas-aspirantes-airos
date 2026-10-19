/*
 * Utilidades compartidas por la página pública, el panel y el modo demo:
 * formato de fechas/horas, validación de formularios y ayudantes de DOM.
 * Todo cuelga del espacio de nombres global AIROS (sin build ni módulos,
 * para que funcione igual abriendo el HTML local o en GitHub Pages).
 */
window.AIROS = window.AIROS || {};

(function (A) {
  "use strict";

  /* ---------- Fechas y horas ---------- */

  var DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
    "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  var NBSP = " ";

  // "2026-10-19" -> {y, m, d, dow}. Se calcula en UTC para no depender de la zona del navegador.
  function partesFecha(iso) {
    var p = String(iso).split("-").map(Number);
    return { y: p[0], m: p[1], d: p[2], dow: new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay() };
  }

  function capitalizar(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  var fmt = {
    diaNombre: function (iso) { return capitalizar(DIAS[partesFecha(iso).dow]); },
    diaCorto: function (iso) { return DIAS[partesFecha(iso).dow].slice(0, 3); },
    diaNumero: function (iso) { return String(partesFecha(iso).d); },
    mes: function (iso) { return MESES[partesFecha(iso).m - 1]; },
    // "Lunes 19 de octubre"
    diaLargo: function (iso) {
      var p = partesFecha(iso);
      return capitalizar(DIAS[p.dow]) + " " + p.d + " de " + MESES[p.m - 1];
    },
    // "17:00" -> "5:00 p. m."
    hora: function (hhmm) {
      var m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm));
      if (!m) return String(hhmm);
      var h = Number(m[1]);
      var sufijo = h >= 12 ? "p." + NBSP + "m." : "a." + NBSP + "m.";
      var h12 = h % 12 === 0 ? 12 : h % 12;
      return h12 + ":" + m[2] + NBSP + sufijo;
    },
    // "+59399…" -> "099 123 4567" (para mostrar al administrador)
    whatsappLocal: function (canonico) {
      var d = String(canonico).replace(/\D/g, "").slice(-9);
      return d.length === 9 ? "0" + d.slice(0, 2) + " " + d.slice(2, 5) + " " + d.slice(5) : String(canonico);
    }
  };

  // Agrupa [{fecha, hora, ...}] por día, ordenado por fecha y hora.
  function agruparPorDia(slots) {
    var mapa = {};
    slots.forEach(function (s) { (mapa[s.fecha] = mapa[s.fecha] || []).push(s); });
    return Object.keys(mapa).sort().map(function (fecha) {
      mapa[fecha].sort(function (a, b) { return a.hora < b.hora ? -1 : a.hora > b.hora ? 1 : 0; });
      return { fecha: fecha, items: mapa[fecha] };
    });
  }

  /* ---------- Validación (misma lógica que el servidor) ---------- */

  var LIMITES = { nombres: 60, apellidos: 60, propuesta: 300, clave: 100 };
  var RE_NOMBRE = /^[\p{L}][\p{L}\s'’.\-]*$/u;

  function limpiarTexto(v) {
    return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  }

  // 09XXXXXXXX o +5939XXXXXXXX (acepta espacios y guiones). Devuelve "+5939XXXXXXXX" o null.
  function normalizarWhatsapp(v) {
    var s = String(v == null ? "" : v).replace(/[\s\-().]/g, "");
    var m = /^09(\d{8})$/.exec(s) || /^\+?5939(\d{8})$/.exec(s);
    return m ? "+5939" + m[1] : null;
  }

  function quitarTildes(s) {
    return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function validarNombre(v, campo, etiqueta) {
    var t = limpiarTexto(v);
    if (t.length < 2) return { error: "Escribe tus " + etiqueta + "." };
    if (t.length > LIMITES[campo]) return { error: "Máximo " + LIMITES[campo] + " caracteres." };
    if (!RE_NOMBRE.test(t)) return { error: "Usa solo letras, sin números ni símbolos." };
    return { valor: t };
  }

  function validarWhatsapp(v) {
    var n = normalizarWhatsapp(v);
    return n ? { valor: n } : { error: "Escribe un número de Ecuador: 0991234567 o +593991234567." };
  }

  function validarTextoLibre(v, campo, mensajeVacio) {
    var t = limpiarTexto(v);
    if (t.length < 3) return { error: mensajeVacio };
    if (t.length > LIMITES[campo]) return { error: "Máximo " + LIMITES[campo] + " caracteres." };
    return { valor: t };
  }

  /* ---------- DOM ---------- */

  // Crea un elemento: el("button", {class: "x", onclick: fn}, "texto" | nodo | [hijos])
  function el(tag, props, hijos) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k.slice(0, 2) === "on" && typeof v === "function") n.addEventListener(k.slice(2), v);
      else if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else n.setAttribute(k, v === true ? "" : v);
    });
    [].concat(hijos == null ? [] : hijos).forEach(function (h) {
      if (h == null || h === false) return;
      n.appendChild(typeof h === "object" ? h : document.createTextNode(String(h)));
    });
    return n;
  }

  function vaciar(nodo) { while (nodo.firstChild) nodo.removeChild(nodo.firstChild); return nodo; }

  // Marca un campo con error (o lo limpia) y enlaza el mensaje para lectores de pantalla.
  function marcarCampo(input, mensaje) {
    var aviso = document.getElementById(input.id + "-error");
    input.setAttribute("aria-invalid", mensaje ? "true" : "false");
    if (aviso) { aviso.textContent = mensaje || ""; aviso.hidden = !mensaje; }
  }

  // Deshabilita un botón mostrando un texto de carga; devuelve la función que lo restaura.
  function ocupado(boton, textoCarga) {
    var original = boton.textContent;
    boton.disabled = true;
    boton.setAttribute("aria-busy", "true");
    boton.textContent = textoCarga;
    return function () {
      boton.disabled = false;
      boton.removeAttribute("aria-busy");
      boton.textContent = original;
    };
  }

  // Abre/cierra un <dialog> con respaldo para navegadores sin showModal.
  function abrirDialogo(d) { if (typeof d.showModal === "function") { if (!d.open) d.showModal(); } else d.setAttribute("open", ""); }
  function cerrarDialogo(d) { if (typeof d.close === "function") { if (d.open) d.close(); } else d.removeAttribute("open"); }

  A.fmt = fmt;
  A.agruparPorDia = agruparPorDia;
  A.validar = {
    LIMITES: LIMITES,
    limpiarTexto: limpiarTexto,
    normalizarWhatsapp: normalizarWhatsapp,
    quitarTildes: quitarTildes,
    nombres: function (v) { return validarNombre(v, "nombres", "nombres"); },
    apellidos: function (v) { return validarNombre(v, "apellidos", "apellidos"); },
    whatsapp: validarWhatsapp,
    texto: validarTextoLibre
  };
  A.dom = {
    el: el, vaciar: vaciar, marcarCampo: marcarCampo, ocupado: ocupado,
    abrirDialogo: abrirDialogo, cerrarDialogo: cerrarDialogo
  };
})(window.AIROS);
