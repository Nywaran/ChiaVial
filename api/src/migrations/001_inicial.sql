-- ChíaVial · esquema inicial (fase 1)
CREATE EXTENSION IF NOT EXISTS postgis;

-- ───────── Entidades y usuarios (RF-GEN-01 a RF-GEN-05) ─────────
CREATE TABLE entidades (
  id      SERIAL PRIMARY KEY,
  nombre  TEXT NOT NULL UNIQUE
);

CREATE TABLE usuarios (
  id                       SERIAL PRIMARY KEY,
  nombre                   TEXT NOT NULL,
  email                    TEXT NOT NULL UNIQUE,
  password_hash            TEXT NOT NULL,
  rol                      TEXT NOT NULL CHECK (rol IN ('ciudadano','funcionario','entidad','admin')),
  entidad_id               INT REFERENCES entidades(id),
  activo                   BOOLEAN NOT NULL DEFAULT TRUE,
  email_verificado         BOOLEAN NOT NULL DEFAULT FALSE,
  token_verificacion       TEXT,
  token_reset              TEXT,
  token_reset_expira       TIMESTAMPTZ,
  intentos_fallidos        INT NOT NULL DEFAULT 0,
  bloqueado_hasta          TIMESTAMPTZ,
  acepto_tratamiento_en    TIMESTAMPTZ,
  creado_en                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────── Bitácora de auditoría (RF-GEN-14, RNF-SEG-11) ─────────
CREATE TABLE bitacora (
  id          BIGSERIAL PRIMARY KEY,
  usuario_id  INT REFERENCES usuarios(id) ON DELETE SET NULL,
  accion      TEXT NOT NULL,
  objeto      TEXT,
  objeto_id   TEXT,
  detalle     JSONB,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────── Ingesta de datos abiertos (RF-GEN-07, RF-GEN-12) ─────────
CREATE TABLE ingestas (
  id                  SERIAL PRIMARY KEY,
  conjunto            TEXT NOT NULL,
  fuente              TEXT NOT NULL,           -- csv | api
  estado              TEXT NOT NULL DEFAULT 'en_curso', -- en_curso | ok | error
  iniciada_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalizada_en       TIMESTAMPTZ,
  filas_leidas        INT DEFAULT 0,
  filas_nuevas        INT DEFAULT 0,
  filas_actualizadas  INT DEFAULT 0,
  errores             JSONB DEFAULT '[]'::jsonb,
  calidad             JSONB DEFAULT '{}'::jsonb
);

-- ───────── Datos abiertos ─────────
CREATE TABLE veredas (
  id      SERIAL PRIMARY KEY,
  nombre  TEXT NOT NULL,
  codigo  TEXT,
  geom    geometry(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX veredas_geom_idx ON veredas USING GIST (geom);

CREATE TABLE siniestros (
  id                 SERIAL PRIMARY KEY,
  numero_ipat        TEXT NOT NULL UNIQUE,
  municipio          TEXT NOT NULL DEFAULT 'CHIA',
  vigencia           INT,
  fecha              DATE,
  gravedad           TEXT,          -- normalizada: CON MUERTO | CON HERIDO | ...
  gravedad_original  TEXT,
  clase              TEXT,          -- normalizada
  clase_original     TEXT,
  lugar              TEXT,          -- original
  lugar_normalizado  TEXT,
  via                TEXT,          -- vía o corredor extraído del lugar
  entidad_reporta    TEXT,
  geom               geometry(Point, 4326),
  geo_fuente         TEXT,          -- corredor | vereda | nominatim | manual
  geo_confianza      NUMERIC(3,2),
  geo_intentado_en   TIMESTAMPTZ,
  vereda             TEXT,
  ingesta_id         INT REFERENCES ingestas(id),
  actualizado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX siniestros_geom_idx ON siniestros USING GIST (geom);
CREATE INDEX siniestros_fecha_idx ON siniestros (fecha);

CREATE TABLE comparendos (
  id                 SERIAL PRIMARY KEY,
  clave              TEXT NOT NULL UNIQUE,  -- número|fecha|infracción (el archivo publicado repite números)
  numero_comparendo  TEXT NOT NULL,         -- nunca se expone públicamente (RF-M10-07)
  vigencia           INT,
  fecha              DATE,
  infraccion         TEXT,
  entidad            TEXT,
  ingesta_id         INT REFERENCES ingestas(id)
);
CREATE INDEX comparendos_fecha_idx ON comparendos (fecha);
CREATE INDEX comparendos_infraccion_idx ON comparendos (infraccion);

-- Diccionario de infracciones (RF-M10-01, RF-M10-04)
CREATE TABLE grupos_infraccion (
  codigo        TEXT PRIMARY KEY,
  nombre        TEXT NOT NULL,
  es_riesgo     BOOLEAN NOT NULL DEFAULT FALSE,
  orden         INT NOT NULL DEFAULT 0
);
CREATE TABLE infracciones (
  codigo       TEXT PRIMARY KEY,
  descripcion  TEXT,
  grupo        TEXT NOT NULL DEFAULT 'SIN_CLASIFICAR' REFERENCES grupos_infraccion(codigo)
);

CREATE TABLE vehiculos_siniestro (
  id               SERIAL PRIMARY KEY,
  marca            TEXT,
  modelo           INT,
  tipo_vehiculo    TEXT,
  edad_vehiculo    INT,
  fecha_texto      TEXT,
  anio             INT,
  mes              INT,
  gravedad         TEXT,
  departamento     TEXT,
  municipio        TEXT,
  autoridad        TEXT,
  ingesta_id       INT REFERENCES ingestas(id)
);

-- Puntos de referencia kilométricos por corredor, cargados por el administrador (RF-GEN-09)
CREATE TABLE corredores_km (
  id        SERIAL PRIMARY KEY,
  corredor  TEXT NOT NULL,   -- como aparece en el lugar normalizado, ej. "CHIA BOGOTA"
  km        NUMERIC(8,3) NOT NULL,
  geom      geometry(Point, 4326) NOT NULL,
  UNIQUE (corredor, km)
);

CREATE TABLE geocache (
  consulta    TEXT PRIMARY KEY,
  lat         DOUBLE PRECISION,
  lon         DOUBLE PRECISION,
  etiqueta    TEXT,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────── Catálogos editables (RF-GEN-15) ─────────
CREATE TABLE catalogos (
  tipo     TEXT NOT NULL,     -- conducta | infraestructura
  codigo   TEXT NOT NULL,
  nombre   TEXT NOT NULL,
  orden    INT NOT NULL DEFAULT 0,
  activo   BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (tipo, codigo)
);

-- ───────── Reportes ciudadanos (M01 conducta, M04 infraestructura) ─────────
CREATE TABLE reportes (
  id                   SERIAL PRIMARY KEY,
  tipo                 TEXT NOT NULL CHECK (tipo IN ('conducta','infraestructura')),
  categoria            TEXT NOT NULL,
  descripcion          TEXT NOT NULL,
  fecha_hecho          TIMESTAMPTZ,
  geom                 geometry(Point, 4326) NOT NULL,
  placa                TEXT,               -- solo visible para funcionarios (RF-M01-03)
  autor_id             INT REFERENCES usuarios(id) ON DELETE SET NULL,
  estado               TEXT NOT NULL DEFAULT 'RECIBIDO',
  entidad_asignada_id  INT REFERENCES entidades(id),
  fecha_objetivo       DATE,
  posible_duplicado_de INT REFERENCES reportes(id),
  spam                 BOOLEAN NOT NULL DEFAULT FALSE,
  vereda               TEXT,
  creado_en            TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reportes_geom_idx ON reportes USING GIST (geom);
CREATE INDEX reportes_autor_idx ON reportes (autor_id);

CREATE TABLE reporte_fotos (
  id          SERIAL PRIMARY KEY,
  reporte_id  INT NOT NULL REFERENCES reportes(id) ON DELETE CASCADE,
  archivo     TEXT NOT NULL,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reporte_historial (
  id               SERIAL PRIMARY KEY,
  reporte_id       INT NOT NULL REFERENCES reportes(id) ON DELETE CASCADE,
  estado_anterior  TEXT,
  estado_nuevo     TEXT NOT NULL,
  comentario       TEXT,
  usuario_id       INT REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reporte_apoyos (
  reporte_id  INT NOT NULL REFERENCES reportes(id) ON DELETE CASCADE,
  usuario_id  INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (reporte_id, usuario_id)
);

-- ───────── Correos (bandeja de salida; en desarrollo se consultan desde el panel) ─────────
CREATE TABLE correos (
  id          SERIAL PRIMARY KEY,
  para        TEXT NOT NULL,
  asunto      TEXT NOT NULL,
  cuerpo      TEXT NOT NULL,
  enviado     BOOLEAN NOT NULL DEFAULT FALSE,
  error       TEXT,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────── Datos semilla ─────────
INSERT INTO entidades (nombre) VALUES
  ('Secretaría de Movilidad de Chía'),
  ('Policía de Tránsito'),
  ('Policía de Carreteras'),
  ('Secretaría de Salud'),
  ('Secretaría de Obras Públicas');

INSERT INTO grupos_infraccion (codigo, nombre, es_riesgo, orden) VALUES
  ('VELOCIDAD',        'Velocidad',              TRUE,  1),
  ('EMBRIAGUEZ',       'Embriaguez',             TRUE,  2),
  ('SEMAFORO_SENALES', 'Semáforo y señales',     TRUE,  3),
  ('CELULAR',          'Uso del celular',        TRUE,  4),
  ('CASCO_CINTURON',   'Casco o cinturón',       TRUE,  5),
  ('ESTACIONAMIENTO',  'Estacionamiento',        FALSE, 6),
  ('DOCUMENTOS',       'Documentos y licencias', FALSE, 7),
  ('OTRAS',            'Otras',                  FALSE, 8),
  ('SIN_CLASIFICAR',   'Sin clasificar',         FALSE, 9);

INSERT INTO catalogos (tipo, codigo, nombre, orden) VALUES
  ('conducta', 'EXCESO_VELOCIDAD',  'Exceso de velocidad', 1),
  ('conducta', 'ALCOHOL',           'Presunta conducción bajo efectos del alcohol', 2),
  ('conducta', 'SEMAFORO_PARE',     'No respetar semáforo o señal de pare', 3),
  ('conducta', 'CELULAR',           'Uso del celular al conducir', 4),
  ('conducta', 'CASCO_CINTURON',    'No uso de casco o cinturón', 5),
  ('conducta', 'OTRA',              'Otra conducta de riesgo', 6),
  ('infraestructura', 'PASO_PEATONAL',  'Falta de paso peatonal', 1),
  ('infraestructura', 'SENALIZACION',   'Señalización ausente o dañada', 2),
  ('infraestructura', 'REDUCTOR',       'Falta de reductor de velocidad o separador', 3),
  ('infraestructura', 'ILUMINACION',    'Iluminación deficiente', 4),
  ('infraestructura', 'ESTADO_VIA',     'Mal estado de la vía', 5),
  ('infraestructura', 'ANDEN_CICLORRUTA','Falta de andén o ciclorruta', 6),
  ('infraestructura', 'OTRA',           'Otra deficiencia', 7);
