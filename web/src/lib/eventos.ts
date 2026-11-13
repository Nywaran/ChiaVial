// Cliente de Server-Sent Events con fetch (permite enviar cabeceras, a diferencia de EventSource)
// y reconexión automática. Devuelve una función para cerrar la conexión.
export type EventoSSE = { tipo: string; datos: any };

export function escucharEventos(
  ruta: string,
  alRecibir: (e: EventoSSE) => void,
  { cabeceras = {}, alCambiarEstado }: { cabeceras?: Record<string, string>; alCambiarEstado?: (conectado: boolean) => void } = {}
): () => void {
  let cerrado = false;
  let control = new AbortController();
  let espera = 1000;

  async function conectar() {
    while (!cerrado) {
      try {
        control = new AbortController();
        const r = await fetch(`/api${ruta}`, { headers: { Accept: "text/event-stream", ...cabeceras }, credentials: "same-origin", signal: control.signal });
        if (!r.ok || !r.body) throw new Error(String(r.status));
        alCambiarEstado?.(true);
        espera = 1000;
        const lector = r.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        for (;;) {
          const { value, done } = await lector.read();
          if (done) break;
          buf += value;
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const bloque = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const tipo = /^event: (.+)$/m.exec(bloque)?.[1];
            const datos = /^data: (.+)$/m.exec(bloque)?.[1];
            if (tipo && datos) {
              try { alRecibir({ tipo, datos: JSON.parse(datos) }); } catch { /* evento mal formado */ }
            }
          }
        }
      } catch {
        /* se reintenta abajo */
      }
      if (cerrado) break;
      alCambiarEstado?.(false);
      await new Promise((r) => setTimeout(r, espera));
      espera = Math.min(espera * 2, 15000);
    }
  }
  conectar();
  return () => {
    cerrado = true;
    control.abort();
  };
}
