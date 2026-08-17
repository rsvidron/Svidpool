# Multi-stage so the running image carries the built files and a server, and
# none of the toolchain.
#
# A Dockerfile rather than Nixpacks autodetection: vite and typescript live in
# devDependencies, and an autodetected build that decides to install production
# deps only would fail to build at all. This is explicit and reproducible.

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/dist ./dist
COPY server.mjs ./

# Railway overrides PORT at runtime; this is only the local default.
ENV PORT=3000
EXPOSE 3000

USER node
CMD ["node", "server.mjs"]
