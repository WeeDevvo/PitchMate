# Build stage
FROM node:22-alpine AS build
WORKDIR /app

# Copy root package files and package manifests for dependency restore caching
COPY package.json package-lock.json ./
COPY .npmrc ./
COPY packages/api-client/package.json ./packages/api-client/
COPY apps/web/package.json ./apps/web/

RUN npm ci

# Copy sources
COPY packages/ ./packages/
COPY apps/web/ ./apps/web/

# Build packages and web client
RUN npm run build --workspace @pitchmate/web

# Production serving stage
FROM nginx:alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
