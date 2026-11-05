// Pruebas de integración: vinculación con Telegram, notificaciones, cifrado en BD y tablero.
// La red de Telegram se simula (no se hacen llamadas reales a api.telegram.org).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || "postgres://chiavial:chiavial@localhost:5432/chiavial_test";
process.env.DATA_DIR = path.join(aqui, "datos");
process.env.UPLOADS_DIR = path.join(aqui, "uploads_prueba");
process.env.GEOCODER = "off";
process.env.ADMIN_EMAIL = "admin@prueba.co";
process.env.ADMIN_PASSWORD = "Admin12345";
process.env.WEB_DIST = "/no-existe";
process.env.CIFRADO_CLAVE = crypto.randomBytes(32).toString("base64");
process.env.TELEGRAM_BOT_TOKEN = "123:prueba";
process.env.TELEGRAM_BOT_USERNAME = "ChiaVialBot";
process.env.TELEGRAM_MODO = "webhook";
process.env.TELEGRAM_WEBHOOK_SECRET = "secreto-de-prueba-0123456789";

const { pool, q, migrar } = await import("../src/db.js");
const { crearApp } = await import("../src/app.js");
const { crearAdminInicial } = await import("../src/scripts/admin-inicial.js");
const { ingestarTodo } = await import("../src/etl/ingesta.js");
const telegram = await import("../src/lib/telegram.js");
const request = (await import("supertest")).default;

const app = crearApp();
const H = { "X-Requested-With": "ChiaVial" };
const WH = { "X-Telegram-Bot-Api-Secret-Token": process.env.TELEGRAM_WEBHOOK_SECRET };

// Bot API simulada: guarda los mensajes enviados
const enviados = [];
telegram.usarFetch(async (url, opts) => {
  const metodo = url.split("/").pop();
  const body = JSON.parse(opts.body || "{}");
  if (metodo === "sendMessage") enviados.push({ chat: String(body.chat_id), texto: body.text });
  return { ok: true, json: async () => ({ ok: true, result: metodo === "getMe" ? { username: "ChiaVialBot" } : { message_id: 1 } }) };
});
const esperar = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const msj = (chatId, text) => ({ update_id: Date.now(), message: { chat: { id: chatId, type: "private" }, text } });

async function sesion(email, password) {
  const ag = request.agent(app);
  const r = await ag.post("/api/auth/login").set(H).send({ email, password });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return ag;
}

let admin, func, ana;
before(async () => {
  await q("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrar();
  await crearAdminInicial();
  await ingestarTodo();
  admin = await sesion("admin@prueba.co", "Admin12345");
  await admin.post("/api/admin/usuarios").set(H).send({ nombre: "Funcionaria", email: "func@prueba.co", rol: "funcionario", password: "Func12345" });
  const bcrypt = (await import("bcryptjs")).default;
  await q(`INSERT INTO usuarios (nombre, email, password_hash, rol, email_verificado) VALUES ('Ana', 'ana@prueba.co', $1, 'ciudadano', TRUE)`,
    [await bcrypt.hash("Ana123456", 4)]);
  func = await sesion("func@prueba.co", "Func12345");
  ana = await sesion("ana@prueba.co", "Ana123456");
});
after(async () => { await pool.end(); });

async function vincular(agente, chatId) {
  const v = await agente.post("/api/telegram/vincular").set(H);
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.match(v.body.enlace, /^https:\/\/t\.me\/ChiaVialBot\?start=[a-f0-9]{32}$/);
  const r = await request(app).post("/api/telegram/webhook").set(WH).send(msj(chatId, `/start ${v.body.codigo}`));
  assert.equal(r.status, 200);
  await esperar();
  return v.body.codigo;
}

test("webhook: rechaza peticiones sin el secreto", async () => {
  assert.equal((await request(app).post("/api/telegram/webhook").send(msj(1, "/ayuda"))).status, 401);
  assert.equal((await request(app).post("/api/telegram/webhook").set({ "X-Telegram-Bot-Api-Secret-Token": "otro" }).send(msj(1, "/ayuda"))).status, 401);
});

test("vinculación: código de un solo uso; chat cifrado e indexado con HMAC", async () => {
  const codigo = await vincular(ana, 555001);
  assert.match(enviados.at(-1).texto, /Listo, Ana/);
  const est = await ana.get("/api/telegram/estado");
  assert.equal(est.body.vinculado, true);
  // En BD no queda ni el chat ni el código en claro
  const v = await q(`SELECT chat_id_cifrado, chat_id_hmac FROM telegram_vinculos`);
  assert.ok(v.rows[0].chat_id_cifrado.startsWith("v1:"));
  assert.doesNotMatch(JSON.stringify(v.rows), /555001/);
  const c = await q(`SELECT codigo_hash FROM telegram_codigos`);
  assert.notEqual(c.rows[0].codigo_hash, codigo);
  // Reutilizar el código falla
  await request(app).post("/api/telegram/webhook").set(WH).send(msj(555999, `/start ${codigo}`));
  await esperar();
  assert.match(enviados.at(-1).texto, /no es válido o venció/);
});

test("cambio de estado notifica al ciudadano por correo y Telegram", async () => {
  await vincular(func, 555002);
  enviados.length = 0;
  const r = await ana.post("/api/reportes").set(H).field("tipo", "infraestructura").field("categoria", "PASO_PEATONAL")
    .field("descripcion", "Falta un paso peatonal frente al parque").field("lat", "4.86").field("lon", "-74.05");
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await esperar(300);
  // Alerta de nuevo reporte a la funcionaria (y no a la ciudadana)
  const alerta = enviados.find((e) => /Nuevo reporte/.test(e.texto));
  assert.ok(alerta, "alerta de nuevo reporte");
  assert.equal(alerta.chat, "555002");
  assert.ok(!enviados.some((e) => e.chat === "555001"));

  assert.equal((await func.patch(`/api/reportes/${r.body.id}/estado`).set(H).send({ estado: "VERIFICADO" })).status, 200);
  const aviso = enviados.find((e) => e.chat === "555001");
  assert.match(aviso.texto, new RegExp(`#${r.body.id} cambió a «verificado»`));
  const log = await q(`SELECT canal, evento, estado FROM notificaciones WHERE evento = 'cambio_estado' ORDER BY canal`);
  assert.deepEqual(log.rows.map((x) => `${x.canal}:${x.estado}`), ["correo:sin_configurar", "telegram:enviado"]);
});

test("comandos del bot: /estado y /desvincular; preferencias", async () => {
  enviados.length = 0;
  await request(app).post("/api/telegram/webhook").set(WH).send(msj(555001, "/estado"));
  await esperar();
  assert.match(enviados.at(-1).texto, /Tus últimos reportes:\n#\d+ · .* · Verificado/);

  // Con la preferencia desactivada no se envía por Telegram
  assert.equal((await ana.patch("/api/telegram/preferencias").set(H).send({ notif_telegram: false })).status, 200);
  const { porTelegram } = await import("../src/lib/notificaciones.js");
  const id = (await q(`SELECT id FROM usuarios WHERE email='ana@prueba.co'`)).rows[0].id;
  assert.equal(await porTelegram(id, "prueba", "hola"), "omitido");
  await ana.patch("/api/telegram/preferencias").set(H).send({ notif_telegram: true });

  await request(app).post("/api/telegram/webhook").set(WH).send(msj(555001, "/desvincular"));
  await esperar();
  assert.equal((await ana.get("/api/telegram/estado")).body.vinculado, false);
});

test("administrador: registro de notificaciones y mensaje de prueba", async () => {
  const lista = await admin.get("/api/admin/notificaciones");
  assert.equal(lista.status, 200);
  assert.equal(lista.body.telegram.configurado, true);
  assert.ok(lista.body.notificaciones.length >= 2);
  // El admin no tiene Telegram vinculado
  const p = await admin.post("/api/admin/notificaciones/prueba").set(H);
  assert.equal(p.body.resultado, "omitido");
  assert.equal((await func.get("/api/admin/notificaciones")).status, 403);
});

test("tablero: solo funcionario/admin y cifras desde la base de datos", async () => {
  assert.equal((await ana.get("/api/dashboard")).status, 403);
  assert.equal((await request(app).get("/api/dashboard")).status, 401);
  const d = await func.get("/api/dashboard");
  assert.equal(d.status, 200);
  assert.equal(d.body.kpis.total, 1);
  assert.equal(d.body.kpis.abiertos, 1);
  assert.ok(d.body.kpis.horas_primera_respuesta >= 0);
  assert.deepEqual(d.body.siniestrosPorMes.reduce((a, m) => a + m.con_muerto + m.con_herido + m.otros, 0), 4);
  assert.equal(d.body.comparendosPorGrupo.reduce((a, g) => a + g.n, 0), 4);
  assert.equal(d.body.usuariosPorRol, undefined); // solo admin
  const da = await admin.get("/api/dashboard?desde=2030-01-01");
  assert.equal(da.body.kpis.total, 0);
  assert.ok(Array.isArray(da.body.usuariosPorRol));
});

test("placas heredadas en texto plano se cifran al migrar", async () => {
  const { cifrarDatosHeredados } = await import("../src/lib/migracion-cifrado.js");
  const id = (await q(`SELECT id FROM reportes LIMIT 1`)).rows[0].id;
  await q(`UPDATE reportes SET placa = 'XYZ987' WHERE id = $1`, [id]);
  assert.equal(await cifrarDatosHeredados(), 1);
  const p = (await q(`SELECT placa FROM reportes WHERE id = $1`, [id])).rows[0].placa;
  assert.ok(p.startsWith("v1:"));
  assert.equal((await func.get(`/api/reportes/${id}`)).body.placa, "XYZ987");
});
