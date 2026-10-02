import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { cargarUsuario, protegerCsrf } from "./middleware/auth.js";
import auth from "./routes/auth.js";
import observatorio from "./routes/observatorio.js";
import comparendos from "./routes/comparendos.js";
import reportes from "./routes/reportes.js";
import admin from "./routes/admin.js";

export function crearApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "blob:", "https://*.tile.openstreetmap.org"],
          connectSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
        },
      },
    })
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  app.use(cargarUsuario);
  app.use("/api", protegerCsrf);

  // Límite de intentos para autenticación (complementa el bloqueo por cuenta)
  const limiteAuth = rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: true, legacyHeaders: false,
    message: { error: "Demasiados intentos. Espera unos minutos." } });

  app.get("/api/salud", (req, res) => res.json({ ok: true }));
  app.use(["/api/auth/login", "/api/auth/registro", "/api/auth/olvide"], limiteAuth);
  app.use("/api/auth", auth);
  app.use("/api/observatorio", observatorio);
  app.use("/api/comparendos", comparendos);
  app.use("/api/reportes", reportes);
  app.use("/api/admin", admin);
  app.use("/api", (req, res) => res.status(404).json({ error: "Ruta no encontrada." }));

  // En producción la API sirve también la interfaz web compilada
  if (fs.existsSync(config.webDist)) {
    app.use(express.static(config.webDist, { maxAge: "1h", index: false }));
    app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(config.webDist, "index.html")));
  }

  // Errores no controlados: mensaje genérico (sin detalles internos)
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error("[error]", err);
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Solicitud mal formada." });
    res.status(500).json({ error: "Ocurrió un error inesperado. Intenta de nuevo." });
  });
  return app;
}
