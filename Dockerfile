# Imagem self-hosted (DTEC/PMPE): builda o frontend (repositório separado) e a API
# (este repositório) e roda tudo num único processo Node (api/server.ts), servindo
# o front, a API e os PDFs enviados.
#
# O frontend vive num repositório à parte (RepositorioPMPE-frontend) — este build
# clona ele numa etapa própria. Pra trocar de branch/tag do frontend (ou apontar
# pra um fork), use os build args FRONTEND_REPO e FRONTEND_REF:
#   docker compose build --build-arg FRONTEND_REF=minha-branch

# ---- Build do frontend (repositório separado) ----
FROM node:22-slim AS frontend-builder
ARG FRONTEND_REPO=https://github.com/yLucasG/RepositorioPMPE-frontend.git
ARG FRONTEND_REF=main
WORKDIR /frontend
RUN apt-get update && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/*
RUN git clone --branch "${FRONTEND_REF}" --depth 1 "${FRONTEND_REPO}" .
RUN npm ci
RUN npm run build

# ---- Build do backend (este repositório) ----
FROM node:22-slim AS backend-builder
WORKDIR /app

# Só pra "prisma generate" (roda no postinstall do npm ci) não falhar por falta da
# variável — não conecta em banco nenhum nesta etapa.
ENV DATABASE_URL="postgresql://user:pass@localhost:5432/placeholder"

# Copia tudo (não só package*.json) ANTES do npm ci: o postinstall roda
# "prisma generate", que exige prisma/schema.prisma já presente — copiar só o
# package.json antes (padrão comum pra cache de layer) faz o build inteiro falhar
# aqui ("Could not find Prisma Schema"), confirmado testando esse cenário à parte.
COPY . .
RUN npm ci
# Redundante de propósito: já visto o "prisma generate" do postinstall gerar um
# client incompleto de vez em quando (erro de compilação "no exported member
# PrismaClient" no passo seguinte) — rodar de novo aqui evita isso sem custo.
RUN npx prisma generate
RUN npm run build

# ---- Runtime ----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV UPLOADS_DIR=/app/uploads
ENV ANGULAR_DIST=/app/dist/repositorio-angular/browser
ENV PORT=3000

COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/dist-server ./dist-server
COPY --from=backend-builder /app/prisma ./prisma
COPY --from=backend-builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=backend-builder /app/package.json ./
COPY --from=frontend-builder /frontend/dist/repositorio-angular/browser ./dist/repositorio-angular/browser

RUN mkdir -p /app/uploads

EXPOSE 3000
CMD ["node", "dist-server/server.js"]
