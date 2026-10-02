// Pruebas de integración de la API contra una base PostgreSQL/PostGIS de pruebas.
// Requiere DATABASE_URL apuntando a una base vacía (se recrea el esquema).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || "postgres://chiavial:chiavial@localhost:5432/chiavial_test";
process.env.DATA_DIR = path.join(aqui, "datos");
process.env.UPLOADS_DIR = path.join(aqui, "uploads_prueba");
process.env.GEOCODER = "off";
process.env.ADMIN_EMAIL = "admin@prueba.co";
process.env.ADMIN_PASSWORD = "Admin12345";
process.env.WEB_DIST = "/no-existe";

const { pool, q, migrar } = await import("../src/db.js");
const { crearApp } = await import("../src/app.js");
const { crearAdminInicial } = await import("../src/scripts/admin-inicial.js");
const { ingestarTodo } = await import("../src/etl/ingesta.js");
const request = (await import("supertest")).default;

const app = crearApp();
const H = { "X-Requested-With": "ChiaVial" };

/** Agente con cookie de sesión. */
async function sesion(email, password) {
  const ag = request.agent(app);
  const r = await ag.post("/api/auth/login").set(H).send({ email, password });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return ag;
}

before(async () => {
  await q("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrar();
  await crearAdminInicial();
});
after(async () => { await pool.end(); });

test("ingesta desde CSV: duplicados idénticos, normalización y veredas", async () => {
  const r = await ingestarTodo();
  const est = Object.fromEntries(r.resultados.map((x) => [x.conjunto, x]));
  assert.equal(est.siniestros.estado, "ok");
  assert.equal(est.siniestros.nuevas, 4); // 5 filas, 1 idéntica
  assert.equal(est.siniestros.calidad.filas_identicas_descartadas, 1);
  assert.equal(est.comparendos.nuevas, 4); // 5 filas: 1 idéntica; mismo número con otra infracción se conserva
  assert.equal(est.vehiculos.nuevas, 2);   // «CHÍA - LA PAZ» se excluye
  assert.deepEqual(est.vehiculos.calidad.variantes_excluidas, { "CHÍA - LA PAZ": 1 });
  const g = await q(`SELECT gravedad, count(*)::int AS n FROM siniestros GROUP BY 1 ORDER BY 1`);
  assert.deepEqual(g.rows, [{ gravedad: "CON HERIDO", n: 3 }, { gravedad: "CON MUERTO", n: 1 }]);
  // El siniestro de vereda se ubica con el polígono
  const v = await q(`SELECT geo_fuente, vereda FROM siniestros WHERE lugar LIKE 'VEREDA FAGUA%'`);
  assert.equal(v.rows[0].geo_fuente, "vereda");
  assert.equal(v.rows[0].vereda, "FAGUA");
  // Segunda ingesta: actualiza sin duplicar
  const r2 = await ingestarTodo();
  assert.equal(r2.resultados.find((x) => x.conjunto === "siniestros").actualizadas, 4);
});

test("observatorio público: resumen, ranking, mapa y descarga", async () => {
  const res = await request(app).get("/api/observatorio/resumen?anio=2025");
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 2);
  assert.equal(res.body.periodo_anterior, "ene–may 2024"); // 2025 incompleto: se compara con los mismos meses
  assert.equal(res.body.anterior.total, 2);
  const rk = await request(app).get("/api/observatorio/ranking");
  assert.equal(rk.body[0].via, "VÍA BOGOTA - TUNJA");
  assert.equal(rk.body[0].total, 2);
  const mapa = await request(app).get("/api/observatorio/mapa");
  assert.equal(mapa.body.puntos.length, 1);
  assert.equal(mapa.body.sin_ubicar, 3);
  const csv = await request(app).get("/api/observatorio/descarga.csv");
  assert.match(csv.text, /CC BY-SA 4.0/);
});

test("comparendos: agregados sin números individuales", async () => {
  const res = await request(app).get("/api/comparendos/resumen");
  assert.equal(res.body.total, 4);
  assert.equal(res.body.de_riesgo, 2); // F (embriaguez) y C29 (velocidad)
  const rk = await request(app).get("/api/comparendos/ranking");
  const txt = JSON.stringify(rk.body) + JSON.stringify((await request(app).get("/api/comparendos/descarga.csv")).text);
  assert.doesNotMatch(txt, /25175000000040851435/);
  assert.ok(rk.body.find((x) => x.codigo === "C29").descripcion.includes("velocidad"));
});

test("registro, verificación por correo e inicio de sesión del ciudadano", async () => {
  const sinConsent = await request(app).post("/api/auth/registro").set(H).send({ nombre: "Ana", email: "ana@prueba.co", password: "clave1234" });
  assert.equal(sinConsent.status, 400);
  const reg = await request(app).post("/api/auth/registro").set(H).send({ nombre: "Ana", email: "ana@prueba.co", password: "clave1234", acepta_politica: true });
  assert.equal(reg.status, 201);
  const antes = await request(app).post("/api/auth/login").set(H).send({ email: "ana@prueba.co", password: "clave1234" });
  assert.equal(antes.status, 403);
  const correo = await q(`SELECT cuerpo FROM correos WHERE para='ana@prueba.co' ORDER BY id DESC LIMIT 1`);
  const token = correo.rows[0].cuerpo.match(/token=([a-f0-9]+)/)[1];
  assert.equal((await request(app).post("/api/auth/verificar").set(H).send({ token })).status, 200);
  await sesion("ana@prueba.co", "clave1234");
});

test("sin cabecera anti-CSRF se rechazan las escrituras", async () => {
  const r = await request(app).post("/api/auth/login").send({ email: "x@y.co", password: "x" });
  assert.equal(r.status, 403);
});

test("bloqueo tras 5 intentos fallidos", async () => {
  for (let i = 0; i < 5; i++) await request(app).post("/api/auth/login").set(H).send({ email: "ana@prueba.co", password: "mala" });
  const r = await request(app).post("/api/auth/login").set(H).send({ email: "ana@prueba.co", password: "clave1234" });
  assert.equal(r.status, 429);
  await q(`UPDATE usuarios SET bloqueado_hasta = NULL WHERE email='ana@prueba.co'`);
});

test("reportes: creación, privacidad de la placa, bandeja y cambio de estado", async () => {
  const ana = await sesion("ana@prueba.co", "clave1234");
  const admin = await sesion("admin@prueba.co", "Admin12345");
  // El administrador crea un funcionario
  const f = await admin.post("/api/admin/usuarios").set(H).send({ nombre: "Funcionario", email: "func@prueba.co", rol: "funcionario", password: "Func12345" });
  assert.equal(f.status, 201);
  const func = await sesion("func@prueba.co", "Func12345");

  // Sin aceptar el aviso no se puede reportar una conducta
  const sinAviso = await ana.post("/api/reportes").set(H).field("tipo", "conducta").field("categoria", "EXCESO_VELOCIDAD")
    .field("descripcion", "Moto a alta velocidad cerca al colegio").field("lat", "4.86").field("lon", "-74.05");
  assert.equal(sinAviso.status, 400);

  // Foto PNG mínima de 1x1
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const ok = await ana.post("/api/reportes").set(H).field("tipo", "conducta").field("categoria", "EXCESO_VELOCIDAD")
    .field("descripcion", "Moto a alta velocidad cerca al colegio").field("lat", "4.86").field("lon", "-74.05")
    .field("placa", "abc-12d").field("acepto_aviso", "true").attach("fotos", png, { filename: "f.png", contentType: "image/png" });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const id = ok.body.id;

  // Fuera de Chía se rechaza
  const fuera = await ana.post("/api/reportes").set(H).field("tipo", "infraestructura").field("categoria", "PASO_PEATONAL")
    .field("descripcion", "Falta un paso peatonal en esta esquina").field("lat", "4.60").field("lon", "-74.08");
  assert.equal(fuera.status, 400);

  // El ciudadano no ve la placa; el funcionario sí
  assert.equal((await ana.get(`/api/reportes/${id}`)).body.placa, undefined);
  assert.equal((await func.get(`/api/reportes/${id}`)).body.placa, "ABC12D");
  // El mapa público no expone placa ni descripción
  const pub = await request(app).get("/api/reportes/publico");
  assert.doesNotMatch(JSON.stringify(pub.body), /ABC12D|colegio/);
  // El ciudadano no puede gestionar
  assert.equal((await ana.get("/api/reportes/bandeja")).status, 403);
  // Descartar exige motivo
  assert.equal((await func.patch(`/api/reportes/${id}/estado`).set(H).send({ estado: "DESCARTADO" })).status, 400);
  assert.equal((await func.patch(`/api/reportes/${id}/estado`).set(H).send({ estado: "EN_REVISION" })).status, 200);
  const mios = await ana.get("/api/reportes/mios");
  assert.equal(mios.body[0].estado, "EN_REVISION");
  assert.equal(mios.body[0].historial.length, 2);
  const aviso = await q(`SELECT asunto FROM correos WHERE para='ana@prueba.co' ORDER BY id DESC LIMIT 1`);
  assert.match(aviso.rows[0].asunto, /cambió de estado/);
  // Foto: visible para el autor, no para anónimos
  const det = await ana.get(`/api/reportes/${id}`);
  assert.equal((await ana.get(det.body.fotos[0])).status, 200);
  assert.equal((await request(app).get(det.body.fotos[0])).status, 401);
});

test("infraestructura: similares, apoyos y asignación a entidad", async () => {
  const ana = await sesion("ana@prueba.co", "clave1234");
  const admin = await sesion("admin@prueba.co", "Admin12345");
  const r = await ana.post("/api/reportes").set(H).field("tipo", "infraestructura").field("categoria", "PASO_PEATONAL")
    .field("descripcion", "Falta un paso peatonal en esta esquina").field("lat", "4.8605").field("lon", "-74.0505");
  assert.equal(r.status, 201);
  const sim = await request(app).get("/api/reportes/similares?lat=4.8606&lon=-74.0506&categoria=PASO_PEATONAL");
  assert.equal(sim.body[0].id, r.body.id);
  // Entidad externa: solo ve lo asignado
  const ent = (await q(`SELECT id FROM entidades WHERE nombre='Secretaría de Obras Públicas'`)).rows[0].id;
  await admin.post("/api/admin/usuarios").set(H).send({ nombre: "Obras", email: "obras@prueba.co", rol: "entidad", entidad_id: ent, password: "Obras12345" });
  const obras = await sesion("obras@prueba.co", "Obras12345");
  assert.equal((await obras.get("/api/reportes/bandeja")).body.reportes.length, 0);
  assert.equal((await admin.patch(`/api/reportes/${r.body.id}/asignar`).set(H).send({ entidad_id: ent, fecha_objetivo: "2026-12-01" })).status, 200);
  const b = await obras.get("/api/reportes/bandeja");
  assert.equal(b.body.reportes.length, 1);
  assert.equal(b.body.reportes[0].placa, null);
  assert.equal((await obras.patch(`/api/reportes/${r.body.id}/estado`).set(H).send({ estado: "RECHAZADO", comentario: "x" })).status, 400);
  assert.equal((await obras.patch(`/api/reportes/${r.body.id}/estado`).set(H).send({ estado: "EN_GESTION" })).status, 200);
});

test("ubicación manual de siniestros y referencias kilométricas", async () => {
  const func = await sesion("func@prueba.co", "Func12345");
  const pend = await func.get("/api/admin/siniestros/pendientes");
  assert.equal(pend.body.pendientes, 3);
  const ref1 = await func.post("/api/admin/corredores").set(H).send({ corredor: "TUNJA BOGOTA", km: 2, lat: 4.84, lon: -74.04 });
  assert.equal(ref1.status, 200);
  await func.post("/api/admin/corredores").set(H).send({ corredor: "BOGOTA TUNJA", km: 8, lat: 4.88, lon: -74.03 });
  const s = await q(`SELECT geo_fuente, count(*)::int AS n FROM siniestros WHERE geom IS NOT NULL GROUP BY 1 ORDER BY 1`);
  assert.deepEqual(s.rows, [{ geo_fuente: "corredor", n: 2 }, { geo_fuente: "vereda", n: 1 }]);
  const otro = (await q(`SELECT id FROM siniestros WHERE geom IS NULL LIMIT 1`)).rows[0].id;
  assert.equal((await func.patch(`/api/admin/siniestros/${otro}/ubicacion`).set(H).send({ lat: 4.861, lon: -74.058 })).status, 200);
  // Una nueva ingesta no borra la ubicación manual
  await ingestarTodo();
  assert.equal((await q(`SELECT geo_fuente FROM siniestros WHERE id=$1`, [otro])).rows[0].geo_fuente, "manual");
  assert.equal((await q(`SELECT count(*)::int AS n FROM bitacora WHERE accion='ubicar_siniestro'`)).rows[0].n, 1);
});

test("eliminar cuenta anonimiza los reportes", async () => {
  const ana = await sesion("ana@prueba.co", "clave1234");
  assert.equal((await ana.delete("/api/auth/cuenta").set(H)).status, 200);
  const r = await q(`SELECT count(*)::int AS n FROM reportes WHERE autor_id IS NULL AND placa IS NULL`);
  assert.equal(r.rows[0].n, 2);
});
