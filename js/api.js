/*
 * Cliente de la API.
 * Elige entre el backend real (Google Apps Script) y el modo demo (mock.js)
 * según config.js. Ambos exponen exactamente la misma interfaz:
 *
 *   horarios()                         -> [{id, fecha, hora, estado}]
 *   reservar({...})                    -> {codigo, fecha, hora}
 *   consultar({whatsapp, nombres})     -> {codigo, fecha, hora, nombres, apellidos}
 *   cancelar({whatsapp, nombres})      -> {}
 *   cambiar({whatsapp, nombres, slot_id}) -> {codigo, fecha, hora}
 *   proponer({...})                    -> {}
 *   panelListar(clave) / panelCancelar(clave, codigo) / panelAtender(clave, id)
 *
 * Los errores llegan como ApiError con `codigo` (p. ej. HORA_TOMADA) y un
 * mensaje listo para mostrar al usuario.
 */
(function (A) {
  "use strict";

  var cfg = window.AIROS_CONFIG || {};
  var ESPERA_MS = 25000;

  function ApiError(codigo, mensaje) {
    this.name = "ApiError";
    this.codigo = codigo;
    this.message = mensaje;
  }
  ApiError.prototype = Object.create(Error.prototype);
  A.ApiError = ApiError;

  /*
   * Llamada al backend real. Apps Script no responde bien al preflight de CORS,
   * así que se envía "text/plain" (petición simple, sin preflight) con el JSON
   * dentro del cuerpo. La respuesta siempre es JSON con ok:true|false.
   */
  function llamar(accion, datos) {
    if (!cfg.API_URL || /^PEGA_AQUI/.test(cfg.API_URL)) {
      return Promise.reject(new ApiError("SIN_CONFIG",
        "La página aún no está conectada al servidor. Falta configurar API_URL en config.js."));
    }
    var control = new AbortController();
    var temporizador = setTimeout(function () { control.abort(); }, ESPERA_MS);
    var cuerpo = Object.assign({ accion: accion }, datos || {});

    return fetch(cfg.API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(cuerpo),
      redirect: "follow",
      signal: control.signal
    }).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    }).then(function (r) {
      if (!r || r.ok !== true) throw new ApiError((r && r.codigo) || "ERROR", (r && r.error) || "No se pudo completar la acción.");
      return r.datos || {};
    }).catch(function (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError("RED", "No hay conexión con el servidor. Revisa tu internet e inténtalo otra vez.");
    }).then(function (ok) { clearTimeout(temporizador); return ok; },
      function (e) { clearTimeout(temporizador); throw e; });
  }

  var real = {
    horarios: function () { return llamar("horarios").then(function (d) { return d.horarios || []; }); },
    reservar: function (d) { return llamar("reservar", d); },
    consultar: function (d) { return llamar("consultar", d); },
    cancelar: function (d) { return llamar("cancelar", d); },
    cambiar: function (d) { return llamar("cambiar", d); },
    proponer: function (d) { return llamar("proponer", d); },
    panelListar: function (clave) { return llamar("panel_listar", { clave: clave }); },
    panelCancelar: function (clave, codigo) { return llamar("panel_cancelar", { clave: clave, codigo: codigo }); },
    panelAtender: function (clave, id) { return llamar("panel_atender", { clave: clave, id: id }); }
  };

  A.demo = !!cfg.DEMO_MODE;
  A.api = A.demo ? A.mock : real;
})(window.AIROS);
