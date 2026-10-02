# ChíaVial · imagen única: compila la web y la sirve desde la API
FROM node:22-alpine AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app/api
COPY api/package*.json ./
RUN npm ci --omit=dev
COPY api/ ./
COPY --from=web /app/web/dist /app/web/dist
COPY data/ /app/data/
RUN mkdir -p /app/api/uploads && chown -R node:node /app/api/uploads
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
