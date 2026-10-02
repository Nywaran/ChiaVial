// Conjuntos de datos abiertos verificados en datos.gov.co
export const CONJUNTOS = {
  veredas: {
    id: "fw8q-ut2e",
    nombre: "Veredas del Municipio de Chía",
    fuente: "Alcaldía Municipal de Chía – datos.gov.co",
    licencia: null,
    formato: "geojson",
    archivos: ["veredas.geojson", "fw8q-ut2e.geojson"],
  },
  siniestros: {
    id: "sq65-is2t",
    nombre: "Siniestralidad vial del municipio de Chía",
    fuente: "Alcaldía Municipal de Chía – datos.gov.co",
    licencia: "CC BY-SA 4.0",
    formato: "csv",
    archivos: ["siniestros.csv", "sq65-is2t.csv"],
  },
  comparendos: {
    id: "pkjw-yf7d",
    nombre: "Imposición de comparendos de tránsito en el municipio de Chía",
    fuente: "Alcaldía Municipal de Chía – datos.gov.co",
    licencia: "CC BY-SA 4.0",
    formato: "csv",
    archivos: ["comparendos.csv", "pkjw-yf7d.csv"],
  },
  vehiculos: {
    id: "6jmc-vaxk",
    nombre: "Vehículos involucrados en un accidente de tránsito (Ley 2251-2022)",
    fuente: "Ministerio de Transporte / RUNT – datos.gov.co",
    licencia: null,
    formato: "csv",
    archivos: ["vehiculos.csv", "6jmc-vaxk.csv"],
    where: "departamento_accidente like '%CUNDINAMARCA%'",
  },
};

export const ORDEN_INGESTA = ["veredas", "siniestros", "comparendos", "vehiculos"];
