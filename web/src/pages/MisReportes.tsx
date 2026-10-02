// RF-M01-05 y RF-M04-03: el ciudadano sigue sus reportes
import { Link } from "react-router-dom";
import { useDatos, Estado, Mensaje } from "../components/Comunes";
import { fmtFechaHora, NOMBRE_ESTADO } from "../api";

export default function MisReportes() {
  const { datos, error, cargando } = useDatos<any[]>("/reportes/mios");
  return (
    <div className="pila" style={{ maxWidth: 900 }}>
      <div className="encabezado">
        <h1>Mis reportes</h1>
        <Link className="boton" to="/reportar">Nuevo reporte</Link>
      </div>
      <Mensaje error={error} />
      {cargando && <p className="cargando">Cargando…</p>}
      {datos && !datos.length && <div className="tarjeta vacio">Aún no has hecho reportes. <Link to="/reportar">Haz el primero</Link>.</div>}
      {datos?.map((r) => (
        <article key={r.id} className="tarjeta">
          <div className="encabezado" style={{ marginBottom: "0.4rem" }}>
            <div>
              <h2 style={{ marginBottom: 0 }}>#{r.id} · {r.categoria_nombre}</h2>
              <span className="muy-tenue">{r.tipo === "conducta" ? "Conducción de riesgo" : "Infraestructura"} · enviado el {fmtFechaHora(r.creado_en)}</span>
            </div>
            <Estado e={r.estado} />
          </div>
          <p>{r.descripcion}</p>
          <details>
            <summary>Historial del reporte</summary>
            <ol style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
              {r.historial?.map((h: any, i: number) => (
                <li key={i}><strong>{NOMBRE_ESTADO[h.estado] || h.estado}</strong> · {fmtFechaHora(h.fecha)}{h.comentario && <> · <em>{h.comentario}</em></>}</li>
              ))}
            </ol>
          </details>
        </article>
      ))}
    </div>
  );
}
