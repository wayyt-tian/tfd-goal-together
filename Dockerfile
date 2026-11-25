FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY web ./web
COPY vite.config.mjs ./
RUN npm run build

FROM node:24-alpine
ARG ALPINE_MIRROR=https://dl-cdn.alpinelinux.org/alpine
RUN sed -i "s|https://dl-cdn.alpinelinux.org/alpine|${ALPINE_MIRROR}|g" /etc/apk/repositories \
    && apk add --no-cache postgresql16-client python3
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/web/dist ./web/dist
COPY src ./src
COPY assets ./assets
COPY scripts ./scripts
RUN mkdir -p /data/backups /data/workbench && chown -R node:node /data /app
USER node
ENV HOST=0.0.0.0 PORT=4173 BACKUP_DIR=/data/backups
EXPOSE 4173
CMD ["node", "src/server.cjs"]
