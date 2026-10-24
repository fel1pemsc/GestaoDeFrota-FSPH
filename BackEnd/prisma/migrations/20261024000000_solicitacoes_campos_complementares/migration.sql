ALTER TABLE "solicitacoes_viagem"
    ADD COLUMN "protocolo" VARCHAR(20),
    ADD COLUMN "data_hora_retorno_prevista" TIMESTAMP(3),
    ADD COLUMN "quantidade_passageiros" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "tipo_transporte" VARCHAR(30) NOT NULL DEFAULT 'PASSAGEIROS',
    ADD COLUMN "justificativa" TEXT,
    ADD COLUMN "observacoes" TEXT,
    ADD COLUMN "motivo_recusa" TEXT,
    ADD COLUMN "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "contadores_protocolo" (
    "prefixo" VARCHAR(10) NOT NULL,
    "ano" INTEGER NOT NULL,
    "ultimo_valor" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "contadores_protocolo_pkey" PRIMARY KEY ("prefixo", "ano"),
    CONSTRAINT "contadores_protocolo_ultimo_valor_check" CHECK ("ultimo_valor" >= 0)
);

WITH numeradas AS (
    SELECT
        "id",
        EXTRACT(YEAR FROM "criado_em")::INTEGER AS "ano",
        ROW_NUMBER() OVER (
            PARTITION BY EXTRACT(YEAR FROM "criado_em")
            ORDER BY "criado_em", "id"
        ) AS "sequencia"
    FROM "solicitacoes_viagem"
    WHERE "protocolo" IS NULL
)
UPDATE "solicitacoes_viagem" AS s
SET "protocolo" = 'SV-' || n."ano" || '-' || LPAD(n."sequencia"::TEXT, GREATEST(4, LENGTH(n."sequencia"::TEXT)), '0')
FROM numeradas AS n
WHERE s."id" = n."id";

INSERT INTO "contadores_protocolo" ("prefixo", "ano", "ultimo_valor")
SELECT 'SV', EXTRACT(YEAR FROM "criado_em")::INTEGER, COUNT(*)
FROM "solicitacoes_viagem"
GROUP BY EXTRACT(YEAR FROM "criado_em");

ALTER TABLE "solicitacoes_viagem" ALTER COLUMN "protocolo" SET NOT NULL;
CREATE UNIQUE INDEX "solicitacoes_viagem_protocolo_key" ON "solicitacoes_viagem"("protocolo");

DROP INDEX "solicitacoes_viagem_solicitante_id_idx";
CREATE INDEX "solicitacoes_viagem_solicitante_id_criado_em_idx" ON "solicitacoes_viagem"("solicitante_id", "criado_em");
CREATE INDEX "solicitacoes_viagem_criado_em_idx" ON "solicitacoes_viagem"("criado_em");

ALTER TABLE "solicitacoes_viagem"
    ADD CONSTRAINT "solicitacoes_viagem_protocolo_formato_check"
        CHECK ("protocolo" ~ '^SV-[0-9]{4}-[0-9]{4,}$'),
    ADD CONSTRAINT "solicitacoes_viagem_status_check"
        CHECK ("status" IN ('PENDENTE', 'APROVADA', 'EM_TRANSITO', 'CONCLUIDA', 'RECUSADA')),
    ADD CONSTRAINT "solicitacoes_viagem_urgencia_check"
        CHECK ("urgencia" IN ('NORMAL', 'URGENTE')),
    ADD CONSTRAINT "solicitacoes_viagem_tipo_transporte_check"
        CHECK ("tipo_transporte" IN ('PASSAGEIROS', 'MATERIAL_BIOLOGICO', 'DOCUMENTOS_INSUMOS', 'MISTO')),
    ADD CONSTRAINT "solicitacoes_viagem_quantidade_passageiros_check"
        CHECK ("quantidade_passageiros" BETWEEN 0 AND 15),
    ADD CONSTRAINT "solicitacoes_viagem_passageiros_por_tipo_check"
        CHECK ("tipo_transporte" IN ('MATERIAL_BIOLOGICO', 'DOCUMENTOS_INSUMOS') OR "quantidade_passageiros" >= 1),
    ADD CONSTRAINT "solicitacoes_viagem_retorno_check"
        CHECK ("data_hora_retorno_prevista" IS NULL OR "data_hora_pretendida" IS NULL OR "data_hora_retorno_prevista" > "data_hora_pretendida"),
    ADD CONSTRAINT "solicitacoes_viagem_motivo_recusa_check"
        CHECK ("status" <> 'RECUSADA' OR ("motivo_recusa" IS NOT NULL AND BTRIM("motivo_recusa") <> ''));

INSERT INTO "perfis" ("nome", "descricao") VALUES
    ('SOLICITANTE', 'Solicitante de viagens institucionais')
ON CONFLICT ("nome") DO NOTHING;
