FROM node:20-alpine AS base

# Install dependencies for both client and server
FROM base AS deps
WORKDIR /app
COPY package.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
COPY server/prisma ./server/prisma/
RUN cd client && npm install
RUN cd server && npm install

# Build client
FROM deps AS build-client
WORKDIR /app
COPY client/ ./client/
RUN cd client && npx vite build

# Build server
FROM deps AS build-server
WORKDIR /app
COPY server/ ./server/
RUN cd server && npx tsc

# Production
FROM base AS production
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=deps /app/server/prisma ./server/prisma
COPY --from=build-server /app/server/dist ./server/dist
COPY --from=build-client /app/client/dist ./client/dist
COPY server/package.json ./server/

RUN mkdir -p server/uploads

EXPOSE 3001

CMD ["sh", "-c", "cd server && npx prisma migrate deploy && node dist/index.js"]
