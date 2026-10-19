/*
 * Panel interno. La clave se envía al servidor en cada llamada y SOLO el
 * servidor la valida; aquí nunca se compara. Se guarda en sessionStorage
 * (se borra al cerrar la pestaña) para no pedirla en cada recarga.
 */
(function (A) {
  "use strict";

  var el = A.dom.el, vaciar = A.dom.vaciar, fmt = A.fmt;
  var $ = function (id) { return document.getElementById(id); };
  var CLAVE_SS = "airos_panel_clave";

  var estado = { clave: "", datos: null, filtro: "Todos" };

  /* ---------- Sesión ---------- */

  function leerClaveGuardada() { try { return sessionStorage.getItem(CLAVE_SS) || ""; } catch (e) { return ""; } }
  function guardarClave(c) { try { if (c) sessionStorage.setItem(CLAVE_SS, c); else sessionStorage.removeItem(CLAVE_SS); } catch (e) { /* sin almacenamiento */ } }

  function entrar(clave) {
    return A.api.panelListar(clave).then(function (d) {
      estado.clave = clave;
      guardarClave(clave);
      estado.datos = d;
      $("acceso").hidden = true;
      $("contenido").hidden = false;
      pintar();
    });
  }

  function salir() {
    estado.clave = ""; estado.datos = null;
    guardarClave("");
    $("contenido").hidden = true;
    $("acceso").hidden = false;
    $("form-acceso").reset();
    $("clave").focus();
  }

  $("form-acceso").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var campo = $("clave"), clave = campo.value;
    var err = $("acceso-error");
    err.hidden = true;
    if (!clave) { A.dom.marcarCampo(campo, "Escribe la clave."); campo.focus(); return; }
    A.dom.marcarCampo(campo, "");
    var restaurar = A.dom.ocupado(this.querySelector("[type=submit]"), "Entrando…");
    entrar(clave).then(restaurar).catch(function (e) {
      restaurar();
      err.textContent = e.message;
      err.hidden = false;
      campo.select();
    });
  });

  /* ---------- Carga y errores ---------- */

  function mostrarError(t) { var n = $("panel-error"); n.textContent = t || ""; n.hidden = !t; }
  function mostrarAviso(t) { var n = $("panel-aviso"); n.textContent = t || ""; n.hidden = !t; }

  function recargar(mensaje) {
    mostrarError("");
    return A.api.panelListar(estado.clave).then(function (d) {
      estado.datos = d;
      pintar();
      if (mensaje) mostrarAviso(mensaje);
    }).catch(function (e) {
      if (e.codigo === "CLAVE_INCORRECTA") { salir(); $("acceso-error").textContent = "La sesión expiró. Escribe la clave otra vez."; $("acceso-error").hidden = false; }
      else mostrarError(e.message);
    });
  }

  /* ---------- Pintar ---------- */

  function pintar() {
    var d = estado.datos;
    $("n-reservas").textContent = d.resumen.reservas;
    $("n-libres").textContent = d.resumen.libres;
    $("n-propuestas").textContent = d.resumen.propuestas;
    pintarFiltro();
    pintarAgenda();
    pintarPropuestas();
  }

  function entrevistadores() {
    var set = {};
    estado.datos.slots.forEach(function (s) { if (s.entrevistador) set[s.entrevistador] = 1; });
    return ["Todos"].concat(Object.keys(set).sort());
  }

  function pintarFiltro() {
    var cont = vaciar($("filtro"));
    entrevistadores().forEach(function (n) {
      cont.appendChild(el("button", {
        type: "button", "aria-pressed": String(estado.filtro === n),
        onclick: function () { estado.filtro = n; pintarFiltro(); pintarAgenda(); }
      }, n));
    });
  }

  function enlaceWhatsapp(canonico) {
    var num = String(canonico).replace(/\D/g, "");
    return el("a", { href: "https://wa.me/" + num, target: "_blank", rel: "noopener noreferrer" }, fmt.whatsappLocal(canonico));
  }

  function pintarAgenda() {
    var cont = vaciar($("agenda"));
    var slots = estado.datos.slots.filter(function (s) { return estado.filtro === "Todos" || s.entrevistador === estado.filtro; });
    if (!slots.length) { cont.appendChild(el("p", { class: "p-vacio" }, "No hay horas para mostrar.")); return; }

    A.agruparPorDia(slots).forEach(function (dia) {
      var reservadas = dia.items.filter(function (s) { return s.estado === "reservada"; }).length;
      cont.appendChild(el("div", { class: "p-dia" }, [
        el("h3", { class: "p-dia__titulo" }, [fmt.diaLargo(dia.fecha), el("span", null, reservadas + " de " + dia.items.length + " reservadas")]),
        el("ul", { class: "p-lista" }, dia.items.map(filaSlot))
      ]));
    });
  }

  function filaSlot(s) {
    var r = s.reserva;
    var etiqueta = { reservada: "Reservada", libre: "Libre", bloqueada: "Bloqueada" }[s.estado] || s.estado;
    var quien = r
      ? el("div", { class: "p-quien" }, [r.nombres + " " + r.apellidos, el("span", { class: "etiqueta etiqueta--reservada" }, etiqueta), el("small", null, r.codigo)])
      : el("div", { class: "p-quien" }, [el("em", { class: "p-libre" }, s.estado === "bloqueada" ? "No disponible" : "Sin reservar"), el("span", { class: "etiqueta etiqueta--" + s.estado }, etiqueta)]);
    return el("li", { class: "p-fila p-fila--" + s.estado }, [
      el("span", { class: "p-hora" }, fmt.hora(s.hora)),
      el("span", { class: "p-ent" }, s.entrevistador),
      quien,
      r ? el("span", { class: "p-wa" }, enlaceWhatsapp(r.whatsapp)) : null,
      r ? el("span", { class: "p-accion" }, el("button", {
        type: "button", class: "boton boton--peligro",
        "aria-label": "Cancelar la reserva de " + r.nombres + " " + r.apellidos,
        onclick: function () { cancelarReserva(s); }
      }, "Cancelar")) : null
    ]);
  }

  function pintarPropuestas() {
    var cont = vaciar($("propuestas"));
    var pend = estado.datos.propuestas.filter(function (p) { return p.estado === "pendiente"; });
    if (!pend.length) { cont.appendChild(el("p", { class: "p-vacio" }, "No hay propuestas pendientes.")); return; }
    pend.forEach(function (p) {
      cont.appendChild(el("article", { class: "p-prop" }, [
        el("div", null, [el("strong", null, p.nombres + " " + p.apellidos), " · ", enlaceWhatsapp(p.whatsapp)]),
        el("p", { class: "p-prop__texto" }, p.propuesta),
        el("span", { class: "p-prop__meta" }, "Enviada " + String(p.creada).slice(0, 16).replace("T", " ")),
        el("button", { type: "button", class: "boton boton--sec", onclick: function () { marcarAtendida(p); } }, "Marcar como atendida")
      ]));
    });
  }

  /* ---------- Acciones ---------- */

  function cancelarReserva(s) {
    var r = s.reserva;
    confirmar("¿Cancelar esta reserva?",
      r.nombres + " " + r.apellidos + " perderá " + fmt.diaLargo(s.fecha) + ", " + fmt.hora(s.hora) + ". La hora quedará libre. Avísale por WhatsApp.",
      "Sí, cancelar reserva", "No, mantenerla").then(function (si) {
      if (!si) return;
      A.api.panelCancelar(estado.clave, r.codigo).then(function () {
        recargar("Reserva " + r.codigo + " cancelada.");
      }).catch(function (e) { mostrarError(e.message); recargar(); });
    });
  }

  function marcarAtendida(p) {
    A.api.panelAtender(estado.clave, p.id).then(function () { recargar("Propuesta marcada como atendida."); })
      .catch(function (e) { mostrarError(e.message); });
  }

  function confirmar(titulo, texto, si, no) {
    var dlg = $("dlg-confirmar"), resultado = false;
    $("dk-titulo").textContent = titulo;
    $("dk-texto").textContent = texto;
    $("dk-si").textContent = si;
    $("dk-no").textContent = no;
    return new Promise(function (ok) {
      $("dk-si").onclick = function () { resultado = true; A.dom.cerrarDialogo(dlg); };
      $("dk-no").onclick = function () { A.dom.cerrarDialogo(dlg); };
      dlg.addEventListener("close", function () { ok(resultado); }, { once: true });
      A.dom.abrirDialogo(dlg);
      $("dk-no").focus();
    });
  }

  /* ---------- Exportar CSV ---------- */

  // Escapa comillas y neutraliza fórmulas (=, +, -, @) para que Excel no las ejecute.
  function celda(v) {
    var t = String(v == null ? "" : v);
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
    return '"' + t.replace(/"/g, '""') + '"';
  }

  function descargarCsv(nombre, filas) {
    var texto = "﻿" + filas.map(function (f) { return f.map(celda).join(","); }).join("\r\n");
    var url = URL.createObjectURL(new Blob([texto], { type: "text/csv;charset=utf-8" }));
    var a = el("a", { href: url, download: nombre });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function sello() { return new Date().toISOString().slice(0, 10); }

  $("btn-csv").addEventListener("click", function () {
    var filas = [["Fecha", "Día", "Hora", "Entrevistador", "Estado", "Nombres", "Apellidos", "WhatsApp", "Código"]];
    estado.datos.slots.forEach(function (s) {
      var r = s.reserva || {};
      filas.push([s.fecha, fmt.diaNombre(s.fecha), s.hora, s.entrevistador, s.estado,
        r.nombres || "", r.apellidos || "", r.whatsapp ? fmt.whatsappLocal(r.whatsapp).replace(/\s/g, "") : "", r.codigo || ""]);
    });
    descargarCsv("agenda-entrevistas-" + sello() + ".csv", filas);
  });

  $("btn-csv-prop").addEventListener("click", function () {
    var filas = [["Creada", "Nombres", "Apellidos", "WhatsApp", "Propuesta", "Estado"]];
    estado.datos.propuestas.forEach(function (p) {
      filas.push([p.creada, p.nombres, p.apellidos, fmt.whatsappLocal(p.whatsapp).replace(/\s/g, ""), p.propuesta, p.estado]);
    });
    descargarCsv("propuestas-entrevistas-" + sello() + ".csv", filas);
  });

  $("btn-actualizar").addEventListener("click", function () { recargar("Datos actualizados."); });
  $("btn-salir").addEventListener("click", salir);
  document.addEventListener("visibilitychange", function () { if (!document.hidden && estado.clave) recargar(); });

  /* ---------- Arranque ---------- */

  if (A.demo) {
    $("demo-aviso").hidden = false;
    $("demo-clave").textContent = (window.AIROS_CONFIG || {}).DEMO_PANEL_KEY || "demo-airos";
  }
  var guardada = leerClaveGuardada();
  if (guardada) entrar(guardada).catch(function () { guardarClave(""); });
})(window.AIROS);
