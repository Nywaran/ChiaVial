// Envío de correos (3.4). Sin SMTP configurado, los correos quedan en la bandeja interna
// y el administrador los puede consultar (útil en desarrollo y en la demostración).
import nodemailer from "nodemailer";
import { q } from "../db.js";
import { config } from "../config.js";

let transporte = null;
if (config.smtp.host) {
  transporte = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
}

export async function enviarCorreo(para, asunto, cuerpo) {
  const { rows } = await q(`INSERT INTO correos (para, asunto, cuerpo) VALUES ($1,$2,$3) RETURNING id`, [para, asunto, cuerpo]);
  if (!transporte) return { id: rows[0].id, enviado: false };
  try {
    await transporte.sendMail({ from: config.smtp.from, to: para, subject: asunto, text: cuerpo });
    await q(`UPDATE correos SET enviado = TRUE WHERE id = $1`, [rows[0].id]);
    return { id: rows[0].id, enviado: true };
  } catch (e) {
    await q(`UPDATE correos SET error = $2 WHERE id = $1`, [rows[0].id, e.message]);
    console.warn("[correo]", e.message);
    return { id: rows[0].id, enviado: false };
  }
}

export const plantillas = {
  verificacion: (nombre, enlace) => [
    "Confirma tu cuenta en ChíaVial",
    `Hola ${nombre}:\n\nPara activar tu cuenta en ChíaVial abre este enlace:\n${enlace}\n\nSi no creaste esta cuenta, ignora este mensaje.`,
  ],
  restablecer: (nombre, enlace) => [
    "Restablece tu contraseña de ChíaVial",
    `Hola ${nombre}:\n\nPara crear una nueva contraseña abre este enlace (vence en 1 hora):\n${enlace}\n\nSi no lo solicitaste, ignora este mensaje.`,
  ],
  cambioEstado: (nombre, id, estado, comentario) => [
    `Tu reporte #${id} cambió de estado`,
    `Hola ${nombre}:\n\nTu reporte #${id} ahora está en estado «${estado}».${comentario ? `\n\nComentario: ${comentario}` : ""}\n\nPuedes ver el detalle en «Mis reportes».`,
  ],
  asignacion: (id, entidad, fecha) => [
    `Se asignó el reporte #${id} a ${entidad}`,
    `Se asignó el reporte de infraestructura #${id} a ${entidad}${fecha ? ` con fecha objetivo ${fecha}` : ""}.\n\nIngresa a ChíaVial para ver el detalle.`,
  ],
};
