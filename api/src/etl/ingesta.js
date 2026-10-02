// Ingesta de datos abiertos (RF-GEN-07, RF-GEN-08, RF-GEN-12)
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { q, transaccion } from "../db.js";
import { config } from "../config.js";
import { CONJUNTOS, ORDEN_INGESTA } from "./conjuntos.js";
import * as N from "../lib/normalizar.js";
import { geocodificarPendientes } from "../lib/geocodificar.js";

// ───────── Lectura de la fuente ─────────
function buscarArchivo(conj) {
  for (const nombre of conj.archivos) {
    const p = path.join(config.dataDir, nombre);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function leerApi(conj, fetchFn = fetch) {
  const base = `${config.socrataUrl}/resource/${conj.id}.${conj.formato === "geojson" ? "geojson" : "json"}`;
  const headers = config.socrataAppToken ? { "X-App-Token": config.socrataAppToken } : {};
  if (conj.formato === "geojson") {
    const r = await fetchFn(`${base}?$limit=50000`, { headers });
    if (!r.ok) throw new Error(`datos.gov.co respondió ${r.status}`);
    return r.json();
  }
  const filas = [];
  const lote = 10000;
  for (let offset = 0; ; offset += lote) {
    const u = new URL(base);
    u.searchParams.set("$limit", String(lote));
    u.searchParams.set("$offset", String(offset));
    u.searchParams.set("$order", ":id");
    if (conj.where) u.searchParams.set("$where", conj.where);
    const r = await fetchFn(u, { headers });
    if (!r.ok) throw new Error(`datos.gov.co respondió ${r.status}`);
    const datos = await r.json();
    filas.push(...datos);
    if (datos.length < lote) break;
  }
  return filas;
}

export async function leerConjunto(clave, { fuente = config.ingestaFuente, fetchFn } = {}) {
  const conj = CONJUNTOS[clave];
  if (fuente === "api") return { datos: await leerApi(conj, fetchFn), origen: "api" };
  const archivo = buscarArchivo(conj);
  if (!archivo) return { datos: null, origen: null };
  const texto = fs.readFileSync(archivo, "utf8").replace(/^﻿/, "");
  if (conj.formato === "geojson") return { datos: JSON.parse(texto), origen: path.basename(archivo) };
  const filas = parse(texto, { columns: (h) => h.map((c) => c.trim().toLowerCase().replace(/\s+/g, "_")), skip_empty_lines: true, relax_column_count: true });
  return { datos: filas, origen: path.basename(archivo) };
}

/** Valida que las columnas esperadas existan (3.3: fallar de forma controlada si cambia la estructura). */
function validarColumnas(filas, requeridas, nombre) {
  if (!filas.length) return;
  const presentes = new Set(Object.keys(filas[0]));
  const faltan = requeridas.filter((c) => !presentes.has(c));
  if (faltan.length) throw new Error(`El conjunto «${nombre}» no tiene las columnas esperadas: ${faltan.join(", ")}`);
}

// ───────── Cargas por conjunto ─────────
async function cargarVeredas(c, geo, ingestaId) {
  const features = geo?.features || [];
  await c.query("DELETE FROM veredas");
  for (const f of features) {
    const p = f.properties || {};
    await c.query(
      `INSERT INTO veredas (nombre, codigo, geom) VALUES ($1, $2, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)))`,
      [N.vereda(p.nombre) || "SIN NOMBRE", p.cod_vereda || p.codigo || null, JSON.stringify(f.geometry)]
    );
  }
  return { leidas: features.length, nuevas: features.length, actualizadas: 0, calidad: { veredas: features.length } };
}

async function cargarSiniestros(c, filas, ingestaId) {
  validarColumnas(filas, ["numero_ipat", "gravedad", "fecha_ocurrencia", "lugar_ocurrencia"], "siniestros");
  let nuevas = 0, actualizadas = 0;
  const vistos = new Map();
  let duplicados = 0, conflictos = 0, sinFecha = 0, sinIpat = 0;
  const gravedades = {};
  for (const f of filas) {
    const ipat = (f.numero_ipat || "").trim();
    if (!ipat) { sinIpat++; continue; }
    const firma = JSON.stringify(f);
    if (vistos.has(ipat)) { vistos.get(ipat) === firma ? duplicados++ : conflictos++; continue; }
    vistos.set(ipat, firma);
    const fecha = N.fecha(f.fecha_ocurrencia);
    if (!fecha) sinFecha++;
    const grav = N.gravedad(f.gravedad);
    gravedades[`${f.gravedad} → ${grav}`] = (gravedades[`${f.gravedad} → ${grav}`] || 0) + 1;
    const lugarN = N.lugar(f.lugar_ocurrencia);
    const r = await c.query(
      `INSERT INTO siniestros (numero_ipat, vigencia, fecha, gravedad, gravedad_original, clase, clase_original,
                               lugar, lugar_normalizado, via, entidad_reporta, ingesta_id, actualizado_en)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
       ON CONFLICT (numero_ipat) DO UPDATE SET
         vigencia=EXCLUDED.vigencia, fecha=EXCLUDED.fecha, gravedad=EXCLUDED.gravedad,
         gravedad_original=EXCLUDED.gravedad_original, clase=EXCLUDED.clase, clase_original=EXCLUDED.clase_original,
         lugar=EXCLUDED.lugar, lugar_normalizado=EXCLUDED.lugar_normalizado, via=EXCLUDED.via,
         entidad_reporta=EXCLUDED.entidad_reporta, ingesta_id=EXCLUDED.ingesta_id, actualizado_en=now(),
         -- si el lugar cambió y la ubicación no es manual, se vuelve a geocodificar
         geom = CASE WHEN siniestros.geo_fuente='manual' OR siniestros.lugar_normalizado IS NOT DISTINCT FROM EXCLUDED.lugar_normalizado THEN siniestros.geom ELSE NULL END,
         geo_intentado_en = CASE WHEN siniestros.geo_fuente='manual' OR siniestros.lugar_normalizado IS NOT DISTINCT FROM EXCLUDED.lugar_normalizado THEN siniestros.geo_intentado_en ELSE NULL END
       RETURNING (xmax = 0) AS insertado`,
      [ipat, N.entero(f.vigencia), fecha, grav, f.gravedad || null, N.clase(f.clase_de_accidente), f.clase_de_accidente || null,
       f.lugar_ocurrencia || null, lugarN, N.via(lugarN), N.basico(f.entidad_que_reporta), ingestaId]
    );
    if (r.rows[0].insertado) nuevas++; else actualizadas++;
  }
  return { leidas: filas.length, nuevas, actualizadas, calidad: { filas_identicas_descartadas: duplicados, ipat_repetido_con_datos_distintos: conflictos, registros_unicos: vistos.size, sin_fecha: sinFecha, sin_ipat: sinIpat, normalizacion_gravedad: gravedades } };
}

async function cargarComparendos(c, filas, ingestaId) {
  validarColumnas(filas, ["numero_comparendo", "fecha_imposicion", "infraccion"], "comparendos");
  let nuevas = 0, actualizadas = 0, sinFecha = 0, sinNumero = 0, identicas = 0;
  const codigos = new Set();
  const LOTE = 1000;
  const limpias = [];
  const vistos = new Set();
  const porNumero = new Map();
  for (const f of filas) {
    const num = (f.numero_comparendo || "").trim();
    if (!num) { sinNumero++; continue; }
    const fecha = N.fecha(f.fecha_imposicion);
    const inf = N.basico(f.infraccion)?.replace(/\s|\./g, "") || null;
    // Las filas idénticas se cuentan una vez; el mismo número con otra fecha o infracción se conserva
    const clave = `${num}|${fecha || ""}|${inf || ""}`;
    if (vistos.has(clave)) { identicas++; continue; }
    vistos.add(clave);
    porNumero.set(num, (porNumero.get(num) || 0) + 1);
    if (!fecha) sinFecha++;
    if (inf) codigos.add(inf);
    limpias.push([clave, num, N.entero(f.vigencia), fecha, inf, N.basico(f.tipo_de_comparendo)]);
  }
  for (let i = 0; i < limpias.length; i += LOTE) {
    const lote = limpias.slice(i, i + LOTE);
    const cols = [0, 1, 2, 3, 4, 5].map((k) => lote.map((r) => r[k]));
    const r = await c.query(
      `INSERT INTO comparendos (clave, numero_comparendo, vigencia, fecha, infraccion, entidad, ingesta_id)
       SELECT k, n, v, f::date, i, e, $7 FROM unnest($1::text[], $2::text[], $3::int[], $4::text[], $5::text[], $6::text[]) AS t(k, n, v, f, i, e)
       ON CONFLICT (clave) DO UPDATE SET vigencia=EXCLUDED.vigencia, entidad=EXCLUDED.entidad, ingesta_id=EXCLUDED.ingesta_id
       RETURNING (xmax = 0) AS insertado`,
      [...cols, ingestaId]
    );
    for (const x of r.rows) x.insertado ? nuevas++ : actualizadas++;
  }
  // Los códigos nuevos entran al diccionario como "Sin clasificar" para que el administrador los describa
  if (codigos.size) {
    await c.query(`INSERT INTO infracciones (codigo) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING`, [[...codigos]]);
  }
  const sinDescribir = (await c.query(`SELECT count(*)::int AS n FROM infracciones WHERE descripcion IS NULL`)).rows[0].n;
  const numerosConVariasFilas = [...porNumero.values()].filter((n) => n > 1).length;
  return { leidas: filas.length, nuevas, actualizadas, calidad: {
    filas_identicas_descartadas: identicas, numeros_con_registros_distintos: numerosConVariasFilas,
    registros_unicos: limpias.length, sin_fecha: sinFecha, sin_numero: sinNumero,
    codigos_distintos: codigos.size, codigos_sin_descripcion: sinDescribir } };
}

async function cargarVehiculos(c, filas, ingestaId) {
  validarColumnas(filas, ["municipio_accidente", "tipo_vehiculo"], "vehiculos");
  const chia = filas.filter((f) => N.esChia(f.municipio_accidente));
  const variantes = {};
  for (const f of filas) {
    const m = N.basico(f.municipio_accidente) || "";
    if (m.startsWith("CHIA") && !N.esChia(m)) variantes[f.municipio_accidente] = (variantes[f.municipio_accidente] || 0) + 1;
  }
  await c.query("DELETE FROM vehiculos_siniestro");
  for (const f of chia) {
    const { anio, mes } = N.mesAnio(f.fecha_accidente);
    await c.query(
      `INSERT INTO vehiculos_siniestro (marca, modelo, tipo_vehiculo, edad_vehiculo, fecha_texto, anio, mes, gravedad, departamento, municipio, autoridad, ingesta_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [N.basico(f.marca_vehiculo), N.entero(f.modelo_vehiculo), N.basico(f.tipo_vehiculo), N.entero(f.edad_vehiculo),
       f.fecha_accidente || null, anio, mes, N.gravedad(f.gravedad_accidente), N.basico(f.departamento_accidente),
       N.basico(f.municipio_accidente), N.basico(f.autoridad_de_transito), ingestaId]
    );
  }
  return { leidas: filas.length, nuevas: chia.length, actualizadas: 0, calidad: { filas_de_chia: chia.length, variantes_excluidas: variantes } };
}

const CARGADORES = { veredas: cargarVeredas, siniestros: cargarSiniestros, comparendos: cargarComparendos, vehiculos: cargarVehiculos };

// ───────── Orquestación ─────────
export async function ingestarConjunto(clave, opciones = {}) {
  const fuente = opciones.fuente || config.ingestaFuente;
  const { rows } = await q(`INSERT INTO ingestas (conjunto, fuente) VALUES ($1,$2) RETURNING id`, [clave, fuente]);
  const ingestaId = rows[0].id;
  try {
    const { datos, origen } = await leerConjunto(clave, { ...opciones, fuente });
    if (datos === null) {
      await q(`UPDATE ingestas SET estado='omitida', finalizada_en=now(), errores=$2 WHERE id=$1`,
        [ingestaId, JSON.stringify([`No se encontró el archivo en ${config.dataDir} (${CONJUNTOS[clave].archivos.join(" o ")})`])]);
      return { conjunto: clave, estado: "omitida" };
    }
    const r = await transaccion((c) => CARGADORES[clave](c, datos, ingestaId));
    await q(
      `UPDATE ingestas SET estado='ok', finalizada_en=now(), filas_leidas=$2, filas_nuevas=$3, filas_actualizadas=$4, calidad=$5 WHERE id=$1`,
      [ingestaId, r.leidas, r.nuevas, r.actualizadas, JSON.stringify({ origen, ...r.calidad })]
    );
    return { conjunto: clave, estado: "ok", ...r };
  } catch (e) {
    await q(`UPDATE ingestas SET estado='error', finalizada_en=now(), errores=$2 WHERE id=$1`, [ingestaId, JSON.stringify([e.message])]);
    return { conjunto: clave, estado: "error", error: e.message };
  }
}

/** Ingesta completa + geocodificación + informe de calidad de ubicación. */
export async function ingestarTodo(opciones = {}) {
  const resultados = [];
  for (const clave of opciones.conjuntos || ORDEN_INGESTA) resultados.push(await ingestarConjunto(clave, opciones));
  const geo = opciones.geocodificar === false ? null : await geocodificarPendientes({ fetchFn: opciones.fetchFn });
  const cal = (await q(`SELECT count(*)::int AS total, count(geom)::int AS ubicados FROM siniestros`)).rows[0];
  const ultima = resultados.find((r) => r.conjunto === "siniestros" && r.estado === "ok");
  if (ultima) {
    await q(
      `UPDATE ingestas SET calidad = calidad || $1::jsonb WHERE id = (SELECT max(id) FROM ingestas WHERE conjunto='siniestros' AND estado='ok')`,
      [JSON.stringify({ geocodificados: cal.ubicados, total_siniestros: cal.total, porcentaje_geocodificado: cal.total ? Math.round((100 * cal.ubicados) / cal.total) : 0 })]
    );
  }
  return { resultados, geocodificacion: geo, ubicacion: cal };
}
