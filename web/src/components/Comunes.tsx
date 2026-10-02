import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, nf, NOMBRE_ESTADO } from "../api";

/** Carga datos de la API y vuelve a cargar cuando cambia la ruta. */
export function useDatos<T = any>(ruta: string | null) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const recargar = useCallback(async () => {
    if (!ruta) return;
    setCargando(true);
    try { setDatos(await api.get<T>(ruta)); setError(null); } catch (e: any) { setError(e.message); } finally { setCargando(false); }
  }, [ruta]);
  useEffect(() => { recargar(); }, [recargar]);
  return { datos, error, cargando, recargar };
}

export function Kpi({ etiqueta, valor, detalle, color }: { etiqueta: string; valor: number | string | null | undefined; detalle?: ReactNode; color?: string }) {
  return (
    <div className="tarjeta kpi">
      <div className="etiqueta">{color && <span className="marca-color" style={{ background: color }} />}{etiqueta}</div>
      <div className="valor">{valor === null || valor === undefined ? "—" : typeof valor === "number" ? nf.format(valor) : valor}</div>
      {detalle && <div className="detalle">{detalle}</div>}
    </div>
  );
}

/** Variación frente al periodo anterior, con texto (no solo color). */
export function Variacion({ actual, anterior, periodo }: { actual: number; anterior?: number | null; periodo?: string | null }) {
  if (anterior === null || anterior === undefined || !periodo) return null;
  if (!anterior) return <>Sin registros en {periodo}</>;
  const d = Math.round(((actual - anterior) / anterior) * 100);
  return <>{d === 0 ? "Igual que" : d > 0 ? `▲ ${d} % más que` : `▼ ${Math.abs(d)} % menos que`} {periodo} ({nf.format(anterior)})</>;
}

export function Mensaje({ error, ok, info }: { error?: string | null; ok?: string | null; info?: string | null }) {
  if (error) return <div className="aviso aviso-error" role="alert">{error}</div>;
  if (ok) return <div className="aviso aviso-ok" role="status">{ok}</div>;
  if (info) return <div className="aviso aviso-info">{info}</div>;
  return null;
}

export const Estado = ({ e }: { e: string }) => <span className={`estado e-${e}`}>{NOMBRE_ESTADO[e] || e}</span>;

export function Campo({ id, etiqueta, ayuda, children }: { id: string; etiqueta: string; ayuda?: string; children: ReactNode }) {
  return (
    <div className="campo">
      <label htmlFor={id}>{etiqueta}</label>
      {children}
      {ayuda && <div className="ayuda" id={`${id}-ayuda`}>{ayuda}</div>}
    </div>
  );
}

export function Selector({ id, etiqueta, valor, onCambio, opciones, todas = "Todos" }: {
  id: string; etiqueta: string; valor: string; onCambio: (v: string) => void; opciones: { v: string | number; t: string }[]; todas?: string;
}) {
  return (
    <div className="campo">
      <label htmlFor={id}>{etiqueta}</label>
      <select id={id} value={valor} onChange={(e) => onCambio(e.target.value)}>
        <option value="">{todas}</option>
        {opciones.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
      </select>
    </div>
  );
}

/** Tabla alternativa para cada gráfico (accesibilidad, 2.13). */
export function TablaDatos({ columnas, filas }: { columnas: { k: string; t: string; num?: boolean; f?: (v: any) => string }[]; filas: any[] }) {
  return (
    <details>
      <summary>Ver datos en tabla</summary>
      <div className="tabla-env">
        <table>
          <thead><tr>{columnas.map((c) => <th key={c.k} className={c.num ? "num" : ""}>{c.t}</th>)}</tr></thead>
          <tbody>{filas.map((f, i) => <tr key={i}>{columnas.map((c) => <td key={c.k} className={c.num ? "num" : ""}>{c.f ? c.f(f[c.k]) : c.num ? nf.format(f[c.k]) : f[c.k]}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

export function Fuente({ texto }: { texto: string }) {
  return <p className="muy-tenue" style={{ marginTop: "0.5rem" }}>Fuente: {texto}</p>;
}
