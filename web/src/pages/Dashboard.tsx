// Tablero de indicadores para funcionarios y administradores (Google Charts + datos de PostgreSQL).
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, fmtFecha, fmtFechaHora, fmtMes, nf, qs, NOMBRE_ESTADO, NOMBRE_ROL, titulo } from "../api";
import { Kpi } from "../components/Comunes";
import { useSesion } from "../sesion";
import { cargarGoogleCharts } from "../lib/googleCharts";

// Paleta validada (dataviz): orden fijo, nunca cíclico
const AZUL = "#2a78d6", NARANJA = "#eb6834", VERDE = "#1baf7a";
const TINTA = "#52514e", REJILLA = "#ecebe6";

type Fila = (string | number | null)[];
type Grafico = {
  tipo: "BarChart" | "ColumnChart" | "LineChart";
  columnas: (string | { type: string; role: string })[];
  filas: Fila[];
  colores?: string[];
  apilado?: boolean;
  alto?: number;
};

function opcionesBase(g: Grafico) {
  const horizontal = g.tipo === "BarChart";
  const series = g.columnas.filter((c) => typeof c === "string").length - 1;
  const ejeValor = { minValue: 0, format: "short", gridlines: { color: REJILLA, count: 4 }, baselineColor: "#c9c7bf", textStyle: { color: TINTA, fontSize: 12 } };
  const ejeCat = { textStyle: { color: TINTA, fontSize: 12 }, gridlines: { color: "transparent" } };
  return {
    height: g.alto ?? 280,
    colors: g.colores ?? [AZUL, NARANJA, VERDE],
    isStacked: !!g.apilado,
    legend: series > 1 ? { position: "top", alignment: "start", textStyle: { color: TINTA, fontSize: 12 } } : { position: "none" },
    chartArea: { left: horizontal ? 170 : 48, right: 16, top: series > 1 ? 36 : 12, bottom: horizontal ? 32 : 48, width: "100%", height: "100%" },
    hAxis: horizontal ? ejeValor : { ...ejeCat, slantedText: false, maxAlternation: 1, showTextEvery: g.filas.length > 14 ? Math.ceil(g.filas.length / 8) : 1 },
    vAxis: horizontal ? ejeCat : ejeValor,
    bar: { groupWidth: "62%" },
    lineWidth: 2,
    pointSize: g.filas.length > 30 ? 0 : 6,
    tooltip: { textStyle: { fontSize: 13 } },
    focusTarget: g.tipo === "LineChart" ? "category" : "datum", // en líneas: tooltip de todas las series
    fontName: "system-ui",
    backgroundColor: "transparent",
    animation: { duration: 300, easing: "out", startup: true },
  };
}

/** Un gráfico de Google Charts con su tabla de datos accesible. */
function Tarjeta({ titulo: t, nota, g, google }: { titulo: string; nota?: string; g: Grafico; google: any }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!google || !ref.current || !g.filas.length) return;
    const datos = google.visualization.arrayToDataTable([g.columnas, ...g.filas]);
    const grafico = new google.visualization[g.tipo](ref.current);
    const dibujar = () => grafico.draw(datos, opcionesBase(g));
    dibujar();
    const obs = new ResizeObserver(() => dibujar());
    obs.observe(ref.current);
    return () => { obs.disconnect(); grafico.clearChart(); };
  }, [google, g]);
  const cabeza = g.columnas.filter((c): c is string => typeof c === "string");
  return (
    <section className="tarjeta gchart">
      <h2>{t}</h2>
      {nota && <p className="muy-tenue">{nota}</p>}
      {!g.filas.length ? <p className="tenue">Sin datos para el periodo.</p> : (
        <>
          {google && <div ref={ref} role="img" aria-label={`Gráfico: ${t}`} />}
          <details open={!google}>
            <summary>Ver tabla de datos</summary>
            <div className="tabla-env"><table>
              <thead><tr>{cabeza.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>{g.filas.map((f, i) => (
                <tr key={i}>{f.slice(0, cabeza.length).map((v, j) => <td key={j} className={j ? "num" : ""}>{typeof v === "number" ? nf.format(v) : v}</td>)}</tr>
              ))}</tbody>
            </table></div>
          </details>
        </>
      )}
    </section>
  );
}

const fmtSemana = (f: string) => fmtFecha(f).slice(0, 5);

export default function Dashboard() {
  const { usuario } = useSesion();
  const [filtros, setFiltros] = useState({ desde: "", hasta: "" });
  const [aplicados, setAplicados] = useState({ desde: "", hasta: "" });
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [google, setGoogle] = useState<any>(null);
  const [sinGoogle, setSinGoogle] = useState(false);

  useEffect(() => { cargarGoogleCharts().then(setGoogle).catch(() => setSinGoogle(true)); }, []);
  useEffect(() => {
    setError(null);
    api.get(`/dashboard${qs(aplicados)}`).then(setD).catch((e) => setError(e.message));
  }, [aplicados]);

  function aplicar(e: FormEvent) { e.preventDefault(); setAplicados(filtros); }
  function limpiar() { const v = { desde: "", hasta: "" }; setFiltros(v); setAplicados(v); }

  if (error) return <div className="aviso aviso-error">{error}</div>;
  if (!d) return <p className="tenue">Cargando indicadores…</p>;

  const k = d.kpis;
  const estados: Record<string, number> = {};
  for (const r of d.reportesPorEstado) estados[r.estado] = (estados[r.estado] || 0) + r.n;
  const graficos: Record<string, Grafico> = {
    semana: { tipo: "LineChart", columnas: ["Semana", "Creados", "Cerrados"], filas: d.reportesPorSemana.map((s: any) => [fmtSemana(s.semana), s.creados, s.cerrados]) },
    estado: { tipo: "BarChart", columnas: ["Estado", "Reportes"], filas: Object.entries(estados).map(([e, n]) => [NOMBRE_ESTADO[e] || e, n]) },
    categoria: { tipo: "BarChart", columnas: ["Categoría", "Reportes"], filas: d.reportesPorCategoria.map((c: any) => [c.categoria, c.n]), alto: 320 },
    vereda: { tipo: "BarChart", columnas: ["Vereda", "Reportes"], filas: d.reportesPorVereda.map((v: any) => [titulo(v.vereda), v.n]) },
    siniestrosMes: {
      tipo: "ColumnChart", apilado: true, colores: [AZUL, NARANJA],
      columnas: ["Mes", "Con herido", "Con muerto"],
      filas: d.siniestrosPorMes.map((m: any) => [fmtMes(m.mes), m.con_herido + m.otros, m.con_muerto]),
    },
    clase: { tipo: "BarChart", columnas: ["Clase", "Siniestros"], filas: d.siniestrosPorClase.map((c: any) => [titulo(c.clase), c.n]) },
    vias: { tipo: "BarChart", columnas: ["Vía", "Siniestros"], filas: d.topVias.map((v: any) => [titulo(v.via), v.n]) },
    comparendosGrupo: {
      tipo: "BarChart", alto: 340,
      columnas: ["Grupo", "Comparendos", { type: "string", role: "style" }],
      filas: d.comparendosPorGrupo.map((g: any) => [g.grupo, g.n, g.es_riesgo ? NARANJA : AZUL]),
    },
    comparendosMes: { tipo: "LineChart", columnas: ["Mes", "Comparendos"], filas: d.comparendosPorMes.map((m: any) => [fmtMes(m.mes), m.n]) },
  };
  const totalNotif = d.notificaciones.reduce((a: number, n: any) => a + n.n, 0);
  const r = d.resumenDatos;

  return (
    <div className="pila">
      <div>
        <h1>Tablero de indicadores</h1>
        <p className="tenue">Gestión de reportes ciudadanos y datos abiertos de siniestralidad y comparendos de Chía. Actualizado {fmtFechaHora(d.generado_en)}.</p>
      </div>

      <form className="filtros tarjeta" onSubmit={aplicar} aria-label="Filtrar por fechas">
        <label>Desde <input type="date" value={filtros.desde} onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })} /></label>
        <label>Hasta <input type="date" value={filtros.hasta} onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })} /></label>
        <button type="submit">Aplicar</button>
        {(aplicados.desde || aplicados.hasta) && <button type="button" className="secundario" onClick={limpiar}>Quitar filtro</button>}
      </form>

      {r.usuarios_demo > 0 && (
        <div className="aviso aviso-info">Hay datos de demostración cargados ({r.usuarios_demo} usuarios @demo.chiavial.local): los indicadores de reportes y notificaciones incluyen esos registros ficticios. Los siniestros y comparendos son datos abiertos reales.</div>
      )}
      {sinGoogle && <div className="aviso aviso-info">No se pudo cargar Google Charts (se necesita conexión a www.gstatic.com). Se muestran las tablas de datos.</div>}

      <h2 className="seccion">Reportes ciudadanos</h2>
      <div className="rejilla r4">
        <Kpi etiqueta="Reportes" valor={k.total} detalle={aplicados.desde || aplicados.hasta ? "en el periodo" : "en total"} />
        <Kpi etiqueta="Abiertos" valor={k.abiertos} detalle={`${nf.format(k.cerrados)} cerrados`} />
        <Kpi etiqueta="Primera respuesta" valor={k.horas_primera_respuesta === null ? null : `${nf.format(k.horas_primera_respuesta)} h`} detalle="promedio desde la creación" />
        <Kpi etiqueta="Tiempo de cierre" valor={k.dias_cierre === null ? null : `${nf.format(k.dias_cierre)} d`} detalle="promedio hasta atender o resolver" />
      </div>
      <Tarjeta google={google} titulo="Reportes creados y cerrados por semana" g={graficos.semana} />
      <div className="rejilla r2">
        <Tarjeta google={google} titulo="Reportes por estado" g={graficos.estado} />
        <Tarjeta google={google} titulo="Reportes por vereda" g={graficos.vereda} />
      </div>
      <Tarjeta google={google} titulo="Reportes por categoría" g={graficos.categoria} />

      <h2 className="seccion">Siniestralidad (datos abiertos)</h2>
      <div className="rejilla r4">
        <Kpi etiqueta="Siniestros" valor={r.siniestros} detalle={`${fmtFecha(r.siniestros_desde)} – ${fmtFecha(r.siniestros_hasta)}`} />
        <Kpi etiqueta="Ubicados en el mapa" valor={r.siniestros_ubicados} detalle={r.siniestros ? `${Math.round((100 * r.siniestros_ubicados) / r.siniestros)} % del total` : undefined} />
        <Kpi etiqueta="Comparendos" valor={r.comparendos} detalle={`${fmtFecha(r.comparendos_desde)} – ${fmtFecha(r.comparendos_hasta)}`} />
        <Kpi etiqueta="Notificaciones" valor={totalNotif} detalle={d.notificaciones.map((n: any) => `${n.canal === "telegram" ? "Telegram" : "Correo"} ${n.estado.replace("_", " ")}: ${n.n}`).join(" · ") || "sin envíos"} />
      </div>
      <Tarjeta google={google} titulo="Siniestros por mes y gravedad" g={graficos.siniestrosMes} />
      <div className="rejilla r2">
        <Tarjeta google={google} titulo="Siniestros por clase" g={graficos.clase} />
        <Tarjeta google={google} titulo="Vías con más siniestros" g={graficos.vias} />
      </div>
      <div className="rejilla r2">
        <Tarjeta google={google} titulo="Comparendos por grupo de infracción" nota="Naranja: grupos clasificados como conducta de riesgo." g={graficos.comparendosGrupo} />
        <Tarjeta google={google} titulo="Comparendos por mes" g={graficos.comparendosMes} />
      </div>

      {usuario?.rol === "admin" && d.usuariosPorRol && (
        <section className="tarjeta">
          <h2>Usuarios activos</h2>
          <div className="tabla-env"><table>
            <thead><tr><th>Rol</th><th className="num">Usuarios</th><th className="num">Con Telegram</th></tr></thead>
            <tbody>{d.usuariosPorRol.map((u: any) => <tr key={u.rol}><td>{NOMBRE_ROL[u.rol]}</td><td className="num">{nf.format(u.n)}</td><td className="num">{nf.format(u.con_telegram)}</td></tr>)}</tbody>
          </table></div>
        </section>
      )}
    </div>
  );
}
