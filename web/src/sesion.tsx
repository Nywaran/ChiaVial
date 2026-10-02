import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api } from "./api";

export type Usuario = { id: number; nombre: string; email: string; rol: "ciudadano" | "funcionario" | "entidad" | "admin"; entidad_id?: number; entidad?: string };

type Ctx = { usuario: Usuario | null; cargando: boolean; recargar: () => Promise<void>; salir: () => Promise<void> };
const SesionCtx = createContext<Ctx>({ usuario: null, cargando: true, recargar: async () => {}, salir: async () => {} });

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);
  const recargar = useCallback(async () => {
    try { setUsuario(await api.get<Usuario | null>("/auth/yo")); } catch { setUsuario(null); } finally { setCargando(false); }
  }, []);
  const salir = useCallback(async () => { await api.post("/auth/logout"); setUsuario(null); }, []);
  useEffect(() => { recargar(); }, [recargar]);
  return <SesionCtx.Provider value={{ usuario, cargando, recargar, salir }}>{children}</SesionCtx.Provider>;
}

export const useSesion = () => useContext(SesionCtx);

/** Protege una ruta por rol; redirige a Ingresar si no hay sesión. */
export function Protegida({ roles, children }: { roles?: Usuario["rol"][]; children: ReactNode }) {
  const { usuario, cargando } = useSesion();
  const loc = useLocation();
  if (cargando) return <p className="cargando">Cargando…</p>;
  if (!usuario) return <Navigate to={`/ingresar?volver=${encodeURIComponent(loc.pathname)}`} replace />;
  if (roles && !roles.includes(usuario.rol)) return <div className="aviso aviso-error">No tienes permiso para ver esta página.</div>;
  return <>{children}</>;
}
