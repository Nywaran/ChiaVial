// Cliente de la API: envía la cookie de sesión y la cabecera anti-CSRF
export class ErrorApi extends Error {
  estado: number;
  constructor(mensaje: string, estado: number) {
    super(mensaje);
    this.estado = estado;
  }
}

async function solicitar<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
  const esForm = cuerpo instanceof FormData;
  const r = await fetch(`/api${ruta}`, {
    method: metodo,
    credentials: "same-origin",
    headers: {
      "X-Requested-With": "ChiaVial",
      ...(cuerpo !== undefined && !esForm ? { "Content-Type": "application/json" } : {}),
    },
    body: cuerpo === undefined ? undefined : esForm ? (cuerpo as FormData) : JSON.stringify(cuerpo),
  });
  const tipo = r.headers.get("content-type") || "";
  const datos = tipo.includes("application/json") ? await r.json() : null;
  if (!r.ok) throw new ErrorApi(datos?.error || "No se pudo completar la solicitud. Intenta de nuevo.", r.status);
  return datos as T;
}

export const api = {
  get: <T = any>(ruta: string) => solicitar<T>("GET", ruta),
  post: <T = any>(ruta: string, cuerpo?: unknown) => solicitar<T>("POST", ruta, cuerpo ?? {}),
  put: <T = any>(ruta: string, cuerpo?: unknown) => solicitar<T>("PUT", ruta, cuerpo ?? {}),
  patch: <T = any>(ruta: string, cuerpo?: unknown) => solicitar<T>("PATCH", ruta, cuerpo ?? {}),
  del: <T = any>(ruta: string) => solicitar<T>("DELETE", ruta),
};

/** Arma la cadena de consulta omitiendo filtros vacíos. */
export function qs(filtros: Record<string, any>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filtros)) if (v !== "" && v !== undefined && v !== null) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const nf = new Intl.NumberFormat("es-CO");
export const fmtFecha = (f?: string | null) => {
  if (!f) return "—";
  const d = f.length === 10 ? new Date(`${f}T12:00:00`) : new Date(f);
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Bogota" });
};
export const fmtFechaHora = (f?: string | null) =>
  f ? new Date(f).toLocaleString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Bogota" }) : "—";
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const fmtMes = (m: string) => {
  const [a, mm] = m.split("-");
  return `${MESES[Number(mm) - 1]} ${a.slice(2)}`;
};
const MENORES = new Set(["de", "del", "la", "las", "los", "el", "y", "a", "en", "por", "con"]);
export const titulo = (s?: string | null) =>
  s ? s.toLowerCase().split(" ").map((p, i) => (i > 0 && MENORES.has(p) ? p : p.replace(/(^|-)\S/g, (x) => x.toUpperCase()))).join(" ") : "";

export const NOMBRE_ESTADO: Record<string, string> = {
  RECIBIDO: "Recibido", EN_REVISION: "En revisión", ATENDIDO: "Atendido", DESCARTADO: "Descartado",
  VERIFICADO: "Verificado", EN_GESTION: "En gestión", RESUELTO: "Resuelto", RECHAZADO: "Rechazado",
};
export const NOMBRE_ROL: Record<string, string> = {
  ciudadano: "Ciudadano", funcionario: "Funcionario de Movilidad", entidad: "Entidad externa", admin: "Administrador",
};
