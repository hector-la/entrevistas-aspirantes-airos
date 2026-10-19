# Entrevistas de aspirantes · AIROS ESPOL

Web para que los aspirantes de AIROS (Sociedad de Inteligencia Artificial y Robótica de ESPOL) reserven la hora de su entrevista virtual de 20 minutos. La web solo registra y archiva la reserva: el enlace de la reunión se envía por WhatsApp.

- **Frontend:** HTML, CSS y JS sin build, para GitHub Pages.
- **Backend:** Google Apps Script sobre un Google Sheet privado (`Horarios`, `Reservas`, `Propuestas`).

## Cómo se usa

**Aspirante** (`index.html`): elige una hora libre, escribe nombres, apellidos y WhatsApp (Ecuador) y recibe un código. En «Mi reserva» puede cambiar o cancelar con su WhatsApp y nombre. Si ninguna hora le sirve, deja una propuesta. No ve quién lo entrevista.

**Administradores** (`panel.html`): entran con la clave del panel y ven la agenda de ambos entrevistadores, las propuestas pendientes y los contadores. Pueden cancelar reservas, marcar propuestas como atendidas y exportar CSV. Para agregar horas, añadan una fila en la pestaña `Horarios` del Sheet (id único, fecha `AAAA-MM-DD`, hora `HH:mm`, entrevistador, estado `libre`). Para ocultar una hora, pongan `bloqueada`.

## Desplegar

1. Crea un Google Sheet **privado** (vacío).
2. En el Sheet: *Extensiones > Apps Script*. Pega `apps-script/Code.gs`, guarda y ejecuta `setup()` (autoriza los permisos). Crea las tres pestañas con sus encabezados y carga las 18 horas.
3. En *Configuración del proyecto > Propiedades del script* agrega `PANEL_KEY` con una clave larga y aleatoria. Solo vive ahí.
4. *Implementar > Nueva implementación > Aplicación web*: ejecutar como **Yo**, acceso **Cualquier persona**. Copia la URL que termina en `/exec`.
5. En `config.js` pega la URL en `API_URL` y cambia `DEMO_MODE` a `false`.
6. Sube el repo a GitHub y activa *Settings > Pages* (rama `main`, carpeta raíz).

Si cambias `Code.gs`, crea una **nueva versión** de la implementación (la URL se mantiene).

### Encabezados del Sheet (los crea `setup()`)

| Pestaña | Columnas |
|---|---|
| `Horarios` | id, fecha, hora, entrevistador, estado |
| `Reservas` | codigo, slot_id, fecha, hora, entrevistador, nombres, apellidos, whatsapp, estado, creada, actualizada, cancelada_por |
| `Propuestas` | id, creada, nombres, apellidos, whatsapp, propuesta, estado |

## Modo demo

Con `DEMO_MODE: true` (valor inicial) no hace falta servidor: las reservas se guardan en el `localStorage` del navegador con las mismas 18 horas, y la clave del panel es `DEMO_PANEL_KEY` de `config.js`. Para apagarlo, pon `DEMO_MODE: false`. Para probar en local: `python3 -m http.server` en esta carpeta.

## Privacidad

El repo es público: no contiene datos de aspirantes ni claves. Los datos viven solo en el Sheet privado. La clave del panel se valida en el servidor (Script Properties), con límite de intentos fallidos. Los endpoints públicos devuelven solo id, fecha, hora y estado. No subas exportaciones CSV (el `.gitignore` las excluye).

## Créditos y licencia

Logo e identidad: manual de marca de AIROS. Tipografías Montserrat y Orbitron (SIL OFL, en `assets/fonts`). Código bajo licencia MIT.
