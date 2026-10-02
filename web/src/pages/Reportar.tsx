// M01 y M04 · Reporte ciudadano en tres pasos: ubicar, describir, enviar
import { useEffect, useState } from "react";
import { CircleMarker, Tooltip as TipMapa } from "react-leaflet";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useDatos, Mensaje, Campo, Estado } from "../components/Comunes";
import { MapaBase, AlHacerClic, Centrar } from "../components/Mapa";

type Tipo = "conducta" | "infraestructura";

export default function Reportar() {
  const [params] = useSearchParams();
  const [tipo, setTipo] = useState<Tipo>(params.get("tipo") === "infraestructura" ? "infraestructura" : "conducta");
  const [paso, setPaso] = useState(1);
  const [punto, setPunto] = useState<[number, number] | null>(null);
  const [centrar, setCentrar] = useState<[number, number] | null>(null);
  const [categoria, setCategoria] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [fechaHecho, setFechaHecho] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  const [placa, setPlaca] = useState("");
  const [fotos, setFotos] = useState<File[]>([]);
  const [aviso, setAviso] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState<{ id: number; mensaje: string } | null>(null);
  const [similares, setSimilares] = useState<any[]>([]);
  const [apoyado, setApoyado] = useState<string | null>(null);
  const { datos: cat } = useDatos<any>("/admin/catalogos");

  const bbox = cat?.bbox as number[] | undefined;
  const fueraDeChia = (lat: number, lon: number) => !!bbox && (lon < bbox[0] || lon > bbox[2] || lat < bbox[1] || lat > bbox[3]);

  // RF-M04-02: reportes similares cercanos
  useEffect(() => {
    if (tipo !== "infraestructura" || !punto) { setSimilares([]); return; }
    api.get(`/reportes/similares?lat=${punto[0]}&lon=${punto[1]}${categoria ? `&categoria=${categoria}` : ""}`).then(setSimilares).catch(() => setSimilares([]));
  }, [tipo, punto, categoria]);

  function ubicarme() {
    setError(null);
    if (!navigator.geolocation) return setError("Tu navegador no permite obtener la ubicación. Marca el punto en el mapa.");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const pt: [number, number] = [p.coords.latitude, p.coords.longitude];
        if (fueraDeChia(...pt)) return setError("Tu ubicación actual está fuera de Chía. Marca el punto en el mapa.");
        setPunto(pt); setCentrar(pt);
      },
      () => setError("No fue posible obtener tu ubicación. Marca el punto en el mapa."),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function elegirFotos(lista: FileList | null) {
    setError(null);
    const arr = Array.from(lista || []);
    if (arr.length > 3) return setError("Puedes adjuntar máximo 3 fotos.");
    if (arr.some((f) => f.size > 5 * 1024 * 1024)) return setError("Cada foto debe pesar máximo 5 MB.");
    setFotos(arr);
  }

  async function enviar() {
    setError(null);
    if (!punto) return setError("Marca la ubicación en el mapa.");
    if (!categoria) return setError("Elige una categoría.");
    if (descripcion.trim().length < 10) return setError("Describe lo ocurrido (mínimo 10 caracteres).");
    if (tipo === "conducta" && !aviso) return setError("Debes confirmar que entiendes que el reporte es informativo.");
    const fd = new FormData();
    fd.append("tipo", tipo); fd.append("categoria", categoria); fd.append("descripcion", descripcion.trim());
    fd.append("lat", String(punto[0])); fd.append("lon", String(punto[1]));
    if (tipo === "conducta") {
      if (fechaHecho) fd.append("fecha_hecho", new Date(fechaHecho).toISOString());
      if (placa.trim()) fd.append("placa", placa.trim());
      fd.append("acepto_aviso", String(aviso));
    }
    fotos.forEach((f) => fd.append("fotos", f));
    setEnviando(true);
    try { setHecho(await api.post("/reportes", fd)); } catch (e: any) { setError(e.message); } finally { setEnviando(false); }
  }

  async function apoyar(id: number) {
    try { const r = await api.post(`/reportes/${id}/apoyar`); setApoyado(r.mensaje); } catch (e: any) { setError(e.message); }
  }

  if (hecho) {
    return (
      <div className="tarjeta" style={{ maxWidth: 640 }}>
        <h1>¡Gracias por tu reporte!</h1>
        <Mensaje ok={`Reporte #${hecho.id} recibido. ${hecho.mensaje}`} />
        <div className="acciones">
          <Link className="boton" to="/mis-reportes">Ver mis reportes</Link>
          <button className="secundario" onClick={() => window.location.reload()}>Hacer otro reporte</button>
        </div>
      </div>
    );
  }

  const categorias = (tipo === "conducta" ? cat?.conducta : cat?.infraestructura) || [];
  return (
    <div className="pila" style={{ maxWidth: 980 }}>
      <div>
        <h1>Hacer un reporte</h1>
        <div className="acciones" role="radiogroup" aria-label="Tipo de reporte">
          {([["conducta", "Conducción de riesgo"], ["infraestructura", "Punto peligroso de infraestructura"]] as const).map(([v, t]) => (
            <button key={v} role="radio" aria-checked={tipo === v} className={tipo === v ? "" : "secundario"} onClick={() => { setTipo(v); setCategoria(""); }}>{t}</button>
          ))}
        </div>
      </div>

      <ol className="pasos" aria-label="Pasos">
        {["Ubicar", "Describir", "Enviar"].map((t, i) => (
          <li key={t} className={`paso ${paso === i + 1 ? "activo" : paso > i + 1 ? "hecho" : ""}`} style={{ listStyle: "none" }}><b>{i + 1}</b>{t}</li>
        ))}
      </ol>
      <Mensaje error={error} ok={apoyado} />

      {paso === 1 && (
        <section className="tarjeta">
          <h2>¿Dónde ocurrió?</h2>
          <p className="tenue">Toca el mapa para marcar el lugar o usa tu ubicación actual.</p>
          <div className="acciones" style={{ marginBottom: "0.75rem" }}>
            <button className="secundario" onClick={ubicarme}>Usar mi ubicación</button>
            {punto && <span className="muy-tenue">Punto marcado: {punto[0].toFixed(5)}, {punto[1].toFixed(5)}</span>}
          </div>
          <MapaBase etiqueta="Mapa para marcar la ubicación del reporte">
            <AlHacerClic fn={(lat, lon) => { if (fueraDeChia(lat, lon)) setError("El punto debe estar dentro de Chía."); else { setError(null); setPunto([lat, lon]); } }} />
            <Centrar punto={centrar} />
            {punto && <CircleMarker center={punto} radius={10} pathOptions={{ color: "#fff", weight: 3, fillColor: "#1f5f4a", fillOpacity: 1 }}><TipMapa permanent direction="top">Aquí</TipMapa></CircleMarker>}
          </MapaBase>
          <div className="acciones" style={{ marginTop: "0.75rem", justifyContent: "flex-end" }}>
            <button disabled={!punto} onClick={() => setPaso(2)}>Continuar</button>
          </div>
        </section>
      )}

      {paso === 2 && (
        <section className="tarjeta">
          <h2>¿Qué pasó?</h2>
          <fieldset style={{ border: 0, padding: 0, margin: "0 0 1rem" }}>
            <legend style={{ fontWeight: 600, marginBottom: "0.4rem" }}>Categoría</legend>
            <div className="opciones">
              {categorias.map((c: any) => (
                <label key={c.codigo} className={`opcion ${categoria === c.codigo ? "sel" : ""}`}>
                  <input type="radio" name="categoria" value={c.codigo} checked={categoria === c.codigo} onChange={() => setCategoria(c.codigo)} />{c.nombre}
                </label>
              ))}
            </div>
          </fieldset>
          {tipo === "infraestructura" && similares.length > 0 && (
            <div className="aviso aviso-info">
              <strong>Ya hay reportes parecidos cerca.</strong> Si es el mismo problema, apóyalo en lugar de crear uno nuevo:
              <ul>{similares.map((s) => (
                <li key={s.id} style={{ marginTop: "0.3rem" }}>#{s.id} · {s.categoria_nombre} a {s.distancia_m} m · <Estado e={s.estado} /> · {s.apoyos} apoyo(s){" "}
                  <button className="chico secundario" onClick={() => apoyar(s.id)}>Apoyar este reporte</button></li>
              ))}</ul>
            </div>
          )}
          <Campo id="desc" etiqueta="Descripción" ayuda="Cuenta qué observaste. Evita incluir nombres o datos de otras personas.">
            <textarea id="desc" value={descripcion} maxLength={2000} onChange={(e) => setDescripcion(e.target.value)} aria-describedby="desc-ayuda" />
          </Campo>
          {tipo === "conducta" && (
            <div className="rejilla r2">
              <Campo id="fecha" etiqueta="Fecha y hora del hecho">
                <input id="fecha" type="datetime-local" value={fechaHecho} max={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} onChange={(e) => setFechaHecho(e.target.value)} />
              </Campo>
              <Campo id="placa" etiqueta="Placa del vehículo (opcional)" ayuda="Solo la verá la Secretaría de Movilidad; nunca se publica.">
                <input id="placa" value={placa} maxLength={10} onChange={(e) => setPlaca(e.target.value.toUpperCase())} aria-describedby="placa-ayuda" autoComplete="off" />
              </Campo>
            </div>
          )}
          <Campo id="fotos" etiqueta="Fotos (opcional)" ayuda="Hasta 3 fotos de máximo 5 MB. Se elimina la información de ubicación del archivo antes de guardarlas.">
            <input id="fotos" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => elegirFotos(e.target.files)} aria-describedby="fotos-ayuda" />
          </Campo>
          {fotos.length > 0 && <div className="fotos">{fotos.map((f, i) => <img key={i} src={URL.createObjectURL(f)} alt={`Foto ${i + 1}`} />)}</div>}
          <div className="acciones" style={{ marginTop: "0.75rem", justifyContent: "space-between" }}>
            <button className="secundario" onClick={() => setPaso(1)}>Atrás</button>
            <button disabled={!categoria || descripcion.trim().length < 10} onClick={() => setPaso(3)}>Continuar</button>
          </div>
        </section>
      )}

      {paso === 3 && (
        <section className="tarjeta">
          <h2>Revisa y envía</h2>
          <table><tbody>
            <tr><th>Tipo</th><td>{tipo === "conducta" ? "Conducción de riesgo" : "Punto peligroso de infraestructura"}</td></tr>
            <tr><th>Categoría</th><td>{categorias.find((c: any) => c.codigo === categoria)?.nombre}</td></tr>
            <tr><th>Ubicación</th><td>{punto?.[0].toFixed(5)}, {punto?.[1].toFixed(5)}</td></tr>
            <tr><th>Descripción</th><td>{descripcion}</td></tr>
            {tipo === "conducta" && <tr><th>Placa</th><td>{placa || "No indicada"}</td></tr>}
            <tr><th>Fotos</th><td>{fotos.length || "Ninguna"}</td></tr>
          </tbody></table>
          {tipo === "conducta" && (
            <label className="casilla" style={{ margin: "1rem 0" }}>
              <input type="checkbox" checked={aviso} onChange={(e) => setAviso(e.target.checked)} />
              <span>Entiendo que este reporte es <strong>informativo</strong>: no es una denuncia formal ni genera un comparendo. La Secretaría de Movilidad lo usará para orientar sus acciones de control.</span>
            </label>
          )}
          <div className="acciones" style={{ justifyContent: "space-between", marginTop: "0.75rem" }}>
            <button className="secundario" onClick={() => setPaso(2)}>Atrás</button>
            <button onClick={enviar} disabled={enviando || (tipo === "conducta" && !aviso)}>{enviando ? "Enviando…" : "Enviar reporte"}</button>
          </div>
        </section>
      )}
    </div>
  );
}
