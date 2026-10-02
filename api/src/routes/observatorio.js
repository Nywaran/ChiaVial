// M07 · Observatorio y mapa de calor de siniestralidad (público)
import { Router } from "express";
import { q } from "../db.js";
import { CONJUNTOS } from "../etl/conjuntos.js";
import { aCsv } from "../lib/csv.js";

const r = Router();

/** Construye el WHERE a partir de los filtros de RF-M07-01. */
export function filtrosSiniestros(query, alias = "s") {
  const cond = [];
  const params = [];
  const add = (sql, v) => { params.push(v); cond.push(sql.replace("?", `$${params.length}`)); };
  if (query.anio) add(`EXTRACT(YEAR FROM ${alias}.fecha) = ?`, Number(query.anio));
  if (query.mes) add(`EXTRACT(MONTH FROM ${alias}.fecha) = ?`, Number(query.mes));
  if (query.gravedad) add(`${alias}.gravedad = ?`, String(query.gravedad));
  if (query.clase) add(`${alias}.clase = ?`, String(query.clase));
  if (query.entidad) add(`${alias}.entidad_reporta = ?`, String(query.entidad));
  if (query.vereda) add(`${alias}.vereda = ?`, String(query.vereda));
  if (query.hasta) add(`${alias}.fecha <= ?::date`, String(query.hasta));
  return { where: cond.length ? `WHERE ${cond.join(" AND ")}` : "", params };
}

async function contar(query) {
  const { where, params } = filtrosSiniestros(query);
  const { rows } = await q(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE gravedad='CON MUERTO')::int AS con_muerto,
            count(*) FILTER (WHERE gravedad='CON HERIDO')::int AS con_herido
       FROM siniestros s ${where}`, params);
  return rows[0];
}

// RF-M07-05: fuente, actualización, licencia y limitaciones
r.get("/meta", async (req, res) => {
  const ult = await q(`SELECT conjunto, max(finalizada_en) AS fecha FROM ingestas WHERE estado='ok' GROUP BY conjunto`);
  const rango = await q(`SELECT min(fecha) AS desde, max(fecha) AS hasta, count(*)::int AS total, count(geom)::int AS ubicados FROM siniestros`);
  res.json({
    fuentes: Object.entries(CONJUNTOS).map(([k, c]) => ({
      clave: k, id: c.id, nombre: c.nombre, fuente: c.fuente, licencia: c.licencia,
      url: `https://www.datos.gov.co/d/${c.id}`,
      actualizado_en: ult.rows.find((x) => x.conjunto === k)?.fecha || null,
    })),
    ...rango.rows[0],
    limitaciones: [
      "El conjunto de siniestros solo incluye accidentes con herido o con muerto (no incluye los de solo daños).",
      "No trae hora, tipo de víctima ni clase de vehículo: no es posible analizar por franja horaria ni por peatones o ciclistas.",
      "El lugar viene como texto libre; la ubicación en el mapa es aproximada y algunos siniestros aún no están ubicados.",
      "Los datos se actualizan por periodos (trimestral según el portal); no son en tiempo real.",
    ],
  });
});

r.get("/filtros", async (req, res) => {
  const [anios, clases, entidades, veredas] = await Promise.all([
    q(`SELECT DISTINCT EXTRACT(YEAR FROM fecha)::int AS v FROM siniestros WHERE fecha IS NOT NULL ORDER BY 1 DESC`),
    q(`SELECT DISTINCT clase AS v FROM siniestros WHERE clase IS NOT NULL ORDER BY 1`),
    q(`SELECT DISTINCT entidad_reporta AS v FROM siniestros WHERE entidad_reporta IS NOT NULL ORDER BY 1`),
    q(`SELECT nombre AS v FROM veredas ORDER BY 1`),
  ]);
  res.json({
    anios: anios.rows.map((x) => x.v),
    gravedades: ["CON MUERTO", "CON HERIDO"],
    clases: clases.rows.map((x) => x.v),
    entidades: entidades.rows.map((x) => x.v),
    veredas: veredas.rows.map((x) => x.v),
  });
});

// RF-M07-02: indicadores y comparación con el periodo anterior
r.get("/resumen", async (req, res) => {
  const actual = await contar(req.query);
  let anterior = null, periodo_anterior = null;
  if (req.query.anio && req.query.mes) {
    let a = Number(req.query.anio), m = Number(req.query.mes) - 1;
    if (m === 0) { m = 12; a -= 1; }
    anterior = await contar({ ...req.query, anio: a, mes: m });
    periodo_anterior = `${String(m).padStart(2, "0")}/${a}`;
  } else if (req.query.anio) {
    // Si el año en curso está incompleto, se compara con los mismos meses del año anterior
    const a = Number(req.query.anio) - 1;
    const { rows } = await q(`SELECT max(fecha) AS max FROM siniestros WHERE EXTRACT(YEAR FROM fecha) = $1`, [Number(req.query.anio)]);
    const max = rows[0].max;
    if (max && !max.endsWith("-12-31") && Number(max.slice(5, 7)) < 12) {
      const hasta = `${a}${max.slice(4)}`;
      anterior = await contar({ ...req.query, anio: a, hasta });
      const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
      periodo_anterior = `ene–${meses[Number(max.slice(5, 7)) - 1]} ${a}`;
    } else {
      anterior = await contar({ ...req.query, anio: a });
      periodo_anterior = String(a);
    }
  }
  res.json({ ...actual, anterior, periodo_anterior });
});

// RF-M07-01: puntos para el mapa de calor (peso: con muerto 3, con herido 1)
r.get("/mapa", async (req, res) => {
  const { where, params } = filtrosSiniestros(req.query);
  const extra = where ? `${where} AND s.geom IS NOT NULL` : "WHERE s.geom IS NOT NULL";
  const { rows } = await q(
    `SELECT s.id, ST_Y(s.geom) AS lat, ST_X(s.geom) AS lon, s.gravedad, s.clase, s.fecha, s.lugar, s.geo_fuente, s.geo_confianza
       FROM siniestros s ${extra}`, params);
  const sinUbicar = await q(`SELECT count(*)::int AS n FROM siniestros s ${where ? `${where} AND` : "WHERE"} s.geom IS NULL`, params);
  res.json({ puntos: rows.map((p) => ({ ...p, peso: p.gravedad === "CON MUERTO" ? 3 : 1 })), sin_ubicar: sinUbicar.rows[0].n });
});

// RF-M07-03: tendencia mensual por gravedad
r.get("/tendencia", async (req, res) => {
  const { where, params } = filtrosSiniestros({ ...req.query, mes: undefined });
  const { rows } = await q(
    `SELECT to_char(date_trunc('month', fecha), 'YYYY-MM') AS mes,
            count(*) FILTER (WHERE gravedad='CON HERIDO')::int AS con_herido,
            count(*) FILTER (WHERE gravedad='CON MUERTO')::int AS con_muerto
       FROM siniestros s ${where ? `${where} AND` : "WHERE"} fecha IS NOT NULL
      GROUP BY 1 ORDER BY 1`, params);
  res.json(rows);
});

// RF-M07-03: distribución por clase de accidente
r.get("/clases", async (req, res) => {
  const { where, params } = filtrosSiniestros(req.query);
  const { rows } = await q(
    `SELECT coalesce(clase,'SIN DATO') AS clase, count(*)::int AS total,
            count(*) FILTER (WHERE gravedad='CON MUERTO')::int AS con_muerto
       FROM siniestros s ${where} GROUP BY 1 ORDER BY 2 DESC`, params);
  res.json(rows);
});

// RF-M07-04: ranking de las 10 vías con más siniestros
r.get("/ranking", async (req, res) => {
  const { where, params } = filtrosSiniestros(req.query);
  const { rows } = await q(
    `SELECT coalesce(via,'SIN DATO') AS via, count(*)::int AS total,
            count(*) FILTER (WHERE gravedad='CON MUERTO')::int AS con_muerto
       FROM siniestros s ${where} GROUP BY 1 ORDER BY 2 DESC, 3 DESC, 1 LIMIT 10`, params);
  res.json(rows);
});

// RF-M07-06: vehículos involucrados (MinTransporte/RUNT, filtrado por Chía)
r.get("/vehiculos", async (req, res) => {
  const cond = [], params = [];
  if (req.query.anio) { params.push(Number(req.query.anio)); cond.push(`anio = $${params.length}`); }
  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
  const [tipos, edades, total] = await Promise.all([
    q(`SELECT coalesce(tipo_vehiculo,'SIN DATO') AS tipo, count(*)::int AS total,
              count(*) FILTER (WHERE gravedad='CON MUERTO')::int AS con_muerto
         FROM vehiculos_siniestro ${where} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, params),
    q(`SELECT CASE WHEN edad_vehiculo IS NULL THEN 'Sin dato'
                   WHEN edad_vehiculo <= 2 THEN '0 a 2 años'
                   WHEN edad_vehiculo <= 5 THEN '3 a 5 años'
                   WHEN edad_vehiculo <= 10 THEN '6 a 10 años'
                   WHEN edad_vehiculo <= 20 THEN '11 a 20 años'
                   ELSE 'Más de 20 años' END AS rango,
              count(*)::int AS total, min(coalesce(edad_vehiculo, 999)) AS orden
         FROM vehiculos_siniestro ${where} GROUP BY 1 ORDER BY 3`, params),
    q(`SELECT count(*)::int AS total, min(anio) AS desde, max(anio) AS hasta FROM vehiculos_siniestro ${where}`, params),
  ]);
  res.json({ ...total.rows[0], tipos: tipos.rows, edades: edades.rows.map(({ orden, ...x }) => x) });
});

// RF-M07-07: límites de veredas
r.get("/veredas", async (req, res) => {
  const { rows } = await q(`SELECT nombre, ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.00005))::json AS geometry FROM veredas`);
  res.json({ type: "FeatureCollection", features: rows.map((v) => ({ type: "Feature", properties: { nombre: v.nombre }, geometry: v.geometry })) });
});

// RF-M07-08: descarga CSV de datos agregados con atribución y licencia
r.get("/descarga.csv", async (req, res) => {
  const { where, params } = filtrosSiniestros(req.query);
  const { rows } = await q(
    `SELECT to_char(date_trunc('month', fecha),'YYYY-MM') AS mes, gravedad, clase, coalesce(vereda,'') AS vereda, count(*)::int AS siniestros
       FROM siniestros s ${where} GROUP BY 1,2,3,4 ORDER BY 1,2,3,4`, params);
  const c = CONJUNTOS.siniestros;
  const filas = rows.map((x) => ({ ...x, fuente: `${c.fuente} (${c.id})`, licencia: c.licencia }));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="chiavial_siniestros_agregados.csv"');
  res.send(aCsv(filas, ["mes", "gravedad", "clase", "vereda", "siniestros", "fuente", "licencia"]));
});

export default r;
