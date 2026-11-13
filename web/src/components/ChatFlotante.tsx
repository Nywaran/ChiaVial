// Burbuja de chat (abajo a la derecha) en todas las páginas: cualquier persona, con o sin cuenta,
// escribe al equipo de ChíaVial. El mensaje llega a Telegram y la respuesta aparece aquí en tiempo real.
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api";
import { escucharEventos } from "../lib/eventos";

type Mensaje = { id: number; autor: "visitante" | "equipo" | "sistema"; texto: string; creado_en: string; quien: string | null };
type Conversacion = { id: number; estado: "abierta" | "cerrada" };

const CLAVE = "chiavial_chat";
const leerToken = () => { try { return localStorage.getItem(CLAVE); } catch { return null; } };
const guardarToken = (t: string | null) => {
  try { if (t) localStorage.setItem(CLAVE, t); else localStorage.removeItem(CLAVE); } catch { /* almacenamiento no disponible */ }
};
const hora = (f: string) => new Date(f).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });

function IconoChat() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z" />
      <path d="M8.5 11h7M8.5 14h4.5" />
    </svg>
  );
}

export default function ChatFlotante() {
  const loc = useLocation();
  const [abierto, setAbierto] = useState(false);
  const [token, setToken] = useState<string | null>(() => leerToken());
  const [conv, setConv] = useState<Conversacion | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState("");
  const [nombre, setNombre] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noLeidos, setNoLeidos] = useState(0);
  const lista = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const abiertoRef = useRef(abierto);
  abiertoRef.current = abierto;

  const agregar = (m: Mensaje) => setMensajes((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));

  // Recupera la conversación guardada en este navegador
  useEffect(() => {
    if (!token) return;
    api.get("/chat/conversacion", { "X-Chat-Token": token })
      .then((r) => { setConv(r.conversacion); setMensajes(r.mensajes); })
      .catch(() => { guardarToken(null); setToken(null); });
  }, [token]);

  // Tiempo real: respuestas del equipo y cambios de estado
  useEffect(() => {
    if (!token) return;
    return escucharEventos("/chat/eventos", (e) => {
      if (e.tipo === "mensaje") {
        agregar(e.datos.mensaje);
        if (e.datos.mensaje.autor === "equipo" && !abiertoRef.current) setNoLeidos((n) => n + 1);
      } else if (e.tipo === "conversacion") {
        setConv((c) => (c ? { ...c, estado: e.datos.estado } : c));
      }
    }, { cabeceras: { "X-Chat-Token": token } });
  }, [token]);

  useEffect(() => { if (abierto) { setNoLeidos(0); setTimeout(() => campo.current?.focus(), 50); } }, [abierto]);
  useEffect(() => { lista.current?.scrollTo({ top: lista.current.scrollHeight }); }, [mensajes, abierto]);

  if (loc.pathname.startsWith("/atencion")) return null; // el equipo atiende desde su propia página

  async function enviar(e?: FormEvent) {
    e?.preventDefault();
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      if (!token) {
        const r = await api.post("/chat/conversaciones", { texto: t, nombre: nombre.trim() || undefined, pagina: loc.pathname });
        guardarToken(r.token);
        setConv(r.conversacion);
        setMensajes(r.mensajes);
        setToken(r.token);
      } else {
        const r = await api.post("/chat/mensajes", { texto: t }, { "X-Chat-Token": token });
        agregar(r.mensaje);
        setConv((c) => (c ? { ...c, estado: "abierta" } : c));
      }
      setTexto("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  function alTeclear(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); }
    if (e.key === "Escape") setAbierto(false);
  }

  function nuevaConversacion() {
    guardarToken(null);
    setToken(null);
    setConv(null);
    setMensajes([]);
  }

  return (
    <div className="chat-flotante">
      {abierto && (
        <section className="chat-panel" role="dialog" aria-label="Chat con el equipo de ChíaVial" onKeyDown={(e) => e.key === "Escape" && setAbierto(false)}>
          <header className="chat-cabeza">
            <div>
              <strong>Escríbenos</strong>
              <span>Equipo ChíaVial</span>
            </div>
            <button type="button" className="chat-cerrar" onClick={() => setAbierto(false)} aria-label="Cerrar chat">×</button>
          </header>
          <div className="chat-mensajes" ref={lista} aria-live="polite">
            <p className="chat-intro">
              Escribe tu pregunta y el equipo te responderá aquí mismo. Para reportar un incidente usa <Link to="/reportar" onClick={() => setAbierto(false)}>Reportar</Link>. No compartas datos sensibles.
            </p>
            {mensajes.map((m) => (
              <div key={m.id} className={`chat-msj ${m.autor === "visitante" ? "propio" : "equipo"}`}>
                {m.autor === "equipo" && <span className="chat-quien">{m.quien} · ChíaVial</span>}
                <p>{m.texto}</p>
                <time dateTime={m.creado_en}>{hora(m.creado_en)}</time>
              </div>
            ))}
            {conv && mensajes.length > 0 && !mensajes.some((m) => m.autor === "equipo") && (
              <p className="chat-nota">Mensaje recibido. Te responderemos en este chat; puedes seguir navegando.</p>
            )}
            {conv?.estado === "cerrada" && (
              <p className="chat-nota">
                El equipo cerró esta conversación. Si escribes de nuevo se reabre, o puedes{" "}
                <button type="button" className="enlace" onClick={nuevaConversacion}>iniciar una nueva</button>.
              </p>
            )}
          </div>
          <form className="chat-form" onSubmit={enviar}>
            {!token && (
              <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Tu nombre (opcional)" maxLength={60} aria-label="Tu nombre (opcional)" />
            )}
            {error && <p className="chat-error" role="alert">{error}</p>}
            <div className="chat-fila">
              <textarea ref={campo} value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={alTeclear}
                placeholder="Escribe un mensaje…" rows={2} maxLength={1000} aria-label="Mensaje" />
              <button type="submit" disabled={enviando || !texto.trim()} aria-label="Enviar mensaje">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
              </button>
            </div>
          </form>
        </section>
      )}
      <button type="button" className="chat-boton" onClick={() => setAbierto((a) => !a)} aria-expanded={abierto}
        aria-label={abierto ? "Cerrar chat" : noLeidos ? `Abrir chat (${noLeidos} respuestas nuevas)` : "Abrir chat con el equipo de ChíaVial"}>
        {abierto ? <span className="chat-x" aria-hidden="true">×</span> : <IconoChat />}
        {noLeidos > 0 && !abierto && <span className="chat-insignia" aria-hidden="true">{noLeidos}</span>}
      </button>
    </div>
  );
}
