# ChíaVial · Plataforma Integral de Seguridad Vial de Chía

Plataforma web que reúne datos abiertos de siniestralidad y comparendos del municipio de Chía (Cundinamarca) con reportes ciudadanos de conductas de riesgo y de puntos peligrosos, para que la Secretaría de Movilidad y otras entidades actúen con evidencia.

Proyecto universitario. Esta versión implementa la **fase 1 (MVP)** del documento de especificación de requisitos (SRS v1.0):

| Módulo | Qué hace |
|---|---|
| **Transversal** | Cuentas, roles, verificación por correo, ingesta de datos abiertos, normalización, geocodificación, mapa base, bitácora |
| **M07 · Observatorio** | Mapa de calor, indicadores con comparación de periodo, tendencia mensual, clases de accidente, ranking de vías, vehículos involucrados, descarga CSV |
| **M10 · Comparendos** | Comparendos por mes, entidad y grupo de riesgo; infracciones más frecuentes con su descripción oficial; día de la semana; comparación con siniestros |
| **M01 · Reporte de conducción de riesgo** | Reporte en 3 pasos con mapa, fotos y placa privada; bandeja de gestión y seguimiento |
| **M04 · Reporte de puntos peligrosos** | Reporte con detección de similares y apoyos; verificación, asignación a entidades y seguimiento |

## Puesta en marcha rápida (Docker)

Requisitos: Docker Desktop.

```bash
docker compose up --build
```

- Plataforma: http://localhost:3000
- Correos de prueba (Mailpit): http://localhost:8025 — aquí llegan los enlaces para activar cuentas.
- Administrador inicial: `admin@chiavial.local` / `Admin12345` (cámbielo con las variables `ADMIN_EMAIL` y `ADMIN_PASSWORD`).

Después de iniciar, entre como administrador, vaya a **Administración → Datos abiertos** y pulse **Ejecutar ingesta ahora** para cargar los archivos de `data/`. La ingesta también corre sola cada 7 días.

## Puesta en marcha manual (desarrollo)

Requisitos: Node.js 20 o superior y PostgreSQL 15 o superior con PostGIS.

```bash
# 1. Base de datos
createdb chiavial            # con un usuario que pueda crear la extensión postgis

# 2. API (puerto 3000)
cd api
cp .env.example .env         # ajuste DATABASE_URL y JWT_SECRET
npm install
npm run ingesta              # crea las tablas y carga los datos de ../data
npm run dev

# 3. Web (puerto 5173, en otra terminal)
cd web
npm install
npm run dev
```

Abra http://localhost:5173. Sin servidor SMTP, los correos quedan en **Administración → Correos**.

### Comandos útiles

| Comando (en `api/`) | Para qué |
|---|---|
| `npm run ingesta` | Carga los CSV de `data/` (o `-- --fuente=api` para descargar de datos.gov.co) |
| `npm run geocodificar -- --reintentar` | Vuelve a intentar ubicar los siniestros sin coordenadas |
| `npm test` | 21 pruebas (requiere la base `chiavial_test` con PostGIS, o `TEST_DATABASE_URL`) |
| `npm run lint` | Verificación de sintaxis |

## Roles

| Rol | Cómo se crea | Qué puede hacer |
|---|---|---|
| Visitante | — | Observatorio, comparendos, mapa público de reportes |
| Ciudadano | Se registra y activa la cuenta por correo | Reportar, seguir sus reportes, apoyar reportes de otros, eliminar su cuenta |
| Funcionario de Movilidad | Lo crea el administrador | Bandejas de reportes, cambios de estado, asignación, ubicar siniestros |
| Entidad externa | Lo crea el administrador | Ver y actualizar los reportes asignados a su entidad |
| Administrador | Variables de entorno o otro administrador | Usuarios, ingesta, diccionario de infracciones, bitácora, correos |

## Datos

Los datos vienen de datos.gov.co y se describen en [`data/LEEME.md`](data/LEEME.md), junto con los hallazgos de calidad: el archivo publicado de siniestros tiene **165 siniestros únicos** (no 182) y el de comparendos **22.883** (no 27.350), porque contienen filas repetidas.

**Ubicación de los siniestros.** El dato publicado trae el lugar como texto («BOGOTA TUNJA KM 5+200», «CARRERA 9 CALLE 25», «VEREDA FAGUA SECTOR BUYARA»). ChíaVial los ubica así:
1. **Veredas:** con el polígono de la vereda (aproximado).
2. **Puntos kilométricos:** cuando un funcionario registra al menos dos referencias de un corredor en **Panel → Ubicar siniestros → Referencias kilométricas**, todos los siniestros de ese corredor se ubican por interpolación. El 48 % de los siniestros (79 de 165) están en corredores con kilómetro.
3. **Direcciones urbanas:** con Nominatim (OpenStreetMap), respetando su límite de una consulta por segundo. Requiere internet.
4. **Manual:** el funcionario marca el punto en el mapa; esta ubicación nunca se sobrescribe.

**Diccionario de infracciones.** Las descripciones de los 77 códigos presentes en los comparendos se tomaron de la [Tabla de autoliquidación 2024 de la Alcaldía de Bogotá](https://bogota.gov.co/sites/default/files/inline-files/tabla-autoliquidacion-2024_0.pdf) (códigos del Código Nacional de Tránsito). La clasificación en grupos de riesgo es una propuesta del equipo y el administrador puede cambiarla.

## Arquitectura

```
web/   React + TypeScript (Vite), Leaflet (mapas) y Recharts (gráficos)
api/   Node.js + Express 5, PostgreSQL + PostGIS
  src/routes/      auth · observatorio (M07) · comparendos (M10) · reportes (M01, M04) · admin
  src/etl/         ingesta desde CSV o API de datos.gov.co, programador semanal
  src/lib/         normalización, geocodificación, correo, bitácora
  src/migrations/  esquema SQL versionado
  test/            pruebas unitarias e integración (node:test + supertest)
data/  datos abiertos descargados
```

En producción la API sirve también la web compilada (una sola imagen Docker).

## Seguridad y privacidad (SRS 4.1)

- Contraseñas con bcrypt; sesión en cookie `httpOnly` (30 minutos de inactividad para cuentas institucionales).
- Bloqueo de 15 minutos tras 5 intentos fallidos; cabecera anti-CSRF obligatoria en escrituras; cabeceras de seguridad con Helmet.
- Autorización por rol validada en el servidor; la entidad externa solo ve lo asignado.
- Placas, fotos, descripciones y autores nunca aparecen en vistas públicas; los números de comparendo nunca se exponen.
- Fotos reescaladas y sin metadatos EXIF (incluida la ubicación).
- Consentimiento explícito (Ley 1581 de 2012) y eliminación de cuenta con anonimización de reportes.

## Limitaciones conocidas

- Los siniestros publicados no traen hora, tipo de víctima ni clase de vehículo, y solo incluyen accidentes con herido o muerto.
- Los comparendos no traen hora ni lugar, así que no se pueden mapear.
- La geocodificación automática de direcciones depende de Nominatim y es aproximada.
- Los módulos de fase 2 y 3 del SRS (M02, M03, M05, M06, M08, M09) no están construidos en esta versión.

## Licencia de los datos

Datos de siniestros y comparendos: © Alcaldía Municipal de Chía, publicados en datos.gov.co bajo CC BY-SA 4.0. Los datos derivados que descarga ChíaVial se comparten bajo la misma licencia. Mapas © colaboradores de OpenStreetMap (ODbL).
