FROM node:24-alpine
RUN apk add --no-cache postgresql16-client python3
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
