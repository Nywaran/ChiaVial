// M01 · Reporte de conducción de riesgo y M04 · Reporte de puntos peligrosos de infraestructura
import { Router } from "express";
import multer from "multer";
import sharp from "sharp";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { q, transaccion } from "../db.js";
import { config } from "../config.js";
import { requiereSesion, requiereRol } from "../middleware/auth.js";
import { enviarCorreo, plantillas } from "../lib/correo.js";
import { registrar } from "../lib/bitacora.js";

const r = Router();
fs.mkdirSync(config.uploadsDir, { recursive: true });

export const ESTADOS = {
  conducta: ["RECIBIDO", "EN_REVISION", "ATENDIDO", "DESCARTADO"],
  infraestructura: ["RECIBIDO", "VERIFICADO", "EN_GESTION", "RESUELTO", "RECHAZADO"],
};
const ESTADOS_CIERRE_CON_MOTIVO = ["DESCARTADO", "RECHAZADO"];
const ESTADOS_ABIERTOS = ["RECIBIDO", "EN_REVISION", "VERIFICADO", "EN_GESTION"];

// RF-M01-02: hasta 3 fotos de máx. 5 MB (JPG, PNG o WebP)
const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 3 },
  fileFilter: (req, f, cb) => cb(null, ["image/jpeg", "image/png", "image/webp"].includes(f.mimetype)),
});
function recibirFotos(req, res, next) {
  subida.array("fotos", 3)(req, res, (err) => {
    if (!err) return next();
    const msg = err.code === "LIMIT_FILE_SIZE" ? "Cada foto debe pesar máximo 5 MB."
      : err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE" ? "Puedes adjuntar máximo 3 fotos." : "No se pudieron recibir las fotos.";
    res.status(400).json({ error: msg });
  });
}

/** RNF-SEG-08: se reescala a 1600 px y se eliminan los metadatos EXIF (incluida la ubicación). */
async function guardarFoto(buffer) {
  const nombre = `${crypto.randomUUID()}.jpg`;
  await sharp(buffer).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 }).toFile(path.join(config.uploadsDir, nombre));
  return nombre;
}

const esquema = z.object({
  tipo: z.enum(["conducta", "infraestructura"]),
  categoria: z.string().min(1),
  descripcion: z.string().trim().min(10, "Describe lo ocurrido (mínimo 10 caracteres).").max(2000),
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  fecha_hecho: z.string().optional(),
  placa: z.string().trim().max(10).optional(),
  acepto_aviso: z.string().optional(),
});

const esFuncionario = (u) => ["funcionario", "admin"].includes(u?.rol);

// ───────── Creación (ciudadano) ─────────
r.post("/", requiereRol("ciudadano"), recibirFotos, async (req, res) => {
  const p = esquema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const d = p.data;
  const cat = await q(`SELECT 1 FROM catalogos WHERE tipo=$1 AND codigo=$2 AND activo`, [d.tipo, d.categoria]);
  if (!cat.rows.length) return res.status(400).json({ error: "Categoría no válida." });
  // RF-M01-04: aviso de que el reporte es informativo
  if (d.tipo === "conducta" && d.acepto_aviso !== "true") {
    return res.status(400).json({ error: "Debes confirmar que entiendes que el reporte es informativo y no genera comparendo." });
  }
  const [oeste, sur, este, norte] = config.bboxChia;
  if (d.lon < oeste || d.lon > este || d.lat < sur || d.lat > norte) {
    return res.status(400).json({ error: "La ubicación debe estar dentro del municipio de Chía." });
  }
  // RF-M01-08: límite diario por usuario
  const hoy = await q(`SELECT count(*)::int AS n FROM reportes WHERE autor_id=$1 AND creado_en > now() - interval '24 hours'`, [req.usuario.id]);
  if (hoy.rows[0].n >= config.maxReportesDia) {
    return res.status(429).json({ error: `Alcanzaste el máximo de ${config.maxReportesDia} reportes en 24 horas.` });
  }
  const fechaHecho = d.fecha_hecho ? new Date(d.fecha_hecho) : null;
  if (fechaHecho && (isNaN(fechaHecho) || fechaHecho > new Date(Date.now() + 5 * 60 * 1000))) {
    return res.status(400).json({ error: "La fecha del hecho no es válida." });
  }
  const placa = d.tipo === "conducta" && d.placa ? d.placa.toUpperCase().replace(/[^A-Z0-9]/g, "") : null;

  const fotos = [];
  for (const f of req.files || []) fotos.push(await guardarFoto(f.buffer));

  const id = await transaccion(async (c) => {
    // RF-M01-08: posible duplicado (mismo tipo y categoría, a menos de X m, misma franja de 1 hora para conductas o abierto para infraestructura)
    const dup = await c.query(
      `SELECT id FROM reportes
        WHERE tipo=$1 AND categoria=$2 AND NOT spam
          AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($3,$4),4326)::geography, $5)
          AND ( ($1='conducta' AND abs(extract(epoch FROM (coalesce(fecha_hecho, creado_en) - coalesce($6::timestamptz, now())))) <= 3600)
             OR ($1='infraestructura' AND estado = ANY($7)) )
        ORDER BY creado_en LIMIT 1`,
      [d.tipo, d.categoria, d.lon, d.lat, config.radioDuplicadoM, fechaHecho, ESTADOS_ABIERTOS]
    );
    const ins = await c.query(
      `INSERT INTO reportes (tipo, categoria, descripcion, fecha_hecho, geom, placa, autor_id, posible_duplicado_de, vereda)
       VALUES ($1,$2,$3,$4, ST_SetSRID(ST_MakePoint($5,$6),4326), $7, $8, $9,
               (SELECT nombre FROM veredas v WHERE ST_Contains(v.geom, ST_SetSRID(ST_MakePoint($5,$6),4326)) LIMIT 1))
       RETURNING id`,
      [d.tipo, d.categoria, d.descripcion, fechaHecho, d.lon, d.lat, placa, req.usuario.id, dup.rows[0]?.id || null]
    );
    const nuevoId = ins.rows[0].id;
    for (const f of fotos) await c.query(`INSERT INTO reporte_fotos (reporte_id, archivo) VALUES ($1,$2)`, [nuevoId, f]);
    await c.query(`INSERT INTO reporte_historial (reporte_id, estado_nuevo, usuario_id) VALUES ($1,'RECIBIDO',$2)`, [nuevoId, req.usuario.id]);
    return nuevoId;
  });
  res.status(201).json({ id, mensaje: "Reporte recibido. Puedes seguir su estado en «Mis reportes»." });
});

// RF-M04-02: reportes similares cercanos antes de enviar
r.get("/similares", async (req, res) => {
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.json([]);
  const { rows } = await q(
    `SELECT r.id, r.categoria, c.nombre AS categoria_nombre, r.estado, r.creado_en,
            round(ST_Distance(r.geom::geography, ST_SetSRID(ST_MakePoint($2,$3),4326)::geography))::int AS distancia_m,
            (SELECT count(*)::int FROM reporte_apoyos a WHERE a.reporte_id = r.id) AS apoyos
       FROM reportes r JOIN catalogos c ON c.tipo = r.tipo AND c.codigo = r.categoria
      WHERE r.tipo = 'infraestructura' AND NOT r.spam AND r.estado = ANY($4)
        AND ($1::text IS NULL OR r.categoria = $1)
        AND ST_DWithin(r.geom::geography, ST_SetSRID(ST_MakePoint($2,$3),4326)::geography, 150)
      ORDER BY distancia_m LIMIT 5`,
    [req.query.categoria || null, lon, lat, ESTADOS_ABIERTOS]
  );
  res.json(rows);
});

r.post("/:id/apoyar", requiereRol("ciudadano"), async (req, res) => {
  const { rows } = await q(`SELECT tipo, autor_id FROM reportes WHERE id=$1`, [req.params.id]);
  if (!rows.length || rows[0].tipo !== "infraestructura") return res.status(404).json({ error: "Reporte no encontrado." });
  if (rows[0].autor_id === req.usuario.id) return res.status(400).json({ error: "No puedes apoyar tu propio reporte." });
  await q(`INSERT INTO reporte_apoyos (reporte_id, usuario_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.params.id, req.usuario.id]);
  res.json({ ok: true, mensaje: "Gracias. Sumamos tu apoyo al reporte existente." });
});

// ───────── Consulta del ciudadano (RF-M01-05, RF-M04-03) ─────────
r.get("/mios", requiereSesion, async (req, res) => {
  const { rows } = await q(
    `SELECT r.id, r.tipo, r.categoria, c.nombre AS categoria_nombre, r.descripcion, r.estado, r.creado_en, r.actualizado_en,
            ST_Y(r.geom) AS lat, ST_X(r.geom) AS lon,
            (SELECT json_agg(json_build_object('estado', h.estado_nuevo, 'comentario', h.comentario, 'fecha', h.creado_en) ORDER BY h.creado_en)
               FROM reporte_historial h WHERE h.reporte_id = r.id) AS historial
       FROM reportes r JOIN catalogos c ON c.tipo = r.tipo AND c.codigo = r.categoria
      WHERE r.autor_id = $1 ORDER BY r.creado_en DESC`, [req.usuario.id]);
  res.json(rows);
});

// ───────── Mapa público agregado (RF-M01-07, RF-M04-06) ─────────
r.get("/publico", async (req, res) => {
  // Conductas: agregadas en celdas de ~250 m (sin placas, fotos, descripción ni autor)
  const conductas = await q(
    `SELECT ST_Y(ST_Centroid(ST_Collect(geom))) AS lat, ST_X(ST_Centroid(ST_Collect(geom))) AS lon, count(*)::int AS total
       FROM reportes WHERE tipo='conducta' AND NOT spam AND estado <> 'DESCARTADO'
      GROUP BY ST_SnapToGrid(geom, 0.0025)`);
  // Infraestructura: puntos con categoría y estado
  const infra = await q(
    `SELECT r.id, ST_Y(r.geom) AS lat, ST_X(r.geom) AS lon, r.categoria, c.nombre AS categoria_nombre, r.estado,
            (SELECT count(*)::int FROM reporte_apoyos a WHERE a.reporte_id = r.id) AS apoyos
       FROM reportes r JOIN catalogos c ON c.tipo = r.tipo AND c.codigo = r.categoria
      WHERE r.tipo='infraestructura' AND NOT r.spam AND r.estado <> 'RECHAZADO'`);
  res.json({ conductas: conductas.rows, infraestructura: infra.rows });
});

// ───────── Bandeja de gestión (RF-M01-06, RF-M04-04) ─────────
r.get("/bandeja", requiereRol("funcionario", "admin", "entidad"), async (req, res) => {
  const cond = ["TRUE"], params = [];
  const add = (sql, v) => { params.push(v); cond.push(sql.replace("?", `$${params.length}`)); };
  if (req.query.tipo) add("r.tipo = ?", req.query.tipo);
  if (req.query.estado) add("r.estado = ?", req.query.estado);
  if (req.query.categoria) add("r.categoria = ?", req.query.categoria);
  if (req.query.vereda) add("r.vereda = ?", req.query.vereda);
  if (req.query.desde) add("r.creado_en >= ?::date", req.query.desde);
  if (req.query.hasta) add("r.creado_en < (?::date + 1)", req.query.hasta);
  if (req.query.spam !== "true") cond.push("NOT r.spam");
  // La entidad externa solo ve los reportes asignados a su entidad (RF-M04-05)
  if (req.usuario.rol === "entidad") add("r.entidad_asignada_id = ?", req.usuario.entidad_id ?? -1);
  params.push(config.radioSiniestrosM);
  const radio = `$${params.length}`;
  const { rows } = await q(
    `SELECT r.id, r.tipo, r.categoria, c.nombre AS categoria_nombre, r.descripcion, r.estado, r.creado_en, r.fecha_hecho,
            r.vereda, r.posible_duplicado_de, r.spam, r.fecha_objetivo, e.nombre AS entidad_asignada, r.entidad_asignada_id,
            ST_Y(r.geom) AS lat, ST_X(r.geom) AS lon,
            ${req.usuario.rol === "entidad" ? "NULL" : "r.placa"} AS placa,
            (SELECT count(*)::int FROM reporte_apoyos a WHERE a.reporte_id = r.id) AS apoyos,
            (SELECT count(*)::int FROM reporte_fotos f WHERE f.reporte_id = r.id) AS fotos,
            (SELECT count(*)::int FROM siniestros s WHERE s.geom IS NOT NULL
                AND ST_DWithin(s.geom::geography, r.geom::geography, ${radio})) AS siniestros_cercanos,
            (EXTRACT(EPOCH FROM (now() - r.creado_en)) / 86400)::int AS dias
       FROM reportes r
       JOIN catalogos c ON c.tipo = r.tipo AND c.codigo = r.categoria
       LEFT JOIN entidades e ON e.id = r.entidad_asignada_id
      WHERE ${cond.join(" AND ")}
      ORDER BY r.creado_en DESC LIMIT 500`, params);
  res.json({ reportes: rows, radio_m: config.radioSiniestrosM, estados: ESTADOS });
});

r.get("/:id", requiereSesion, async (req, res) => {
  const { rows } = await q(
    `SELECT r.*, ST_Y(r.geom) AS lat, ST_X(r.geom) AS lon, c.nombre AS categoria_nombre, e.nombre AS entidad_asignada
       FROM reportes r JOIN catalogos c ON c.tipo = r.tipo AND c.codigo = r.categoria
       LEFT JOIN entidades e ON e.id = r.entidad_asignada_id WHERE r.id = $1`, [req.params.id]);
  const rep = rows[0];
  if (!rep) return res.status(404).json({ error: "Reporte no encontrado." });
  const u = req.usuario;
  const puede = rep.autor_id === u.id || esFuncionario(u) || (u.rol === "entidad" && rep.entidad_asignada_id === u.entidad_id);
  if (!puede) return res.status(403).json({ error: "No tienes permiso para ver este reporte." });
  delete rep.geom;
  if (!esFuncionario(u)) delete rep.placa; // RF-M01-03
  const [fotos, historial] = await Promise.all([
    q(`SELECT id FROM reporte_fotos WHERE reporte_id=$1 ORDER BY id`, [rep.id]),
    q(`SELECT h.estado_anterior, h.estado_nuevo, h.comentario, h.creado_en, us.nombre AS usuario
         FROM reporte_historial h LEFT JOIN usuarios us ON us.id = h.usuario_id WHERE h.reporte_id=$1 ORDER BY h.creado_en`, [rep.id]),
  ]);
  res.json({ ...rep, fotos: fotos.rows.map((f) => `/api/reportes/${rep.id}/fotos/${f.id}`), historial: historial.rows });
});

// Fotos: solo autor, funcionarios o entidad asignada (RNF-SEG-09)
r.get("/:id/fotos/:fotoId", requiereSesion, async (req, res) => {
  const { rows } = await q(
    `SELECT f.archivo, r.autor_id, r.entidad_asignada_id FROM reporte_fotos f JOIN reportes r ON r.id = f.reporte_id
      WHERE f.id = $1 AND r.id = $2`, [req.params.fotoId, req.params.id]);
  const f = rows[0];
  const u = req.usuario;
  if (!f) return res.status(404).end();
  if (!(f.autor_id === u.id || esFuncionario(u) || (u.rol === "entidad" && f.entidad_asignada_id === u.entidad_id))) return res.status(403).end();
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.sendFile(path.join(config.uploadsDir, path.basename(f.archivo)));
});

// ───────── Cambios de estado (RF-M01-06, RF-M04-04, RF-M04-05) ─────────
r.patch("/:id/estado", requiereRol("funcionario", "admin", "entidad"), async (req, res) => {
  const estado = String(req.body?.estado || "");
  const comentario = String(req.body?.comentario || "").trim() || null;
  const { rows } = await q(
    `SELECT r.*, u.email, u.nombre AS autor_nombre FROM reportes r LEFT JOIN usuarios u ON u.id = r.autor_id WHERE r.id=$1`, [req.params.id]);
  const rep = rows[0];
  if (!rep) return res.status(404).json({ error: "Reporte no encontrado." });
  if (req.usuario.rol === "entidad") {
    if (rep.tipo !== "infraestructura" || rep.entidad_asignada_id !== req.usuario.entidad_id) {
      return res.status(403).json({ error: "Solo puedes actualizar los reportes asignados a tu entidad." });
    }
    if (!["EN_GESTION", "RESUELTO"].includes(estado)) return res.status(400).json({ error: "Tu entidad solo puede marcar «En gestión» o «Resuelto»." });
  }
  if (!ESTADOS[rep.tipo].includes(estado)) return res.status(400).json({ error: "Estado no válido para este tipo de reporte." });
  if (ESTADOS_CIERRE_CON_MOTIVO.includes(estado) && !comentario) return res.status(400).json({ error: "Indica el motivo para descartar o rechazar el reporte." });
  if (estado === rep.estado) return res.status(400).json({ error: "El reporte ya está en ese estado." });
  await transaccion(async (c) => {
    await c.query(`UPDATE reportes SET estado=$2, actualizado_en=now() WHERE id=$1`, [rep.id, estado]);
    await c.query(`INSERT INTO reporte_historial (reporte_id, estado_anterior, estado_nuevo, comentario, usuario_id) VALUES ($1,$2,$3,$4,$5)`,
      [rep.id, rep.estado, estado, comentario, req.usuario.id]);
  });
  await registrar(req.usuario.id, "cambio_estado_reporte", "reporte", rep.id, { de: rep.estado, a: estado });
  if (rep.email) {
    const [asunto, cuerpo] = plantillas.cambioEstado(rep.autor_nombre, rep.id, estado.replace("_", " ").toLowerCase(), comentario);
    await enviarCorreo(rep.email, asunto, cuerpo);
  }
  res.json({ ok: true });
});

r.patch("/:id/asignar", requiereRol("funcionario", "admin"), async (req, res) => {
  const entidadId = Number(req.body?.entidad_id);
  const fecha = req.body?.fecha_objetivo || null;
  const { rows } = await q(`SELECT id, tipo FROM reportes WHERE id=$1`, [req.params.id]);
  if (!rows.length || rows[0].tipo !== "infraestructura") return res.status(404).json({ error: "Reporte de infraestructura no encontrado." });
  const ent = await q(`SELECT nombre FROM entidades WHERE id=$1`, [entidadId]);
  if (!ent.rows.length) return res.status(400).json({ error: "Entidad no válida." });
  await q(`UPDATE reportes SET entidad_asignada_id=$2, fecha_objetivo=$3, actualizado_en=now() WHERE id=$1`, [req.params.id, entidadId, fecha]);
  await registrar(req.usuario.id, "asignar_reporte", "reporte", req.params.id, { entidad_id: entidadId, fecha_objetivo: fecha });
  const dest = await q(`SELECT email FROM usuarios WHERE entidad_id=$1 AND rol='entidad' AND activo`, [entidadId]);
  const [asunto, cuerpo] = plantillas.asignacion(req.params.id, ent.rows[0].nombre, fecha);
  for (const d of dest.rows) await enviarCorreo(d.email, asunto, cuerpo);
  res.json({ ok: true });
});

r.patch("/:id/spam", requiereRol("funcionario", "admin"), async (req, res) => {
  const spam = req.body?.spam !== false;
  await q(`UPDATE reportes SET spam=$2, actualizado_en=now() WHERE id=$1`, [req.params.id, spam]);
  await registrar(req.usuario.id, spam ? "marcar_spam" : "desmarcar_spam", "reporte", req.params.id);
  res.json({ ok: true });
});

export default r;
