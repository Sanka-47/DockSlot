# syntax=docker/dockerfile:1
#
# DockSlot backend image.
#
# One image serves both long-running Node processes:
#   - the API + outbox worker:  node dist/index.js            (port 5000)
#   - the mock carrier service: node dist/mock-carrier/server.js (port 4001)
#
# The build is multi-stage so the Alpine toolchain needed to compile native
# modules (bcrypt) and the npm cache never reach the final image.
#
# Runtime dependencies are intentionally *not* pruned: docker-compose starts
# the container with `prisma db push` and `prisma db seed`, and the seed is
# invoked through ts-node, so the Prisma CLI, ts-node and TypeScript must be
# present at runtime.

FROM node:18-alpine AS build
WORKDIR /app

# Prisma's query engine links against OpenSSL on Alpine. python3/make/g++ are
# only used if bcrypt has no musl prebuild and compiles from source.
RUN apk add --no-cache openssl libc6-compat python3 make g++

# Install from the lockfile first so this layer is cached until dependencies change.
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

COPY backend/tsconfig.json ./
COPY backend/prisma ./prisma
COPY backend/src ./src

# `prisma generate` is platform-specific: running it inside the Alpine build
# stage produces the musl query engine that the runtime stage will load. The
# datasource URL is never connected during generate, so a placeholder is fine.
ENV DATABASE_URL="mysql://build:build@localhost:3306/build"
RUN npx prisma generate

# Compile TypeScript (src -> dist). This also produces dist/mock-carrier/server.js.
RUN npm run build

# ---------------------------------------------------------------------------

FROM node:18-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

ENV NODE_ENV=production

# Copy the dependency tree and compiled output from the build stage. Ownership
# is handed to the unprivileged `node` user: `prisma db push` regenerates the
# client into node_modules on first boot, and ts-node needs to read the project.
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/prisma ./prisma
COPY --chown=node:node backend/package.json backend/package-lock.json ./
# ts-node (used by `prisma db seed`) needs the compiler options - notably
# esModuleInterop, which the seed's default imports rely on.
COPY --chown=node:node backend/tsconfig.json ./tsconfig.json

USER node

# 5000 = API, 4001 = mock carrier
EXPOSE 5000 4001

# Starts the HTTP server and the transactional outbox worker (src/index.ts).
CMD ["node", "dist/index.js"]
