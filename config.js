/*
 * Configuración del frontend.
 * Este archivo es PÚBLICO (se publica con GitHub Pages): nunca pongas aquí
 * claves ni datos de aspirantes.
 *
 * API_URL
 *   URL de la aplicación web de Google Apps Script (termina en /exec).
 *   Se obtiene en Apps Script > Implementar > Nueva implementación > Aplicación web.
 *
 * DEMO_MODE
 *   true  -> no se conecta a nada: las reservas se guardan solo en el
 *            localStorage del navegador, con las mismas 18 horas. Sirve para
 *            probar y para mostrar el flujo.
 *   false -> usa el Google Sheet real a través de API_URL.
 *   PARA PRODUCCIÓN: pon DEMO_MODE en false y pega la API_URL real.
 *
 * DEMO_PANEL_KEY
 *   Clave del panel SOLO en modo demo. En producción la clave vive en las
 *   propiedades del script (PANEL_KEY) y se valida en el servidor.
 */
window.AIROS_CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbznpH8SUusyc4GlouTGMGfTld8sByRKBRKTa_Qb0mTryN9HqPRoRKt5020_69mTDYL8IQ/exec",
  DEMO_MODE: false,
  DEMO_PANEL_KEY: "demo-airos"
};
