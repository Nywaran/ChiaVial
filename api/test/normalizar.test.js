import { test } from "node:test";
import assert from "node:assert/strict";
import * as N from "../src/lib/normalizar.js";
import { interpolarKm, consultaNominatim } from "../src/lib/geocodificar.js";

test("gravedad: unifica mayúsculas y plurales", () => {
  assert.equal(N.gravedad("Con Herido"), "CON HERIDO");
  assert.equal(N.gravedad("CON HERIDOS"), "CON HERIDO");
  assert.equal(N.gravedad("Con muerto"), "CON MUERTO");
  assert.equal(N.gravedad("CON MUERTOS"), "CON MUERTO");
  assert.equal(N.gravedad(""), null);
});

test("clase: corrige erratas conocidas", () => {
  assert.equal(N.clase("Caida Oupante"), "CAIDA OCUPANTE");
  assert.equal(N.clase("Choque"), "CHOQUE");
});

test("lugar: normaliza abreviaturas y puntos kilométricos", () => {
  assert.equal(N.lugar("chia cajica km 9 +900"), "CHIA CAJICA KM 9+900");
  assert.equal(N.lugar("Cra 9 Cl 25"), "CARRERA 9 CALLE 25");
  assert.equal(N.lugar("Av. Pradilla 5E"), "AVENIDA PRADILLA 5E");
});

test("interpretarLugar: corredores en ambos sentidos son el mismo", () => {
  const a = N.interpretarLugar(N.lugar("TUNJA BOGOTA KM 6+120"));
  const b = N.interpretarLugar(N.lugar("BOGOTA TUNJA KM 5+200"));
  assert.equal(a.tipo, "km");
  assert.equal(a.corredor, "BOGOTA - TUNJA");
  assert.equal(b.corredor, "BOGOTA - TUNJA");
  assert.equal(a.km, 6.12);
  assert.equal(N.interpretarLugar("TUNJA BOGOTA KM 3+00").km, 3);
  assert.equal(N.interpretarLugar("CHIA BOGOTA KM 4+800 UNIVERSIDAD EL BOSQUE").km, 4.8);
});

test("interpretarLugar: veredas y direcciones", () => {
  assert.deepEqual(N.interpretarLugar("VEREDA FAGUA SECTOR BUYARA"), { tipo: "vereda", vereda: "FAGUA" });
  assert.equal(N.interpretarLugar("CARRERA 9 CALLE 25").tipo, "direccion");
});

test("via: agrupa para el ranking", () => {
  assert.equal(N.via(N.lugar("BOGOTA TUNJA KM 12+200")), "VÍA BOGOTA - TUNJA");
  assert.equal(N.via(N.lugar("AVENIDA PRADILLA 1-12 ESTE")), "AVENIDA PRADILLA");
  assert.equal(N.via(N.lugar("VARIANTE CALLE 2 8-27")), "VARIANTE");
  assert.equal(N.via(N.lugar("VEREDA YERBABUENA SECTOR PETACAS")), "VEREDA YERBABUENA");
  assert.equal(N.via(N.lugar("CARRERA 12 3-59")), "CARRERA 12");
});

test("fechas de Socrata y textos de mes/año", () => {
  assert.equal(N.fecha("2024-01-03T00:00:00.000"), "2024-01-03");
  assert.equal(N.fecha("3/1/2024"), "2024-01-03");
  assert.deepEqual(N.mesAnio("09/2026"), { anio: 2026, mes: 9 });
  assert.deepEqual(N.mesAnio("2025-04"), { anio: 2025, mes: 4 });
});

test("municipio: solo Chía exacto; variantes se excluyen", () => {
  assert.equal(N.esChia("CHIA"), true);
  assert.equal(N.esChia("Chía"), true);
  assert.equal(N.esChia("CHÍA - LA PAZ"), false);
  assert.equal(N.esChia("CHIPAQUE"), false);
});

test("veredas: repara los nombres dañados del archivo publicado", () => {
  assert.equal(N.vereda("Vereda Fonquet "), "FONQUETA");
  assert.equal(N.vereda("Vereda  Bojac "), "BOJACA");
  assert.equal(N.vereda("Vereda T quiza"), "TIQUIZA");
  assert.equal(N.vereda("Vereda La Balsa"), "LA BALSA");
});

test("interpolación kilométrica", () => {
  const refs = [{ km: 2, lat: 4.80, lon: -74.04 }, { km: 4, lat: 4.82, lon: -74.04 }];
  const r = interpolarKm(refs, 3);
  assert.ok(Math.abs(r.lat - 4.81) < 1e-9);
  assert.equal(r.confianza, 0.7);
  assert.equal(interpolarKm(refs, 5.5).confianza, 0.5);
  assert.equal(interpolarKm(refs, 9), null);
  assert.equal(interpolarKm([], 3), null);
});

test("consulta para Nominatim", () => {
  assert.equal(consultaNominatim("CARRERA 9 CALLE 25"), "Carrera 9, Chía, Cundinamarca, Colombia");
  assert.equal(consultaNominatim("AVENIDA PRADILLA 5E"), "Avenida Pradilla 5e, Chía, Cundinamarca, Colombia");
});
