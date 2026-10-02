// Verificación de sintaxis de todos los archivos del servidor (sin dependencias externas)
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const archivos = [];
const recorrer = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? recorrer(p) : p.endsWith(".js") && archivos.push(p); } };
recorrer(new URL("..", import.meta.url).pathname); recorrer(new URL("../../test", import.meta.url).pathname);
for (const f of archivos) execFileSync(process.execPath, ["--check", f], { stdio: "inherit" });
console.log(`Sintaxis correcta en ${archivos.length} archivos.`);
