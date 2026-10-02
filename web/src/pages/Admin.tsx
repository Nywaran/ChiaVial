// Administración: usuarios, ingesta de datos, diccionario de infracciones, bitácora y correos
import { useState, type FormEvent } from "react";
import { api, fmtFechaHora, NOMBRE_ROL, nf, titulo } from "../api";
import { useDatos, Mensaje, Campo } from "../components/Comunes";

export default function Admin() {
  const [p, setP] = useState("ingesta");
  const PEST = [["ingesta", "Datos abiertos"], ["usuarios", "Usuarios"], ["infracciones", "Infracciones"], ["bitacora", "Bitácora"], ["correos", "Correos"]];
  return (
    <div className="pila">
      <h1>Administración</h1>
      <div className="pestanas" role="tablist">
        {PEST.map(([k, t]) => <button key={k} role="tab" aria-selected={p === k} className={p === k ? "activa" : ""} onClick={() => setP(k)}>{t}</button>)}
      </div>
      {p === "ingesta" && <Ingesta />}
      {p === "usuarios" && <Usuarios />}
      {p === "infracciones" && <Infracciones />}
      {p === "bitacora" && <Bitacora />}
      {p === "correos" && <Correos />}
    </div>
  );
}

const NOMBRE_CONJUNTO: Record<string, string> = { siniestros: "Siniestros", comparendos: "Comparendos", vehiculos: "Vehículos (RUNT)", veredas: "Veredas" };
const ETQ_CALIDAD: Record<string, string> = {
  origen: "Archivo", registros_unicos: "Registros únicos", filas_identicas_descartadas: "Filas idénticas descartadas",
  ipat_repetido_con_datos_distintos: "IPAT repetido con datos distintos", numeros_con_registros_distintos: "Números con varios registros distintos",
  sin_fecha: "Sin fecha", sin_ipat: "Sin IPAT", sin_numero: "Sin número", codigos_distintos: "Códigos distintos",
  codigos_sin_descripcion: "Códigos sin descripción", filas_de_chia: "Filas de Chía", variantes_excluidas: "Variantes excluidas",
  porcentaje_geocodificado: "% ubicados en el mapa", geocodificados: "Ubicados", total_siniestros: "Total siniestros", veredas: "Veredas",
  normalizacion_gravedad: "Normalización de gravedad",
};

function Ingesta() {
  const { datos, recargar } = useDatos<any>("/admin/ingestas");
  const [ejecutando, setEjecutando] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  async function ejecutar(fuente?: string) {
    setEjecutando(true); setMsg({});
    try {
      const r = await api.post("/admin/ingestas", fuente ? { fuente } : {});
      setMsg({ ok: r.resultados.map((x: any) => `${NOMBRE_CONJUNTO[x.conjunto]}: ${x.estado}${x.error ? ` (${x.error})` : ""}`).join(" · ") });
      recargar();
    } catch (e: any) { setMsg({ error: e.message }); } finally { setEjecutando(false); }
  }
  async function geocodificar() {
    setEjecutando(true);
    try { const r = await api.post("/admin/geocodificar", { reintentar: true }); setMsg({ ok: `Geocodificación: ${r.ubicados} de ${r.procesados} ubicados.` }); recargar(); }
    catch (e: any) { setMsg({ error: e.message }); } finally { setEjecutando(false); }
  }
  const t = datos?.totales;
  return (
    <div className="pila">
      <section className="tarjeta">
        <h2>Estado de los datos</h2>
        {t && <p>{nf.format(t.siniestros)} siniestros ({nf.format(t.ubicados)} en el mapa) · {nf.format(t.comparendos)} comparendos · {nf.format(t.vehiculos)} vehículos · {t.veredas} veredas</p>}
        <p className="muy-tenue">Fuente configurada: <strong>{datos?.fuente === "api" ? "API de datos.gov.co" : `archivos CSV en ${datos?.directorio}`}</strong>. La ingesta programada corre cada 7 días (configurable).</p>
        <Mensaje ok={msg.ok} error={msg.error} />
        <div className="acciones">
          <button disabled={ejecutando} onClick={() => ejecutar()}>{ejecutando ? "Procesando…" : "Ejecutar ingesta ahora"}</button>
          <button className="secundario" disabled={ejecutando} onClick={() => ejecutar("api")}>Descargar desde datos.gov.co</button>
          <button className="secundario" disabled={ejecutando} onClick={geocodificar}>Reintentar geocodificación</button>
        </div>
      </section>
      <section className="tarjeta">
        <h2>Historial de ingestas e informe de calidad</h2>
        <div className="tabla-env">
          <table>
            <thead><tr><th>Fecha</th><th>Conjunto</th><th>Estado</th><th className="num">Leídas</th><th className="num">Nuevas</th><th className="num">Actualizadas</th><th>Calidad</th></tr></thead>
            <tbody>{datos?.ingestas?.map((i: any) => (
              <tr key={i.id}>
                <td>{fmtFechaHora(i.iniciada_en)}</td><td>{NOMBRE_CONJUNTO[i.conjunto] || i.conjunto}<div className="muy-tenue">{i.fuente}</div></td>
                <td><span className={`estado e-${i.estado === "ok" ? "RESUELTO" : i.estado === "error" ? "RECHAZADO" : "EN_REVISION"}`}>{i.estado}</span></td>
                <td className="num">{nf.format(i.filas_leidas || 0)}</td><td className="num">{nf.format(i.filas_nuevas || 0)}</td><td className="num">{nf.format(i.filas_actualizadas || 0)}</td>
                <td style={{ fontSize: "0.85rem" }}>
                  {i.errores?.length > 0 && <div style={{ color: "var(--error)" }}>{i.errores.join("; ")}</div>}
                  {Object.entries(i.calidad || {}).map(([k, v]) => <div key={k}>{ETQ_CALIDAD[k] || k}: {typeof v === "object" ? Object.entries(v as any).map(([a, b]) => `${a} (${b})`).join(", ") || "ninguna" : String(v)}</div>)}
                </td>
              </tr>))}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Usuarios() {
  const { datos, recargar } = useDatos<any[]>("/admin/usuarios");
  const { datos: cat } = useDatos<any>("/admin/catalogos");
  const [f, setF] = useState({ nombre: "", email: "", rol: "funcionario", entidad_id: "" });
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  async function crear(e: FormEvent) {
    e.preventDefault(); setMsg({});
    try {
      const r = await api.post("/admin/usuarios", { ...f, entidad_id: f.entidad_id ? Number(f.entidad_id) : null });
      setMsg({ ok: `Usuario creado. Contraseña temporal: ${r.password_temporal}. Compártela por un canal seguro; la persona puede cambiarla con «Olvidé mi contraseña».` });
      setF({ nombre: "", email: "", rol: "funcionario", entidad_id: "" }); recargar();
    } catch (er: any) { setMsg({ error: er.message }); }
  }
  async function alternar(u: any) {
    try { await api.patch(`/admin/usuarios/${u.id}`, { activo: !u.activo }); recargar(); } catch (er: any) { setMsg({ error: er.message }); }
  }
  return (
    <div className="dos-col">
      <section className="tarjeta">
        <h2>Usuarios</h2>
        <div className="tabla-env"><table>
          <thead><tr><th>Nombre</th><th>Rol</th><th>Estado</th><th></th></tr></thead>
          <tbody>{datos?.map((u) => (
            <tr key={u.id}>
              <td>{u.nombre}<div className="muy-tenue">{u.email}</div></td>
              <td>{NOMBRE_ROL[u.rol]}{u.entidad && <div className="muy-tenue">{u.entidad}</div>}</td>
              <td>{u.activo ? (u.email_verificado ? "Activo" : "Sin verificar") : "Inactivo"}</td>
              <td>{u.rol !== "ciudadano" || !u.activo ? <button className="chico secundario" onClick={() => alternar(u)}>{u.activo ? "Desactivar" : "Activar"}</button> : <button className="chico secundario" onClick={() => alternar(u)}>Desactivar</button>}</td>
            </tr>))}</tbody>
        </table></div>
      </section>
      <section className="tarjeta">
        <h2>Crear cuenta institucional</h2>
        <p className="muy-tenue">Los ciudadanos se registran solos. Las cuentas de funcionarios, entidades y administradores solo las crea un administrador.</p>
        <Mensaje ok={msg.ok} error={msg.error} />
        <form onSubmit={crear}>
          <Campo id="u-nom" etiqueta="Nombre"><input id="u-nom" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Campo>
          <Campo id="u-mail" etiqueta="Correo"><input id="u-mail" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Campo>
          <Campo id="u-rol" etiqueta="Rol">
            <select id="u-rol" value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value })}>
              <option value="funcionario">Funcionario de Movilidad</option><option value="entidad">Entidad externa</option><option value="admin">Administrador</option>
            </select>
          </Campo>
          <Campo id="u-ent" etiqueta={f.rol === "entidad" ? "Entidad (obligatoria)" : "Entidad (opcional)"}>
            <select id="u-ent" value={f.entidad_id} onChange={(e) => setF({ ...f, entidad_id: e.target.value })}>
              <option value="">—</option>{cat?.entidades?.map((e: any) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          </Campo>
          <button type="submit">Crear usuario</button>
        </form>
      </section>
    </div>
  );
}

function Infracciones() {
  const { datos, recargar } = useDatos<any>("/admin/infracciones");
  const [editando, setEditando] = useState<Record<string, { descripcion: string; grupo: string }>>({});
  const [csv, setCsv] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  async function guardar(codigo: string) {
    try { await api.put(`/admin/infracciones/${codigo}`, editando[codigo]); setEditando(({ [codigo]: _, ...r }) => r); recargar(); setMsg({ ok: `Infracción ${codigo} actualizada.` }); }
    catch (e: any) { setMsg({ error: e.message }); }
  }
  async function cargarCsv() {
    try { const r = await api.post("/admin/infracciones/csv", { csv }); setMsg({ ok: `${r.cargadas} infracciones cargadas.${r.errores.length ? ` Errores: ${r.errores.join("; ")}` : ""}` }); setCsv(""); recargar(); }
    catch (e: any) { setMsg({ error: e.message }); }
  }
  return (
    <div className="pila">
      <section className="tarjeta">
        <h2>Diccionario de infracciones</h2>
        <p className="muy-tenue">Descripciones del Código Nacional de Tránsito (tabla de autoliquidación 2024, Alcaldía de Bogotá). El grupo define qué cuenta como «conducta de riesgo» en la analítica.</p>
        <Mensaje ok={msg.ok} error={msg.error} />
        <div className="tabla-env"><table>
          <thead><tr><th>Código</th><th>Descripción</th><th>Grupo</th><th className="num">Comparendos</th><th></th></tr></thead>
          <tbody>{datos?.infracciones?.map((i: any) => {
            const ed = editando[i.codigo];
            return (
              <tr key={i.codigo}>
                <td><strong>{i.codigo}</strong></td>
                <td style={{ minWidth: 280 }}>{ed ? <textarea aria-label={`Descripción de ${i.codigo}`} value={ed.descripcion} onChange={(e) => setEditando({ ...editando, [i.codigo]: { ...ed, descripcion: e.target.value } })} style={{ minHeight: 70 }} /> : i.descripcion || <span className="tenue">Sin descripción</span>}</td>
                <td>{ed ? (
                  <select aria-label={`Grupo de ${i.codigo}`} value={ed.grupo} onChange={(e) => setEditando({ ...editando, [i.codigo]: { ...ed, grupo: e.target.value } })}>
                    {datos.grupos.map((g: any) => <option key={g.codigo} value={g.codigo}>{g.nombre}</option>)}
                  </select>) : datos.grupos.find((g: any) => g.codigo === i.grupo)?.nombre}</td>
                <td className="num">{nf.format(i.comparendos)}</td>
                <td>{ed ? <div className="acciones"><button className="chico" onClick={() => guardar(i.codigo)}>Guardar</button><button className="chico secundario" onClick={() => setEditando(({ [i.codigo]: _, ...r }) => r)}>Cancelar</button></div>
                  : <button className="chico secundario" onClick={() => setEditando({ ...editando, [i.codigo]: { descripcion: i.descripcion || "", grupo: i.grupo } })}>Editar</button>}</td>
              </tr>);
          })}</tbody>
        </table></div>
      </section>
      <section className="tarjeta">
        <h2>Carga masiva (CSV)</h2>
        <p className="muy-tenue">Pega un CSV con las columnas <code>codigo,descripcion,grupo</code>. Grupos válidos: {datos?.grupos?.map((g: any) => g.codigo).join(", ")}.</p>
        <textarea aria-label="Contenido CSV" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={"codigo,descripcion,grupo\nC29,Conducir a velocidad superior a la máxima permitida,VELOCIDAD"} />
        <button style={{ marginTop: "0.5rem" }} disabled={!csv.trim()} onClick={cargarCsv}>Cargar</button>
      </section>
    </div>
  );
}

function Bitacora() {
  const { datos } = useDatos<any[]>("/admin/bitacora");
  return (
    <section className="tarjeta">
      <h2>Bitácora de auditoría</h2>
      <div className="tabla-env"><table>
        <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Objeto</th><th>Detalle</th></tr></thead>
        <tbody>{datos?.map((b) => (
          <tr key={b.id}><td>{fmtFechaHora(b.creado_en)}</td><td>{b.usuario || "—"}{b.rol && <div className="muy-tenue">{NOMBRE_ROL[b.rol]}</div>}</td><td>{titulo(b.accion.replace(/_/g, " "))}</td><td>{b.objeto}{b.objeto_id ? ` #${b.objeto_id}` : ""}</td><td><code style={{ fontSize: "0.8rem" }}>{b.detalle ? JSON.stringify(b.detalle) : ""}</code></td></tr>
        ))}</tbody>
      </table></div>
    </section>
  );
}

function Correos() {
  const { datos } = useDatos<any>("/admin/correos");
  return (
    <section className="tarjeta">
      <h2>Correos enviados por el sistema</h2>
      {!datos?.smtp_configurado && <div className="aviso aviso-info">No hay servidor SMTP configurado: los correos no salen, pero quedan aquí para la demostración (por ejemplo, los enlaces de activación de cuentas).</div>}
      <div className="tabla-env"><table>
        <thead><tr><th>Fecha</th><th>Para</th><th>Asunto</th><th>Mensaje</th><th>Enviado</th></tr></thead>
        <tbody>{datos?.correos?.map((c: any) => (
          <tr key={c.id}><td>{fmtFechaHora(c.creado_en)}</td><td>{c.para}</td><td>{c.asunto}</td><td style={{ whiteSpace: "pre-wrap", fontSize: "0.85rem" }}>{c.cuerpo}</td><td>{c.enviado ? "Sí" : c.error ? `Error: ${c.error}` : "No (sin SMTP)"}</td></tr>
        ))}</tbody>
      </table></div>
    </section>
  );
}
