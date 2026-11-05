// Algoritmos criptográficos de ChíaVial (SRS 4.1 · RNF-SEG)
//
//  • AES-256-GCM  → cifrado simétrico autenticado de datos sensibles en reposo
//                   (placa del vehículo reportado, chat de Telegram).
//  • HKDF-SHA256  → deriva, a partir de una clave maestra, subclaves independientes
//                   para cifrar (AES) y para firmar (HMAC).
//  • HMAC-SHA256  → "índice ciego": permite buscar un valor cifrado (p. ej. el chat
//                   de Telegram) sin descifrar toda la tabla.
//  • SHA-256      → huella de los tokens de un solo uso (activación de cuenta,
//                   recuperación de contraseña, vinculación con Telegram).
//  • bcrypt       → contraseñas (ver routes/auth.js; costo 12).
//  • TLS 1.2+     → datos en tránsito (lo provee Nginx/aaPanel con Let's Encrypt).
import crypto from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12; // recomendado para GCM
const TAG_BYTES = 16;

let claves = null;

/** Obtiene la clave maestra (32 bytes en base64) y deriva las subclaves con HKDF. */
function obtenerClaves() {
  if (claves) return claves;
  const b64 = process.env.CIFRADO_CLAVE || "";
  let maestra;
  if (b64) {
    maestra = Buffer.from(b64, "base64");
    if (maestra.length !== 32) throw new Error("CIFRADO_CLAVE debe ser de 32 bytes codificados en base64 (genérela con: openssl rand -base64 32).");
  } else {
    if (process.env.NODE_ENV === "production") throw new Error("Defina CIFRADO_CLAVE en producción (openssl rand -base64 32).");
    // Solo para desarrollo: clave derivada de un valor fijo, con aviso.
    console.warn("[cifrado] CIFRADO_CLAVE no está definida: se usa una clave de desarrollo. No la use en producción.");
    maestra = crypto.createHash("sha256").update("chiavial-clave-de-desarrollo").digest();
  }
  const derivar = (info) => Buffer.from(crypto.hkdfSync("sha256", maestra, Buffer.alloc(0), Buffer.from(info), 32));
  claves = { aes: derivar("chiavial/aes-256-gcm/v1"), hmac: derivar("chiavial/hmac-sha256/v1") };
  return claves;
}

/** Valida la clave al arrancar el servidor (en producción, sin CIFRADO_CLAVE válida no arranca). */
export function verificarClave() {
  obtenerClaves();
}

/** Solo para pruebas: olvida las claves cargadas. */
export function reiniciarClaves() {
  claves = null;
}

const b64url = (buf) => buf.toString("base64url");

/**
 * Cifra un texto con AES-256-GCM.
 * Formato: "v1:" + base64url(iv ‖ etiqueta ‖ texto cifrado).
 * El `contexto` (p. ej. "reportes.placa") se usa como dato adicional autenticado (AAD):
 * un valor cifrado para un campo no se puede copiar a otro campo sin que falle el descifrado.
 */
export function cifrar(texto, contexto) {
  if (texto === null || texto === undefined || texto === "") return null;
  const iv = crypto.randomBytes(IV_BYTES);
  const c = crypto.createCipheriv("aes-256-gcm", obtenerClaves().aes, iv, { authTagLength: TAG_BYTES });
  c.setAAD(Buffer.from(contexto));
  const cifrado = Buffer.concat([c.update(String(texto), "utf8"), c.final()]);
  return `${VERSION}:${b64url(Buffer.concat([iv, c.getAuthTag(), cifrado]))}`;
}

/** Descifra un valor producido por `cifrar`. Lanza error si fue alterado o si el contexto no coincide. */
export function descifrar(valor, contexto) {
  if (valor === null || valor === undefined || valor === "") return null;
  const [version, datos] = String(valor).split(":");
  if (version !== VERSION || !datos) throw new Error("Formato de dato cifrado no reconocido.");
  const buf = Buffer.from(datos, "base64url");
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const cifrado = buf.subarray(IV_BYTES + TAG_BYTES);
  const d = crypto.createDecipheriv("aes-256-gcm", obtenerClaves().aes, iv, { authTagLength: TAG_BYTES });
  d.setAAD(Buffer.from(contexto));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(cifrado), d.final()]).toString("utf8");
}

/** Como descifrar(), pero nunca lanza: nulo → nulo, texto plano heredado → tal cual, alterado → null. */
export function descifrarSeguro(valor, contexto) {
  if (valor === null || valor === undefined) return null;
  if (!estaCifrado(valor)) return valor;
  try {
    return descifrar(valor, contexto);
  } catch {
    return null;
  }
}

export const estaCifrado = (valor) => typeof valor === "string" && valor.startsWith(`${VERSION}:`);

/** HMAC-SHA256 con la subclave de firma (índice ciego para búsquedas). */
export function hmac(texto, contexto) {
  return crypto.createHmac("sha256", obtenerClaves().hmac).update(`${contexto}:${texto}`).digest("hex");
}

/** SHA-256 de un token de un solo uso: en la base de datos solo se guarda la huella. */
export const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

/** Token aleatorio criptográficamente seguro (256 bits). */
export const tokenAleatorio = (bytes = 32) => crypto.randomBytes(bytes).toString("hex");

/** Comparación en tiempo constante (evita ataques de temporización). */
export function iguales(a, b) {
  const x = Buffer.from(String(a ?? ""));
  const y = Buffer.from(String(b ?? ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
