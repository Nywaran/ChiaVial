// Carga datos de DEMOSTRACIÓN (ficticios) para ver el tablero con movimiento.
//   npm run demo            → crea usuarios @demo.chiavial.local y ~80 reportes en las últimas 12 semanas
//   npm run demo -- --borrar → elimina todo lo creado por este script
// El tablero muestra un aviso mientras existan estos datos. No ejecutar en producción real.
import bcrypt from "bcryptjs";
import { q, pool, migrar, transaccion } from "../db.js";
import { cifrar } from "../lib/cifrado.js";

const DOMINIO = "@demo.chiavial.local";
const borrar = process.argv.includes("--borrar");

// Generador pseudoaleatorio con semilla: los mismos datos en cada ejecución
let semilla = 20261104;
const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const elegir = (a) => a[Math.floor(azar() * a.length)];

async function eliminar() {
  const r = await q(`DELETE FROM reportes WHERE autor_id IN (SELECT id FROM usuarios WHERE email LIKE $1)`, [`%${DOMINIO}`]);
  const u = await q(`DELETE FROM usuarios WHERE email LIKE $1`, [`%${DOMINIO}`]);
  console.log(`Eliminados ${r.rowCount} reportes y ${u.rowCount} usuarios de demostración.`);
}

await migrar();
if (borrar) {
  await eliminar();
} else {
  await eliminar();
  const hash = await bcrypt.hash("Demo12345", 12);
  const crear = async (nombre, email, rol) =>
    (await q(`INSERT INTO usuarios (nombre, email, password_hash, rol, email_verificado) VALUES ($1,$2,$3,$4,TRUE) RETURNING id`,
      [nombre, email + DOMINIO, hash, rol])).rows[0].id;
  const func = await crear("Funcionaria Demo", "funcionaria", "funcionario");
  const ciudadanos = [];
  for (const n of ["Laura", "Andrés", "Camila", "Julián", "Sofía", "Mateo"]) ciudadanos.push(await crear(`${n} (demo)`, n.toLowerCase().normalize("NFD").replace(/[^a-z]/g, ""), "ciudadano"));

  const cats = (await q(`SELECT tipo, codigo FROM catalogos WHERE tipo IN ('conducta','infraestructura')`)).rows;
  const veredas = (await q(`SELECT nombre FROM veredas`)).rows.map((v) => v.nombre);
  const FLUJO = {
    conducta: [["EN_REVISION", 0.75], ["ATENDIDO", 0.6]],
    infraestructura: [["VERIFICADO", 0.8], ["EN_GESTION", 0.7], ["RESUELTO", 0.55]],
  };
  const DESCRIP = {
    conducta: ["Vehículo a exceso de velocidad frente al colegio", "Moto adelantando por la berma", "Carro estacionado sobre el andén", "Conductor usando el celular en el semáforo"],
    infraestructura: ["Hueco profundo en el carril derecho", "Paso peatonal sin demarcar", "Señal de pare caída", "Semáforo apagado desde ayer", "Falta iluminación en el cruce"],
  };
  let total = 0;
  for (let i = 0; i < 80; i++) {
    const c = elegir(cats);
    const diasAtras = Math.floor(azar() * 84);
    const creado = new Date(Date.now() - diasAtras * 86400000 - Math.floor(azar() * 36000000));
    await transaccion(async (cx) => {
      const vereda = elegir(veredas);
      const ins = await cx.query(
        `INSERT INTO reportes (tipo, categoria, descripcion, fecha_hecho, geom, placa, autor_id, vereda, creado_en, actualizado_en)
         SELECT $1, $2, $3, $4, (ST_Dump(ST_GeneratePoints(geom, 1, $8::int))).geom, $5, $6, nombre, $4, $4
           FROM veredas WHERE nombre = $7 LIMIT 1 RETURNING id`,
        [c.tipo, c.codigo, elegir(DESCRIP[c.tipo]), creado, c.tipo === "conducta" && azar() < 0.5 ? cifrar(`DEM${100 + i}`, "reportes.placa") : null,
          elegir(ciudadanos), vereda, i + 1]);
      const id = ins.rows[0].id;
      await cx.query(`INSERT INTO reporte_historial (reporte_id, estado_nuevo, usuario_id, creado_en) VALUES ($1,'RECIBIDO',$2,$3)`, [id, null, creado]);
      let estado = "RECIBIDO", t = creado.getTime();
      for (const [siguiente, prob] of FLUJO[c.tipo]) {
        if (azar() > prob) break;
        const nt = t + (2 + azar() * 70) * 3600000;
        if (nt > Date.now()) break;
        t = nt;
        await cx.query(`INSERT INTO reporte_historial (reporte_id, estado_anterior, estado_nuevo, usuario_id, creado_en) VALUES ($1,$2,$3,$4,$5)`,
          [id, estado, siguiente, func, new Date(t)]);
        estado = siguiente;
      }
      await cx.query(`UPDATE reportes SET estado = $2, actualizado_en = $3 WHERE id = $1`, [id, estado, new Date(t)]);
    });
    total++;
  }
  console.log(`Datos de demostración: 1 funcionaria y ${ciudadanos.length} ciudadanos (${DOMINIO}, clave Demo12345) y ${total} reportes.`);
}
await pool.end();
