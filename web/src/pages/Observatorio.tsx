// M07 · Observatorio y mapa de calor de siniestralidad
import { useMemo, useState } from "react";
import { CircleMarker, Tooltip as TipMapa } from "react-leaflet";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { useDatos, Kpi, Variacion, Selector, TablaDatos, Fuente, Mensaje } from "../components/Comunes";
import { MapaBase, CapaCalor, CapaVeredas } from "../components/Mapa";
import { qs, fmtMes, fmtFecha, titulo, nf } from "../api";

const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const C_HERIDO = "#2a78d6", C_MUERTO = "#eb6834";

export default function Observatorio() {
  const [f, setF] = useState({ anio: "", mes: "", gravedad: "", clase: "", entidad: "", vereda: "" });
  const [capas, setCapas] = useState({ calor: true, puntos: false, veredas: true, reportes: false });
  const set = (k: string) => (v: string) => setF((x) => ({ ...x, [k]: v, ...(k === "anio" && !v ? { mes: "" } : {}) }));
  const consulta = qs(f);
  const { datos: opc } = useDatos<any>("/observatorio/filtros");
  const { datos: meta } = useDatos<any>("/observatorio/meta");
  const { datos: res, error } = useDatos<any>(`/observatorio/resumen${consulta}`);
  const { datos: mapa } = useDatos<any>(`/observatorio/mapa${consulta}`);
  const { datos: tend } = useDatos<any[]>(`/observatorio/tendencia${consulta}`);
  const { datos: clases } = useDatos<any[]>(`/observatorio/clases${consulta}`);
  const { datos: ranking } = useDatos<any[]>(`/observatorio/ranking${consulta}`);
  const { datos: veh } = useDatos<any>(`/observatorio/vehiculos${qs({ anio: f.anio })}`);
  const { datos: veredas } = useDatos<any>("/observatorio/veredas");
  const { datos: rep } = useDatos<any>(capas.reportes ? "/reportes/publico" : null);
  const puntos = useMemo(() => mapa?.puntos || [], [mapa]);
  const fuente = "Siniestralidad vial del municipio de Chía (Alcaldía de Chía, datos.gov.co, CC BY-SA 4.0)";

  return (
    <div className="pila">
      <div className="encabezado">
        <div>
          <h1>Observatorio de siniestralidad vial</h1>
          <p className="tenue" style={{ margin: 0 }}>Siniestros con herido o con muerto registrados en Chía{meta?.desde ? ` entre ${fmtFecha(meta.desde)} y ${fmtFecha(meta.hasta)}` : ""}.</p>
        </div>
        <a className="boton secundario" href={`/api/observatorio/descarga.csv${consulta}`}>Descargar CSV</a>
      </div>

      <section className="tarjeta" aria-label="Filtros">
        <div className="filtros">
          <Selector id="f-anio" etiqueta="Año" valor={f.anio} onCambio={set("anio")} opciones={(opc?.anios || []).map((a: number) => ({ v: a, t: String(a) }))} />
          <Selector id="f-mes" etiqueta="Mes" valor={f.mes} onCambio={set("mes")} opciones={f.anio ? MESES.map((m, i) => ({ v: i + 1, t: m })) : []} todas={f.anio ? "Todos" : "Elige un año"} />
          <Selector id="f-grav" etiqueta="Gravedad" valor={f.gravedad} onCambio={set("gravedad")} todas="Todas" opciones={(opc?.gravedades || []).map((g: string) => ({ v: g, t: titulo(g) }))} />
          <Selector id="f-clase" etiqueta="Clase de accidente" valor={f.clase} onCambio={set("clase")} todas="Todas" opciones={(opc?.clases || []).map((g: string) => ({ v: g, t: titulo(g) }))} />
          <Selector id="f-ent" etiqueta="Entidad que reporta" valor={f.entidad} onCambio={set("entidad")} todas="Todas" opciones={(opc?.entidades || []).map((g: string) => ({ v: g, t: titulo(g) }))} />
          <Selector id="f-ver" etiqueta="Vereda" valor={f.vereda} onCambio={set("vereda")} todas="Todas" opciones={(opc?.veredas || []).map((g: string) => ({ v: g, t: titulo(g) }))} />
          {Object.values(f).some(Boolean) && <button className="secundario" onClick={() => setF({ anio: "", mes: "", gravedad: "", clase: "", entidad: "", vereda: "" })}>Limpiar</button>}
        </div>
      </section>

      <Mensaje error={error} />
      <div className="rejilla r3">
        <Kpi etiqueta="Siniestros" valor={res?.total} detalle={res && <Variacion actual={res.total} anterior={res.anterior?.total} periodo={res.periodo_anterior} />} />
        <Kpi etiqueta="Con muerto" valor={res?.con_muerto} color={C_MUERTO} detalle={res && <Variacion actual={res.con_muerto} anterior={res.anterior?.con_muerto} periodo={res.periodo_anterior} />} />
        <Kpi etiqueta="Con herido" valor={res?.con_herido} color={C_HERIDO} detalle={res && <Variacion actual={res.con_herido} anterior={res.anterior?.con_herido} periodo={res.periodo_anterior} />} />
      </div>

      <div className="dos-col">
        <section className="tarjeta">
          <h2>Mapa de calor</h2>
          <div className="acciones" style={{ marginBottom: "0.5rem" }} role="group" aria-label="Capas del mapa">
            {([["calor", "Calor"], ["puntos", "Puntos"], ["veredas", "Veredas"], ["reportes", "Reportes ciudadanos"]] as const).map(([k, t]) => (
              <label key={k} className="casilla" style={{ fontSize: "0.9rem", marginRight: "0.6rem" }}>
                <input type="checkbox" checked={capas[k]} onChange={(e) => setCapas((c) => ({ ...c, [k]: e.target.checked }))} /> {t}
              </label>
            ))}
          </div>
          <MapaBase etiqueta="Mapa de calor de siniestros en Chía">
            {capas.veredas && <CapaVeredas datos={veredas} />}
            {capas.calor && <CapaCalor puntos={puntos} />}
            {capas.puntos && puntos.map((p: any) => (
              <CircleMarker key={p.id} center={[p.lat, p.lon]} radius={p.gravedad === "CON MUERTO" ? 8 : 6}
                pathOptions={{ color: "#fff", weight: 2, fillColor: p.gravedad === "CON MUERTO" ? C_MUERTO : C_HERIDO, fillOpacity: 0.95 }}>
                <TipMapa>{`${titulo(p.gravedad)} · ${titulo(p.clase)} · ${fmtFecha(p.fecha)}`}<br />{p.lugar}<br /><small>Ubicación: {p.geo_fuente === "manual" ? "verificada" : `aproximada (${p.geo_fuente})`}</small></TipMapa>
              </CircleMarker>
            ))}
            {capas.reportes && rep?.infraestructura?.map((r: any) => (
              <CircleMarker key={`i${r.id}`} center={[r.lat, r.lon]} radius={7} pathOptions={{ color: "#fff", weight: 2, fillColor: "#4a3aa7", fillOpacity: 0.9 }}>
                <TipMapa>Reporte de infraestructura: {r.categoria_nombre}</TipMapa>
              </CircleMarker>
            ))}
            {capas.reportes && rep?.conductas?.map((r: any, i: number) => (
              <CircleMarker key={`c${i}`} center={[r.lat, r.lon]} radius={6 + Math.min(r.total, 10)} pathOptions={{ color: "#fff", weight: 2, fillColor: "#1baf7a", fillOpacity: 0.85 }}>
                <TipMapa>{r.total} reporte(s) de conducción de riesgo en esta zona</TipMapa>
              </CircleMarker>
            ))}
          </MapaBase>
          <div className="leyenda">
            <span>Menos<span className="degradado" />Más siniestros (un siniestro con muerto pesa 3 veces)</span>
            {capas.puntos && <><span><span className="marca-color" style={{ background: C_HERIDO }} />Con herido</span><span><span className="marca-color" style={{ background: C_MUERTO }} />Con muerto</span></>}
            {capas.reportes && <><span><span className="marca-color" style={{ background: "#4a3aa7" }} />Infraestructura</span><span><span className="marca-color" style={{ background: "#1baf7a" }} />Conducción de riesgo</span></>}
          </div>
          {mapa && (
            <p className="muy-tenue" style={{ marginTop: "0.5rem" }}>
              En el mapa: {nf.format(puntos.length)} de {nf.format(puntos.length + mapa.sin_ubicar)} siniestros. Los demás aún no tienen ubicación porque el dato publicado es texto libre; la Secretaría de Movilidad los va ubicando.
            </p>
          )}
        </section>

        <section className="tarjeta">
          <h2>Vías con más siniestros</h2>
          <div className="tabla-env">
            <table>
              <thead><tr><th>#</th><th>Vía o sector</th><th className="num">Siniestros</th><th className="num">Con muerto</th></tr></thead>
              <tbody>
                {ranking?.map((r, i) => <tr key={r.via}><td>{i + 1}</td><td>{titulo(r.via)}</td><td className="num">{r.total}</td><td className="num">{r.con_muerto}</td></tr>)}
              </tbody>
            </table>
          </div>
          {ranking && !ranking.length && <p className="vacio">No hay siniestros con estos filtros.</p>}
          <Fuente texto={fuente} />
        </section>
      </div>

      <div className="rejilla r2">
        <section className="tarjeta">
          <h2>Tendencia mensual</h2>
          <p className="muy-tenue">Siniestros por mes según su gravedad.</p>
          <div className="grafico">
            <ResponsiveContainer>
              <BarChart data={tend || []} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#ecebe6" />
                <XAxis dataKey="mes" tickFormatter={fmtMes} tickLine={false} axisLine={{ stroke: "#d6d4cc" }} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                <Tooltip labelFormatter={(m) => fmtMes(String(m))} formatter={(v, n) => [v, n === "con_herido" ? "Con herido" : "Con muerto"]} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                <Legend formatter={(n) => (n === "con_herido" ? "Con herido" : "Con muerto")} />
                <Bar dataKey="con_herido" stackId="g" fill={C_HERIDO} stroke="#fff" strokeWidth={1} />
                <Bar dataKey="con_muerto" stackId="g" fill={C_MUERTO} stroke="#fff" strokeWidth={1} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <TablaDatos columnas={[{ k: "mes", t: "Mes", f: fmtMes }, { k: "con_herido", t: "Con herido", num: true }, { k: "con_muerto", t: "Con muerto", num: true }]} filas={tend || []} />
        </section>

        <section className="tarjeta">
          <h2>Clase de accidente</h2>
          <p className="muy-tenue">Número de siniestros por clase.</p>
          <div className="grafico">
            <ResponsiveContainer>
              <BarChart data={(clases || []).map((c) => ({ ...c, nombre: titulo(c.clase) }))} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke="#ecebe6" />
                <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="nombre" width={150} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v) => [v, "Siniestros"]} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                <Bar dataKey="total" fill={C_HERIDO} radius={[0, 4, 4, 0]} barSize={18} label={{ position: "right", fontSize: 12, fill: "#52514e" }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <TablaDatos columnas={[{ k: "clase", t: "Clase", f: titulo }, { k: "total", t: "Siniestros", num: true }, { k: "con_muerto", t: "Con muerto", num: true }]} filas={clases || []} />
        </section>
      </div>

      <section className="tarjeta">
        <h2>Vehículos involucrados</h2>
        <p className="muy-tenue">
          {veh ? `${nf.format(veh.total)} vehículos involucrados en siniestros con herido o muerto en Chía${veh.desde ? ` (${veh.desde}–${veh.hasta})` : ""}. ` : ""}
          Fuente distinta: Ministerio de Transporte / RUNT, Ley 2251 de 2022. Solo se filtra por año.
        </p>
        <div className="rejilla r2">
          <div className="grafico">
            <ResponsiveContainer>
              <BarChart data={(veh?.tipos || []).map((t: any) => ({ ...t, nombre: titulo(t.tipo) }))} layout="vertical" margin={{ top: 4, right: 32, left: 8, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke="#ecebe6" />
                <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="nombre" width={120} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v) => [nf.format(Number(v)), "Vehículos"]} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                <Bar dataKey="total" fill={C_HERIDO} radius={[0, 4, 4, 0]} barSize={16} label={{ position: "right", fontSize: 12, fill: "#52514e" }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="grafico">
            <ResponsiveContainer>
              <BarChart data={veh?.edades || []} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#ecebe6" />
                <XAxis dataKey="rango" tickLine={false} axisLine={{ stroke: "#d6d4cc" }} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v) => [nf.format(Number(v)), "Vehículos"]} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                <Bar dataKey="total" fill={C_HERIDO} radius={[4, 4, 0, 0]} barSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <TablaDatos columnas={[{ k: "tipo", t: "Tipo de vehículo", f: titulo }, { k: "total", t: "Vehículos", num: true }, { k: "con_muerto", t: "En siniestros con muerto", num: true }]} filas={veh?.tipos || []} />
      </section>

      {meta && (
        <section className="aviso aviso-info">
          <strong>Limitaciones de los datos</strong>
          <ul>{meta.limitaciones.map((l: string) => <li key={l}>{l}</li>)}</ul>
        </section>
      )}
    </div>
  );
}
