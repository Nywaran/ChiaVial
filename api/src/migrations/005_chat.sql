-- Chat de atención: visitantes (anónimos o con sesión) escriben desde la web;
-- el equipo recibe el aviso en Telegram y responde desde /atencion/:id en tiempo real.

CREATE TABLE chat_conversaciones (
  id                 SERIAL PRIMARY KEY,
  token_hash         TEXT NOT NULL UNIQUE,              -- SHA-256 del token que guarda el navegador del visitante
  nombre_cifrado     TEXT,                              -- nombre opcional del visitante (AES-256-GCM)
  pagina             TEXT,                              -- ruta desde la que escribió por primera vez
  usuario_id         INT REFERENCES usuarios(id) ON DELETE SET NULL,  -- si el visitante tenía sesión
  estado             TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'cerrada')),
  atendida_por       INT REFERENCES usuarios(id) ON DELETE SET NULL,
  ultimo_aviso_en    TIMESTAMPTZ,                       -- último aviso enviado a Telegram (evita saturar el grupo)
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX chat_conversaciones_estado_idx ON chat_conversaciones (estado, actualizado_en DESC);

CREATE TABLE chat_mensajes (
  id               BIGSERIAL PRIMARY KEY,
  conversacion_id  INT NOT NULL REFERENCES chat_conversaciones(id) ON DELETE CASCADE,
  autor            TEXT NOT NULL CHECK (autor IN ('visitante', 'equipo', 'sistema')),
  usuario_id       INT REFERENCES usuarios(id) ON DELETE SET NULL,  -- miembro del equipo que respondió
  texto_cifrado    TEXT NOT NULL,                                   -- AES-256-GCM
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX chat_mensajes_conversacion_idx ON chat_mensajes (conversacion_id, id);

COMMENT ON COLUMN chat_conversaciones.token_hash IS 'SHA-256 del token de acceso del visitante (nunca se guarda en claro)';
COMMENT ON COLUMN chat_mensajes.texto_cifrado IS 'Texto del mensaje cifrado con AES-256-GCM (contexto chat_mensajes.texto)';
