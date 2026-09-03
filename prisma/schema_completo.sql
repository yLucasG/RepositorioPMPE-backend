-- Schema completo do banco (todas as tabelas), gerado a partir de prisma/schema.prisma
-- via `prisma migrate diff --from-empty`. Use isso para criar o banco do zero em
-- qualquer Postgres novo (ambiente local de desenvolvimento ou servidor do DTEC/PMPE).
--
-- Depois de rodar, crie um admin manualmente (não há endpoint de cadastro):
--   INSERT INTO "Admin" (id, usuario, "senhaHash")
--   VALUES ('algum-id-unico', 'nome_do_usuario', '<hash bcrypt da senha>');
-- Gere o hash bcrypt com: node -e "console.log(require('bcryptjs').hashSync('SENHA_AQUI', 10))"

CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "TrabalhoAcademico" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "autor" TEXT NOT NULL,
    "resumo" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "categoria" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT '',
    "url_arquivo" TEXT NOT NULL,
    "referencias" TEXT[],
    "visualizacoes" INTEGER NOT NULL DEFAULT 0,
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrabalhoAcademico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Admin" (
    "id" TEXT NOT NULL,
    "usuario" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualizacaoTrabalho" (
    "id" TEXT NOT NULL,
    "trabalhoId" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "visualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisualizacaoTrabalho_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Admin_usuario_key" ON "Admin"("usuario");

-- CreateIndex
CREATE INDEX "VisualizacaoTrabalho_visualizadoEm_idx" ON "VisualizacaoTrabalho"("visualizadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "VisualizacaoTrabalho_trabalhoId_ipHash_key" ON "VisualizacaoTrabalho"("trabalhoId", "ipHash");

-- AddForeignKey
ALTER TABLE "VisualizacaoTrabalho" ADD CONSTRAINT "VisualizacaoTrabalho_trabalhoId_fkey" FOREIGN KEY ("trabalhoId") REFERENCES "TrabalhoAcademico"("id") ON DELETE CASCADE ON UPDATE CASCADE;
