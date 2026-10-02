// M10 · Analítica de comparendos y conductas de riesgo
import { useState } from "react";
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { useDatos, Kpi, Selector, TablaDatos, Fuente, Mensaje } from "../components/Comunes";
import { qs, fmtMes, fmtFecha, titulo, nf } from "../api";

const C_TOTAL = "#2a78d6", C_RIESGO = "#eb6834";

export default function Comparendos() {
  const [f, setF] = useState({ anio: "", entidad: "", grupo: "" });
  const set = (k: string) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const consulta = qs(f);
  const { datos: opc } = useDatos<any>("/comparendos/filtros");
  const { datos: res, error } = useDatos<any>(`/comparendos/resumen${consulta}`);
  const { datos: mensual } = useDatos<any[]>(`/comparendos/mensual${consulta}`);
  const { datos: ranking } = useDatos<any[]>(`/comparendos/ranking${consulta}`);
  const { datos: dias } = useDatos<any[]>(`/comparendos/dia-semana${consulta}`);
  const { datos: vs } = useDatos<any[]>(`/comparendos/vs-siniestros${qs({ anio: f.anio })}`);
  const fuente = "Imposición de comparendos de tránsito en el municipio de Chía (Alcaldía de Chía, datos.gov.co, CC BY-SA 4.0)";
  const riesgo = (res?.por_grupo || []).filter((g: any) => g.es_riesgo);

  return (
    <div className="pila">
      <div className="encabezado">
        <div>
          <h1>Analítica de comparendos</h1>
          <p className="tenue" style={{ margin: 0 }}>Comparendos de tránsito impuestos en Chía{res?.desde ? ` entre ${fmtFecha(res.desde)} y ${fmtFecha(res.hasta)}` : ""}. Solo se muestran totales agregados.</p>
        </div>
        <a className="boton secundario" href={`/api/comparendos/descarga.csv${consulta}`}>Descargar CSV</a>
      </div>

      <section className="tarjeta" aria-label="Filtros">
        <div className="filtros">
          <Selector id="c-anio" etiqueta="Año" valor={f.anio} onCambio={set("anio")} opciones={(opc?.anios || []).map((a: number) => ({ v: a, t: String(a) }))} />
          <Selector id="c-ent" etiqueta="Entidad que impone" valor={f.entidad} onCambio={set("entidad")} todas="Todas" opciones={(opc?.entidades || []).map((e: string) => ({ v: e, t: titulo(e) }))} />
          <Selector id="c-grp" etiqueta="Grupo de infracción" valor={f.grupo} onCambio={set("grupo")} opciones={(opc?.grupos || []).map((g: any) => ({ v: g.codigo, t: g.nombre }))} />
          {Object.values(f).some(Boolean) && <button className="secundario" onClick={() => setF({ anio: "", entidad: "", grupo: "" })}>Limpiar</button>}
        </div>
      </section>

      <Mensaje error={error} />
      <div className="rejilla r3">
        <Kpi etiqueta="Comparendos" valor={res?.total} color={C_TOTAL} />
        <Kpi etiqueta="Por conductas de riesgo" valor={res?.de_riesgo} color={C_RIESGO} detalle={res ? `${nf.format(res.porcentaje_riesgo)} % del total` : undefined} />
        <Kpi etiqueta="Entidades que imponen" valor={res?.por_entidad?.length}
          detalle={res?.por_entidad?.map((e: any) => `${titulo(e.entidad)}: ${nf.format(e.total)}`).join(" · ")} />
      </div>
      <p className="muy-tenue" style={{ marginTop: "-0.25rem" }}>
        Conductas de riesgo: {riesgo.map((g: any) => g.nombre.toLowerCase()).join(", ") || "velocidad, embriaguez, maniobras peligrosas, semáforo y señales, celular, cinturón"}. La clasificación la define el administrador a partir del Código Nacional de Tránsito.
      </p>

      <div className="rejilla r2">
        <section className="tarjeta">
          <h2>Comparendos por mes</h2>
          <p className="muy-tenue">Total y los impuestos por conductas de riesgo.</p>
          <div className="grafico">
            <ResponsiveContainer>
              <LineChart data={mensual || []} margin={{ top: 8, right: 12, left: -6, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#ecebe6" />
                <XAxis dataKey="mes" tickFormatter={fmtMes} tickLine={false} axisLine={{ stroke: "#d6d4cc" }} interval="preserveStartEnd" />
                <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => nf.format(v)} />
                <Tooltip labelFormatter={(m) => fmtMes(String(m))} formatter={(v, n) => [nf.format(Number(v)), n === "total" ? "Total" : "Conductas de riesgo"]} />
                <Legend formatter={(n) => (n === "total" ? "Total" : "Conductas de riesgo")} />
                <Line type="monotone" dataKey="total" stroke={C_TOTAL} strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey="de_riesgo" stroke={C_RIESGO} strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <TablaDatos columnas={[{ k: "mes", t: "Mes", f: fmtMes }, { k: "total", t: "Total", num: true }, { k: "de_riesgo", t: "Conductas de riesgo", num: true }]} filas={mensual || []} />
        </section>

        <section className="tarjeta">
          <h2>Por grupo de infracción</h2>
          <p className="muy-tenue">En naranja, los grupos considerados conductas de riesgo.</p>
          <div className="grafico">
            <ResponsiveContainer>
              <BarChart data={res?.por_grupo || []} layout="vertical" margin={{ top: 4, right: 48, left: 8, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke="#ecebe6" />
                <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(v) => nf.format(v)} />
                <YAxis type="category" dataKey="nombre" width={170} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v) => [nf.format(Number(v)), "Comparendos"]} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                <Bar dataKey="total" radius={[0, 4, 4, 0]} barSize={16} label={{ position: "right", fontSize: 12, fill: "#52514e", formatter: (v: any) => nf.format(v) }}
                  shape={(p: any) => <rect x={p.x} y={p.y} width={Math.max(p.width, 0)} height={p.height} rx={3} fill={p.payload.es_riesgo ? C_RIESGO : C_TOTAL} />} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <TablaDatos columnas={[{ k: "nombre", t: "Grupo" }, { k: "es_riesgo", t: "Conducta de riesgo", f: (v) => (v ? "Sí" : "No") }, { k: "total", t: "Comparendos", num: true }]} filas={res?.por_grupo || []} />
        </section>
      </div>

      <section className="tarjeta">
        <h2>Infracciones más frecuentes</h2>
        <div className="tabla-env">
          <table>
            <thead><tr><th>Código</th><th>Descripción (Código Nacional de Tránsito)</th><th>Grupo</th><th className="num">Comparendos</th></tr></thead>
            <tbody>
              {ranking?.map((r) => (
                <tr key={r.codigo}>
                  <td><strong>{r.codigo}</strong></td>
                  <td>{r.descripcion || <span className="tenue">Sin descripción cargada</span>}</td>
                  <td>{r.grupo}{r.es_riesgo && <> <span className="insignia insignia-alerta">riesgo</span></>}</td>
                  <td className="num">{nf.format(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Fuente texto={`${fuente}. Descripciones: Tabla de autoliquidación 2024, Alcaldía de Bogotá.`} />
      </section>

      <div className="rejilla r2">
        <section className="tarjeta">
          <h2>Día de la semana</h2>
          <div className="grafico">
            <ResponsiveContainer>
              <BarChart data={dias || []} margin={{ top: 8, right: 8, left: -6, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#ecebe6" />
                <XAxis dataKey="dia" tickLine={false} axisLine={{ stroke: "#d6d4cc" }} tickFormatter={(d) => d.slice(0, 3)} />
                <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => nf.format(v)} />
                <Tooltip formatter={(v) => [nf.format(Number(v)), "Comparendos"]} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                <Bar dataKey="total" fill={C_TOTAL} radius={[4, 4, 0, 0]} barSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <TablaDatos columnas={[{ k: "dia", t: "Día" }, { k: "total", t: "Comparendos", num: true }]} filas={dias || []} />
        </section>

        <section className="tarjeta">
          <h2>Comparendos y siniestros por mes</h2>
          <p className="muy-tenue">Dos escalas distintas, en dos gráficos alineados por mes. La coincidencia en el tiempo no prueba causalidad.</p>
          <div style={{ height: 130 }}>
            <ResponsiveContainer>
              <LineChart data={vs || []} syncId="vs" margin={{ top: 6, right: 12, left: -6, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#ecebe6" />
                <XAxis dataKey="mes" hide />
                <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => nf.format(v)} />
                <Tooltip labelFormatter={(m) => fmtMes(String(m))} formatter={(v) => [nf.format(Number(v)), "Comparendos"]} />
                <Line type="monotone" dataKey="comparendos" stroke={C_TOTAL} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="muy-tenue"><span className="marca-color" style={{ background: C_TOTAL }} />Comparendos</div>
          <div style={{ height: 130 }}>
            <ResponsiveContainer>
              <LineChart data={vs || []} syncId="vs" margin={{ top: 6, right: 12, left: -6, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#ecebe6" />
                <XAxis dataKey="mes" tickFormatter={fmtMes} tickLine={false} axisLine={{ stroke: "#d6d4cc" }} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                <Tooltip labelFormatter={(m) => fmtMes(String(m))} formatter={(v) => [nf.format(Number(v)), "Siniestros"]} />
                <Line type="monotone" dataKey="siniestros" stroke={C_RIESGO} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="muy-tenue"><span className="marca-color" style={{ background: C_RIESGO }} />Siniestros con víctimas</div>
          <TablaDatos columnas={[{ k: "mes", t: "Mes", f: fmtMes }, { k: "comparendos", t: "Comparendos", num: true }, { k: "siniestros", t: "Siniestros", num: true }]} filas={vs || []} />
        </section>
      </div>
      <p className="muy-tenue">Los comparendos no traen hora ni lugar, por eso no se muestran en el mapa. El archivo publicado contiene filas repetidas; ChíaVial las cuenta una sola vez.</p>
    </div>
  );
}
