// RF-GEN-01, 02, 03 y RNF-SEG-10
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, NOMBRE_ROL } from "../api";
import { Campo, Mensaje } from "../components/Comunes";
import { useSesion } from "../sesion";

const Caja = ({ titulo, children }: { titulo: string; children: React.ReactNode }) => (
  <div className="tarjeta" style={{ maxWidth: 460, margin: "1rem auto" }}><h1>{titulo}</h1>{children}</div>
);

export function Ingresar() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const { recargar } = useSesion();
  const navegar = useNavigate();
  const [params] = useSearchParams();
  async function enviar(e: FormEvent) {
    e.preventDefault(); setError(null); setEnviando(true);
    try {
      const u = await api.post("/auth/login", { email, password });
      await recargar();
      navegar(params.get("volver") || (u.rol === "ciudadano" ? "/mis-reportes" : u.rol === "admin" ? "/admin" : "/panel"));
    } catch (er: any) { setError(er.message); } finally { setEnviando(false); }
  }
  return (
    <Caja titulo="Ingresar">
      <Mensaje error={error} />
      <form onSubmit={enviar} noValidate>
        <Campo id="email" etiqueta="Correo electrónico"><input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Campo>
        <Campo id="pass" etiqueta="Contraseña"><input id="pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Campo>
        <button type="submit" disabled={enviando} style={{ width: "100%" }}>{enviando ? "Ingresando…" : "Ingresar"}</button>
      </form>
      <p style={{ marginTop: "1rem" }}><Link to="/olvide">Olvidé mi contraseña</Link> · <Link to="/registro">Crear una cuenta</Link></p>
    </Caja>
  );
}

export function Registro() {
  const [f, setF] = useState({ nombre: "", email: "", password: "", acepta_politica: false });
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  async function enviar(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (f.password.length < 8) return setError("La contraseña debe tener al menos 8 caracteres.");
    if (!f.acepta_politica) return setError("Debes aceptar la política de tratamiento de datos.");
    setEnviando(true);
    try { setOk((await api.post("/auth/registro", f)).mensaje); } catch (er: any) { setError(er.message); } finally { setEnviando(false); }
  }
  if (ok) return <Caja titulo="Revisa tu correo"><Mensaje ok={ok} /><p>Abre el enlace que te enviamos para activar tu cuenta y luego <Link to="/ingresar">ingresa</Link>.</p></Caja>;
  return (
    <Caja titulo="Crear una cuenta">
      <p className="tenue">Con tu cuenta puedes reportar conductas de riesgo y puntos peligrosos, y seguir su estado.</p>
      <Mensaje error={error} />
      <form onSubmit={enviar} noValidate>
        <Campo id="nombre" etiqueta="Nombre"><input id="nombre" autoComplete="name" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Campo>
        <Campo id="email" etiqueta="Correo electrónico"><input id="email" type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Campo>
        <Campo id="pass" etiqueta="Contraseña" ayuda="Mínimo 8 caracteres."><input id="pass" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} aria-describedby="pass-ayuda" /></Campo>
        <label className="casilla" style={{ marginBottom: "1rem" }}>
          <input type="checkbox" checked={f.acepta_politica} onChange={(e) => setF({ ...f, acepta_politica: e.target.checked })} />
          <span>Autorizo el tratamiento de mis datos personales (nombre y correo) según la <Link to="/politica-de-datos" target="_blank">política de tratamiento de datos</Link> y la Ley 1581 de 2012.</span>
        </label>
        <button type="submit" disabled={enviando} style={{ width: "100%" }}>{enviando ? "Creando…" : "Crear cuenta"}</button>
      </form>
      <p style={{ marginTop: "1rem" }}>¿Ya tienes cuenta? <Link to="/ingresar">Ingresa</Link></p>
    </Caja>
  );
}

export function Verificar() {
  const [params] = useSearchParams();
  const [estado, setEstado] = useState<{ ok?: string; error?: string }>({});
  useEffect(() => {
    api.post("/auth/verificar", { token: params.get("token") }).then((r) => setEstado({ ok: r.mensaje })).catch((e) => setEstado({ error: e.message }));
  }, [params]);
  return <Caja titulo="Activar cuenta"><Mensaje ok={estado.ok} error={estado.error} />{estado.ok && <Link className="boton" to="/ingresar">Ingresar</Link>}</Caja>;
}

export function Olvide() {
  const [email, setEmail] = useState("");
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function enviar(e: FormEvent) {
    e.preventDefault();
    try { setOk((await api.post("/auth/olvide", { email })).mensaje); } catch (er: any) { setError(er.message); }
  }
  return (
    <Caja titulo="Restablecer contraseña">
      <Mensaje ok={ok} error={error} />
      {!ok && <form onSubmit={enviar}>
        <Campo id="email" etiqueta="Correo electrónico"><input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Campo>
        <button type="submit">Enviar enlace</button>
      </form>}
    </Caja>
  );
}

export function Restablecer() {
  const [params] = useSearchParams();
  const [password, setPassword] = useState("");
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function enviar(e: FormEvent) {
    e.preventDefault(); setError(null);
    try { setOk((await api.post("/auth/restablecer", { token: params.get("token"), password })).mensaje); } catch (er: any) { setError(er.message); }
  }
  return (
    <Caja titulo="Nueva contraseña">
      <Mensaje ok={ok} error={error} />
      {ok ? <Link className="boton" to="/ingresar">Ingresar</Link> : (
        <form onSubmit={enviar}>
          <Campo id="pass" etiqueta="Nueva contraseña" ayuda="Mínimo 8 caracteres."><input id="pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Campo>
          <button type="submit">Guardar</button>
        </form>
      )}
    </Caja>
  );
}

export function Cuenta() {
  const { usuario, recargar } = useSesion();
  const navegar = useNavigate();
  const [nombre, setNombre] = useState(usuario?.nombre || "");
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [confirmar, setConfirmar] = useState(false);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    try { await api.patch("/auth/cuenta", { nombre }); await recargar(); setMsg({ ok: "Datos actualizados." }); } catch (er: any) { setMsg({ error: er.message }); }
  }
  async function eliminar() {
    try { await api.del("/auth/cuenta"); await recargar(); navegar("/"); } catch (er: any) { setMsg({ error: er.message }); }
  }
  return (
    <Caja titulo="Mi cuenta">
      <p className="tenue">{usuario?.email} · {NOMBRE_ROL[usuario?.rol || "ciudadano"]}{usuario?.entidad ? ` · ${usuario.entidad}` : ""}</p>
      <Mensaje ok={msg.ok} error={msg.error} />
      <form onSubmit={guardar}>
        <Campo id="nombre" etiqueta="Nombre"><input id="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} /></Campo>
        <button type="submit">Guardar</button>
      </form>
      <hr style={{ margin: "1.5rem 0", border: 0, borderTop: "1px solid var(--borde)" }} />
      <Telegram />
      <hr style={{ margin: "1.5rem 0", border: 0, borderTop: "1px solid var(--borde)" }} />
      <h2>Eliminar mi cuenta</h2>
      <p className="tenue">Se borrarán tus datos personales. Tus reportes se conservan de forma anónima, sin placa ni autor.</p>
      {!confirmar ? <button className="peligro" onClick={() => setConfirmar(true)}>Eliminar mi cuenta</button> : (
        <div className="acciones"><span>¿Seguro? Esta acción no se puede deshacer.</span><button className="peligro" onClick={eliminar}>Sí, eliminar</button><button className="secundario" onClick={() => setConfirmar(false)}>Cancelar</button></div>
      )}
    </Caja>
  );
}

type EstadoTelegram = { disponible: boolean; bot: string | null; vinculado: boolean; vinculado_en: string | null; notif_telegram: boolean };

/** Vincula la cuenta con el bot de Telegram para recibir notificaciones. */
function Telegram() {
  const { usuario } = useSesion();
  const [est, setEst] = useState<EstadoTelegram | null>(null);
  const [enlace, setEnlace] = useState<{ enlace: string | null; codigo: string } | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const cargar = () => api.get<EstadoTelegram>("/telegram/estado").then(setEst).catch(() => {});
  useEffect(() => { cargar(); }, []);
  // Mientras hay un enlace pendiente, revisa cada 4 s si ya se vinculó
  useEffect(() => {
    if (!enlace || est?.vinculado) return;
    const t = setInterval(cargar, 4000);
    return () => clearInterval(t);
  }, [enlace, est?.vinculado]);
  useEffect(() => { if (est?.vinculado) setEnlace(null); }, [est?.vinculado]);

  if (!est) return null;
  const que = usuario?.rol === "ciudadano" ? "cuando cambie el estado de tus reportes" : "cuando lleguen reportes nuevos o se te asignen";
  async function generar() {
    setMsg({});
    try { setEnlace(await api.post("/telegram/vincular")); } catch (e: any) { setMsg({ error: e.message }); }
  }
  async function quitar() {
    try { await api.del("/telegram/vincular"); await cargar(); setMsg({ ok: "Telegram desvinculado." }); } catch (e: any) { setMsg({ error: e.message }); }
  }
  async function preferir(v: boolean) {
    try { await api.patch("/telegram/preferencias", { notif_telegram: v }); await cargar(); } catch (e: any) { setMsg({ error: e.message }); }
  }
  return (
    <section aria-labelledby="tg-titulo">
      <h2 id="tg-titulo">Notificaciones por Telegram</h2>
      <Mensaje ok={msg.ok} error={msg.error} />
      {!est.disponible && !est.vinculado ? (
        <p className="tenue">Este servidor aún no tiene configurado el bot de Telegram.</p>
      ) : est.vinculado ? (
        <>
          <p>✅ Tu cuenta está vinculada. Te avisaremos {que}.</p>
          <label style={{ display: "flex", gap: ".5rem", alignItems: "center", margin: ".5rem 0" }}>
            <input type="checkbox" checked={est.notif_telegram} onChange={(e) => preferir(e.target.checked)} style={{ width: "auto" }} />
            Recibir notificaciones por Telegram
          </label>
          <button className="secundario" onClick={quitar}>Desvincular Telegram</button>
        </>
      ) : enlace ? (
        <>
          <p>Abre el bot y pulsa <strong>Iniciar</strong>. El enlace vence en 15 minutos.</p>
          {enlace.enlace ? (
            <a className="boton" href={enlace.enlace} target="_blank" rel="noopener noreferrer">Abrir @{est.bot} en Telegram</a>
          ) : (
            <p>Envía al bot este mensaje: <code>/start {enlace.codigo}</code></p>
          )}
          <p className="muy-tenue" aria-live="polite">Esperando la confirmación de Telegram…</p>
        </>
      ) : (
        <>
          <p className="tenue">Recibe un mensaje en Telegram {que}. Guardamos tu identificador de chat cifrado.</p>
          <button onClick={generar}>Vincular Telegram</button>
        </>
      )}
    </section>
  );
}
