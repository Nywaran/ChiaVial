import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

// DATE como texto "AAAA-MM-DD" (evita corrimientos por zona horaria)
pg.types.setTypeParser(1082, (v) => v);
// BIGINT (conteos) como número
pg.types.setTypeParser(20, (v) => Number(v));
// NUMERIC como número
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export const q = (text, params) => pool.query(text, params);

export async function transaccion(fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    const r = await fn(cliente);
    await cliente.query("COMMIT");
    return r;
  } catch (e) {
    await cliente.query("ROLLBACK");
    throw e;
  } finally {
    cliente.release();
  }
}

const dirMigraciones = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

export async function migrar() {
  await q(`CREATE TABLE IF NOT EXISTS schema_migraciones (archivo TEXT PRIMARY KEY, aplicada_en TIMESTAMPTZ DEFAULT now())`);
  const hechas = new Set((await q("SELECT archivo FROM schema_migraciones")).rows.map((r) => r.archivo));
  const archivos = fs.readdirSync(dirMigraciones).filter((f) => f.endsWith(".sql")).sort();
  const aplicadas = [];
  for (const f of archivos) {
    if (hechas.has(f)) continue;
    const sql = fs.readFileSync(path.join(dirMigraciones, f), "utf8");
    await transaccion(async (c) => {
      await c.query(sql);
      await c.query("INSERT INTO schema_migraciones (archivo) VALUES ($1)", [f]);
    });
    aplicadas.push(f);
  }
  return aplicadas;
}
