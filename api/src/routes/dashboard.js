// Tablero de indicadores (Google Charts) para funcionarios y administradores.
// Todas las cifras se calculan en PostgreSQL a partir de las tablas del sistema.
import { Router } from "express";
import { q } from "../db.js";
import { requiereRol } from "../middleware/auth.js";

const r = Router();
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

r.get("/", requiereRol("funcionario", "admin"), async (req, res) => {
  const desde = FECHA.test(req.query.desde || "") ? req.query.desde : null;
  const hasta = FECHA.test(req.query.hasta || "") ? req.query.hasta : null;
  const P = [desde, hasta];
  // Filtro de rango reutilizable (columna date o timestamptz)
  const rango = (col) => `($1::date IS NULL OR ${col} >= $1::date) AND ($2::date IS NULL OR ${col} < $2::date + 1)`;
  const esAdmin = req.usuario.rol === "admin";

  const consultas = {
    kpis: q(
      `WITH rep AS (SELECT * FROM reportes WHERE NOT spam AND ${rango("creado_en")}),
            primera AS (
              SELECT h.reporte_id, min(h.creado_en) AS t FROM reporte_historial h
               WHERE h.estado_anterior IS NOT NULL GROUP BY 1),
            cierre AS (
              SELECT h.reporte_id, min(h.creado_en) AS t FROM reporte_historial h
               WHERE h.estado_nuevo IN ('ATENDIDO','DESCARTADO','RESUELTO','RECHAZADO') GROUP BY 1)
       SELECT count(*)::int AS total,
              count(*) FILTER (WHERE estado IN ('RECIBIDO','EN_REVISION','VERIFICADO','EN_GESTION'))::int AS abiertos,
              count(*) FILTER (WHERE estado IN ('ATENDIDO','DESCARTADO','RESUELTO','RECHAZADO'))::int AS cerrados,
              round(avg(EXTRACT(EPOCH FROM (p.t - rep.creado_en)) / 3600)::numeric, 1) AS horas_primera_respuesta,
              round(avg(EXTRACT(EPOCH FROM (c.t - rep.creado_en)) / 86400)::numeric, 1) AS dias_cierre
         FROM rep LEFT JOIN primera p ON p.reporte_id = rep.id LEFT JOIN cierre c ON c.reporte_id = rep.id`, P),
    reportesPorEstado: q(
      `SELECT tipo, estado, count(*)::int AS n FROM reportes WHERE NOT spam AND ${rango("creado_en")} GROUP BY 1, 2 ORDER BY 1, 2`, P),
    reportesPorCategoria: q(
      `SELECT c.nombre AS categoria, r.tipo, count(*)::int AS n
         FROM reportes r JOIN catalogos c ON c.tipo = r.tipo AND c.codigo = r.categoria
        WHERE NOT r.spam AND ${rango("r.creado_en")} GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12`, P),
    reportesPorSemana: q(
      `WITH semanas AS (
         SELECT generate_series(date_trunc('week', coalesce($1::date, (SELECT min(creado_en) FROM reportes)::date, current_date)),
                                date_trunc('week', coalesce($2::date, current_date)), interval '1 week')::date AS semana)
       SELECT s.semana,
              (SELECT count(*)::int FROM reportes r WHERE NOT r.spam AND date_trunc('week', r.creado_en)::date = s.semana) AS creados,
              (SELECT count(*)::int FROM reporte_historial h
                WHERE h.estado_nuevo IN ('ATENDIDO','DESCARTADO','RESUELTO','RECHAZADO')
                  AND date_trunc('week', h.creado_en)::date = s.semana) AS cerrados
         FROM semanas s ORDER BY 1 LIMIT 104`, P),
    reportesPorVereda: q(
      `SELECT coalesce(vereda, 'Sin vereda') AS vereda, count(*)::int AS n FROM reportes
        WHERE NOT spam AND ${rango("creado_en")} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, P),
    siniestrosPorMes: q(
      `SELECT to_char(date_trunc('month', fecha), 'YYYY-MM') AS mes,
              count(*) FILTER (WHERE gravedad = 'CON MUERTO')::int AS con_muerto,
              count(*) FILTER (WHERE gravedad = 'CON HERIDO')::int AS con_herido,
              count(*) FILTER (WHERE gravedad NOT IN ('CON MUERTO','CON HERIDO') OR gravedad IS NULL)::int AS otros
         FROM siniestros WHERE fecha IS NOT NULL AND ${rango("fecha")} GROUP BY 1 ORDER BY 1`, P),
    siniestrosPorClase: q(
      `SELECT coalesce(clase, 'SIN DATO') AS clase, count(*)::int AS n FROM siniestros
        WHERE ${rango("fecha")} GROUP BY 1 ORDER BY 2 DESC`, P),
    topVias: q(
      `SELECT via, count(*)::int AS n FROM siniestros WHERE via IS NOT NULL AND ${rango("fecha")}
        GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, P),
    comparendosPorGrupo: q(
      `SELECT coalesce(g.nombre, 'Sin clasificar') AS grupo, coalesce(g.es_riesgo, FALSE) AS es_riesgo, count(*)::int AS n
         FROM comparendos c LEFT JOIN infracciones i ON i.codigo = c.infraccion
         LEFT JOIN grupos_infraccion g ON g.codigo = i.grupo
        WHERE ${rango("c.fecha")} GROUP BY 1, 2 ORDER BY 3 DESC`, P),
    comparendosPorMes: q(
      `SELECT to_char(date_trunc('month', fecha), 'YYYY-MM') AS mes, count(*)::int AS n
         FROM comparendos WHERE fecha IS NOT NULL AND ${rango("fecha")} GROUP BY 1 ORDER BY 1`, P),
    notificaciones: q(
      `SELECT canal, estado, count(*)::int AS n FROM notificaciones WHERE ${rango("creado_en")} GROUP BY 1, 2 ORDER BY 1, 2`, P),
    resumenDatos: q(
      `SELECT (SELECT count(*)::int FROM siniestros) AS siniestros,
              (SELECT count(*)::int FROM siniestros WHERE geom IS NOT NULL) AS siniestros_ubicados,
              (SELECT count(*)::int FROM comparendos) AS comparendos,
              (SELECT min(fecha) FROM siniestros) AS siniestros_desde, (SELECT max(fecha) FROM siniestros) AS siniestros_hasta,
              (SELECT min(fecha) FROM comparendos) AS comparendos_desde, (SELECT max(fecha) FROM comparendos) AS comparendos_hasta,
              (SELECT count(*)::int FROM usuarios WHERE email LIKE '%@demo.chiavial.local') AS usuarios_demo`),
  };
  if (esAdmin) {
    consultas.usuariosPorRol = q(
      `SELECT u.rol, count(*)::int AS n, count(v.usuario_id)::int AS con_telegram
         FROM usuarios u LEFT JOIN telegram_vinculos v ON v.usuario_id = u.id WHERE u.activo GROUP BY 1 ORDER BY 1`);
  }

  const claves = Object.keys(consultas);
  const resultados = await Promise.all(Object.values(consultas));
  const datos = Object.fromEntries(claves.map((k, i) => [k, resultados[i].rows]));
  datos.kpis = datos.kpis[0];
  datos.resumenDatos = datos.resumenDatos[0];
  res.json({ filtros: { desde, hasta }, generado_en: new Date().toISOString(), ...datos });
});

export default r;
