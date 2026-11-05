// Carga perezosa de Google Charts (https://developers.google.com/chart).
// El script se descarga una sola vez desde www.gstatic.com (permitido en la CSP del servidor).
declare global {
  interface Window { google?: any }
}

let promesa: Promise<any> | null = null;

export function cargarGoogleCharts(): Promise<any> {
  if (promesa) return promesa;
  promesa = new Promise((resolver, rechazar) => {
    const listo = () =>
      window.google.charts.load("current", { packages: ["corechart"], language: "es" }).then(() => resolver(window.google), rechazar);
    if (window.google?.charts) return listo();
    const s = document.createElement("script");
    s.src = "https://www.gstatic.com/charts/loader.js";
    s.async = true;
    s.onload = listo;
    s.onerror = () => { promesa = null; rechazar(new Error("No se pudo cargar Google Charts")); };
    document.head.appendChild(s);
  });
  return promesa;
}
