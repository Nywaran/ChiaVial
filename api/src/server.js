import { crearApp } from "./app.js";
import { config } from "./config.js";
import { migrar } from "./db.js";
import { verificarClave } from "./lib/cifrado.js";
import { crearAdminInicial } from "./scripts/admin-inicial.js";
import { programarIngesta } from "./etl/programador.js";
import { iniciarPolling, configurarWebhook } from "./lib/telegram.js";

verificarClave();
const aplicadas = await migrar();
if (aplicadas.length) console.log("Migraciones aplicadas:", aplicadas.join(", "));
await crearAdminInicial();
programarIngesta();
iniciarPolling();
configurarWebhook().catch((e) => console.error("[telegram] webhook:", e.message));

crearApp().listen(config.puerto, () => {
  console.log(`ChíaVial API escuchando en http://localhost:${config.puerto}`);
});
