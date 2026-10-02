import { migrar, pool } from "../db.js";
const r = await migrar();
console.log(r.length ? `Migraciones aplicadas: ${r.join(", ")}` : "La base de datos ya está al día.");
await pool.end();
