# Image van Avanta Reizen: Node 22 zonder build-stap; data (afbeeldingen, sleutel) in het volume /data.
FROM node:22-alpine
# pg_dump/pg_restore voor de versleutelde back-ups (zelfde hoofdversie als de database: PostgreSQL 17).
RUN apk add --no-cache postgresql17-client
ENV NODE_ENV=production PORT=3400 DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
COPY tools ./tools
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3400
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3400/api/health >/dev/null || exit 1
CMD ["node", "src/server.js"]
