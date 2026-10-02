// Cuentas y sesiones: RF-GEN-01, 02, 03; RNF-SEG-01, 03, 07, 10
import { Router } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { q, transaccion } from "../db.js";
import { config } from "../config.js";
import { emitirSesion, cerrarSesion, requiereSesion } from "../middleware/auth.js";
import { enviarCorreo, plantillas } from "../lib/correo.js";
import { registrar } from "../lib/bitacora.js";

const r = Router();
const token = () => crypto.randomBytes(32).toString("hex");
const MAX_INTENTOS = 5;
const BLOQUEO_MIN = 15;

const esquemaRegistro = z.object({
  nombre: z.string().trim().min(2, "Escribe tu nombre.").max(120),
  email: z.string().trim().toLowerCase().email("Correo no válido."),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres.").max(200),
  acepta_politica: z.literal(true, { errorMap: () => ({ message: "Debes aceptar la política de tratamiento de datos." }) }),
});

r.post("/registro", async (req, res) => {
  const p = esquemaRegistro.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const { nombre, email, password } = p.data;
  const existe = await q("SELECT 1 FROM usuarios WHERE email = $1", [email]);
  if (existe.rows.length) return res.status(409).json({ error: "Ya existe una cuenta con ese correo." });
  const t = token();
  const hash = await bcrypt.hash(password, 12);
  const { rows } = await q(
    `INSERT INTO usuarios (nombre, email, password_hash, rol, token_verificacion, acepto_tratamiento_en)
     VALUES ($1,$2,$3,'ciudadano',$4, now()) RETURNING id`,
    [nombre, email, hash, t]
  );
  const [asunto, cuerpo] = plantillas.verificacion(nombre, `${config.appUrl}/verificar?token=${t}`);
  await enviarCorreo(email, asunto, cuerpo);
  await registrar(rows[0].id, "registro", "usuario", rows[0].id);
  res.status(201).json({ ok: true, mensaje: "Te enviamos un correo para activar tu cuenta." });
});

r.post("/verificar", async (req, res) => {
  const t = String(req.body?.token || "");
  if (!t) return res.status(400).json({ error: "Falta el código de verificación." });
  const { rows } = await q(
    `UPDATE usuarios SET email_verificado = TRUE, token_verificacion = NULL WHERE token_verificacion = $1 RETURNING id`,
    [t]
  );
  if (!rows.length) return res.status(400).json({ error: "El enlace no es válido o ya fue usado." });
  res.json({ ok: true, mensaje: "Cuenta activada. Ya puedes iniciar sesión." });
});

r.post("/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const { rows } = await q(`SELECT * FROM usuarios WHERE email = $1`, [email]);
  const u = rows[0];
  const generico = { error: "Correo o contraseña incorrectos." };
  if (!u || !u.activo) return res.status(401).json(generico);
  if (u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) {
    return res.status(429).json({ error: `Cuenta bloqueada temporalmente por intentos fallidos. Intenta de nuevo en ${BLOQUEO_MIN} minutos.` });
  }
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) {
    const intentos = u.intentos_fallidos + 1;
    if (intentos >= MAX_INTENTOS) {
      await q(`UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = now() + make_interval(mins => $2) WHERE id = $1`, [u.id, BLOQUEO_MIN]);
      await registrar(u.id, "bloqueo_por_intentos", "usuario", u.id);
    } else {
      await q(`UPDATE usuarios SET intentos_fallidos = $2 WHERE id = $1`, [u.id, intentos]);
    }
    return res.status(401).json(generico);
  }
  if (!u.email_verificado) return res.status(403).json({ error: "Debes activar tu cuenta con el enlace que te enviamos por correo." });
  await q(`UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1`, [u.id]);
  emitirSesion(res, u);
  if (u.rol !== "ciudadano") await registrar(u.id, "inicio_sesion", "usuario", u.id);
  res.json({ id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, entidad_id: u.entidad_id });
});

r.post("/logout", (req, res) => {
  cerrarSesion(res);
  res.json({ ok: true });
});

r.get("/yo", (req, res) => {
  if (!req.usuario) return res.json(null);
  const { id, nombre, email, rol, entidad_id, entidad } = req.usuario;
  res.json({ id, nombre, email, rol, entidad_id, entidad });
});

r.post("/olvide", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const { rows } = await q(`SELECT id, nombre FROM usuarios WHERE email = $1 AND activo`, [email]);
  if (rows.length) {
    const t = token();
    await q(`UPDATE usuarios SET token_reset = $2, token_reset_expira = now() + interval '1 hour' WHERE id = $1`, [rows[0].id, t]);
    const [asunto, cuerpo] = plantillas.restablecer(rows[0].nombre, `${config.appUrl}/restablecer?token=${t}`);
    await enviarCorreo(email, asunto, cuerpo);
  }
  // Misma respuesta exista o no la cuenta, para no revelar correos registrados
  res.json({ ok: true, mensaje: "Si el correo está registrado, recibirás un enlace para restablecer la contraseña." });
});

r.post("/restablecer", async (req, res) => {
  const t = String(req.body?.token || "");
  const password = String(req.body?.password || "");
  if (password.length < 8) return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres." });
  const hash = await bcrypt.hash(password, 12);
  const { rows } = await q(
    `UPDATE usuarios SET password_hash = $2, token_reset = NULL, token_reset_expira = NULL, intentos_fallidos = 0, bloqueado_hasta = NULL
      WHERE token_reset = $1 AND token_reset_expira > now() RETURNING id`,
    [t, hash]
  );
  if (!rows.length) return res.status(400).json({ error: "El enlace no es válido o venció." });
  await registrar(rows[0].id, "restablecer_contrasena", "usuario", rows[0].id);
  res.json({ ok: true, mensaje: "Contraseña actualizada. Ya puedes iniciar sesión." });
});

// RNF-SEG-10: el titular puede corregir su nombre y eliminar su cuenta (los reportes se anonimizan)
r.patch("/cuenta", requiereSesion, async (req, res) => {
  const nombre = String(req.body?.nombre || "").trim();
  if (nombre.length < 2) return res.status(400).json({ error: "Escribe tu nombre." });
  await q(`UPDATE usuarios SET nombre = $2 WHERE id = $1`, [req.usuario.id, nombre]);
  res.json({ ok: true });
});

r.delete("/cuenta", requiereSesion, async (req, res) => {
  if (req.usuario.rol === "admin") {
    const { rows } = await q(`SELECT count(*)::int AS n FROM usuarios WHERE rol='admin' AND activo AND id <> $1`, [req.usuario.id]);
    if (!rows[0].n) return res.status(400).json({ error: "No puedes eliminar la única cuenta de administrador." });
  }
  await transaccion(async (c) => {
    await c.query(`UPDATE reportes SET autor_id = NULL, placa = NULL WHERE autor_id = $1`, [req.usuario.id]);
    await c.query(`DELETE FROM usuarios WHERE id = $1`, [req.usuario.id]);
  });
  await registrar(null, "cuenta_eliminada", "usuario", req.usuario.id);
  cerrarSesion(res);
  res.json({ ok: true, mensaje: "Tu cuenta fue eliminada y tus reportes quedaron anónimos." });
});

export default r;
