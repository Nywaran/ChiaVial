import bcrypt from "bcryptjs";
import { q } from "../db.js";
import { config } from "../config.js";

/** Crea el primer administrador desde ADMIN_EMAIL / ADMIN_PASSWORD si no existe ninguno. */
export async function crearAdminInicial() {
  const { rows } = await q(`SELECT count(*)::int AS n FROM usuarios WHERE rol='admin'`);
  if (rows[0].n) return;
  if (!config.adminEmail || !config.adminPassword) {
    console.warn("No hay administrador. Defina ADMIN_EMAIL y ADMIN_PASSWORD para crearlo al iniciar.");
    return;
  }
  if (config.adminPassword.length < 8) throw new Error("ADMIN_PASSWORD debe tener al menos 8 caracteres.");
  await q(
    `INSERT INTO usuarios (nombre, email, password_hash, rol, email_verificado, entidad_id)
     VALUES ($1, $2, $3, 'admin', TRUE, (SELECT id FROM entidades WHERE nombre='Secretaría de Movilidad de Chía'))`,
    [config.adminNombre, config.adminEmail.toLowerCase(), await bcrypt.hash(config.adminPassword, 12)]
  );
  console.log(`Administrador inicial creado: ${config.adminEmail}`);
}
