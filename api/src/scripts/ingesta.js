// Uso: npm run ingesta [-- --fuente=api|csv] [-- --conjunto=siniestros]
import { migrar, pool } from "../db.js";
import { ingestarTodo, ingestarConjunto } from "../etl/ingesta.js";
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
await migrar();
const fuente = arg("fuente");
const conjunto = arg("conjunto");
const r = conjunto ? { resultados: [await ingestarConjunto(conjunto, { fuente })] } : await ingestarTodo({ fuente });
for (const x of r.resultados) console.log(`${x.conjunto.padEnd(12)} ${x.estado.padEnd(8)} leídas=${x.leidas ?? "-"} nuevas=${x.nuevas ?? "-"} actualizadas=${x.actualizadas ?? "-"} ${x.error || ""}`);
if (r.ubicacion) console.log(`Siniestros ubicados en el mapa: ${r.ubicacion.ubicados} de ${r.ubicacion.total}`);
await pool.end();
