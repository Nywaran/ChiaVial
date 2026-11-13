// Pruebas del chat de atención: visitante anónimo, aviso a Telegram con enlace y respuesta en tiempo real (SSE).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import http from "node:http";
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
process.env.APP_URL = "https://chiavial.prueba";
process.env.COOKIE_SECURE = "false"; // las pruebas van por http
process.env.CIFRADO_CLAVE = crypto.randomBytes(32).toString("base64");
process.env.TELEGRAM_BOT_TOKEN = "123:prueba";
process.env.TELEGRAM_MODO = "off";
process.env.TELEGRAM_GRUPO_ID = "-1005550001";

const { pool, q, migrar } = await import("../src/db.js");
const { crearApp } = await import("../src/app.js");
const { crearAdminInicial } = await import("../src/scripts/admin-inicial.js");
const telegram = await import("../src/lib/telegram.js");
const request = (await import("supertest")).default;

const app = crearApp();
const H = { "X-Requested-With": "ChiaVial" };
const enviados = [];
telegram.usarFetch(async (url, opts) => {
  const body = JSON.parse(opts.body || "{}");
  if (url.endsWith("/sendMessage")) enviados.push(body);
  return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
});
const esperar = (ms = 150) => new Promise((r) => setTimeout(r, ms));

let servidor, base, admin, func;
async function sesion(email, password) {
  const ag = request.agent(app);
  const r = await ag.post("/api/auth/login").set(H).send({ email, password });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return ag;
}

/** Cliente SSE mínimo: guarda los eventos recibidos. */
function escuchar(ruta, headers = {}) {
  const eventos = [];
  let req;
  const listo = new Promise((resolver, rechazar) => {
    req = http.get(`${base}${ruta}`, { headers }, (res) => {
      if (res.statusCode !== 200) return rechazar(new Error(`SSE ${res.statusCode}`));
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const bloque = buf.slice(0, i); buf = buf.slice(i + 2);
          const tipo = /^event: (.+)$/m.exec(bloque)?.[1];
          const data = /^data: (.+)$/m.exec(bloque)?.[1];
          if (tipo && data) eventos.push({ tipo, datos: JSON.parse(data) });
        }
      });
      resolver();
    });
    req.on("error", () => {});
  });
  return { eventos, listo, cerrar: () => req.destroy() };
}

before(async () => {
  await q("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrar();
  await crearAdminInicial();
  admin = await sesion("admin@prueba.co", "Admin12345");
  await admin.post("/api/admin/usuarios").set(H).send({ nombre: "Laura Gómez", email: "laura@prueba.co", rol: "funcionario", password: "Func12345" });
  func = await sesion("laura@prueba.co", "Func12345");
  servidor = http.createServer(app).listen(0);
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(async () => {
  servidor.closeAllConnections();
  servidor.close();
  await pool.end();
});

let token, convId;

test("visitante anónimo inicia una conversación; texto y nombre cifrados, token solo como SHA-256", async () => {
  const r = await request(app).post("/api/chat/conversaciones").set(H)
    .send({ texto: "Hola, ¿cómo reporto un semáforo dañado?", nombre: "Pedro", pagina: "/observatorio" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.token, /^[a-f0-9]{64}$/);
  token = r.body.token; convId = r.body.conversacion.id;
  const c = (await q(`SELECT token_hash, nombre_cifrado FROM chat_conversaciones WHERE id=$1`, [convId])).rows[0];
  assert.equal(c.token_hash, crypto.createHash("sha256").update(token).digest("hex"));
  assert.ok(c.nombre_cifrado.startsWith("v1:"));
  const m = (await q(`SELECT texto_cifrado FROM chat_mensajes WHERE conversacion_id=$1`, [convId])).rows[0];
  assert.ok(m.texto_cifrado.startsWith("v1:") && !m.texto_cifrado.includes("semáforo"));
  // Sin la cabecera anti-CSRF no se acepta
  assert.equal((await request(app).post("/api/chat/conversaciones").send({ texto: "x" })).status, 403);
});

test("el grupo de Telegram recibe el aviso con enlace y botón a /atencion/:id, sin repetir avisos seguidos", async () => {
  await esperar();
  assert.equal(enviados.length, 1);
  const aviso = enviados[0];
  assert.equal(String(aviso.chat_id), "-1005550001");
  assert.match(aviso.text, new RegExp(`Nueva conversación.*#${convId}`));
  assert.match(aviso.text, /De: Pedro · Página: \/observatorio/);
  assert.match(aviso.text, new RegExp(`https://chiavial.prueba/atencion/${convId}`));
  assert.equal(aviso.reply_markup.inline_keyboard[0][0].url, `https://chiavial.prueba/atencion/${convId}`);
  const r = await request(app).post("/api/chat/mensajes").set(H).set("X-Chat-Token", token).send({ texto: "¿Hay alguien?" });
  assert.equal(r.status, 201);
  await esperar();
  assert.equal(enviados.length, 1, "no se avisa de nuevo antes de 2 minutos");
});

test("solo funcionarios y administradores acceden a las conversaciones", async () => {
  assert.equal((await request(app).get("/api/chat/equipo/conversaciones")).status, 401);
  const l = await func.get("/api/chat/equipo/conversaciones");
  assert.equal(l.status, 200);
  assert.equal(l.body.abiertas, 1);
  assert.equal(l.body.conversaciones[0].nombre, "Pedro");
  assert.equal(l.body.conversaciones[0].sin_responder, true);
  assert.equal((await request(app).get("/api/chat/conversacion").set("X-Chat-Token", "0".repeat(64))).status, 404);
  assert.equal((await request(app).post("/api/chat/mensajes").set(H).set("X-Chat-Token", token).send({ texto: "x".repeat(1001) })).status, 400);
});

test("tiempo real: el visitante ve la respuesta del equipo y el equipo ve al visitante", async () => {
  const vis = escuchar("/api/chat/eventos", { "X-Chat-Token": token });
  const login = await request(app).post("/api/auth/login").set(H).send({ email: "laura@prueba.co", password: "Func12345" });
  const cookie = login.headers["set-cookie"].map((c) => c.split(";")[0]).join("; ");
  const eq = escuchar("/api/chat/equipo/eventos", { Cookie: cookie });
  await Promise.all([vis.listo, eq.listo]);

  const r = await func.post(`/api/chat/equipo/conversaciones/${convId}/mensajes`).set(H).send({ texto: "Hola Pedro, usa la opción Reportar." });
  assert.equal(r.status, 201);
  await esperar();
  const llegada = vis.eventos.find((e) => e.tipo === "mensaje");
  assert.equal(llegada.datos.mensaje.texto, "Hola Pedro, usa la opción Reportar.");
  assert.equal(llegada.datos.mensaje.quien, "Laura", "el visitante solo ve el primer nombre");

  await request(app).post("/api/chat/mensajes").set(H).set("X-Chat-Token", token).send({ texto: "¡Gracias!" });
  await esperar();
  const delVisitante = eq.eventos.find((e) => e.tipo === "mensaje" && e.datos.mensaje.autor === "visitante");
  assert.equal(delVisitante.datos.conversacion_id, convId);
  assert.equal(delVisitante.datos.mensaje.texto, "¡Gracias!");
  const delEquipo = eq.eventos.find((e) => e.tipo === "mensaje" && e.datos.mensaje.autor === "equipo");
  assert.equal(delEquipo.datos.mensaje.quien, "Laura Gómez");

  // Cerrar: el visitante se entera; si vuelve a escribir, se reabre
  assert.equal((await func.patch(`/api/chat/equipo/conversaciones/${convId}`).set(H).send({ estado: "cerrada" })).status, 200);
  await esperar();
  assert.ok(vis.eventos.some((e) => e.tipo === "conversacion" && e.datos.estado === "cerrada"));
  await request(app).post("/api/chat/mensajes").set(H).set("X-Chat-Token", token).send({ texto: "Una pregunta más" });
  const c = await request(app).get("/api/chat/conversacion").set("X-Chat-Token", token);
  assert.equal(c.body.conversacion.estado, "abierta");
  assert.deepEqual(c.body.mensajes.map((m) => m.autor), ["visitante", "visitante", "equipo", "visitante", "visitante"]);
  vis.cerrar(); eq.cerrar();
});
