// Servicio de mensajería por Telegram (Bot API).
// Modos: "polling" (recomendado en VPS: solo requiere salida HTTPS), "webhook" (requiere dominio con HTTPS) u "off".
import { q, transaccion } from "../db.js";
import { config } from "../config.js";
import { cifrar, descifrarSeguro, hmac, hashToken, tokenAleatorio } from "./cifrado.js";
import { registrar } from "./bitacora.js";

const CTX_CHAT = "telegram_vinculos.chat_id";
const NOMBRE_ESTADO = {
  RECIBIDO: "Recibido", EN_REVISION: "En revisión", ATENDIDO: "Atendido", DESCARTADO: "Descartado",
  VERIFICADO: "Verificado", EN_GESTION: "En gestión", RESUELTO: "Resuelto", RECHAZADO: "Rechazado",
};

export const telegramConfigurado = () => !!config.telegram.token;

let fetchTelegram = (...a) => fetch(...a);
/** Solo para pruebas: reemplaza la función de red. */
export function usarFetch(fn) {
  fetchTelegram = fn;
}

/** Llama a un método de la Bot API. */
export async function api(metodo, parametros = {}, { timeoutMs = 10000 } = {}) {
  if (!telegramConfigurado()) throw new Error("Telegram no está configurado (TELEGRAM_BOT_TOKEN).");
  const r = await fetchTelegram(`${config.telegram.apiUrl}/bot${config.telegram.token}/${metodo}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parametros),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok || !datos.ok) throw new Error(`Telegram ${metodo}: ${datos.description || r.status}`);
  return datos.result;
}

export const enviarTexto = (chatId, texto) => api("sendMessage", { chat_id: chatId, text: texto, disable_web_page_preview: true });

// ───────── Vinculación de cuentas ─────────

/** Genera un código de un solo uso y el enlace profundo t.me/<bot>?start=<código>. */
export async function crearCodigoVinculacion(usuarioId) {
  const codigo = tokenAleatorio(16); // 32 caracteres hex (Telegram admite hasta 64 en /start)
  await q(`DELETE FROM telegram_codigos WHERE usuario_id = $1 OR expira_en < now()`, [usuarioId]);
  await q(`INSERT INTO telegram_codigos (codigo_hash, usuario_id, expira_en) VALUES ($1, $2, now() + interval '15 minutes')`,
    [hashToken(codigo), usuarioId]);
  const enlace = config.telegram.botUsername ? `https://t.me/${config.telegram.botUsername}?start=${codigo}` : null;
  return { codigo, enlace, expira_min: 15 };
}

/** Consume un código y guarda el chat cifrado. Devuelve el usuario vinculado o null. */
export async function vincularConCodigo(codigo, chatId) {
  return transaccion(async (c) => {
    const { rows } = await c.query(
      `UPDATE telegram_codigos SET usado_en = now()
        WHERE codigo_hash = $1 AND usado_en IS NULL AND expira_en > now()
        RETURNING usuario_id`, [hashToken(codigo)]);
    if (!rows.length) return null;
    const usuarioId = rows[0].usuario_id;
    const indice = hmac(String(chatId), CTX_CHAT);
    // Un chat solo puede estar vinculado a una cuenta
    await c.query(`DELETE FROM telegram_vinculos WHERE chat_id_hmac = $1 OR usuario_id = $2`, [indice, usuarioId]);
    await c.query(`INSERT INTO telegram_vinculos (usuario_id, chat_id_cifrado, chat_id_hmac) VALUES ($1, $2, $3)`,
      [usuarioId, cifrar(String(chatId), CTX_CHAT), indice]);
    const u = await c.query(`SELECT id, nombre, rol FROM usuarios WHERE id = $1`, [usuarioId]);
    return u.rows[0];
  });
}

export async function usuarioPorChat(chatId) {
  const { rows } = await q(
    `SELECT u.id, u.nombre, u.rol, u.entidad_id FROM telegram_vinculos v JOIN usuarios u ON u.id = v.usuario_id
      WHERE v.chat_id_hmac = $1 AND u.activo`, [hmac(String(chatId), CTX_CHAT)]);
  return rows[0] || null;
}

export async function chatDeUsuario(usuarioId) {
  const { rows } = await q(`SELECT chat_id_cifrado FROM telegram_vinculos WHERE usuario_id = $1`, [usuarioId]);
  return rows[0] ? descifrarSeguro(rows[0].chat_id_cifrado, CTX_CHAT) : null;
}

export async function desvincular(usuarioId) {
  const r = await q(`DELETE FROM telegram_vinculos WHERE usuario_id = $1`, [usuarioId]);
  return r.rowCount > 0;
}

// ───────── Comandos del bot ─────────

const AYUDA = [
  "Soy el bot de ChíaVial, la plataforma de seguridad vial de Chía.",
  "",
  "Comandos:",
  "/estado – tus reportes abiertos",
  "/desvincular – dejar de recibir notificaciones",
  "/ayuda – esta ayuda",
  "",
  "Para vincular tu cuenta, entra a ChíaVial → Mi cuenta → «Vincular Telegram».",
].join("\n");

async function comandoEstado(chatId) {
  const u = await usuarioPorChat(chatId);
  if (!u) return "Este chat no está vinculado a ninguna cuenta. Entra a ChíaVial → Mi cuenta → «Vincular Telegram».";
  if (u.rol === "ciudadano") {
    const { rows } = await q(
      `SELECT r.id, c.nombre AS categoria, r.estado FROM reportes r JOIN catalogos c ON c.tipo = r.tipo AND c.codigo = r.categoria
        WHERE r.autor_id = $1 ORDER BY r.creado_en DESC LIMIT 10`, [u.id]);
    if (!rows.length) return "Aún no tienes reportes.";
    return ["Tus últimos reportes:", ...rows.map((r) => `#${r.id} · ${r.categoria} · ${NOMBRE_ESTADO[r.estado] || r.estado}`)].join("\n");
  }
  const { rows } = await q(
    `SELECT estado, count(*)::int AS n FROM reportes WHERE NOT spam
       AND ($1::int IS NULL OR entidad_asignada_id = $1) GROUP BY 1 ORDER BY 1`,
    [u.rol === "entidad" ? u.entidad_id : null]);
  if (!rows.length) return "No hay reportes registrados.";
  return ["Reportes por estado:", ...rows.map((r) => `${NOMBRE_ESTADO[r.estado] || r.estado}: ${r.n}`)].join("\n");
}

/** Procesa un update de Telegram (mensaje entrante). Devuelve el texto respondido (útil en pruebas). */
export async function procesarActualizacion(update) {
  const msg = update?.message;
  if (!msg?.chat?.id || typeof msg.text !== "string") return null;
  const chatId = msg.chat.id;
  if (msg.chat.type !== "private") return null; // solo chats privados
  const [comando, arg] = msg.text.trim().split(/\s+/, 2);
  let respuesta;
  switch (comando.split("@")[0]) {
    case "/start":
      if (arg && /^[a-f0-9]{32}$/.test(arg)) {
        const u = await vincularConCodigo(arg, chatId);
        if (u) {
          await registrar(u.id, "telegram_vinculado", "usuario", u.id);
          respuesta = `¡Listo, ${u.nombre}! Tu cuenta de ChíaVial quedó vinculada. Aquí recibirás las notificaciones.\n\nEscribe /estado para ver tus reportes.`;
        } else {
          respuesta = "El código no es válido o venció (dura 15 minutos). Genera uno nuevo en ChíaVial → Mi cuenta.";
        }
      } else respuesta = AYUDA;
      break;
    case "/estado":
      respuesta = await comandoEstado(chatId);
      break;
    case "/desvincular": {
      const u = await usuarioPorChat(chatId);
      if (u && (await desvincular(u.id))) {
        await registrar(u.id, "telegram_desvinculado", "usuario", u.id);
        respuesta = "Listo, este chat ya no recibirá notificaciones de ChíaVial.";
      } else respuesta = "Este chat no estaba vinculado.";
      break;
    }
    default:
      respuesta = AYUDA;
  }
  await enviarTexto(chatId, respuesta).catch((e) => console.warn("[telegram]", e.message));
  return respuesta;
}

// ───────── Recepción de mensajes ─────────

let detener = false;

/** Modo polling: consulta getUpdates en bucle (long polling de 25 s). */
export function iniciarPolling() {
  if (!telegramConfigurado() || config.telegram.modo !== "polling") return false;
  detener = false;
  (async () => {
    try {
      await api("deleteWebhook", {}); // polling y webhook son excluyentes
      const yo = await api("getMe");
      console.log(`[telegram] bot @${yo.username} en modo polling`);
    } catch (e) {
      console.error("[telegram] no se pudo iniciar:", e.message);
    }
    let espera = 1000;
    while (!detener) {
      try {
        const { rows } = await q(`SELECT valor FROM telegram_estado WHERE clave = 'offset'`);
        const offset = rows[0] ? Number(rows[0].valor) : 0;
        const updates = await api("getUpdates", { offset, timeout: 25, allowed_updates: ["message"] }, { timeoutMs: 35000 });
        for (const u of updates) {
          await procesarActualizacion(u).catch((e) => console.error("[telegram] update:", e.message));
          await q(`INSERT INTO telegram_estado (clave, valor) VALUES ('offset', $1)
                   ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`, [String(u.update_id + 1)]);
        }
        espera = 1000;
      } catch (e) {
        if (!detener) console.warn("[telegram] getUpdates:", e.message);
        await new Promise((r) => setTimeout(r, espera));
        espera = Math.min(espera * 2, 60000);
      }
    }
  })();
  return true;
}

export function detenerPolling() {
  detener = true;
}

/** Modo webhook: registra la URL pública en Telegram con un secreto. */
export async function configurarWebhook() {
  if (!telegramConfigurado() || config.telegram.modo !== "webhook") return false;
  const url = `${config.appUrl.replace(/\/$/, "")}/api/telegram/webhook`;
  await api("setWebhook", { url, secret_token: config.telegram.webhookSecret, allowed_updates: ["message"] });
  console.log(`[telegram] webhook registrado en ${url}`);
  return true;
}
