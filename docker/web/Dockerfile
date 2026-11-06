# syntax=docker/dockerfile:1

# The editor's browser build (pnpm build:web), served at /projects by Caddy.
# CI pushes this image to ghcr.io; polemic-server's Compose stack runs it
# behind its own Caddy, on the services app's origin. Build from the
# repository root: docker build -f docker/web/Dockerfile .

FROM node:22-alpine AS build
WORKDIR /app
RUN npm install --global pnpm@12.6.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm build:web

FROM caddy:2-alpine
COPY docker/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist-web /srv/projects
EXPOSE 80
