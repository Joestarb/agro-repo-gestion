FROM node:20-alpine

WORKDIR /app

# Instalar pnpm globalmente
RUN npm install -g pnpm

# Copiar configuración del workspace
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/agro-repo-ingestion/package.json apps/agro-repo-ingestion/

# Copiar la configuración base de TypeScript para que los paquetes (schemas, common, etc.)
COPY tsconfig.json ./


# Instalar dependencias del workspace
RUN pnpm install --frozen-lockfile

# Construir paquetes comunes si los usas
RUN pnpm --filter @agro-project/schemas build
RUN pnpm --filter @agro-project/common build

# Copiar el código fuente del ingestion
COPY apps/agro-repo-ingestion ./apps/agro-repo-ingestion

WORKDIR /app/apps/agro-repo-ingestion

# Compilar ingestion
RUN pnpm run build

CMD ["pnpm", "run", "start:dev"]
