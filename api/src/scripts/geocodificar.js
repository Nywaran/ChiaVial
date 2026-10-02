import { pool } from "../db.js";
import { geocodificarPendientes } from "../lib/geocodificar.js";
const r = await geocodificarPendientes({ reintentar: process.argv.includes("--reintentar") });
console.log(`Procesados: ${r.procesados} · ubicados: ${r.ubicados}`);
await pool.end();
