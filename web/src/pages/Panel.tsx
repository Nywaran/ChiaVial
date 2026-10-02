// Panel de gestión: bandejas de reportes (RF-M01-06, RF-M04-04/05) y ubicación de siniestros (RF-GEN-11)
import { useEffect, useState } from "react";
import { CircleMarker, Tooltip as TipMapa } from "react-leaflet";
import { api, qs, fmtFecha, fmtFechaHora, titulo, NOMBRE_ESTADO, nf } from "../api";
import { useDatos, Estado, Mensaje, Selector, Campo } from "../components/Comunes";
import { MapaBase, AlHacerClic, Centrar, CapaVeredas } from "../components/Mapa";
import { useSesion } from "../sesion";

export default function Panel() {
  const { usuario } = useSesion();
  const esEntidad = usuario?.rol === "entidad";
  const [pestana, setPestana] = useState(esEntidad ? "infraestructura" : "conducta");
  const pestanas = esEntidad
    ? [["infraestructura", "Reportes asignados"]]
    : [["conducta", "Conducción de riesgo"], ["infraestructura", "Infraestructura"], ["ubicar", "Ubicar siniestros"]];
  return (
    <div className="pila">
      <div>
        <h1>Panel de gestión</h1>
        <p className="tenue" style={{ margin: 0 }}>{usuario?.entidad ? `${usuario.entidad} · ` : ""}{esEntidad ? "Reportes de infraestructura asignados a tu entidad." : "Revisa, clasifica y responde los reportes ciudadanos."}</p>
      </div>
      <div className="pestanas" role="tablist">
        {pestanas.map(([k, t]) => <button key={k} role="tab" aria-selected={pestana === k} className={pestana === k ? "activa" : ""} onClick={() => setPestana(k)}>{t}</button>)}
      </div>
      {pestana === "ubicar" ? <UbicarSiniestros /> : <Bandeja tipo={pestana as any} key={pestana} />}
    </div>
  );
}

function Bandeja({ tipo }: { tipo: "conducta" | "infraestructura" }) {
  const { usuario } = useSesion();
  const [f, setF] = useState({ estado: "", categoria: "", vereda: "", desde: "", hasta: "", spam: "" });
  const set = (k: string) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const { datos, error, recargar, cargando } = useDatos<any>(`/reportes/bandeja${qs({ tipo, ...f })}`);
  const { datos: cat } = useDatos<any>("/admin/catalogos");
  const { datos: opc } = useDatos<any>("/observatorio/filtros");
  const [sel, setSel] = useState<number | null>(null);
  const lista = datos?.reportes || [];
  const estados = datos?.estados?.[tipo] || [];
  return (
    <div className="pila">
      <section className="tarjeta" aria-label="Filtros">
        <div className="filtros">
          <Selector id="b-est" etiqueta="Estado" valor={f.estado} onCambio={set("estado")} opciones={estados.map((e: string) => ({ v: e, t: NOMBRE_ESTADO[e] }))} />
          <Selector id="b-cat" etiqueta="Categoría" valor={f.categoria} onCambio={set("categoria")} todas="Todas" opciones={(cat?.[tipo] || []).map((c: any) => ({ v: c.codigo, t: c.nombre }))} />
          <Selector id="b-ver" etiqueta="Vereda" valor={f.vereda} onCambio={set("vereda")} todas="Todas" opciones={(opc?.veredas || []).map((v: string) => ({ v, t: titulo(v) }))} />
          <div className="campo"><label htmlFor="b-desde">Desde</label><input id="b-desde" type="date" value={f.desde} onChange={(e) => set("desde")(e.target.value)} /></div>
          <div className="campo"><label htmlFor="b-hasta">Hasta</label><input id="b-hasta" type="date" value={f.hasta} onChange={(e) => set("hasta")(e.target.value)} /></div>
          {usuario?.rol !== "entidad" && <label className="casilla" style={{ fontSize: "0.9rem" }}><input type="checkbox" checked={f.spam === "true"} onChange={(e) => set("spam")(e.target.checked ? "true" : "")} /> Incluir spam</label>}
        </div>
      </section>
      <Mensaje error={error} />
      <div className="dos-col">
        <section className="tarjeta">
          <h2>{nf.format(lista.length)} reporte(s)</h2>
          {cargando && <p className="cargando">Cargando…</p>}
          {!cargando && !lista.length && <p className="vacio">No hay reportes con estos filtros.</p>}
          {lista.length > 0 && (
            <div className="tabla-env">
              <table>
                <thead><tr><th>#</th><th>Categoría</th><th>Estado</th><th>Recibido</th><th className="num">Siniestros cerca</th></tr></thead>
                <tbody>
                  {lista.map((r: any) => (
                    <tr key={r.id} className={`clic ${sel === r.id ? "seleccionada" : ""}`} onClick={() => setSel(r.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSel(r.id)}>
                      <td>{r.id}</td>
                      <td>{r.categoria_nombre}{r.posible_duplicado_de && <> <span className="insignia insignia-alerta">¿duplicado de #{r.posible_duplicado_de}?</span></>}{r.spam && <> <span className="insignia">spam</span></>}{r.apoyos > 0 && <> <span className="insignia">{r.apoyos} apoyo(s)</span></>}</td>
                      <td><Estado e={r.estado} /></td>
                      <td>{fmtFecha(r.creado_en)}<div className="muy-tenue">hace {r.dias} día(s)</div></td>
                      <td className="num">{r.siniestros_cercanos}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muy-tenue">«Siniestros cerca»: siniestros ubicados a menos de {datos?.radio_m ?? 200} m.</p>
        </section>
        <section className="tarjeta">
          {sel ? <Detalle id={sel} estados={estados} entidades={cat?.entidades || []} alCambiar={recargar} /> : <p className="vacio">Selecciona un reporte para ver el detalle.</p>}
        </section>
      </div>
    </div>
  );
}

function Detalle({ id, estados, entidades, alCambiar }: { id: number; estados: string[]; entidades: any[]; alCambiar: () => void }) {
  const { usuario } = useSesion();
  const { datos: r, recargar, error: errCarga } = useDatos<any>(`/reportes/${id}`);
  const [estado, setEstado] = useState("");
  const [comentario, setComentario] = useState("");
  const [asig, setAsig] = useState({ entidad_id: "", fecha_objetivo: "" });
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  useEffect(() => { setMsg({}); setEstado(""); setComentario(""); }, [id]);
  useEffect(() => { if (r) setAsig({ entidad_id: r.entidad_asignada_id ? String(r.entidad_asignada_id) : "", fecha_objetivo: r.fecha_objetivo || "" }); }, [r]);
  if (errCarga) return <Mensaje error={errCarga} />;
  if (!r) return <p className="cargando">Cargando…</p>;
  const esEntidad = usuario?.rol === "entidad";
  const opcionesEstado = (esEntidad ? ["EN_GESTION", "RESUELTO"] : estados).filter((e) => e !== r.estado);
  const requiereMotivo = ["DESCARTADO", "RECHAZADO"].includes(estado);

  async function accion(fn: () => Promise<any>, ok: string) {
    setMsg({});
    try { await fn(); setMsg({ ok }); await recargar(); alCambiar(); } catch (e: any) { setMsg({ error: e.message }); }
  }
  return (
    <div>
      <div className="encabezado" style={{ marginBottom: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>Reporte #{r.id}</h2><Estado e={r.estado} />
      </div>
      <p className="muy-tenue">{r.categoria_nombre} · {fmtFechaHora(r.creado_en)}{r.vereda ? ` · Vereda ${titulo(r.vereda)}` : ""}</p>
      <Mensaje ok={msg.ok} error={msg.error} />
      <p>{r.descripcion}</p>
      <table><tbody>
        {r.fecha_hecho && <tr><th>Fecha del hecho</th><td>{fmtFechaHora(r.fecha_hecho)}</td></tr>}
        {r.tipo === "conducta" && !esEntidad && <tr><th>Placa</th><td>{r.placa || "No indicada"}</td></tr>}
        {r.tipo === "infraestructura" && <tr><th>Asignado a</th><td>{r.entidad_asignada || "Sin asignar"}{r.fecha_objetivo ? ` · fecha objetivo ${fmtFecha(r.fecha_objetivo)}` : ""}</td></tr>}
      </tbody></table>
      {r.fotos?.length > 0 && <div className="fotos" style={{ margin: "0.75rem 0" }}>{r.fotos.map((u: string, i: number) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt={`Foto ${i + 1} del reporte`} /></a>)}</div>}
      <MapaBase etiqueta="Ubicación del reporte" alto="mapa-chico" centro={[r.lat, r.lon]} zoom={16}>
        <CircleMarker center={[r.lat, r.lon]} radius={9} pathOptions={{ color: "#fff", weight: 3, fillColor: "#1f5f4a", fillOpacity: 1 }} />
      </MapaBase>

      <h3 style={{ marginTop: "1rem" }}>Cambiar estado</h3>
      <div className="filtros">
        <div className="campo"><label htmlFor="n-est">Nuevo estado</label>
          <select id="n-est" value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="">Elige…</option>{opcionesEstado.map((e) => <option key={e} value={e}>{NOMBRE_ESTADO[e]}</option>)}
          </select></div>
      </div>
      <Campo id="n-com" etiqueta={requiereMotivo ? "Motivo (obligatorio)" : "Comentario para el ciudadano (opcional)"}>
        <textarea id="n-com" value={comentario} onChange={(e) => setComentario(e.target.value)} style={{ minHeight: 70 }} />
      </Campo>
      <button disabled={!estado || (requiereMotivo && !comentario.trim())} onClick={() => accion(async () => { await api.patch(`/reportes/${r.id}/estado`, { estado, comentario }); setEstado(""); setComentario(""); }, "Estado actualizado. Se avisó al ciudadano por correo.")}>Guardar estado</button>

      {r.tipo === "infraestructura" && !esEntidad && (
        <>
          <h3 style={{ marginTop: "1rem" }}>Asignar a una entidad</h3>
          <div className="filtros">
            <div className="campo"><label htmlFor="a-ent">Entidad</label>
              <select id="a-ent" value={asig.entidad_id} onChange={(e) => setAsig({ ...asig, entidad_id: e.target.value })}>
                <option value="">Elige…</option>{entidades.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </select></div>
            <div className="campo"><label htmlFor="a-fec">Fecha objetivo</label><input id="a-fec" type="date" value={asig.fecha_objetivo} onChange={(e) => setAsig({ ...asig, fecha_objetivo: e.target.value })} /></div>
            <button disabled={!asig.entidad_id} onClick={() => accion(() => api.patch(`/reportes/${r.id}/asignar`, { entidad_id: Number(asig.entidad_id), fecha_objetivo: asig.fecha_objetivo || null }), "Reporte asignado.")}>Asignar</button>
          </div>
        </>
      )}
      {!esEntidad && (
        <p style={{ marginTop: "1rem" }}>
          <button className="chico secundario" onClick={() => accion(() => api.patch(`/reportes/${r.id}/spam`, { spam: !r.spam }), r.spam ? "Reporte restaurado." : "Reporte marcado como spam.")}>{r.spam ? "Quitar marca de spam" : "Marcar como spam"}</button>
        </p>
      )}
      <details open>
        <summary>Historial</summary>
        <ol style={{ paddingLeft: "1.2rem" }}>{r.historial.map((h: any, i: number) => <li key={i}><strong>{NOMBRE_ESTADO[h.estado_nuevo]}</strong> · {fmtFechaHora(h.creado_en)}{h.usuario ? ` · ${h.usuario}` : ""}{h.comentario && <> · <em>{h.comentario}</em></>}</li>)}</ol>
      </details>
    </div>
  );
}

function UbicarSiniestros() {
  const { datos, recargar } = useDatos<any>("/admin/siniestros/pendientes");
  const { datos: cor, recargar: recCor } = useDatos<any>("/admin/corredores");
  const { datos: veredas } = useDatos<any>("/observatorio/veredas");
  const [sel, setSel] = useState<any>(null);
  const [punto, setPunto] = useState<[number, number] | null>(null);
  const [modo, setModo] = useState<"siniestro" | "km">("siniestro");
  const [ref, setRef] = useState({ corredor: "", km: "" });
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});

  async function guardarUbicacion() {
    if (!sel || !punto) return;
    try {
      await api.patch(`/admin/siniestros/${sel.id}/ubicacion`, { lat: punto[0], lon: punto[1] });
      setMsg({ ok: `Siniestro ${sel.numero_ipat} ubicado.` }); setSel(null); setPunto(null); recargar();
    } catch (e: any) { setMsg({ error: e.message }); }
  }
  async function guardarRef() {
    if (!punto || !ref.corredor || ref.km === "") return;
    try {
      const r = await api.post("/admin/corredores", { corredor: ref.corredor, km: Number(ref.km), lat: punto[0], lon: punto[1] });
      setMsg({ ok: `Referencia guardada. Se ubicaron automáticamente ${r.geocodificacion.ubicados} siniestro(s).` }); setPunto(null); setRef({ ...ref, km: "" }); recargar(); recCor();
    } catch (e: any) { setMsg({ error: e.message }); }
  }
  return (
    <div className="pila">
      <div className="aviso aviso-info">
        El conjunto de siniestros trae el lugar como texto. Hay dos formas de ubicarlos: marcar cada siniestro en el mapa o registrar <strong>puntos kilométricos de referencia</strong> en un corredor (por ejemplo, dónde queda el km 4 de la vía Bogotá–Tunja). Con dos referencias por corredor, el sistema ubica todos los siniestros de ese corredor.
      </div>
      <Mensaje ok={msg.ok} error={msg.error} />
      <div className="pestanas">
        <button className={modo === "siniestro" ? "activa" : ""} onClick={() => setModo("siniestro")}>Ubicar un siniestro ({datos?.pendientes ?? "…"} pendientes)</button>
        <button className={modo === "km" ? "activa" : ""} onClick={() => setModo("km")}>Referencias kilométricas</button>
      </div>
      <div className="dos-col">
        <section className="tarjeta">
          {modo === "siniestro" ? (
            <>
              <h2>Siniestros sin ubicación</h2>
              <div className="tabla-env" style={{ maxHeight: 470, overflowY: "auto" }}>
                <table>
                  <thead><tr><th>Fecha</th><th>Lugar</th><th>Gravedad</th></tr></thead>
                  <tbody>{datos?.siniestros?.map((s: any) => (
                    <tr key={s.id} className={`clic ${sel?.id === s.id ? "seleccionada" : ""}`} onClick={() => { setSel(s); setPunto(null); }} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSel(s)}>
                      <td>{fmtFecha(s.fecha)}</td><td>{s.lugar}<div className="muy-tenue">{titulo(s.entidad_reporta)}</div></td><td>{titulo(s.gravedad)}</td>
                    </tr>))}</tbody>
                </table>
              </div>
            </>
          ) : (
            <>
              <h2>Corredores en los datos</h2>
              <div className="tabla-env">
                <table>
                  <thead><tr><th>Corredor</th><th className="num">Siniestros</th><th>Km</th><th>Referencias</th></tr></thead>
                  <tbody>{cor?.corredores_en_datos?.map((c: any) => (
                    <tr key={c.corredor} className={`clic ${ref.corredor === c.corredor ? "seleccionada" : ""}`} onClick={() => setRef({ corredor: c.corredor, km: "" })}>
                      <td>{titulo(c.corredor)}</td><td className="num">{c.siniestros}</td><td>{c.km_min}–{c.km_max}</td>
                      <td>{cor.referencias.filter((r: any) => r.corredor === c.corredor).map((r: any) => `km ${r.km}`).join(", ") || "—"}</td>
                    </tr>))}</tbody>
                </table>
              </div>
            </>
          )}
        </section>
        <section className="tarjeta">
          {modo === "siniestro" ? (
            sel ? <><h2>{sel.lugar}</h2><p className="muy-tenue">IPAT {sel.numero_ipat} · {fmtFecha(sel.fecha)} · {titulo(sel.clase)}. Haz clic en el mapa donde ocurrió.</p></> : <p className="tenue">Selecciona un siniestro de la lista y márcalo en el mapa.</p>
          ) : (
            <>
              <h2>{ref.corredor ? titulo(ref.corredor) : "Elige un corredor"}</h2>
              <div className="filtros">
                <div className="campo"><label htmlFor="r-km">Kilómetro</label><input id="r-km" type="number" step="0.001" value={ref.km} onChange={(e) => setRef({ ...ref, km: e.target.value })} placeholder="Ej. 4.8" /></div>
              </div>
              <p className="muy-tenue">Marca en el mapa la ubicación de ese kilómetro (por ejemplo, el mojón o poste de referencia).</p>
            </>
          )}
          <MapaBase etiqueta="Mapa para ubicar siniestros">
            <CapaVeredas datos={veredas} />
            <AlHacerClic fn={(lat, lon) => setPunto([lat, lon])} />
            <Centrar punto={null} />
            {punto && <CircleMarker center={punto} radius={9} pathOptions={{ color: "#fff", weight: 3, fillColor: "#eb6834", fillOpacity: 1 }} />}
            {modo === "km" && cor?.referencias?.filter((r: any) => !ref.corredor || r.corredor === ref.corredor).map((r: any) => (
              <CircleMarker key={r.id} center={[r.lat, r.lon]} radius={7} pathOptions={{ color: "#fff", weight: 2, fillColor: "#1f5f4a", fillOpacity: 1 }}><TipMapa>{titulo(r.corredor)} km {r.km}</TipMapa></CircleMarker>
            ))}
          </MapaBase>
          <div className="acciones" style={{ marginTop: "0.75rem", justifyContent: "flex-end" }}>
            {modo === "siniestro"
              ? <button disabled={!sel || !punto} onClick={guardarUbicacion}>Guardar ubicación</button>
              : <button disabled={!ref.corredor || ref.km === "" || !punto} onClick={guardarRef}>Guardar referencia</button>}
          </div>
        </section>
      </div>
    </div>
  );
}
