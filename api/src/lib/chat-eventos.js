// Tiempo real del chat con Server-Sent Events (SSE).
// Un solo proceso de Node atiende la app (docker-compose.prod.yml), así que basta un emisor en memoria.
import { EventEmitter } from "node:events";

const bus = new EventEmitter();
bus.setMaxListeners(0);

/** Publica un evento para el visitante de la conversación y para el equipo (que puede recibir más detalle). */
export function publicar(conversacionId, tipo, datos, datosEquipo = datos) {
  bus.emit(`conv:${conversacionId}`, { tipo, datos });
  bus.emit("equipo", { tipo, datos: { conversacion_id: conversacionId, ...datosEquipo } });
}

/**
 * Abre un flujo SSE en `res` y lo suscribe a un canal ("equipo" o "conv:<id>").
 * X-Accel-Buffering: no evita que Nginx (aaPanel) acumule los eventos.
 */
export function abrirFlujo(req, res, canal) {
  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write("retry: 3000\n\n");
  const enviar = (evento) => res.write(`event: ${evento.tipo}\ndata: ${JSON.stringify(evento.datos)}\n\n`);
  bus.on(canal, enviar);
  // Comentario cada 20 s para que ni Nginx ni el navegador cierren la conexión por inactividad
  const latido = setInterval(() => res.write(": latido\n\n"), 20000);
  req.on("close", () => {
    clearInterval(latido);
    bus.off(canal, enviar);
  });
}
