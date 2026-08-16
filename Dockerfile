FROM node:20-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Vite reads VITE_* variables at build time. Railway Dockerfile builds only expose
# service variables that are explicitly declared as ARGs. Keep this public feature
# flag scoped to the build stage so the browser bundle matches the server rollout.
ARG VITE_FEATURE_ABA_V3_UI=false
ENV VITE_FEATURE_ABA_V3_UI=${VITE_FEATURE_ABA_V3_UI}

RUN npm run build
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/services ./services
COPY --from=build /app/src/services ./src/services
COPY --from=build /app/src/server ./src/server
COPY --from=build /app/src/utils ./src/utils
COPY --from=build /app/src/constants ./src/constants
COPY --from=build /app/server.ts ./server.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json

EXPOSE 8080

CMD ["npm", "run", "start"]
