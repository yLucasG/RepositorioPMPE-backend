-- Cria a tabela VisualizacaoTrabalho (trava anti-abuso do contador de visualizações).
-- Gerado a partir do diff real do schema Prisma (prisma migrate diff), não escrito à mão.
-- Rode isso UMA VEZ no banco de produção antes de fazer deploy do código que a usa.

-- CreateTable
CREATE TABLE "VisualizacaoTrabalho" (
    "id" TEXT NOT NULL,
    "trabalhoId" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "visualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisualizacaoTrabalho_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VisualizacaoTrabalho_visualizadoEm_idx" ON "VisualizacaoTrabalho"("visualizadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "VisualizacaoTrabalho_trabalhoId_ipHash_key" ON "VisualizacaoTrabalho"("trabalhoId", "ipHash");

-- AddForeignKey
ALTER TABLE "VisualizacaoTrabalho" ADD CONSTRAINT "VisualizacaoTrabalho_trabalhoId_fkey" FOREIGN KEY ("trabalhoId") REFERENCES "TrabalhoAcademico"("id") ON DELETE CASCADE ON UPDATE CASCADE;
