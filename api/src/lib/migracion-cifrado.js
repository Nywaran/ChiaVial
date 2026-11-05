// Cifra los datos sensibles que se guardaron en texto plano antes de la migración 004.
import { q } from "../db.js";
import { cifrar, estaCifrado } from "./cifrado.js";

export async function cifrarDatosHeredados() {
  const { rows } = await q(`SELECT id, placa FROM reportes WHERE placa IS NOT NULL AND placa NOT LIKE 'v1:%'`);
  for (const r of rows) {
    if (estaCifrado(r.placa)) continue;
    await q(`UPDATE reportes SET placa = $2 WHERE id = $1`, [r.id, cifrar(r.placa, "reportes.placa")]);
  }
  return rows.length;
}
