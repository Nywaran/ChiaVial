// Mensajería: vinculación de la cuenta con Telegram y preferencias de notificación.
import { Router } from "express";
import { q } from "../db.js";
import { config } from "../config.js";
import { requiereSesion } from "../middleware/auth.js";
import { registrar } from "../lib/bitacora.js";
import { iguales } from "../lib/cifrado.js";
import { telegramConfigurado, crearCodigoVinculacion, desvincular, procesarActualizacion } from "../lib/telegram.js";

const r = Router();

/** Webhook de Telegram. Se monta ANTES de la protección CSRF: Telegram no envía X-Requested-With,
 *  así que se autentica con el encabezado secreto X-Telegram-Bot-Api-Secret-Token. */
export async function webhook(req, res) {
  if (!telegramConfigurado() || config.telegram.modo !== "webhook") return res.status(404).end();
  const secreto = req.get("X-Telegram-Bot-Api-Secret-Token") || "";
  if (!iguales(secreto, config.telegram.webhookSecret)) return res.status(401).end();
  res.json({ ok: true }); // responder rápido; Telegram reintenta si tarda
  procesarActualizacion(req.body).catch((e) => console.error("[telegram] webhook:", e.message));
}

r.get("/estado", requiereSesion, async (req, res) => {
  const { rows } = await q(
    `SELECT u.notif_telegram, v.vinculado_en FROM usuarios u LEFT JOIN telegram_vinculos v ON v.usuario_id = u.id WHERE u.id = $1`,
    [req.usuario.id]);
  res.json({
    disponible: telegramConfigurado(),
    bot: config.telegram.botUsername || null,
    vinculado: !!rows[0]?.vinculado_en,
    vinculado_en: rows[0]?.vinculado_en || null,
    notif_telegram: rows[0]?.notif_telegram ?? true,
  });
});

r.post("/vincular", requiereSesion, async (req, res) => {
  if (!telegramConfigurado()) return res.status(503).json({ error: "Las notificaciones por Telegram no están habilitadas en este servidor." });
  const v = await crearCodigoVinculacion(req.usuario.id);
  res.json(v);
});

r.delete("/vincular", requiereSesion, async (req, res) => {
  const ok = await desvincular(req.usuario.id);
  if (ok) await registrar(req.usuario.id, "telegram_desvinculado", "usuario", req.usuario.id);
  res.json({ ok });
});

r.patch("/preferencias", requiereSesion, async (req, res) => {
  const activo = req.body?.notif_telegram;
  if (typeof activo !== "boolean") return res.status(400).json({ error: "Valor no válido." });
  await q(`UPDATE usuarios SET notif_telegram = $2 WHERE id = $1`, [req.usuario.id, activo]);
  res.json({ ok: true, notif_telegram: activo });
});

export default r;
