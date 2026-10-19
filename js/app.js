/*
 * Página pública: elegir hora, reservar, consultar/cambiar/cancelar y
 * proponer otro horario. La página nunca muestra quién entrevista:
 * la API pública solo entrega id, fecha, hora y estado.
 */
(function (A) {
  "use strict";

  var el = A.dom.el, vaciar = A.dom.vaciar, fmt = A.fmt;
  var $ = function (id) { return document.getElementById(id); };

  var VISTAS = {
    "#reservar": "agenda", "#mi-reserva": "mi-reserva", "#otra-hora": "propuesta"
  };

  // Estado en memoria. Los datos personales nunca se guardan en el navegador.
  var estado = {
    slots: [],            // todas las horas públicas (libres y ocupadas)
    cargando: false,
    errorCarga: false,
    elegida: null,        // hora escogida en el diálogo de reserva
    mi: null,             // {whatsapp, nombres, reserva} tras consultar
    propuestaEnviada: false
  };

  /* ================= Avisos y vistas ================= */

  var temporizadorAviso = null;
  function aviso(texto, tipo) {
    var n = $("aviso");
    clearTimeout(temporizadorAviso);
    if (!texto) { n.hidden = true; n.textContent = ""; return; }
    n.textContent = texto;
    n.className = "aviso aviso--" + (tipo || "info");
    n.hidden = false;
    if (tipo !== "error") temporizadorAviso = setTimeout(function () { n.hidden = true; }, 10000);
  }

  function mostrar(vista, opciones) {
    opciones = opciones || {};
    ["agenda", "mi-reserva", "propuesta", "confirmacion"].forEach(function (v) { $("vista-" + v).hidden = v !== vista; });
    [].forEach.call(document.querySelectorAll(".pestana"), function (a) {
      if (a.getAttribute("data-vista") === vista) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    if (vista !== "propuesta") restablecerPropuesta();
    if (!opciones.inicial) {
      aviso("");
      window.scrollTo(0, 0);
      var h = document.querySelector("#vista-" + vista + " h2");
      if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
    }
  }

  function vistaDeHash() { return VISTAS[location.hash] || "agenda"; }

  /* ================= Agenda ================= */

  function cargarHorarios() {
    if (estado.cargando) return Promise.resolve();
    estado.cargando = true;
    estado.errorCarga = false;
    pintarAgenda();
    return A.api.horarios().then(function (slots) {
      estado.slots = slots;
    }).catch(function (e) {
      estado.errorCarga = e.message;
    }).then(function () {
      estado.cargando = false;
      pintarAgenda();
    });
  }

  // Dibuja las horas en un contenedor: un bloque por día con sus horas libres.
  function dibujarHoras(contenedor, slots, alElegir, excluir) {
    vaciar(contenedor);
    var dias = A.agruparPorDia(slots);
    if (!dias.length) {
      contenedor.appendChild(el("p", { class: "vacio" }, "Todavía no hay horas publicadas."));
      return;
    }
    dias.forEach(function (dia) {
      var libres = dia.items.filter(function (s) {
        return s.estado === "libre" && !(excluir && excluir.fecha === s.fecha && excluir.hora === s.hora);
      });
      var lista = el("ul", { class: "horas" }, libres.map(function (s) {
        return el("li", null, el("button", {
          type: "button", class: "hora",
          "aria-label": fmt.diaLargo(s.fecha) + ", " + fmt.hora(s.hora),
          onclick: function () { alElegir(s); }
        }, fmt.hora(s.hora)));
      }));
      contenedor.appendChild(el("section", { class: "dia", "aria-label": fmt.diaLargo(dia.fecha) }, [
        el("div", { class: "dia__fecha" }, [
          el("span", { class: "dia__num", "aria-hidden": "true" }, fmt.diaNumero(dia.fecha)),
          el("span", { class: "dia__nombre" }, fmt.diaNombre(dia.fecha)),
          el("span", { class: "dia__mes" }, fmt.mes(dia.fecha))
        ]),
        el("div", { class: "dia__horas" }, libres.length ? lista : el("p", { class: "dia__completo" }, "Sin horas libres"))
      ]));
    });
  }

  function pintarAgenda() {
    var cont = $("agenda"), contador = $("contador");
    cont.setAttribute("aria-busy", estado.cargando ? "true" : "false");

    if (estado.cargando && !estado.slots.length) {
      vaciar(cont);
      for (var i = 0; i < 3; i++) {
        cont.appendChild(el("div", { class: "dia dia--esqueleto", "aria-hidden": "true" }, [
          el("div", { class: "dia__fecha" }, el("span", { class: "esqueleto esqueleto--num" })),
          el("div", { class: "dia__horas" }, el("ul", { class: "horas" }, [1, 2, 3, 4].map(function () {
            return el("li", null, el("span", { class: "esqueleto esqueleto--hora" }));
          })))
        ]));
      }
      contador.textContent = "Cargando horas…";
      return;
    }

    if (estado.errorCarga && !estado.slots.length) {
      vaciar(cont);
      contador.textContent = "";
      cont.appendChild(el("div", { class: "error-caja", role: "alert" }, [
        el("p", null, "No pudimos cargar las horas. " + estado.errorCarga),
        el("button", { type: "button", class: "boton boton--sec", onclick: cargarHorarios }, "Reintentar")
      ]));
      return;
    }

    var libres = estado.slots.filter(function (s) { return s.estado === "libre"; }).length;
    contador.textContent = libres
      ? libres + " de " + estado.slots.length + " horas libres"
      : "No quedan horas libres";
    dibujarHoras(cont, estado.slots, abrirReserva);
    if (!libres && estado.slots.length) {
      cont.appendChild(el("p", { class: "vacio" }, [
        "Ya no quedan horas. ", el("a", { href: "#otra-hora" }, "Propón otro horario"), " y te escribimos."
      ]));
    }
  }

  /* ================= Reservar ================= */

  var formReserva = $("form-reserva");

  function abrirReserva(slot) {
    estado.elegida = slot;
    $("dr-cuando").textContent = fmt.diaLargo(slot.fecha) + ", " + fmt.hora(slot.hora);
    limpiarErrores(formReserva, "r-error");
    A.dom.abrirDialogo($("dlg-reservar"));
    $("r-nombres").focus();
  }

  function limpiarErrores(form, idError) {
    [].forEach.call(form.querySelectorAll("input, textarea"), function (i) { A.dom.marcarCampo(i, ""); });
    mostrarErrorForm(idError, "");
  }
  function mostrarErrorForm(id, texto) {
    var n = $(id);
    n.textContent = texto || "";
    n.hidden = !texto;
  }

  // Valida una lista de [input, resultadoDeValidación]; enfoca el primero con error.
  function aplicarValidacion(pares) {
    var primero = null, datos = {};
    pares.forEach(function (p) {
      var input = p[0], r = p[1];
      A.dom.marcarCampo(input, r.error || "");
      if (r.error && !primero) primero = input;
      else datos[input.name] = r.valor;
    });
    if (primero) { primero.focus(); return null; }
    return datos;
  }

  formReserva.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var f = formReserva.elements;
    mostrarErrorForm("r-error", "");
    var datos = aplicarValidacion([
      [f.nombres, A.validar.nombres(f.nombres.value)],
      [f.apellidos, A.validar.apellidos(f.apellidos.value)],
      [f.whatsapp, A.validar.whatsapp(f.whatsapp.value)]
    ]);
    if (!datos || !estado.elegida) return;
    datos.slot_id = estado.elegida.id;
    datos.sitio_web = f.sitio_web.value; // señuelo anti-bots: un humano lo deja vacío

    var boton = formReserva.querySelector("[type=submit]");
    var restaurar = A.dom.ocupado(boton, "Reservando…");
    A.api.reservar(datos).then(function (r) {
      restaurar();
      formReserva.reset();
      A.dom.cerrarDialogo($("dlg-reservar"));
      mostrarConfirmacion(r);
      cargarHorarios();
    }).catch(function (e) {
      restaurar();
      if (e.codigo === "HORA_TOMADA" || e.codigo === "HORA_NO_EXISTE" || e.codigo === "HORA_PASADA") {
        // Otra persona se adelantó: se cierra el formulario y se refresca la lista.
        A.dom.cerrarDialogo($("dlg-reservar"));
        aviso(e.message, "error");
        cargarHorarios();
      } else {
        mostrarErrorForm("r-error", e.message);
      }
    });
  });

  function mostrarConfirmacion(r) {
    $("conf-cuando").textContent = fmt.diaLargo(r.fecha) + ", " + fmt.hora(r.hora) + " (hora de Guayaquil)";
    $("conf-codigo").textContent = r.codigo;
    $("btn-copiar").textContent = "Copiar código";
    mostrar("confirmacion");
  }

  $("btn-copiar").addEventListener("click", function () {
    var boton = this, codigo = $("conf-codigo").textContent;
    function listo(ok) {
      boton.textContent = ok ? "Código copiado" : "Selecciona y copia el código";
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(codigo).then(function () { listo(true); }, function () { listo(false); });
    } else {
      listo(false);
    }
  });

  /* ================= Mi reserva ================= */

  var formConsulta = $("form-consulta");

  formConsulta.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var f = formConsulta.elements;
    mostrarErrorForm("c-error", "");
    var datos = aplicarValidacion([
      [f.whatsapp, A.validar.whatsapp(f.whatsapp.value)],
      [f.nombres, A.validar.nombres(f.nombres.value)]
    ]);
    if (!datos) return;
    var restaurar = A.dom.ocupado(formConsulta.querySelector("[type=submit]"), "Buscando…");
    A.api.consultar(datos).then(function (r) {
      restaurar();
      estado.mi = { whatsapp: datos.whatsapp, nombres: datos.nombres, reserva: r };
      pintarMiReserva("");
    }).catch(function (e) {
      restaurar();
      mostrarErrorForm("c-error", e.message);
    });
  });

  function pintarMiReserva(mensaje, tipo) {
    var cont = $("mi-resultado"), r = estado.mi.reserva;
    vaciar(cont);
    $("form-consulta").hidden = true;
    cont.hidden = false;
    cont.appendChild(el("article", { class: "tarjeta-reserva" }, [
      mensaje ? el("p", { class: "aviso aviso--" + (tipo || "ok") }, mensaje) : null,
      el("p", { class: "tarjeta-reserva__cuando" }, [
        el("span", { class: "tarjeta-reserva__dia" }, fmt.diaLargo(r.fecha)),
        el("span", { class: "tarjeta-reserva__hora" }, fmt.hora(r.hora) + " (hora de Guayaquil)")
      ]),
      el("p", { class: "tarjeta-reserva__datos" }, r.nombres + " " + r.apellidos + " · código " + r.codigo),
      el("div", { class: "acciones" }, [
        el("button", { type: "button", class: "boton", onclick: abrirCambio }, "Cambiar hora"),
        el("button", { type: "button", class: "boton boton--peligro", onclick: pedirCancelacion }, "Cancelar reserva")
      ]),
      el("button", { type: "button", class: "enlace", onclick: salirMiReserva }, "Buscar con otros datos")
    ]));
  }

  function salirMiReserva() {
    estado.mi = null;
    $("mi-resultado").hidden = true;
    vaciar($("mi-resultado"));
    formConsulta.hidden = false;
    formConsulta.reset();
    $("c-whatsapp").focus();
  }

  function abrirCambio() {
    var actual = estado.mi.reserva;
    $("dc-agenda").setAttribute("aria-busy", "true");
    vaciar($("dc-agenda")).appendChild(el("p", { class: "vacio" }, "Cargando horas…"));
    A.dom.abrirDialogo($("dlg-cambiar"));
    // Se pide la lista fresca para no ofrecer horas que ya se tomaron.
    A.api.horarios().then(function (slots) {
      estado.slots = slots;
      pintarAgenda();
      var libres = slots.filter(function (s) { return s.estado === "libre" && !(s.fecha === actual.fecha && s.hora === actual.hora); });
      if (!libres.length) {
        vaciar($("dc-agenda")).appendChild(el("p", { class: "vacio" }, "No hay otras horas libres por ahora. Puedes proponer otro horario."));
      } else {
        dibujarHoras($("dc-agenda"), slots, confirmarCambio, actual);
      }
    }).catch(function (e) {
      vaciar($("dc-agenda")).appendChild(el("p", { class: "error-form", role: "alert" }, e.message));
    }).then(function () { $("dc-agenda").setAttribute("aria-busy", "false"); });
  }

  function confirmarCambio(nuevo) {
    var actual = estado.mi.reserva;
    A.dom.cerrarDialogo($("dlg-cambiar"));
    confirmar({
      titulo: "¿Cambiar tu hora?",
      texto: "Pasarás de " + fmt.diaLargo(actual.fecha) + ", " + fmt.hora(actual.hora) + " a " +
        fmt.diaLargo(nuevo.fecha) + ", " + fmt.hora(nuevo.hora) + ". Tu hora anterior quedará libre.",
      si: "Sí, cambiar hora", no: "No, mantener la mía"
    }).then(function (acepto) {
      if (!acepto) return;
      return A.api.cambiar({ whatsapp: estado.mi.whatsapp, nombres: estado.mi.nombres, slot_id: nuevo.id })
        .then(function (r) {
          estado.mi.reserva = Object.assign({}, estado.mi.reserva, { fecha: r.fecha, hora: r.hora, codigo: r.codigo });
          pintarMiReserva("Listo, cambiaste tu hora.");
          cargarHorarios();
        }).catch(function (e) {
          var libre = e.codigo === "HORA_TOMADA" || e.codigo === "HORA_NO_EXISTE" || e.codigo === "HORA_PASADA";
          pintarMiReserva(e.message + (libre ? " Tu hora actual sigue reservada." : ""), "error");
          cargarHorarios();
        });
    });
  }

  function pedirCancelacion() {
    var r = estado.mi.reserva;
    confirmar({
      titulo: "¿Cancelar tu reserva?",
      texto: "Se liberará " + fmt.diaLargo(r.fecha) + ", " + fmt.hora(r.hora) + ". Después podrás reservar otra hora.",
      si: "Sí, cancelar reserva", no: "No, mantenerla", peligro: true
    }).then(function (acepto) {
      if (!acepto) return;
      return A.api.cancelar({ whatsapp: estado.mi.whatsapp, nombres: estado.mi.nombres }).then(function () {
        estado.mi = null;
        var cont = vaciar($("mi-resultado"));
        cont.appendChild(el("div", { class: "exito" }, [
          el("h3", { tabindex: "-1", id: "mi-cancelada" }, "Reserva cancelada"),
          el("p", null, "Tu hora quedó libre. Si aún quieres entrevistarte, elige otra."),
          el("a", { class: "boton", href: "#reservar" }, "Elegir otra hora")
        ]));
        $("mi-cancelada").focus();
        cargarHorarios();
      }).catch(function (e) {
        pintarMiReserva(e.message, "error");
      });
    });
  }

  /* ================= Propuesta de otro horario ================= */

  var formPropuesta = $("form-propuesta");

  function restablecerPropuesta() {
    if (!estado.propuestaEnviada) return;
    estado.propuestaEnviada = false;
    formPropuesta.hidden = false;
    $("propuesta-ok").hidden = true;
  }

  formPropuesta.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var f = formPropuesta.elements;
    mostrarErrorForm("p-error", "");
    var datos = aplicarValidacion([
      [f.nombres, A.validar.nombres(f.nombres.value)],
      [f.apellidos, A.validar.apellidos(f.apellidos.value)],
      [f.whatsapp, A.validar.whatsapp(f.whatsapp.value)],
      [f.propuesta, A.validar.texto(f.propuesta.value, "propuesta", "Cuéntanos qué día y hora podrías.")]
    ]);
    if (!datos) return;
    datos.sitio_web = f.sitio_web.value;
    var restaurar = A.dom.ocupado(formPropuesta.querySelector("[type=submit]"), "Enviando…");
    A.api.proponer(datos).then(function () {
      restaurar();
      formPropuesta.reset();
      estado.propuestaEnviada = true;
      formPropuesta.hidden = true;
      $("propuesta-ok").hidden = false;
      $("propuesta-ok").querySelector("h3").focus();
    }).catch(function (e) {
      restaurar();
      mostrarErrorForm("p-error", e.message);
    });
  });

  /* ================= Diálogos ================= */

  // Confirmación genérica: devuelve una promesa que resuelve true/false.
  function confirmar(o) {
    var dlg = $("dlg-confirmar"), si = $("dk-si"), no = $("dk-no"), resultado = false;
    $("dk-titulo").textContent = o.titulo;
    $("dk-texto").textContent = o.texto;
    si.textContent = o.si;
    no.textContent = o.no;
    si.className = "boton" + (o.peligro ? " boton--peligro" : "");
    return new Promise(function (resolver) {
      si.onclick = function () { resultado = true; A.dom.cerrarDialogo(dlg); };
      no.onclick = function () { A.dom.cerrarDialogo(dlg); };
      dlg.addEventListener("close", function () { resolver(resultado); }, { once: true });
      A.dom.abrirDialogo(dlg);
      no.focus();
    });
  }

  // Cerrar con los botones [data-cerrar] y al tocar el fondo oscuro.
  [].forEach.call(document.querySelectorAll("dialog"), function (d) {
    d.addEventListener("click", function (ev) { if (ev.target === d) A.dom.cerrarDialogo(d); });
    [].forEach.call(d.querySelectorAll("[data-cerrar]"), function (b) {
      b.addEventListener("click", function () { A.dom.cerrarDialogo(d); });
    });
  });

  /* ================= Arranque ================= */

  // Los enlaces internos también llaman a mostrar(): así «Elegir hora» funciona
  // incluso estando ya en #reservar (donde hashchange no se dispara).
  document.addEventListener("click", function (ev) {
    var a = ev.target.closest && ev.target.closest('a[href^="#"]');
    if (a && VISTAS[a.getAttribute("href")]) mostrar(VISTAS[a.getAttribute("href")]);
  });
  window.addEventListener("hashchange", function () { mostrar(vistaDeHash()); });
  $("btn-actualizar").addEventListener("click", cargarHorarios);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && !$("vista-agenda").hidden) cargarHorarios();
  });

  if (A.demo) $("demo-aviso").hidden = false;
  mostrar(vistaDeHash(), { inicial: true });
  cargarHorarios();
})(window.AIROS);
