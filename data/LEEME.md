# Datos abiertos de ChíaVial

Archivos descargados de datos.gov.co el 1 de octubre de 2026. La ingesta los busca por nombre en esta carpeta.

| Archivo | Conjunto | Identificador | Enlace de descarga |
|---|---|---|---|
| `siniestros.csv` | Siniestralidad vial del municipio de Chía (Alcaldía de Chía, CC BY-SA 4.0) | sq65-is2t | https://www.datos.gov.co/resource/sq65-is2t.csv?$limit=50000 |
| `comparendos.csv` | Imposición de comparendos de tránsito en el municipio de Chía (Alcaldía de Chía, CC BY-SA 4.0) | pkjw-yf7d | https://www.datos.gov.co/resource/pkjw-yf7d.csv?$limit=50000 |
| `vehiculos.csv` | Vehículos involucrados en un accidente de tránsito, Ley 2251-2022 (MinTransporte/RUNT), filtrado a Cundinamarca | 6jmc-vaxk | https://www.datos.gov.co/resource/6jmc-vaxk.csv?$limit=50000&$where=departamento_accidente%20like%20%27%25CUNDINAMARCA%25%27 |
| `veredas.geojson` | Veredas del Municipio de Chía (Alcaldía de Chía) | fw8q-ut2e | https://www.datos.gov.co/resource/fw8q-ut2e.geojson |

## Hallazgos de calidad (ingesta del 01/10/2026)

- **Siniestros:** 182 filas, de las cuales 17 son copias exactas: quedan **165 siniestros únicos** (155 con herido y 10 con muerto) entre el 03/01/2024 y el 30/06/2025. La gravedad y la clase vienen con mayúsculas distintas entre años y una errata («Caida Oupante»); se normalizan.
- **Comparendos:** 27.350 filas, 4.467 son copias exactas; otros 17 números de comparendo aparecen con fecha o infracción distinta y se conservan. Quedan **22.883 registros únicos**.
- **Vehículos:** 13.845 filas de Cundinamarca; **822 de Chía**. Se excluyen las variantes «CHÍA - LA PAZ» (2) y «CHÍA - CHIQUILINDA» (3) porque no es claro que correspondan al municipio.
- **Veredas:** 8 polígonos; los nombres llegan con letras dañadas («Fonquet », «Bojac », «T quiza») y se corrigen a Fonquetá, Bojacá y Tíquiza.
