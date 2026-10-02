// M10 · Analítica de comparendos y conductas de riesgo (público)
// RF-M10-07: nunca se devuelve el número de comparendo; solo agregados.
import { Router } from "express";
import { q } from "../db.js";
import { CONJUNTOS } from "../etl/conjuntos.js";
import { aCsv } from "../lib/csv.js";

const r = Router();

function filtros(query) {
  const cond = [], params = [];
  const add = (sql, v) => { params.push(v); cond.push(sql.replace("?", `$${params.length}`)); };
  if (query.anio) add("EXTRACT(YEAR FROM c.fecha) = ?", Number(query.anio));
  if (query.entidad) add("c.entidad = ?", String(query.entidad));
  if (query.grupo) add("coalesce(i.grupo,'SIN_CLASIFICAR') = ?", String(query.grupo));
  return { where: cond.length ? `WHERE ${cond.join(" AND ")}` : "", params };
}
const BASE = `FROM comparendos c LEFT JOIN infracciones i ON i.codigo = c.infraccion
              LEFT JOIN grupos_infraccion g ON g.codigo = coalesce(i.grupo,'SIN_CLASIFICAR')`;

r.get("/filtros", async (req, res) => {
  const [anios, entidades, grupos] = await Promise.all([
    q(`SELECT DISTINCT EXTRACT(YEAR FROM fecha)::int AS v FROM comparendos WHERE fecha IS NOT NULL ORDER BY 1 DESC`),
    q(`SELECT DISTINCT entidad AS v FROM comparendos WHERE entidad IS NOT NULL ORDER BY 1`),
    q(`SELECT codigo, nombre, es_riesgo FROM grupos_infraccion ORDER BY orden`),
  ]);
  res.json({ anios: anios.rows.map((x) => x.v), entidades: entidades.rows.map((x) => x.v), grupos: grupos.rows });
});

// RF-M10-02 y RF-M10-04: totales, por entidad e indicador de conductas de riesgo
r.get("/resumen", async (req, res) => {
  const { where, params } = filtros(req.query);
  const [tot, ent, grp, dic] = await Promise.all([
    q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE g.es_riesgo)::int AS de_riesgo,
              min(c.fecha) AS desde, max(c.fecha) AS hasta ${BASE} ${where}`, params),
    q(`SELECT coalesce(c.entidad,'SIN DATO') AS entidad, count(*)::int AS total ${BASE} ${where} GROUP BY 1 ORDER BY 2 DESC`, params),
    q(`SELECT g.codigo, g.nombre, g.es_riesgo, count(*)::int AS total ${BASE} ${where} GROUP BY 1,2,3, g.orden ORDER BY g.orden`, params),
    q(`SELECT count(*) FILTER (WHERE descripcion IS NULL)::int AS sin_descripcion, count(*)::int AS codigos FROM infracciones`),
  ]);
  const t = tot.rows[0];
  res.json({
    ...t,
    porcentaje_riesgo: t.total ? Math.round((1000 * t.de_riesgo) / t.total) / 10 : 0,
    por_entidad: ent.rows,
    por_grupo: grp.rows,
    diccionario: dic.rows[0],
  });
});

// RF-M10-02: comparendos por mes
r.get("/mensual", async (req, res) => {
  const { where, params } = filtros(req.query);
  const { rows } = await q(
    `SELECT to_char(date_trunc('month', c.fecha),'YYYY-MM') AS mes, count(*)::int AS total,
            count(*) FILTER (WHERE g.es_riesgo)::int AS de_riesgo
       ${BASE} ${where ? `${where} AND` : "WHERE"} c.fecha IS NOT NULL GROUP BY 1 ORDER BY 1`, params);
  res.json(rows);
});

// RF-M10-03: infracciones más frecuentes
r.get("/ranking", async (req, res) => {
  const { where, params } = filtros(req.query);
  const { rows } = await q(
    `SELECT coalesce(c.infraccion,'SIN DATO') AS codigo, i.descripcion, g.nombre AS grupo, g.es_riesgo, count(*)::int AS total
       ${BASE} ${where} GROUP BY 1,2,3,4 ORDER BY 5 DESC LIMIT 15`, params);
  res.json(rows);
});

// RF-M10-05: patrón por día de la semana
r.get("/dia-semana", async (req, res) => {
  const { where, params } = filtros(req.query);
  const { rows } = await q(
    `SELECT EXTRACT(ISODOW FROM c.fecha)::int AS dia, count(*)::int AS total
       ${BASE} ${where ? `${where} AND` : "WHERE"} c.fecha IS NOT NULL GROUP BY 1 ORDER BY 1`, params);
  const nombres = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
  res.json(nombres.map((n, i) => ({ dia: n, total: rows.find((x) => x.dia === i + 1)?.total || 0 })));
});

// RF-M10-06: comparación mensual comparendos vs. siniestros
r.get("/vs-siniestros", async (req, res) => {
  const anio = req.query.anio ? Number(req.query.anio) : null;
  const { rows } = await q(
    `WITH c AS (SELECT to_char(date_trunc('month', fecha),'YYYY-MM') AS mes, count(*)::int AS comparendos
                  FROM comparendos WHERE fecha IS NOT NULL AND ($1::int IS NULL OR EXTRACT(YEAR FROM fecha) = $1) GROUP BY 1),
          s AS (SELECT to_char(date_trunc('month', fecha),'YYYY-MM') AS mes, count(*)::int AS siniestros
                  FROM siniestros WHERE fecha IS NOT NULL AND ($1::int IS NULL OR EXTRACT(YEAR FROM fecha) = $1) GROUP BY 1)
     SELECT coalesce(c.mes, s.mes) AS mes, coalesce(c.comparendos,0) AS comparendos, coalesce(s.siniestros,0) AS siniestros
       FROM c FULL JOIN s ON s.mes = c.mes ORDER BY 1`, [anio]);
  res.json(rows);
});

// RF-M10-08: descarga CSV con atribución
r.get("/descarga.csv", async (req, res) => {
  const { where, params } = filtros(req.query);
  const { rows } = await q(
    `SELECT to_char(date_trunc('month', c.fecha),'YYYY-MM') AS mes, coalesce(c.infraccion,'') AS codigo,
            coalesce(i.descripcion,'') AS descripcion, g.nombre AS grupo, coalesce(c.entidad,'') AS entidad, count(*)::int AS comparendos
       ${BASE} ${where} GROUP BY 1,2,3,4,5 ORDER BY 1,6 DESC`, params);
  const k = CONJUNTOS.comparendos;
  const filas = rows.map((x) => ({ ...x, fuente: `${k.fuente} (${k.id})`, licencia: k.licencia }));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="chiavial_comparendos_agregados.csv"');
  res.send(aCsv(filas, ["mes", "codigo", "descripcion", "grupo", "entidad", "comparendos", "fuente", "licencia"]));
});

export default r;
