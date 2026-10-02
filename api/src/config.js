import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const num = (v, d) => (v === undefined || v === "" ? d : Number(v));

export const config = {
  entorno: process.env.NODE_ENV || "development",
  puerto: num(process.env.PORT, 3000),
  databaseUrl: process.env.DATABASE_URL || "postgres://chiavial:chiavial@localhost:5432/chiavial",
  jwtSecret: process.env.JWT_SECRET || "solo-para-desarrollo-cambiar",
  appUrl: process.env.APP_URL || "http://localhost:5173",
  dataDir: process.env.DATA_DIR || path.resolve(aqui, "../../data"),
  uploadsDir: process.env.UPLOADS_DIR || path.resolve(aqui, "../uploads"),
  webDist: process.env.WEB_DIST || path.resolve(aqui, "../../web/dist"),

  smtp: {
    host: process.env.SMTP_HOST || "",
    port: num(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    secure: process.env.SMTP_SECURE === "true",
    from: process.env.SMTP_FROM || "ChíaVial <no-responder@chiavial.local>",
  },

  // Ingesta de datos abiertos: "csv" (archivos en data/) o "api" (datos.gov.co)
  ingestaFuente: process.env.INGESTA_FUENTE || "csv",
  socrataUrl: process.env.SOCRATA_URL || "https://www.datos.gov.co",
  socrataAppToken: process.env.SOCRATA_APP_TOKEN || "",

  // Geocodificación
  geocoder: process.env.GEOCODER || "nominatim", // nominatim | off
  nominatimUrl: process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org",
  nominatimUserAgent: process.env.NOMINATIM_USER_AGENT || "ChiaVial/1.0 (proyecto universitario)",
  // Caja aproximada del municipio de Chía (oeste, sur, este, norte). Ajustable.
  bboxChia: (process.env.CHIA_BBOX || "-74.13,4.82,-73.98,4.94").split(",").map(Number),

  // Parámetros de negocio (configurables)
  maxReportesDia: num(process.env.MAX_REPORTES_DIA, 10),
  radioSiniestrosM: num(process.env.RADIO_SINIESTROS_M, 200),
  radioDuplicadoM: num(process.env.RADIO_DUPLICADO_M, 100),

  adminEmail: process.env.ADMIN_EMAIL || "",
  adminPassword: process.env.ADMIN_PASSWORD || "",
  adminNombre: process.env.ADMIN_NOMBRE || "Administrador ChíaVial",
};

config.esProduccion = config.entorno === "production";

if (config.esProduccion && config.jwtSecret === "solo-para-desarrollo-cambiar") {
  throw new Error("Defina JWT_SECRET en producción.");
}
