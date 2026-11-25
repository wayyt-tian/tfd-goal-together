FROM node:24-alpine
ARG ALPINE_MIRROR=https://dl-cdn.alpinelinux.org/alpine
RUN sed -i "s|https://dl-cdn.alpinelinux.org/alpine|${ALPINE_MIRROR}|g" /etc/apk/repositories \
    && apk add --no-cache postgresql16-client python3
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY web ./web
COPY assets ./assets
COPY tests ./tests
COPY scripts ./scripts
COPY tools ./tools
COPY vite.config.mjs ./
CMD ["npm", "test"]
