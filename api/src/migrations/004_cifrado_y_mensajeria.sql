-- ChíaVial · cifrado de datos sensibles y servicio de mensajería (Telegram)

-- Los tokens de un solo uso pasan a guardarse como huella SHA-256 (64 caracteres hex).
-- Los tokens en texto plano emitidos antes de esta migración dejan de servir.
UPDATE usuarios SET token_verificacion = NULL WHERE token_verificacion IS NOT NULL AND length(token_verificacion) <> 64;
UPDATE usuarios SET token_reset = NULL, token_reset_expira = NULL WHERE token_reset IS NOT NULL AND length(token_reset) <> 64;
COMMENT ON COLUMN usuarios.token_verificacion IS 'SHA-256 del token de activación';
COMMENT ON COLUMN usuarios.token_reset IS 'SHA-256 del token de recuperación de contraseña';

-- La placa se guarda cifrada con AES-256-GCM (formato v1:...). La migración de los
-- valores anteriores se hace en JavaScript (lib/migracion-cifrado.js).
COMMENT ON COLUMN reportes.placa IS 'Placa cifrada con AES-256-GCM; solo la descifra el servidor para funcionarios';

-- Preferencia de notificaciones
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS notif_telegram BOOLEAN NOT NULL DEFAULT TRUE;

-- Vínculo de una cuenta con un chat de Telegram
CREATE TABLE telegram_vinculos (
  usuario_id       INT PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  chat_id_cifrado  TEXT NOT NULL,           -- AES-256-GCM
  chat_id_hmac     TEXT NOT NULL UNIQUE,    -- HMAC-SHA256 (índice ciego para buscar por chat)
  vinculado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Códigos de vinculación de un solo uso (se guarda la huella SHA-256, vencen en 15 minutos)
CREATE TABLE telegram_codigos (
  codigo_hash  TEXT PRIMARY KEY,
  usuario_id   INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_en    TIMESTAMPTZ NOT NULL,
  usado_en     TIMESTAMPTZ
);

-- Estado del bot (último update_id procesado en modo polling)
CREATE TABLE telegram_estado (
  clave  TEXT PRIMARY KEY,
  valor  TEXT
);

-- Registro de todas las notificaciones enviadas por cualquier canal
CREATE TABLE notificaciones (
  id          BIGSERIAL PRIMARY KEY,
  usuario_id  INT REFERENCES usuarios(id) ON DELETE SET NULL,
  canal       TEXT NOT NULL CHECK (canal IN ('correo', 'telegram')),
  evento      TEXT NOT NULL,
  estado      TEXT NOT NULL CHECK (estado IN ('enviado', 'error', 'sin_configurar')),
  detalle     TEXT,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notificaciones_fecha_idx ON notificaciones (creado_en);
