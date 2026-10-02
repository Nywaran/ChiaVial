import { useEffect, type ReactNode } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";

export const CENTRO_CHIA: [number, number] = [4.865, -74.05];

/** Mapa base con OpenStreetMap y atribución visible (RF-GEN-10). */
export function MapaBase({ children, alto, centro = CENTRO_CHIA, zoom = 13, etiqueta }: { children?: ReactNode; alto?: string; centro?: [number, number]; zoom?: number; etiqueta: string }) {
  return (
    <div className={`mapa ${alto || ""}`} role="region" aria-label={etiqueta}>
      <MapContainer center={centro} zoom={zoom} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">colaboradores de OpenStreetMap</a>'
          maxZoom={19}
        />
        {children}
      </MapContainer>
    </div>
  );
}

/** Límites de las veredas (RF-M07-07). */
export function CapaVeredas({ datos }: { datos: any }) {
  if (!datos?.features?.length) return null;
  return (
    <GeoJSON
      key={datos.features.length}
      data={datos}
      style={{ color: "#1f5f4a", weight: 1.5, fillOpacity: 0.04, dashArray: "4 4" }}
      onEachFeature={(f, capa) => capa.bindTooltip(`Vereda ${f.properties.nombre.toLowerCase().replace(/(^|\s)\S/g, (s: string) => s.toUpperCase())}`, { sticky: true })}
    />
  );
}

/** Capa de calor (leaflet.heat). Una sola tonalidad de claro a oscuro. */
export function CapaCalor({ puntos }: { puntos: { lat: number; lon: number; peso: number }[] }) {
  const mapa = useMap();
  useEffect(() => {
    let capa: any;
    let vivo = true;
    (async () => {
      (window as any).L = L;
      await import("leaflet.heat");
      if (!vivo || !puntos.length) return;
      capa = (L as any).heatLayer(puntos.map((p) => [p.lat, p.lon, p.peso]), {
        radius: 28, blur: 22, maxZoom: 16, max: 3, minOpacity: 0.35,
        gradient: { 0.2: "#fde7d9", 0.45: "#f6a77e", 0.7: "#eb6834", 1: "#9c3b14" },
      }).addTo(mapa);
    })();
    return () => { vivo = false; if (capa) mapa.removeLayer(capa); };
  }, [mapa, puntos]);
  return null;
}

/** Captura el clic en el mapa (reportes y ubicación manual). */
export function AlHacerClic({ fn }: { fn: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => fn(e.latlng.lat, e.latlng.lng) });
  return null;
}

/** Centra el mapa cuando cambia el punto. */
export function Centrar({ punto, zoom }: { punto: [number, number] | null; zoom?: number }) {
  const mapa = useMap();
  useEffect(() => { if (punto) mapa.setView(punto, zoom ?? Math.max(mapa.getZoom(), 15)); }, [punto, zoom, mapa]);
  return null;
}
