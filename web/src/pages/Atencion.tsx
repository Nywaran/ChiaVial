// Atención del chat para funcionarios y administradores: lista de conversaciones y respuesta en tiempo real.
// El enlace que llega a Telegram abre /atencion/:id.
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, fmtFechaHora } from "../api";
import { escucharEventos } from "../lib/eventos";
import { Mensaje as Aviso } from "../components/Comunes";

type Mensaje = { id: number; autor: "visitante" | "equipo" | "sistema"; texto: string; creado_en: string; quien: string | null };
type Resumen = {
  id: number; estado: "abierta" | "cerrada"; pagina: string | null; nombre: string | null; usuario: string | null;
  actualizado_en: string; total: number; sin_responder: boolean; ultimo: { autor: string; texto: string; creado_en: string } | null;
};
type Detalle = Omit<Resumen, "total" | "sin_responder" | "ultimo"> & { creado_en: string; usuario_rol: string | null; atendida_por: string | null };

const quienEs = (c: { nombre: string | null; usuario: string | null }) => c.nombre || c.usuario || "Visitante anónimo";
const hora = (f: string) => new Date(f).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default function Atencion() {
  const { id } = useParams();
  const sel = id ? Number(id) : null;
  const navegar = useNavigate();
  const [filtro, setFiltro] = useState<"abierta" | "cerrada" | "">("abierta");
  const [lista, setLista] = useState<Resumen[]>([]);
  const [abiertas, setAbiertas] = useState(0);
  const [conv, setConv] = useState<Detalle | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enVivo, setEnVivo] = useState(false);
  const selRef = useRef(sel);
  selRef.current = sel;
  const caja = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);

  const cargarLista = useCallback(() => {
    api.get(`/chat/equipo/conversaciones${filtro ? `?estado=${filtro}` : ""}`)
      .then((r) => { setLista(r.conversaciones); setAbiertas(r.abiertas); })
      .catch(() => {});
  }, [filtro]);
  useEffect(() => { cargarLista(); }, [cargarLista]);

  useEffect(() => {
    setConv(null); setMensajes([]); setError(null);
    if (!sel) return;
    api.get(`/chat/equipo/conversaciones/${sel}`)
      .then((r) => { setConv(r.conversacion); setMensajes(r.mensajes); setTimeout(() => campo.current?.focus(), 50); })
      .catch((e) => setError(e.message));
  }, [sel]);

  // Tiempo real: mensajes nuevos de cualquier conversación
  useEffect(() => {
    let pendiente: ReturnType<typeof setTimeout> | undefined;
    const cerrar = escucharEventos("/chat/equipo/eventos", (e) => {
      if (e.datos.conversacion_id === selRef.current) {
        if (e.tipo === "mensaje") setMensajes((p) => (p.some((m) => m.id === e.datos.mensaje.id) ? p : [...p, e.datos.mensaje]));
        if (e.tipo === "conversacion") setConv((c) => (c ? { ...c, estado: e.datos.estado } : c));
      }
      clearTimeout(pendiente);
      pendiente = setTimeout(cargarLista, 300);
    }, { alCambiarEstado: setEnVivo });
    return () => { clearTimeout(pendiente); cerrar(); };
  }, [cargarLista]);

  useEffect(() => { caja.current?.scrollTo({ top: caja.current.scrollHeight }); }, [mensajes]);
  useEffect(() => { document.title = abiertas ? `(${abiertas}) Atención · ChíaVial` : "Atención · ChíaVial"; return () => { document.title = "ChíaVial"; }; }, [abiertas]);

  async function responder(e?: FormEvent) {
    e?.preventDefault();
    const t = texto.trim();
    if (!t || !sel || enviando) return;
    setEnviando(true); setError(null);
    try {
      const r = await api.post(`/chat/equipo/conversaciones/${sel}/mensajes`, { texto: t });
      setMensajes((p) => (p.some((m) => m.id === r.mensaje.id) ? p : [...p, r.mensaje]));
      setConv((c) => (c ? { ...c, estado: "abierta" } : c));
      setTexto("");
    } catch (err: any) { setError(err.message); } finally { setEnviando(false); }
  }
  function alTeclear(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); responder(); }
  }
  async function cambiarEstado(estado: "abierta" | "cerrada") {
    if (!sel) return;
    try { await api.patch(`/chat/equipo/conversaciones/${sel}`, { estado }); setConv((c) => (c ? { ...c, estado } : c)); cargarLista(); }
    catch (err: any) { setError(err.message); }
  }

  return (
    <div className="pila">
      <div className="atencion-titulo">
        <div>
          <h1>Atención por chat</h1>
          <p className="tenue">Mensajes que escriben los visitantes desde la burbuja de chat. Cada uno avisa al grupo de Telegram con un enlace a esta página.</p>
        </div>
        <span className={`en-vivo ${enVivo ? "si" : ""}`}>{enVivo ? "En vivo" : "Reconectando…"}</span>
      </div>
      <div className={`atencion ${sel ? "con-seleccion" : ""}`}>
        <aside className="atencion-lista tarjeta" aria-label="Conversaciones">
          <div className="segmentos" role="tablist" aria-label="Filtrar conversaciones">
            {([["abierta", `Abiertas (${abiertas})`], ["cerrada", "Cerradas"], ["", "Todas"]] as const).map(([v, t]) => (
              <button key={v} role="tab" aria-selected={filtro === v} className={filtro === v ? "activo" : ""} onClick={() => setFiltro(v)}>{t}</button>
            ))}
          </div>
          {!lista.length && <p className="tenue" style={{ padding: "1rem" }}>No hay conversaciones {filtro === "abierta" ? "abiertas" : filtro === "cerrada" ? "cerradas" : ""}.</p>}
          <ul>
            {lista.map((c) => (
              <li key={c.id}>
                <Link to={`/atencion/${c.id}`} className={c.id === sel ? "activa" : ""} aria-current={c.id === sel ? "page" : undefined}>
                  <span className="fila-1">
                    <strong>{quienEs(c)}</strong>
                    <time dateTime={c.actualizado_en}>{hora(c.actualizado_en)}</time>
                  </span>
                  <span className="fila-2">
                    {c.sin_responder && c.estado === "abierta" && <span className="punto" aria-label="Sin responder" />}
                    <span className="vista-previa">{c.ultimo ? `${c.ultimo.autor === "equipo" ? "Tú/equipo: " : ""}${c.ultimo.texto}` : "—"}</span>
                  </span>
                  <span className="muy-tenue">#{c.id}{c.pagina ? ` · ${c.pagina}` : ""}{c.estado === "cerrada" ? " · cerrada" : ""}</span>
                </Link>
              </li>
            ))}
          </ul>
        </aside>

        <section className="atencion-chat tarjeta" aria-label="Conversación">
          {!sel ? (
            <p className="tenue atencion-vacio">Elige una conversación de la lista.</p>
          ) : !conv ? (
            error ? <Aviso error={error} /> : <p className="tenue atencion-vacio">Cargando…</p>
          ) : (
            <>
              <header className="atencion-cabeza">
                <button type="button" className="secundario volver-lista" onClick={() => navegar("/atencion")}>← Conversaciones</button>
                <div>
                  <h2>{quienEs(conv)} <span className="muy-tenue">#{conv.id}</span></h2>
                  <p className="muy-tenue">
                    {conv.usuario ? `Usuario registrado (${conv.usuario_rol})` : "Sin cuenta"} · iniciada {fmtFechaHora(conv.creado_en)}
                    {conv.pagina && <> · desde <code>{conv.pagina}</code></>}
                    {conv.atendida_por && <> · atiende {conv.atendida_por}</>}
                  </p>
                </div>
                {conv.estado === "abierta"
                  ? <button type="button" className="secundario" onClick={() => cambiarEstado("cerrada")}>Cerrar conversación</button>
                  : <button type="button" className="secundario" onClick={() => cambiarEstado("abierta")}>Reabrir</button>}
              </header>
              <div className="atencion-mensajes" ref={caja} aria-live="polite">
                {mensajes.map((m) => (
                  <div key={m.id} className={`chat-msj ${m.autor === "equipo" ? "propio" : "equipo"}`}>
                    <span className="chat-quien">{m.autor === "equipo" ? m.quien : quienEs(conv)}</span>
                    <p>{m.texto}</p>
                    <time dateTime={m.creado_en}>{hora(m.creado_en)}</time>
                  </div>
                ))}
              </div>
              {conv.estado === "cerrada" && <p className="chat-nota" style={{ margin: "0 1rem" }}>Conversación cerrada. Si respondes, se reabre.</p>}
              <form className="chat-form" onSubmit={responder}>
                {error && <p className="chat-error" role="alert">{error}</p>}
                <div className="chat-fila">
                  <textarea ref={campo} value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={alTeclear}
                    placeholder="Escribe la respuesta… (Enter envía, Mayús+Enter salta de línea)" rows={2} maxLength={1000} aria-label="Respuesta" />
                  <button type="submit" disabled={enviando || !texto.trim()}>Enviar</button>
                </div>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
