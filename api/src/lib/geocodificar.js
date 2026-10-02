// Geocodificación de siniestros (RF-GEN-09)
// Orden: punto kilométrico (referencias del administrador) → vereda → Nominatim → pendiente (ubicación manual, RF-GEN-11)
import { q } from "../db.js";
import { config } from "../config.js";
import { interpretarLugar } from "./normalizar.js";

let ultimaLlamada = 0;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function dentroDeChia(lat, lon) {
  const [oeste, sur, este, norte] = config.bboxChia;
  return lon >= oeste && lon <= este && lat >= sur && lat <= norte;
}

/** Interpolación lineal entre referencias kilométricas de un corredor. */
export function interpolarKm(refs, km) {
  if (!refs.length) return null;
  const orden = [...refs].sort((a, b) => a.km - b.km);
  for (let i = 0; i < orden.length - 1; i++) {
    const a = orden[i], b = orden[i + 1];
    if (km >= a.km && km <= b.km) {
      const t = b.km === a.km ? 0 : (km - a.km) / (b.km - a.km);
      return { lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon), confianza: 0.7 };
    }
  }
  // Fuera del rango: solo se acepta si la referencia más cercana está a 2 km o menos
  const cercana = orden.reduce((m, r) => (Math.abs(r.km - km) < Math.abs(m.km - km) ? r : m));
  if (Math.abs(cercana.km - km) <= 2) return { lat: cercana.lat, lon: cercana.lon, confianza: 0.5 };
  return null;
}

async function porCorredor(corredor, km) {
  const { rows } = await q(
    `SELECT km, ST_Y(geom) AS lat, ST_X(geom) AS lon FROM corredores_km WHERE corredor = $1`,
    [corredor]
  );
  const r = interpolarKm(rows, km);
  return r ? { ...r, fuente: "corredor" } : null;
}

async function porVereda(nombre) {
  const { rows } = await q(
    `SELECT ST_Y(ST_PointOnSurface(geom)) AS lat, ST_X(ST_PointOnSurface(geom)) AS lon
       FROM veredas
      WHERE nombre = $1 OR $1 LIKE nombre || '%'
      LIMIT 1`,
    [nombre]
  );
  return rows[0] ? { ...rows[0], confianza: 0.3, fuente: "vereda" } : null;
}

/** Convierte "CALLE 21 CARRERA 13" en una consulta legible por Nominatim. */
export function consultaNominatim(lugarNorm) {
  let t = lugarNorm
    .replace(/#/g, " ")
    .replace(/\b(CALLE|CARRERA|AVENIDA|DIAGONAL|TRANSVERSAL)\s+(\d+[A-Z]?)\s+(CALLE|CARRERA)\s+(\d+[A-Z]?)\b/, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  const titulo = t.toLowerCase().replace(/(^|\s)\S/g, (s) => s.toUpperCase());
  return `${titulo}, Chía, Cundinamarca, Colombia`;
}

export async function nominatim(consulta, fetchFn = fetch) {
  const enCache = await q("SELECT lat, lon FROM geocache WHERE consulta = $1", [consulta]);
  if (enCache.rows.length) {
    const c = enCache.rows[0];
    return c.lat === null ? null : { lat: c.lat, lon: c.lon };
  }
  if (config.geocoder === "off") return null;
  // Política de uso de Nominatim: máximo 1 solicitud por segundo
  const espera = 1100 - (Date.now() - ultimaLlamada);
  if (espera > 0) await esperar(espera);
  ultimaLlamada = Date.now();
  const [oeste, sur, este, norte] = config.bboxChia;
  const url = new URL("/search", config.nominatimUrl);
  url.search = new URLSearchParams({
    q: consulta, format: "jsonv2", limit: "1", countrycodes: "co",
    viewbox: `${oeste},${norte},${este},${sur}`, bounded: "1",
  }).toString();
  const resp = await fetchFn(url, { headers: { "User-Agent": config.nominatimUserAgent, "Accept-Language": "es" } });
  if (!resp.ok) throw new Error(`Nominatim respondió ${resp.status}`);
  const datos = await resp.json();
  const hit = Array.isArray(datos) && datos[0] ? { lat: Number(datos[0].lat), lon: Number(datos[0].lon), etiqueta: datos[0].display_name } : null;
  const valido = hit && dentroDeChia(hit.lat, hit.lon) ? hit : null;
  await q(
    `INSERT INTO geocache (consulta, lat, lon, etiqueta) VALUES ($1,$2,$3,$4) ON CONFLICT (consulta) DO NOTHING`,
    [consulta, valido?.lat ?? null, valido?.lon ?? null, valido?.etiqueta ?? null]
  );
  return valido;
}

/** Ubica un lugar. Devuelve { lat, lon, confianza, fuente } o null. */
export async function ubicarLugar(lugarNorm, { fetchFn } = {}) {
  if (!lugarNorm) return null;
  const info = interpretarLugar(lugarNorm);
  if (info.tipo === "km") {
    const r = await porCorredor(info.corredor, info.km);
    if (r) return r;
  }
  if (info.tipo === "vereda") {
    const r = await porVereda(info.vereda);
    if (r) return r;
  }
  if (info.tipo === "direccion" || info.tipo === "texto") {
    try {
      const r = await nominatim(consultaNominatim(lugarNorm), fetchFn);
      if (r) return { lat: r.lat, lon: r.lon, confianza: /\bCALLE|CARRERA\b.*\b(CALLE|CARRERA)\b/.test(lugarNorm) ? 0.4 : 0.5, fuente: "nominatim" };
    } catch (e) {
      console.warn("[geocodificar]", e.message);
    }
  }
  return null;
}

/** Geocodifica los siniestros sin ubicación (nunca toca las ubicaciones manuales). */
export async function geocodificarPendientes({ limite = 500, reintentar = false, fetchFn } = {}) {
  const { rows } = await q(
    `SELECT id, lugar_normalizado FROM siniestros
      WHERE geom IS NULL ${reintentar ? "" : "AND geo_intentado_en IS NULL"}
      ORDER BY id LIMIT $1`,
    [limite]
  );
  let ubicados = 0;
  for (const s of rows) {
    const r = await ubicarLugar(s.lugar_normalizado, { fetchFn });
    if (r) {
      await q(
        `UPDATE siniestros SET geom = ST_SetSRID(ST_MakePoint($2,$3),4326), geo_fuente=$4, geo_confianza=$5,
                geo_intentado_en = now(),
                vereda = (SELECT nombre FROM veredas v WHERE ST_Contains(v.geom, ST_SetSRID(ST_MakePoint($2,$3),4326)) LIMIT 1)
          WHERE id=$1`,
        [s.id, r.lon, r.lat, r.fuente, r.confianza]
      );
      ubicados++;
    } else {
      await q("UPDATE siniestros SET geo_intentado_en = now() WHERE id=$1", [s.id]);
    }
  }
  return { procesados: rows.length, ubicados };
}
