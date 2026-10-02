import { NavLink, Route, Routes, Link, useNavigate } from "react-router-dom";
import { useSesion, Protegida } from "./sesion";
import { NOMBRE_ROL } from "./api";
import Inicio from "./pages/Inicio";
import Observatorio from "./pages/Observatorio";
import Comparendos from "./pages/Comparendos";
import Reportar from "./pages/Reportar";
import MisReportes from "./pages/MisReportes";
import { Ingresar, Registro, Verificar, Olvide, Restablecer, Cuenta } from "./pages/Cuentas";
import Politica from "./pages/Politica";
import Panel from "./pages/Panel";
import Admin from "./pages/Admin";

export default function App() {
  const { usuario, salir } = useSesion();
  const navegar = useNavigate();
  const esStaff = usuario && ["funcionario", "admin", "entidad"].includes(usuario.rol);
  return (
    <>
      <a href="#principal" className="oculto-visual">Saltar al contenido</a>
      <header className="barra">
        <div className="barra-in">
          <Link to="/" className="marca"><img src="/favicon.svg" alt="" />ChíaVial</Link>
          <nav className="nav" aria-label="Principal">
            <NavLink to="/observatorio" className={({ isActive }) => (isActive ? "activo" : "")}>Observatorio</NavLink>
            <NavLink to="/comparendos" className={({ isActive }) => (isActive ? "activo" : "")}>Comparendos</NavLink>
            {(!usuario || usuario.rol === "ciudadano") && <NavLink to="/reportar" className={({ isActive }) => (isActive ? "activo" : "")}>Reportar</NavLink>}
            {usuario?.rol === "ciudadano" && <NavLink to="/mis-reportes" className={({ isActive }) => (isActive ? "activo" : "")}>Mis reportes</NavLink>}
            {esStaff && <NavLink to="/panel" className={({ isActive }) => (isActive ? "activo" : "")}>Panel de gestión</NavLink>}
            {usuario?.rol === "admin" && <NavLink to="/admin" className={({ isActive }) => (isActive ? "activo" : "")}>Administración</NavLink>}
          </nav>
          <div className="usuario">
            {usuario ? (
              <>
                <Link to="/cuenta" title={NOMBRE_ROL[usuario.rol]}>{usuario.nombre}</Link>
                <button className="enlace" onClick={async () => { await salir(); navegar("/"); }}>Salir</button>
              </>
            ) : (
              <><Link to="/ingresar">Ingresar</Link><span aria-hidden>·</span><Link to="/registro">Crear cuenta</Link></>
            )}
          </div>
        </div>
      </header>
      <main id="principal" className="contenedor">
        <Routes>
          <Route path="/" element={<Inicio />} />
          <Route path="/observatorio" element={<Observatorio />} />
          <Route path="/comparendos" element={<Comparendos />} />
          <Route path="/reportar" element={<Protegida roles={["ciudadano"]}><Reportar /></Protegida>} />
          <Route path="/mis-reportes" element={<Protegida roles={["ciudadano"]}><MisReportes /></Protegida>} />
          <Route path="/panel" element={<Protegida roles={["funcionario", "admin", "entidad"]}><Panel /></Protegida>} />
          <Route path="/admin" element={<Protegida roles={["admin"]}><Admin /></Protegida>} />
          <Route path="/ingresar" element={<Ingresar />} />
          <Route path="/registro" element={<Registro />} />
          <Route path="/verificar" element={<Verificar />} />
          <Route path="/olvide" element={<Olvide />} />
          <Route path="/restablecer" element={<Restablecer />} />
          <Route path="/cuenta" element={<Protegida><Cuenta /></Protegida>} />
          <Route path="/politica-de-datos" element={<Politica />} />
          <Route path="*" element={<div className="vacio"><h1>Página no encontrada</h1><Link to="/">Volver al inicio</Link></div>} />
        </Routes>
      </main>
      <footer className="pie">
        <div className="contenedor">
          ChíaVial · Plataforma Integral de Seguridad Vial de Chía · Proyecto universitario. Datos abiertos de la Alcaldía Municipal de Chía y del
          Ministerio de Transporte (datos.gov.co). Mapas © colaboradores de OpenStreetMap. <Link to="/politica-de-datos">Política de tratamiento de datos</Link>
        </div>
      </footer>
    </>
  );
}
