import { q } from "../db.js";

/** Registro de auditoría (RF-GEN-14). Nunca interrumpe la operación principal. */
export async function registrar(usuarioId, accion, objeto = null, objetoId = null, detalle = null) {
  try {
    await q(`INSERT INTO bitacora (usuario_id, accion, objeto, objeto_id, detalle) VALUES ($1,$2,$3,$4,$5)`,
      [usuarioId ?? null, accion, objeto, objetoId === null ? null : String(objetoId), detalle ? JSON.stringify(detalle) : null]);
  } catch (e) {
    console.warn("[bitacora]", e.message);
  }
}
