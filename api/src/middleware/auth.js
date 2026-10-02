// Sesiones con JWT en cookie httpOnly y control de acceso por rol (RF-GEN-05, RNF-SEG-05, RNF-SEG-07)
import jwt from "jsonwebtoken";
import { q } from "../db.js";
import { config } from "../config.js";

const COOKIE = "chiavial_sesion";
export const ROLES_INSTITUCIONALES = ["funcionario", "entidad", "admin"];

function duracionMin(rol) {
  // Funcionarios, entidades y administradores: 30 min de inactividad. Ciudadanos: 7 días.
  return ROLES_INSTITUCIONALES.includes(rol) ? 30 : 60 * 24 * 7;
}

export function emitirSesion(res, usuario) {
  const min = duracionMin(usuario.rol);
  const token = jwt.sign({ sub: usuario.id, rol: usuario.rol }, config.jwtSecret, { expiresIn: `${min}m` });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.esProduccion,
    maxAge: min * 60 * 1000,
    path: "/",
  });
}

export function cerrarSesion(res) {
  res.clearCookie(COOKIE, { path: "/" });
}

/** Carga el usuario si hay sesión válida; renueva la sesión (expiración deslizante). */
export async function cargarUsuario(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return next();
  try {
    const p = jwt.verify(token, config.jwtSecret);
    const { rows } = await q(
      `SELECT u.id, u.nombre, u.email, u.rol, u.entidad_id, e.nombre AS entidad, u.activo, u.email_verificado
         FROM usuarios u LEFT JOIN entidades e ON e.id = u.entidad_id WHERE u.id = $1`,
      [p.sub]
    );
    const u = rows[0];
    if (u && u.activo) {
      req.usuario = u;
      emitirSesion(res, u);
    } else {
      cerrarSesion(res);
    }
  } catch {
    cerrarSesion(res);
  }
  next();
}

export function requiereSesion(req, res, next) {
  if (!req.usuario) return res.status(401).json({ error: "Debes iniciar sesión." });
  next();
}

export function requiereRol(...roles) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ error: "Debes iniciar sesión." });
    if (!roles.includes(req.usuario.rol)) return res.status(403).json({ error: "No tienes permiso para esta acción." });
    next();
  };
}

/** Protección CSRF simple: toda petición que modifica datos debe traer la cabecera X-Requested-With. */
export function protegerCsrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("X-Requested-With") !== "ChiaVial") return res.status(403).json({ error: "Solicitud no permitida." });
  next();
}
