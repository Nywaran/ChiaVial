// Normalización de textos de los datos abiertos (RF-GEN-08)

/** Mayúsculas, sin tildes (conserva la Ñ), espacios simples. */
export function basico(texto) {
  if (texto === null || texto === undefined) return null;
  const t = String(texto)
    .replace(/ñ/g, "\u0001").replace(/Ñ/g, "\u0001")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\u0001/g, "Ñ")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
  return t === "" ? null : t;
}

/** "Con Herido" / "CON HERIDO" / "con  herido" → "CON HERIDO" */
export function gravedad(texto) {
  const t = basico(texto);
  if (!t) return null;
  if (t.includes("MUERT")) return "CON MUERTO";
  if (t.includes("HERID")) return "CON HERIDO";
  if (t.includes("DANO") || t.includes("DAÑO")) return "SOLO DAÑOS";
  return t;
}

const ERRATAS_CLASE = { "CAIDA OUPANTE": "CAIDA OCUPANTE" };
export const clase = (texto) => {
  const t = basico(texto);
  return t ? ERRATAS_CLASE[t] || t : t;
};

/** Corredor canónico: «TUNJA BOGOTA» y «BOGOTA TUNJA» son el mismo → «BOGOTA - TUNJA». */
export function corredor(texto) {
  const t = (basico(texto) || "").replace(/^VIA\s+/, "").replace(/\s*-\s*/g, " ").trim();
  const partes = t.split(" ").filter(Boolean);
  if (partes.length === 2) return partes.sort().join(" - ");
  return t;
}

/** Lugar de ocurrencia normalizado para geocodificar y agrupar. */
export function lugar(texto) {
  let t = basico(texto);
  if (!t) return null;
  t = t
    .replace(/[.,;:]/g, " ")
    .replace(/\bK\s*M\b/g, "KM")
    .replace(/\b(KILOMETRO|KMS?)\b/g, "KM")
    .replace(/\b(CLL?|CALL|CL)\b/g, "CALLE")
    .replace(/\b(KR|KRA|CRA|CR|CARR|CARERA)\b/g, "CARRERA")
    .replace(/\b(AV|AVDA|AVE)\b/g, "AVENIDA")
    .replace(/\b(DG|DIAG)\b/g, "DIAGONAL")
    .replace(/\b(TV|TR|TRANSV)\b/g, "TRANSVERSAL")
    .replace(/\bVDA\b/g, "VEREDA")
    .replace(/\bNO\b\s*(?=\d)/g, "# ")
    .replace(/\s*\+\s*/g, "+")
    .replace(/\s+/g, " ")
    .trim();
  return t;
}

const RE_KM = /^(.*?)\s*KM\s*(\d+)(?:\+(\d+))?/;
const RE_VEREDA = /\bVEREDA\s+([A-ZÑ ]+?)(?=\s+(?:SECTOR|KM|CALLE|CARRERA|VIA)\b|$)/;
const RE_DIR = /\b(CALLE|CARRERA|AVENIDA|DIAGONAL|TRANSVERSAL)\s+(\d+[A-Z]?|[A-ZÑ]+(?:\s+[A-ZÑ]+)?)/;

/** Interpreta un lugar normalizado: punto kilométrico, vereda o dirección urbana. */
export function interpretarLugar(lugarNorm) {
  const l = lugarNorm || "";
  const km = l.match(RE_KM);
  if (km && km[1].trim()) {
    const metros = km[3] ? Number(km[3].padEnd(3, "0").slice(0, 3)) : 0;
    return { tipo: "km", corredor: corredor(km[1]), km: Number(km[2]) + metros / 1000 };
  }
  const ver = l.match(RE_VEREDA);
  if (ver) return { tipo: "vereda", vereda: ver[1].trim() };
  const dir = l.match(RE_DIR);
  if (dir) return { tipo: "direccion" };
  return { tipo: "texto" };
}

/** Vía o corredor principal a partir del lugar (para el ranking, RF-M07-04). */
export function via(lugarNorm) {
  if (!lugarNorm) return null;
  const i = interpretarLugar(lugarNorm);
  if (i.tipo === "km") return `VÍA ${i.corredor}`;
  if (i.tipo === "vereda") return `VEREDA ${i.vereda}`;
  if (/^VARIANTE\b/.test(lugarNorm)) return "VARIANTE";
  const av = lugarNorm.match(/\bAVENIDA\s+([A-ZÑ]+(?:\s+(?!CALLE|CARRERA|CON|Y\b)[A-ZÑ]+)?|\d+[A-Z]?)/);
  if (av) return `AVENIDA ${av[1]}`;
  const dir = lugarNorm.match(/\b(CALLE|CARRERA|DIAGONAL|TRANSVERSAL)\s+(\d+[A-Z]?)/);
  if (dir) return `${dir[1]} ${dir[2]}`;
  return lugarNorm.split(" ").slice(0, 4).join(" ");
}

/** Fechas de Socrata ("2024-01-03T00:00:00.000"), "03/01/2024", "01/2024", "2024-01". */
export function fecha(texto) {
  if (!texto) return null;
  const s = String(texto).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

/** Mes y año desde textos variados ("01/2024", "2024-01", "2024-01-15T…", "ENERO 2024"). */
export function mesAnio(texto) {
  if (!texto) return { anio: null, mes: null };
  const s = String(texto).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})/);
  if (m) return { anio: +m[1], mes: +m[2] };
  m = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return { anio: +m[2], mes: +m[1] };
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return { anio: +m[3], mes: +m[2] };
  const meses = ["ENERO","FEBRERO","MARZO","ABRIL","MAYO","JUNIO","JULIO","AGOSTO","SEPTIEMBRE","OCTUBRE","NOVIEMBRE","DICIEMBRE"];
  const b = basico(s) || "";
  const i = meses.findIndex((n) => b.includes(n));
  m = b.match(/(\d{4})/);
  if (i >= 0 && m) return { anio: +m[1], mes: i + 1 };
  return { anio: null, mes: null };
}

export const entero = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/** ¿El municipio es Chía? Solo «CHIA»/«CHÍA» exacto: variantes como «CHÍA - LA PAZ» se excluyen y se informan. */
export function esChia(municipio) {
  return basico(municipio) === "CHIA";
}

/** Nombres de veredas: el archivo publicado trae letras dañadas («Fonquet », «T quiza»). */
const VEREDAS = { "FONQUET": "FONQUETA", "BOJAC": "BOJACA", "T QUIZA": "TIQUIZA" };
export function vereda(texto) {
  const t = (basico(texto) || "").replace(/^VEREDA\s+/, "").trim();
  return VEREDAS[t] || t || null;
}
