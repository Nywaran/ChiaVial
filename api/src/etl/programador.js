// RF-GEN-07: ingesta programada (por defecto cada 7 días; INGESTA_CADA_HORAS=0 la desactiva)
import { ingestarTodo } from "./ingesta.js";
import { q } from "../db.js";

export function programarIngesta() {
  const horas = Number(process.env.INGESTA_CADA_HORAS ?? 168);
  if (!horas) return;
  const ejecutar = async () => {
    try {
      const { rows } = await q(`SELECT max(iniciada_en) AS ultima FROM ingestas`);
      const ultima = rows[0].ultima ? new Date(rows[0].ultima).getTime() : 0;
      if (Date.now() - ultima < horas * 3600 * 1000) return;
      console.log("[ingesta] ejecución programada");
      const r = await ingestarTodo();
      console.log("[ingesta]", r.resultados.map((x) => `${x.conjunto}: ${x.estado}`).join(" · "));
    } catch (e) {
      console.error("[ingesta]", e.message);
    }
  };
  setTimeout(ejecutar, 5000);
  setInterval(ejecutar, 60 * 60 * 1000).unref();
}
