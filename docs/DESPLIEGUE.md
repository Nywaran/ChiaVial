# Despliegue de ChíaVial en un VPS con aaPanel

Esta guía publica ChíaVial en un VPS administrado con **aaPanel**. La aplicación corre en **Docker** (dos contenedores: la app Node.js y PostgreSQL/PostGIS) y aaPanel pone el dominio, el certificado HTTPS (Let's Encrypt) y el proxy inverso Nginx.

```
Internet ──HTTPS 443──► Nginx de aaPanel (SSL) ──► 127.0.0.1:3000  contenedor «app» (API + web compilada)
                                                          │
                                                          └──► contenedor «db» (PostgreSQL 16 + PostGIS, sin puertos públicos)
Bot de Telegram ◄──HTTPS saliente (polling)── contenedor «app»
```

## 1. Qué archivos se despliegan

Se sube **el repositorio completo** (con `git clone`), sin dependencias ni compilados: Docker los instala y compila dentro de la imagen.

| Ruta | Para qué sirve en el servidor |
|---|---|
| `Dockerfile` | Construye la imagen: compila la web (React) y la sirve desde la API |
| `docker-compose.prod.yml` | **Archivo de producción**: servicios `app` y `db`, volúmenes, reinicio automático |
| `.env` (se crea en el VPS) | Secretos y configuración. Se copia de `.env.produccion.example`. **Nunca se sube a GitHub** |
| `.env.produccion.example` | Plantilla con todas las variables de producción |
| `.dockerignore` | Evita meter en la imagen `node_modules`, `.env`, pruebas, etc. |
| `api/` | Código del servidor: `package.json`, `package-lock.json`, `src/` (rutas, migraciones SQL, ETL, cifrado, Telegram) |
| `web/` | Código de la interfaz: `package.json`, `package-lock.json`, `index.html`, `public/`, `src/`, configuración de Vite/TypeScript |
| `data/` | Archivos de datos abiertos (siniestros, comparendos, vehículos, veredas) para la ingesta inicial |
| `deploy/nginx-chiavial.conf` | Bloque de proxy inverso para pegar en el sitio de aaPanel |
| `deploy/respaldo.sh` | Respaldo diario de la base de datos y las fotos (Cron de aaPanel) |
| `deploy/actualizar.sh` | Publica una versión nueva (`git pull` + reconstrucción) |

**No se suben:** `node_modules/`, `web/dist/`, `api/uploads/` ni `api/.env` (el de desarrollo); ya están en `.gitignore`. Archivos que llegan con el `git clone` pero no se usan en producción: `docker-compose.yml` (pruebas locales con Mailpit), `api/test/`, `.github/` y `docs/` (`.dockerignore` los deja fuera de la imagen).

Lo que se **genera en el servidor** y hay que respaldar: el volumen `chiavial_datos_db` (base de datos) y el volumen `chiavial_fotos` (fotos de reportes). `deploy/respaldo.sh` guarda ambos.

## 2. Requisitos

- VPS con Ubuntu 22.04/24.04 (o Debian 12), **2 GB de RAM** mínimo, 20 GB de disco.
- aaPanel instalado y un **dominio** (o subdominio) con registro A apuntando a la IP del VPS.
- Puertos abiertos en el firewall: 80, 443 y el del panel. **No abra 3000 ni 5432**.

## 3. Paso a paso

### 3.1 Instalar Docker
aaPanel → **App Store** → busque **Docker** → Install. (Por terminal: `curl -fsSL https://get.docker.com | sh`.) Compruebe con `docker compose version`.

### 3.2 Descargar el código
aaPanel → **Terminal**:
```bash
cd /www/wwwroot
git clone https://github.com/Nywaran/ChiaVial.git chiavial
cd chiavial
```
(Si el repositorio es privado, use un token personal de GitHub o suba un .zip en **Files** y descomprímalo en `/www/wwwroot/chiavial`.)

### 3.3 Crear el archivo `.env`
```bash
cp .env.produccion.example .env
openssl rand -base64 32   # copie el resultado en JWT_SECRET
openssl rand -base64 32   # copie el resultado en CIFRADO_CLAVE
nano .env                 # o edítelo desde Files de aaPanel
```
Mínimo: `APP_URL` (con https), `DB_PASSWORD`, `JWT_SECRET`, `CIFRADO_CLAVE`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.

> ⚠️ **Guarde `CIFRADO_CLAVE` en un lugar seguro y no la cambie.** Con ella se cifran las placas y los chats de Telegram; si se pierde, esos datos no se pueden recuperar.

### 3.4 Levantar los contenedores
```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f app     # Ctrl+C para salir
```
Al primer arranque se crean las tablas (migraciones), el administrador inicial y, a los 5 segundos, se cargan los datos abiertos de `data/`. Verifique: `curl http://127.0.0.1:3000/api/salud` → `{"ok":true}`.

### 3.5 Crear el sitio, el certificado y el proxy en aaPanel
1. **Website → Add site**: dominio `chiavial.midominio.co`, sin base de datos, PHP «Static».
2. En el sitio → **SSL → Let's Encrypt** → seleccione el dominio → Apply. Active **Force HTTPS**.
3. En el sitio → **Reverse proxy → Add**: destino `http://127.0.0.1:3000`, «Send domain» `$host`.
   Alternativa equivalente: **Conf** → pegue el contenido de `deploy/nginx-chiavial.conf` dentro del bloque `server` del 443.
4. Asegúrese de que el tamaño máximo de subida sea de al menos 20 MB (`client_max_body_size 20m;`).

Abra `https://chiavial.midominio.co`, ingrese con el administrador y cambie su contraseña.

### 3.6 Bot de Telegram
1. En Telegram, hable con **@BotFather** → `/newbot` → nombre `ChíaVial` → usuario, por ejemplo `ChiaVialBot`. Copie el **token**.
2. (Opcional) `/setcommands` en BotFather:
   ```
   estado - Ver mis reportes
   desvincular - Dejar de recibir notificaciones
   ayuda - Ayuda
   ```
3. En `.env`: `TELEGRAM_BOT_TOKEN=…`, `TELEGRAM_BOT_USERNAME=ChiaVialBot`, `TELEGRAM_MODO=polling`.
4. Reinicie: `docker compose -f docker-compose.prod.yml up -d`. En el log debe aparecer `[telegram] bot @ChiaVialBot en modo polling`.
5. Pruebe: en ChíaVial → **Mi cuenta → Vincular Telegram** → abra el enlace → **Iniciar**. Luego **Administración → Telegram → Enviarme un mensaje de prueba**.

*Modo webhook (opcional):* `TELEGRAM_MODO=webhook` y `TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 24)`. Telegram enviará los mensajes a `https://su-dominio/api/telegram/webhook`. Requiere HTTPS válido; el modo polling no lo necesita.

### 3.7 Respaldos automáticos
aaPanel → **Cron → Add task** → tipo *Shell Script*, diario a las 3:00:
```bash
bash /www/wwwroot/chiavial/deploy/respaldo.sh
```
Los respaldos quedan en `/www/backup/chiavial` (14 días). Restaurar:
```bash
docker compose -f docker-compose.prod.yml exec -T db pg_restore -U chiavial -d chiavial --clean < /www/backup/chiavial/chiavial-AAAAMMDD-HHMM.dump
```

### 3.8 Publicar cambios
```bash
cd /www/wwwroot/chiavial && bash deploy/actualizar.sh
```
Las migraciones nuevas de la base de datos se aplican solas al arrancar.

## 4. Lista de verificación

- [ ] `https://` abre la página con candado y redirige desde `http://`.
- [ ] Ingreso del administrador y cambio de contraseña.
- [ ] Observatorio con 165 siniestros y 22.883 comparendos.
- [ ] **Tablero** (funcionario/administrador) con los gráficos de Google Charts.
- [ ] Registro de un ciudadano y reporte de prueba; el funcionario lo ve en el Panel con la placa.
- [ ] Vinculación con Telegram y mensaje de prueba; cambio de estado → llega el aviso al ciudadano.
- [ ] `docker compose -f docker-compose.prod.yml ps` muestra `healthy`.
- [ ] Desde fuera, `telnet IP 5432` y `telnet IP 3000` **no** conectan.
- [ ] Primer respaldo generado en `/www/backup/chiavial`.

## 5. Problemas frecuentes

| Síntoma | Causa y solución |
|---|---|
| `Defina CIFRADO_CLAVE en producción` en el log | Falta la clave en `.env`. Genérela con `openssl rand -base64 32`. |
| 502 Bad Gateway | El contenedor `app` no está arriba: `docker compose -f docker-compose.prod.yml logs app`. |
| No se puede iniciar sesión por https | Revise que `APP_URL` empiece por `https://` (la cookie de sesión usa `Secure`). |
| «413 Request Entity Too Large» al subir fotos | Falta `client_max_body_size 20m;` en la configuración del sitio. |
| El tablero no muestra gráficos | El navegador no alcanza `www.gstatic.com` (Google Charts). Se muestran las tablas de datos como respaldo. |
| El bot no responde | Revise `TELEGRAM_BOT_TOKEN` y el log `[telegram]`. Solo un servidor puede hacer polling con el mismo bot. |

## 6. Alternativa sin Docker

Es posible con **Website → Node project** de aaPanel (Node 22, comando `npm start` en `api/`, compilando antes `web/` con `npm ci && npm run build`) y PostgreSQL 16 instalado en el sistema, **pero la base de datos necesita la extensión PostGIS**, que el gestor de PostgreSQL de aaPanel no instala. Habría que instalarla a mano (`apt install postgresql-16-postgis-3`). Por eso se recomienda Docker.
