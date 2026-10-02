import { crearApp } from "./app.js";
import { config } from "./config.js";
import { migrar } from "./db.js";
import { crearAdminInicial } from "./scripts/admin-inicial.js";
import { programarIngesta } from "./etl/programador.js";

const aplicadas = await migrar();
if (aplicadas.length) console.log("Migraciones aplicadas:", aplicadas.join(", "));
await crearAdminInicial();
programarIngesta();

crearApp().listen(config.puerto, () => {
  console.log(`ChíaVial API escuchando en http://localhost:${config.puerto}`);
});
