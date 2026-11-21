# syntax=docker/dockerfile:1

FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

# Dummy URL only for `prisma generate` during build.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"

RUN npm ci

COPY . .

# Prisma v7 emits TypeScript sources; they must exist before `nest build`.
RUN npx prisma generate
RUN npm run build
RUN test -f dist/generated/prisma/internal/class.js

FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

# Client is compiled into dist/; skip postinstall to avoid needing DATABASE_URL here.
RUN npm ci --omit=dev --ignore-scripts && npm install prisma --no-save --ignore-scripts

COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["npm", "run", "start:prod"]
