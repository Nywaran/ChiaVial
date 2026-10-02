import { Link } from "react-router-dom";
import { useDatos, Kpi } from "../components/Comunes";
import { fmtFecha, nf } from "../api";
import { useSesion } from "../sesion";

const MODULOS = [
  { id: "M07", t: "Observatorio y mapa de calor", d: "Dónde y cuándo ocurren los siniestros con herido o con muerto en Chía.", a: "/observatorio" },
  { id: "M10", t: "Analítica de comparendos", d: "Las infracciones más frecuentes y la evolución de las conductas de riesgo.", a: "/comparendos" },
  { id: "M01", t: "Reportar conducción de riesgo", d: "Informa exceso de velocidad, uso del celular o semáforos en rojo.", a: "/reportar?tipo=conducta" },
  { id: "M04", t: "Reportar un punto peligroso", d: "Falta de paso peatonal, señales dañadas, mala iluminación o vías en mal estado.", a: "/reportar?tipo=infraestructura" },
];

export default function Inicio() {
  const { usuario } = useSesion();
  const { datos: s } = useDatos<any>("/observatorio/resumen");
  const { datos: c } = useDatos<any>("/comparendos/resumen");
  const { datos: meta } = useDatos<any>("/observatorio/meta");
  return (
    <div className="pila">
      <section className="hero">
        <h1>Seguridad vial en Chía, con datos abiertos y participación ciudadana</h1>
        <p>ChíaVial reúne las cifras oficiales de siniestros y comparendos del municipio y te permite reportar conductas de riesgo y puntos peligrosos para que la Secretaría de Movilidad actúe.</p>
        <div className="acciones">
          <Link className="boton" to="/observatorio">Ver el observatorio</Link>
          {(!usuario || usuario.rol === "ciudadano") && <Link className="boton sec" to="/reportar">Hacer un reporte</Link>}
        </div>
      </section>

      <section aria-labelledby="cifras">
        <h2 id="cifras">Cifras clave</h2>
        <div className="rejilla r4">
          <Kpi etiqueta="Siniestros con víctimas" valor={s?.total} detalle={meta?.desde ? `${fmtFecha(meta.desde)} a ${fmtFecha(meta.hasta)}` : undefined} />
          <Kpi etiqueta="Siniestros con muerto" valor={s?.con_muerto} color="var(--serie-2)" />
          <Kpi etiqueta="Siniestros con herido" valor={s?.con_herido} color="var(--serie-1)" />
          <Kpi etiqueta="Comparendos impuestos" valor={c?.total} detalle={c ? `${nf.format(c.porcentaje_riesgo)} % por conductas de riesgo` : undefined} />
        </div>
      </section>

      <section aria-labelledby="modulos">
        <h2 id="modulos">¿Qué puedes hacer?</h2>
        <div className="rejilla r4">
          {MODULOS.map((m) => (
            <Link key={m.id} to={m.a} className="tarjeta modulo">
              <div className="id">{m.id}</div>
              <h3>{m.t}</h3>
              <p className="tenue" style={{ margin: 0 }}>{m.d}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="tarjeta">
        <h2>Fuentes de datos</h2>
        <ul style={{ margin: "0.25rem 0 0.5rem", paddingLeft: "1.2rem" }}>
          {meta?.fuentes?.map((f: any) => (
            <li key={f.id}><a href={f.url} target="_blank" rel="noreferrer">{f.nombre}</a> · {f.fuente}{f.licencia ? ` · ${f.licencia}` : ""}{f.actualizado_en ? ` · cargado el ${fmtFecha(f.actualizado_en)}` : ""}</li>
          ))}
        </ul>
        <p className="muy-tenue" style={{ margin: 0 }}>Los reportes ciudadanos son informativos: no son denuncias y no generan comparendos.</p>
      </section>
    </div>
  );
}
