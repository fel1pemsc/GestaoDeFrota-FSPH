ALTER TABLE "veiculos"
    ADD COLUMN "propriedade" VARCHAR(10) NOT NULL DEFAULT 'PROPRIO',
    ADD COLUMN "ano" INTEGER,
    ADD COLUMN "combustivel" VARCHAR(30),
    ADD COLUMN "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "veiculos" ADD CONSTRAINT "veiculos_status_check"
    CHECK ("status" IN ('DISPONIVEL', 'EM_VIAGEM', 'MANUTENCAO', 'DESINFECCAO'));

ALTER TABLE "veiculos" ADD CONSTRAINT "veiculos_propriedade_check"
    CHECK ("propriedade" IN ('PROPRIO', 'LOCADO'));

ALTER TABLE "veiculos" ADD CONSTRAINT "veiculos_desinfeccao_somente_svo_check"
    CHECK ("status" <> 'DESINFECCAO' OR "tipo_frota" = 'SVO');

ALTER TABLE "veiculos" ADD CONSTRAINT "veiculos_placa_formato_check"
    CHECK ("placa" ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$');

ALTER TABLE "veiculos" ADD CONSTRAINT "veiculos_ano_check"
    CHECK ("ano" IS NULL OR ("ano" BETWEEN 1950 AND 2100));

CREATE INDEX "veiculos_ativo_idx" ON "veiculos"("ativo");