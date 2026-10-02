// Administración: RF-GEN-04, 07, 11, 12, 14, 15; RF-M10-01
import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { z } from "zod";
import { parse } from "csv-parse/sync";
import { q } from "../db.js";
import { config } from "../config.js";
import { requiereRol } from "../middleware/auth.js";
import { registrar } from "../lib/bitacora.js";
import { ingestarTodo, ingestarConjunto } from "../etl/ingesta.js";
import { ORDEN_INGESTA } from "../etl/conjuntos.js";
import { geocodificarPendientes } from "../lib/geocodificar.js";
import * as N from "../lib/normalizar.js";

const r = Router();
const soloAdmin = requiereRol("admin");
const staff = requiereRol("funcionario", "admin");

// ───────── Catálogos públicos (para formularios) ─────────
r.get("/catalogos", async (req, res) => {
  const [cat, ent] = await Promise.all([
    q(`SELECT tipo, codigo, nombre FROM catalogos WHERE activo ORDER BY tipo, orden`),
    q(`SELECT id, nombre FROM entidades ORDER BY nombre`),
  ]);
  res.json({
    conducta: cat.rows.filter((c) => c.tipo === "conducta"),
    infraestructura: cat.rows.filter((c) => c.tipo === "infraestructura"),
    entidades: ent.rows,
    bbox: config.bboxChia,
  });
});

// ───────── Usuarios (RF-GEN-04) ─────────
r.get("/usuarios", soloAdmin, async (req, res) => {
  const { rows } = await q(
    `SELECT u.id, u.nombre, u.email, u.rol, u.activo, u.email_verificado, u.creado_en, e.nombre AS entidad, u.entidad_id
       FROM usuarios u LEFT JOIN entidades e ON e.id = u.entidad_id ORDER BY u.rol, u.nombre`);
  res.json(rows);
});

const esquemaUsuario = z.object({
  nombre: z.string().trim().min(2),
  email: z.string().trim().toLowerCase().email("Correo no válido."),
  rol: z.enum(["funcionario", "entidad", "admin"]),
  entidad_id: z.coerce.number().int().optional().nullable(),
  password: z.string().min(8, "La contraseña temporal debe tener al menos 8 caracteres.").optional(),
});

r.post("/usuarios", soloAdmin, async (req, res) => {
  const p = esquemaUsuario.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const d = p.data;
  if (d.rol === "entidad" && !d.entidad_id) return res.status(400).json({ error: "Selecciona la entidad del usuario." });
  const existe = await q(`SELECT 1 FROM usuarios WHERE email=$1`, [d.email]);
  if (existe.rows.length) return res.status(409).json({ error: "Ya existe un usuario con ese correo." });
  const temporal = d.password || crypto.randomBytes(9).toString("base64url");
  const { rows } = await q(
    `INSERT INTO usuarios (nombre, email, password_hash, rol, entidad_id, email_verificado)
     VALUES ($1,$2,$3,$4,$5, TRUE) RETURNING id`,
    [d.nombre, d.email, await bcrypt.hash(temporal, 12), d.rol, d.rol === "entidad" ? d.entidad_id : d.entidad_id || null]
  );
  await registrar(req.usuario.id, "crear_usuario", "usuario", rows[0].id, { rol: d.rol });
  res.status(201).json({ id: rows[0].id, password_temporal: d.password ? undefined : temporal });
});

r.patch("/usuarios/:id", soloAdmin, async (req, res) => {
  const activo = req.body?.activo;
  if (typeof activo !== "boolean") return res.status(400).json({ error: "Indica si el usuario queda activo." });
  if (Number(req.params.id) === req.usuario.id && !activo) return res.status(400).json({ error: "No puedes desactivar tu propia cuenta." });
  await q(`UPDATE usuarios SET activo=$2 WHERE id=$1`, [req.params.id, activo]);
  await registrar(req.usuario.id, activo ? "activar_usuario" : "desactivar_usuario", "usuario", req.params.id);
  res.json({ ok: true });
});

// ───────── Ingesta (RF-GEN-07, RF-GEN-12) ─────────
r.get("/ingestas", soloAdmin, async (req, res) => {
  const { rows } = await q(`SELECT * FROM ingestas ORDER BY id DESC LIMIT 50`);
  const estado = await q(`SELECT (SELECT count(*)::int FROM siniestros) AS siniestros, (SELECT count(geom)::int FROM siniestros) AS ubicados,
                                 (SELECT count(*)::int FROM comparendos) AS comparendos, (SELECT count(*)::int FROM vehiculos_siniestro) AS vehiculos,
                                 (SELECT count(*)::int FROM veredas) AS veredas`);
  res.json({ ingestas: rows, totales: estado.rows[0], fuente: config.ingestaFuente, directorio: config.dataDir });
});

r.post("/ingestas", soloAdmin, async (req, res) => {
  const conjunto = req.body?.conjunto;
  const fuente = ["csv", "api"].includes(req.body?.fuente) ? req.body.fuente : undefined;
  const resultado = conjunto && ORDEN_INGESTA.includes(conjunto)
    ? { resultados: [await ingestarConjunto(conjunto, { fuente })] }
    : await ingestarTodo({ fuente });
  await registrar(req.usuario.id, "ejecutar_ingesta", "ingesta", null, { conjunto: conjunto || "todos", fuente: fuente || config.ingestaFuente });
  res.json(resultado);
});

r.post("/geocodificar", soloAdmin, async (req, res) => {
  const resultado = await geocodificarPendientes({ reintentar: !!req.body?.reintentar });
  await registrar(req.usuario.id, "geocodificar", "siniestro", null, resultado);
  res.json(resultado);
});

// ───────── Ubicación manual de siniestros (RF-GEN-11) ─────────
r.get("/siniestros/pendientes", staff, async (req, res) => {
  const { rows } = await q(
    `SELECT id, numero_ipat, fecha, gravedad, clase, lugar, via, entidad_reporta FROM siniestros
      WHERE geom IS NULL ORDER BY fecha DESC NULLS LAST LIMIT 300`);
  const tot = await q(`SELECT count(*)::int AS pendientes FROM siniestros WHERE geom IS NULL`);
  res.json({ siniestros: rows, ...tot.rows[0] });
});

r.get("/siniestros/ubicados", staff, async (req, res) => {
  const { rows } = await q(
    `SELECT id, numero_ipat, fecha, gravedad, lugar, geo_fuente, geo_confianza, ST_Y(geom) AS lat, ST_X(geom) AS lon
       FROM siniestros WHERE geom IS NOT NULL ORDER BY geo_confianza NULLS FIRST, fecha DESC LIMIT 300`);
  res.json(rows);
});

r.patch("/siniestros/:id/ubicacion", staff, async (req, res) => {
  const lat = Number(req.body?.lat), lon = Number(req.body?.lon);
  const [oeste, sur, este, norte] = config.bboxChia;
  if (!(lon >= oeste && lon <= este && lat >= sur && lat <= norte)) return res.status(400).json({ error: "La ubicación debe estar dentro de Chía." });
  const { rows } = await q(
    `UPDATE siniestros SET geom = ST_SetSRID(ST_MakePoint($2,$3),4326), geo_fuente='manual', geo_confianza=1, geo_intentado_en=now(),
            vereda = (SELECT nombre FROM veredas v WHERE ST_Contains(v.geom, ST_SetSRID(ST_MakePoint($2,$3),4326)) LIMIT 1)
      WHERE id=$1 RETURNING id`, [req.params.id, lon, lat]);
  if (!rows.length) return res.status(404).json({ error: "Siniestro no encontrado." });
  await registrar(req.usuario.id, "ubicar_siniestro", "siniestro", req.params.id, { lat, lon });
  res.json({ ok: true });
});

// Referencias kilométricas de corredores (permiten ubicar automáticamente «VÍA X KM n+m»)
r.get("/corredores", staff, async (req, res) => {
  const refs = await q(`SELECT id, corredor, km, ST_Y(geom) AS lat, ST_X(geom) AS lon FROM corredores_km ORDER BY corredor, km`);
  const sugeridos = await q(
    `SELECT lugar_normalizado FROM siniestros WHERE lugar_normalizado ~ '^.+KM\\s*\\d'`);
  const conteo = {};
  for (const s of sugeridos.rows) {
    const i = N.interpretarLugar(s.lugar_normalizado);
    if (i.tipo !== "km") continue;
    conteo[i.corredor] ??= { corredor: i.corredor, siniestros: 0, km_min: i.km, km_max: i.km, ubicados_con_ref: 0 };
    const c = conteo[i.corredor];
    c.siniestros++; c.km_min = Math.min(c.km_min, i.km); c.km_max = Math.max(c.km_max, i.km);
  }
  res.json({ referencias: refs.rows, corredores_en_datos: Object.values(conteo).sort((a, b) => b.siniestros - a.siniestros) });
});

r.post("/corredores", staff, async (req, res) => {
  const corredor = N.corredor(req.body?.corredor);
  const km = Number(req.body?.km), lat = Number(req.body?.lat), lon = Number(req.body?.lon);
  if (!corredor || !Number.isFinite(km) || !Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: "Datos incompletos." });
  await q(`INSERT INTO corredores_km (corredor, km, geom) VALUES ($1,$2, ST_SetSRID(ST_MakePoint($3,$4),4326))
           ON CONFLICT (corredor, km) DO UPDATE SET geom = EXCLUDED.geom`, [corredor, km, lon, lat]);
  // Se reintenta la ubicación de los siniestros de ese corredor que no estén ubicados manualmente
  const deCorredor = (await q(`SELECT id, lugar_normalizado FROM siniestros WHERE coalesce(geo_fuente,'') <> 'manual' AND lugar_normalizado ~ 'KM'`)).rows
    .filter((s) => { const i = N.interpretarLugar(s.lugar_normalizado); return i.tipo === "km" && i.corredor === corredor; }).map((s) => s.id);
  if (deCorredor.length) await q(`UPDATE siniestros SET geom=NULL, geo_fuente=NULL, geo_confianza=NULL, geo_intentado_en=NULL WHERE id = ANY($1)`, [deCorredor]);
  const geo = await geocodificarPendientes();
  await registrar(req.usuario.id, "referencia_corredor", "corredor", corredor, { km, lat, lon });
  res.json({ ok: true, geocodificacion: geo });
});

r.delete("/corredores/:id", staff, async (req, res) => {
  await q(`DELETE FROM corredores_km WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

// ───────── Diccionario de infracciones (RF-M10-01, RF-M10-04) ─────────
r.get("/infracciones", staff, async (req, res) => {
  const { rows } = await q(
    `SELECT i.codigo, i.descripcion, i.grupo, (SELECT count(*)::int FROM comparendos c WHERE c.infraccion = i.codigo) AS comparendos
       FROM infracciones i ORDER BY comparendos DESC, i.codigo`);
  const grupos = await q(`SELECT codigo, nombre, es_riesgo FROM grupos_infraccion ORDER BY orden`);
  res.json({ infracciones: rows, grupos: grupos.rows });
});

r.put("/infracciones/:codigo", soloAdmin, async (req, res) => {
  const codigo = N.basico(req.params.codigo)?.replace(/\s|\./g, "");
  const grupo = String(req.body?.grupo || "SIN_CLASIFICAR");
  const descripcion = String(req.body?.descripcion || "").trim() || null;
  const g = await q(`SELECT 1 FROM grupos_infraccion WHERE codigo=$1`, [grupo]);
  if (!g.rows.length) return res.status(400).json({ error: "Grupo no válido." });
  await q(`INSERT INTO infracciones (codigo, descripcion, grupo) VALUES ($1,$2,$3)
           ON CONFLICT (codigo) DO UPDATE SET descripcion=EXCLUDED.descripcion, grupo=EXCLUDED.grupo`, [codigo, descripcion, grupo]);
  await registrar(req.usuario.id, "editar_infraccion", "infraccion", codigo, { grupo });
  res.json({ ok: true });
});

// Carga masiva desde CSV con columnas codigo,descripcion,grupo
r.post("/infracciones/csv", soloAdmin, async (req, res) => {
  const texto = String(req.body?.csv || "");
  let filas;
  try {
    filas = parse(texto.replace(/^﻿/, ""), { columns: (h) => h.map((c) => c.trim().toLowerCase()), skip_empty_lines: true, trim: true });
  } catch {
    return res.status(400).json({ error: "El CSV no es válido. Use columnas codigo,descripcion,grupo." });
  }
  const grupos = new Set((await q(`SELECT codigo FROM grupos_infraccion`)).rows.map((g) => g.codigo));
  let cargadas = 0;
  const errores = [];
  for (const [i, f] of filas.entries()) {
    const codigo = N.basico(f.codigo)?.replace(/\s|\./g, "");
    const grupo = (f.grupo || "SIN_CLASIFICAR").toUpperCase();
    if (!codigo) { errores.push(`Fila ${i + 2}: falta el código`); continue; }
    if (!grupos.has(grupo)) { errores.push(`Fila ${i + 2}: grupo «${f.grupo}» no válido`); continue; }
    await q(`INSERT INTO infracciones (codigo, descripcion, grupo) VALUES ($1,$2,$3)
             ON CONFLICT (codigo) DO UPDATE SET descripcion=EXCLUDED.descripcion, grupo=EXCLUDED.grupo`, [codigo, f.descripcion || null, grupo]);
    cargadas++;
  }
  await registrar(req.usuario.id, "cargar_infracciones_csv", "infraccion", null, { cargadas, errores: errores.length });
  res.json({ cargadas, errores });
});

// ───────── Bitácora y correos ─────────
r.get("/bitacora", soloAdmin, async (req, res) => {
  const { rows } = await q(
    `SELECT b.id, b.accion, b.objeto, b.objeto_id, b.detalle, b.creado_en, u.nombre AS usuario, u.rol
       FROM bitacora b LEFT JOIN usuarios u ON u.id = b.usuario_id ORDER BY b.id DESC LIMIT 200`);
  res.json(rows);
});

r.get("/correos", soloAdmin, async (req, res) => {
  const { rows } = await q(`SELECT * FROM correos ORDER BY id DESC LIMIT 100`);
  res.json({ correos: rows, smtp_configurado: !!config.smtp.host });
});

export default r;
