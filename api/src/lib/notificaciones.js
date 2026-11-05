// Servicio de notificaciones: un solo punto para enviar mensajes por correo y por Telegram,
// con registro de cada envío en la tabla `notificaciones`.
import { q } from "../db.js";
import { enviarCorreo } from "./correo.js";
import { telegramConfigurado, chatDeUsuario, enviarTexto } from "./telegram.js";

async function registrarEnvio(usuarioId, canal, evento, estado, detalle = null) {
  await q(`INSERT INTO notificaciones (usuario_id, canal, evento, estado, detalle) VALUES ($1,$2,$3,$4,$5)`,
    [usuarioId, canal, evento, estado, detalle ? String(detalle).slice(0, 500) : null]).catch(() => {});
}

/** Envía por Telegram si el usuario tiene el chat vinculado y la preferencia activa. */
export async function porTelegram(usuarioId, evento, texto) {
  const { rows } = await q(`SELECT notif_telegram FROM usuarios WHERE id = $1 AND activo`, [usuarioId]);
  if (!rows[0]?.notif_telegram) return "omitido";
  const chat = await chatDeUsuario(usuarioId);
  if (!chat) return "omitido";
  if (!telegramConfigurado()) {
    await registrarEnvio(usuarioId, "telegram", evento, "sin_configurar");
    return "sin_configurar";
  }
  try {
    await enviarTexto(chat, texto);
    await registrarEnvio(usuarioId, "telegram", evento, "enviado");
    return "enviado";
  } catch (e) {
    await registrarEnvio(usuarioId, "telegram", evento, "error", e.message);
    return "error";
  }
}

export async function porCorreo(usuarioId, email, evento, asunto, cuerpo) {
  const r = await enviarCorreo(email, asunto, cuerpo);
  await registrarEnvio(usuarioId, "correo", evento, r.enviado ? "enviado" : r.error ? "error" : "sin_configurar", r.error);
  return r;
}

/**
 * Notifica a un usuario por todos sus canales.
 * @param {{id:number,email:string}} usuario
 * @param {string} evento  p. ej. "cambio_estado", "asignacion", "nuevo_reporte"
 * @param {{asunto:string, cuerpo:string, telegram?:string, soloTelegram?:boolean}} msg
 */
export async function notificar(usuario, evento, msg) {
  const res = {};
  if (!msg.soloTelegram && usuario.email) res.correo = await porCorreo(usuario.id, usuario.email, evento, msg.asunto, msg.cuerpo);
  res.telegram = await porTelegram(usuario.id, evento, msg.telegram || `${msg.asunto}\n\n${msg.cuerpo}`);
  return res;
}

/** Alerta por Telegram a todos los usuarios activos de ciertos roles (p. ej. funcionarios ante un reporte nuevo). */
export async function alertarRoles(roles, evento, texto, { entidadId = null } = {}) {
  const { rows } = await q(
    `SELECT u.id FROM usuarios u JOIN telegram_vinculos v ON v.usuario_id = u.id
      WHERE u.activo AND u.notif_telegram AND u.rol = ANY($1) AND ($2::int IS NULL OR u.entidad_id = $2)`,
    [roles, entidadId]);
  let enviados = 0;
  for (const u of rows) if ((await porTelegram(u.id, evento, texto)) === "enviado") enviados++;
  return { destinatarios: rows.length, enviados };
}
