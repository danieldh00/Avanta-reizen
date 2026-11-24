# Image van Avanta Reizen: Node 22; data (afbeeldingen, sleutel) in het volume /data.
# Eén bouwstap: de publieke CSS en JavaScript worden verkleind (tools/minify-public.js, esbuild alleen hier). De bron
# in public/ blijft leesbaar; het image krijgt de verkleinde bestanden over de bron heen.
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS minify
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY public ./public
COPY tools/minify-public.js ./tools/minify-public.js
RUN node tools/minify-public.js public public-min

FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a
# pg_dump/pg_restore voor de versleutelde back-ups (zelfde hoofdversie als de database: PostgreSQL 17).
RUN apk add --no-cache postgresql17-client
ENV NODE_ENV=production PORT=3400 DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
# npm en corepack zijn na de installatie niet meer nodig (de app start met `node`); weghalen verkleint het image en haalt
# de kwetsbaarheden in de meegeleverde npm-pakketten weg, die de image-scan (Trivy) anders terecht meldt.
RUN npm ci --omit=dev && npm cache clean --force \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /root/.npm
COPY src ./src
COPY public ./public
COPY --from=minify /build/public-min ./public
COPY tools ./tools
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3400
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3400/api/health >/dev/null || exit 1
CMD ["node", "src/server.js"]
