// Pruebas unitarias del módulo de cifrado (AES-256-GCM, HKDF, HMAC, SHA-256).
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.CIFRADO_CLAVE = crypto.randomBytes(32).toString("base64");
const C = await import("../src/lib/cifrado.js");

test("cifrar/descifrar: ida y vuelta con contexto", () => {
  const c = C.cifrar("ABC12D", "reportes.placa");
  assert.ok(c.startsWith("v1:"));
  assert.ok(!c.includes("ABC12D"));
  assert.equal(C.descifrar(c, "reportes.placa"), "ABC12D");
  assert.ok(C.estaCifrado(c));
  assert.ok(!C.estaCifrado("ABC12D"));
});

test("cifrar: IV aleatorio, dos cifrados del mismo texto son distintos", () => {
  assert.notEqual(C.cifrar("ABC12D", "x"), C.cifrar("ABC12D", "x"));
});

test("descifrar: falla si el texto cifrado fue alterado (etiqueta GCM)", () => {
  const c = C.cifrar("ABC12D", "reportes.placa");
  const b = Buffer.from(c.slice(3), "base64url");
  b[b.length - 1] ^= 1;
  assert.throws(() => C.descifrar("v1:" + b.toString("base64url"), "reportes.placa"));
});

test("descifrar: falla con otro contexto (AAD)", () => {
  const c = C.cifrar("123456", "telegram_vinculos.chat_id");
  assert.throws(() => C.descifrar(c, "reportes.placa"));
  assert.equal(C.descifrarSeguro(c, "reportes.placa"), null);
});

test("descifrarSeguro: tolera nulos y texto plano heredado", () => {
  assert.equal(C.descifrarSeguro(null, "x"), null);
  assert.equal(C.descifrarSeguro("ABC12D", "x"), "ABC12D");
});

test("hmac: determinista y separado por contexto", () => {
  assert.equal(C.hmac("123", "a"), C.hmac("123", "a"));
  assert.notEqual(C.hmac("123", "a"), C.hmac("123", "b"));
  assert.match(C.hmac("123", "a"), /^[a-f0-9]{64}$/);
});

test("hashToken y tokenAleatorio", () => {
  const t = C.tokenAleatorio(32);
  assert.match(t, /^[a-f0-9]{64}$/);
  assert.equal(C.hashToken(t), crypto.createHash("sha256").update(t).digest("hex"));
  assert.ok(C.iguales("abc", "abc"));
  assert.ok(!C.iguales("abc", "abd"));
  assert.ok(!C.iguales("abc", "abcd"));
});

test("clave maestra inválida se rechaza", () => {
  const antes = process.env.CIFRADO_CLAVE;
  process.env.CIFRADO_CLAVE = Buffer.alloc(16).toString("base64");
  C.reiniciarClaves();
  assert.throws(() => C.cifrar("x", "y"), /32 bytes/);
  process.env.CIFRADO_CLAVE = antes;
  C.reiniciarClaves();
});
