FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.base.json ./
COPY packages/game-core/package.json packages/game-core/package.json
COPY apps/game-server/package.json apps/game-server/package.json
RUN npm ci
COPY packages/game-core packages/game-core
COPY apps/game-server apps/game-server
RUN npm run build -w @print-rush/game-core && npm run build -w @print-rush/game-server

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/game-core/dist ./packages/game-core/dist
COPY --from=build /app/packages/game-core/package.json ./packages/game-core/package.json
COPY --from=build /app/apps/game-server/dist ./apps/game-server/dist
COPY --from=build /app/apps/game-server/package.json ./apps/game-server/package.json
EXPOSE 2567
CMD ["node", "apps/game-server/dist/index.js"]
