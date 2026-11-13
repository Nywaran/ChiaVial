// Chat de atención en tiempo real.
// Visitante (anónimo o con sesión): se identifica con un token aleatorio que guarda su navegador
// (en la base de datos solo queda su SHA-256). Equipo (funcionario/admin): responde desde /atencion/:id.
// Cada mensaje del visitante avisa al grupo de Telegram con un enlace a la conversación.
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { q, transaccion } from "../db.js";
import { config } from "../config.js";
import { requiereRol } from "../middleware/auth.js";
import { cifrar, descifrarSeguro, hashToken, tokenAleatorio } from "../lib/cifrado.js";
import { avisarEquipo } from "../lib/notificaciones.js";
import { registrar } from "../lib/bitacora.js";
import { publicar, abrirFlujo } from "../lib/chat-eventos.js";

const r = Router();
const CTX_TEXTO = "chat_mensajes.texto";
const CTX_NOMBRE = "chat_conversaciones.nombre";
const MAX_TEXTO = 1000;
const AVISO_CADA_MIN = 2; // como máximo un aviso a Telegram cada 2 minutos por conversación
const equipo = requiereRol("funcionario", "admin");

const limite = (windowMs, limit, error) =>
  rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false, message: { error } });
const limiteNuevas = limite(60 * 60 * 1000, 5, "Has iniciado demasiadas conversaciones. Intenta más tarde.");
const limiteMensajes = limite(5 * 60 * 1000, 30, "Estás enviando mensajes muy rápido. Espera un momento.");

function textoValido(v) {
  const t = String(v ?? "").trim();
  return t && t.length <= MAX_TEXTO ? t : null;
}

const primerNombre = (n) => String(n || "").split(/\s+/)[0] || "Equipo";

function aMensaje(m, { paraEquipo = false } = {}) {
  return {
    id: m.id,
    autor: m.autor,
    texto: descifrarSeguro(m.texto_cifrado, CTX_TEXTO) ?? "[mensaje ilegible]",
    creado_en: m.creado_en,
    // El visitante solo ve el primer nombre de quien le responde
    quien: m.autor === "equipo" ? (paraEquipo ? m.equipo_nombre : primerNombre(m.equipo_nombre)) : null,
  };
}

async function mensajesDe(conversacionId, opciones) {
  const { rows } = await q(
    `SELECT m.*, u.nombre AS equipo_nombre FROM chat_mensajes m LEFT JOIN usuarios u ON u.id = m.usuario_id
      WHERE m.conversacion_id = $1 ORDER BY m.id`, [conversacionId]);
  return rows.map((m) => aMensaje(m, opciones));
}

async function guardarMensaje(c, conversacionId, autor, texto, usuarioId = null) {
  const { rows } = await c.query(
    `INSERT INTO chat_mensajes (conversacion_id, autor, usuario_id, texto_cifrado) VALUES ($1,$2,$3,$4) RETURNING *`,
    [conversacionId, autor, usuarioId, cifrar(texto, CTX_TEXTO)]);
  await c.query(`UPDATE chat_conversaciones SET actualizado_en = now() WHERE id = $1`, [conversacionId]);
  return rows[0];
}

/** Avisa al equipo por Telegram con el enlace a la conversación (sin saturar el grupo). */
async function avisarTelegram(conv, texto, esNueva) {
  const { rows } = await q(
    `UPDATE chat_conversaciones SET ultimo_aviso_en = now()
      WHERE id = $1 AND ($2 OR ultimo_aviso_en IS NULL OR ultimo_aviso_en < now() - make_interval(mins => $3))
      RETURNING id`, [conv.id, esNueva, AVISO_CADA_MIN]);
  if (!rows.length) return;
  const enlace = `${config.appUrl.replace(/\/$/, "")}/atencion/${conv.id}`;
  const nombre = descifrarSeguro(conv.nombre_cifrado, CTX_NOMBRE);
  const titulo = esNueva ? `💬 Nueva conversación en el chat de ChíaVial (#${conv.id})` : `💬 Nuevo mensaje en la conversación #${conv.id}`;
  const de = [nombre ? `De: ${nombre}` : "De: visitante anónimo", conv.pagina ? `Página: ${conv.pagina}` : null].filter(Boolean).join(" · ");
  const recorte = texto.length > 300 ? `${texto.slice(0, 300)}…` : texto;
  const mensaje = `${titulo}\n${de}\n\n«${recorte}»\n\nResponder: ${enlace}`;
  // Botón con enlace (Telegram solo admite botones con URL pública https)
  const extra = enlace.startsWith("https://") ? { reply_markup: { inline_keyboard: [[{ text: "💬 Abrir y responder", url: enlace }]] } } : {};
  await avisarEquipo("chat", mensaje, extra).catch((e) => console.warn("[chat] aviso:", e.message));
}

// ───────── Visitante ─────────

async function conversacionPorToken(req) {
  const token = req.get("X-Chat-Token") || "";
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const { rows } = await q(`SELECT * FROM chat_conversaciones WHERE token_hash = $1`, [hashToken(token)]);
  return rows[0] || null;
}

const vistaVisitante = (conv) => ({ id: conv.id, estado: conv.estado, creado_en: conv.creado_en });

r.post("/conversaciones", limiteNuevas, async (req, res) => {
  const texto = textoValido(req.body?.texto);
  if (!texto) return res.status(400).json({ error: `Escribe un mensaje (máximo ${MAX_TEXTO} caracteres).` });
  const nombre = String(req.body?.nombre || "").trim().slice(0, 60) || null;
  const pagina = /^\/[\w\-/.%]{0,199}$/.test(req.body?.pagina || "") ? req.body.pagina : null;
  const token = tokenAleatorio(32);
  const { conv, mensaje } = await transaccion(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO chat_conversaciones (token_hash, nombre_cifrado, pagina, usuario_id) VALUES ($1,$2,$3,$4) RETURNING *`,
      [hashToken(token), nombre ? cifrar(nombre, CTX_NOMBRE) : null, pagina, req.usuario?.id || null]);
    return { conv: rows[0], mensaje: await guardarMensaje(c, rows[0].id, "visitante", texto) };
  });
  publicar(conv.id, "conversacion", { estado: "abierta", nueva: true });
  publicar(conv.id, "mensaje", { mensaje: aMensaje(mensaje, { paraEquipo: true }) });
  avisarTelegram(conv, texto, true);
  res.status(201).json({ token, conversacion: vistaVisitante(conv), mensajes: [aMensaje(mensaje)] });
});

r.get("/conversacion", async (req, res) => {
  const conv = await conversacionPorToken(req);
  if (!conv) return res.status(404).json({ error: "Conversación no encontrada." });
  res.json({ conversacion: vistaVisitante(conv), mensajes: await mensajesDe(conv.id) });
});

r.post("/mensajes", limiteMensajes, async (req, res) => {
  const conv = await conversacionPorToken(req);
  if (!conv) return res.status(404).json({ error: "Conversación no encontrada." });
  const texto = textoValido(req.body?.texto);
  if (!texto) return res.status(400).json({ error: `Escribe un mensaje (máximo ${MAX_TEXTO} caracteres).` });
  const reabierta = conv.estado === "cerrada";
  const mensaje = await transaccion(async (c) => {
    if (reabierta) await c.query(`UPDATE chat_conversaciones SET estado = 'abierta' WHERE id = $1`, [conv.id]);
    return guardarMensaje(c, conv.id, "visitante", texto);
  });
  if (reabierta) publicar(conv.id, "conversacion", { estado: "abierta" });
  publicar(conv.id, "mensaje", { mensaje: aMensaje(mensaje, { paraEquipo: true }) });
  avisarTelegram(conv, texto, false);
  res.status(201).json({ mensaje: aMensaje(mensaje) });
});

r.get("/eventos", async (req, res) => {
  const conv = await conversacionPorToken(req);
  if (!conv) return res.status(404).json({ error: "Conversación no encontrada." });
  abrirFlujo(req, res, `conv:${conv.id}`);
});

// ───────── Equipo (funcionario / administrador) ─────────

r.get("/equipo/conversaciones", equipo, async (req, res) => {
  const estado = ["abierta", "cerrada"].includes(req.query.estado) ? req.query.estado : null;
  const { rows } = await q(
    `SELECT c.id, c.estado, c.pagina, c.nombre_cifrado, c.creado_en, c.actualizado_en, u.nombre AS usuario,
            ult.autor AS ultimo_autor, ult.texto_cifrado AS ultimo_texto, ult.creado_en AS ultimo_en,
            (SELECT count(*)::int FROM chat_mensajes m WHERE m.conversacion_id = c.id) AS total
       FROM chat_conversaciones c
       LEFT JOIN usuarios u ON u.id = c.usuario_id
       LEFT JOIN LATERAL (SELECT autor, texto_cifrado, creado_en FROM chat_mensajes m
                           WHERE m.conversacion_id = c.id ORDER BY m.id DESC LIMIT 1) ult ON TRUE
      WHERE ($1::text IS NULL OR c.estado = $1)
      ORDER BY c.actualizado_en DESC LIMIT 100`, [estado]);
  const abiertas = await q(`SELECT count(*)::int AS n FROM chat_conversaciones WHERE estado = 'abierta'`);
  res.json({
    abiertas: abiertas.rows[0].n,
    conversaciones: rows.map((c) => ({
      id: c.id, estado: c.estado, pagina: c.pagina, creado_en: c.creado_en, actualizado_en: c.actualizado_en,
      nombre: descifrarSeguro(c.nombre_cifrado, CTX_NOMBRE), usuario: c.usuario, total: c.total,
      sin_responder: c.ultimo_autor === "visitante",
      ultimo: c.ultimo_texto ? { autor: c.ultimo_autor, texto: (descifrarSeguro(c.ultimo_texto, CTX_TEXTO) || "").slice(0, 140), creado_en: c.ultimo_en } : null,
    })),
  });
});

async function conversacionEquipo(id) {
  const { rows } = await q(
    `SELECT c.*, u.nombre AS usuario, u.rol AS usuario_rol, a.nombre AS atendida_por_nombre
       FROM chat_conversaciones c LEFT JOIN usuarios u ON u.id = c.usuario_id LEFT JOIN usuarios a ON a.id = c.atendida_por
      WHERE c.id = $1`, [id]);
  return rows[0] || null;
}

r.get("/equipo/conversaciones/:id", equipo, async (req, res) => {
  const c = await conversacionEquipo(Number(req.params.id) || 0);
  if (!c) return res.status(404).json({ error: "Conversación no encontrada." });
  res.json({
    conversacion: {
      id: c.id, estado: c.estado, pagina: c.pagina, creado_en: c.creado_en, actualizado_en: c.actualizado_en,
      nombre: descifrarSeguro(c.nombre_cifrado, CTX_NOMBRE), usuario: c.usuario, usuario_rol: c.usuario_rol,
      atendida_por: c.atendida_por_nombre,
    },
    mensajes: await mensajesDe(c.id, { paraEquipo: true }),
  });
});

r.post("/equipo/conversaciones/:id/mensajes", equipo, async (req, res) => {
  const c = await conversacionEquipo(Number(req.params.id) || 0);
  if (!c) return res.status(404).json({ error: "Conversación no encontrada." });
  const texto = textoValido(req.body?.texto);
  if (!texto) return res.status(400).json({ error: `Escribe un mensaje (máximo ${MAX_TEXTO} caracteres).` });
  const m = await transaccion(async (cx) => {
    await cx.query(`UPDATE chat_conversaciones SET atendida_por = coalesce(atendida_por, $2), estado = 'abierta' WHERE id = $1`, [c.id, req.usuario.id]);
    return guardarMensaje(cx, c.id, "equipo", texto, req.usuario.id);
  });
  const fila = { ...m, equipo_nombre: req.usuario.nombre };
  // Al visitante le llega solo el primer nombre; al equipo, el nombre completo
  publicar(c.id, "mensaje", { mensaje: aMensaje(fila) }, { mensaje: aMensaje(fila, { paraEquipo: true }) });
  res.status(201).json({ mensaje: aMensaje(fila, { paraEquipo: true }) });
});

r.patch("/equipo/conversaciones/:id", equipo, async (req, res) => {
  const estado = req.body?.estado;
  if (!["abierta", "cerrada"].includes(estado)) return res.status(400).json({ error: "Estado no válido." });
  const { rowCount } = await q(`UPDATE chat_conversaciones SET estado = $2, actualizado_en = now() WHERE id = $1`, [Number(req.params.id) || 0, estado]);
  if (!rowCount) return res.status(404).json({ error: "Conversación no encontrada." });
  await registrar(req.usuario.id, estado === "cerrada" ? "chat_cerrado" : "chat_reabierto", "chat", Number(req.params.id));
  publicar(Number(req.params.id), "conversacion", { estado });
  res.json({ ok: true, estado });
});

r.get("/equipo/eventos", equipo, (req, res) => abrirFlujo(req, res, "equipo"));

export default r;
