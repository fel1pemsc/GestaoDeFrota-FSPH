import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  usuarioFindUnique: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  groupBy: vi.fn(),
  create: vi.fn(),
  auditoriaCreate: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("../../../src/lib/prisma", () => ({
  prisma: {
    usuario: { findUnique: mocks.usuarioFindUnique },
    solicitacaoViagem: {
      findMany: mocks.findMany,
      count: mocks.count,
      groupBy: mocks.groupBy,
      create: mocks.create,
    },
    auditoriaSistema: { create: mocks.auditoriaCreate },
    $queryRaw: mocks.queryRaw,
    $transaction: mocks.transaction,
  },
}));

import { HttpError } from "../../../src/middleware/http_m";
import { prisma } from "../../../src/lib/prisma";
import {
  anoDoProtocolo,
  criarSolicitacao,
  criarSolicitacaoSchema,
  formatarProtocolo,
  listarSolicitacoes,
  listarSolicitacoesSchema,
  type CriarSolicitacaoInput,
} from "../../../src/service/solicitacao_s";

const usuarioId = "00000000-0000-4000-8000-000000000001";
const solicitante = { id: usuarioId, perfis: ["SOLICITANTE"] };
const gestor = { id: "00000000-0000-4000-8000-000000000002", perfis: ["GESTOR"] };

function emHoras(horas: number) {
  return new Date(Date.now() + horas * 60 * 60 * 1000);
}

const valido = {
  setorOrigem: "LACEN",
  origem: "LACEN — Rua Campo do Brito",
  destino: "Hospital Regional de Itabaiana",
  dataHoraPretendida: emHoras(24).toISOString(),
  justificativa: "Coleta de amostras para análise laboratorial.",
};

const entrada: CriarSolicitacaoInput = {
  setorOrigem: "LACEN",
  origem: "LACEN — Rua Campo do Brito",
  destino: "Hospital Regional de Itabaiana",
  dataHoraPretendida: new Date("2026-11-10T11:30:00.000Z"),
  dataHoraRetornoPrevista: undefined,
  quantidadePassageiros: 1,
  tipoTransporte: "PASSAGEIROS",
  urgencia: "NORMAL",
  justificativa: "Coleta de amostras para análise laboratorial.",
  observacoes: undefined,
};

const registro = {
  id: "00000000-0000-4000-8000-0000000000a1",
  protocolo: "SV-2026-0042",
  solicitanteId: usuarioId,
  setorOrigem: "LACEN",
  origem: "LACEN — Rua Campo do Brito",
  destino: "Hospital Regional de Itabaiana",
  dataHoraPretendida: new Date("2026-11-10T11:30:00.000Z"),
  dataHoraRetornoPrevista: null,
  quantidadePassageiros: 1,
  tipoTransporte: "PASSAGEIROS",
  urgencia: "NORMAL",
  status: "PENDENTE",
  justificativa: "Coleta de amostras para análise laboratorial.",
  observacoes: null,
  motivoRecusa: null,
  veiculoAlocadoId: null,
  motoristaAlocadoId: null,
  criadoEm: new Date("2026-10-24T12:00:00.000Z"),
  solicitante: { nome: "Marina Costa" },
  veiculoAlocado: null,
  motoristaAlocado: null,
};

async function erroDe(promessa: Promise<unknown>) {
  try {
    await promessa;
  } catch (error) {
    return error;
  }
  return undefined;
}

function campos(resultado: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return (resultado.error?.issues ?? []).map((issue) => issue.path.join(".")).sort();
}

describe("criarSolicitacaoSchema", () => {
  it("aplica os padrões, remove espaços e converte as datas", () => {
    const resultado = criarSolicitacaoSchema.parse({
      ...valido,
      origem: "  LACEN — Rua Campo do Brito  ",
      dataHoraRetornoPrevista: null,
      observacoes: "   ",
    });

    expect(resultado).toEqual({
      ...valido,
      dataHoraPretendida: new Date(valido.dataHoraPretendida),
      quantidadePassageiros: 1,
      tipoTransporte: "PASSAGEIROS",
      urgencia: "NORMAL",
    });
    expect(resultado.dataHoraRetornoPrevista).toBeUndefined();
    expect(resultado.observacoes).toBeUndefined();
  });

  it("aceita datas com fuso -03:00 ou Z e rejeita data sem fuso", () => {
    const local = emHoras(24).toISOString().slice(0, 19);

    expect(
      criarSolicitacaoSchema.safeParse({ ...valido, dataHoraPretendida: `${local}-03:00` }).success,
    ).toBe(true);
    expect(
      criarSolicitacaoSchema.safeParse({ ...valido, dataHoraPretendida: `${local}Z` }).success,
    ).toBe(true);
    expect(
      campos(criarSolicitacaoSchema.safeParse({ ...valido, dataHoraPretendida: local })),
    ).toEqual(["dataHoraPretendida"]);
    expect(
      campos(criarSolicitacaoSchema.safeParse({ ...valido, dataHoraPretendida: "amanhã cedo" })),
    ).toEqual(["dataHoraPretendida"]);
  });

  it("lista todos os campos obrigatórios sem quebrar com o body vazio", () => {
    expect(campos(criarSolicitacaoSchema.safeParse({}))).toEqual([
      "dataHoraPretendida",
      "destino",
      "justificativa",
      "origem",
      "setorOrigem",
    ]);
  });

  it.each([
    { caso: "origem curta", dados: { origem: "AB" } },
    { caso: "destino longo", dados: { destino: "x".repeat(151) } },
    { caso: "justificativa curta", dados: { justificativa: "curta" } },
    { caso: "justificativa longa", dados: { justificativa: "x".repeat(501) } },
    { caso: "observações longas", dados: { observacoes: "x".repeat(301) } },
    { caso: "tipo de transporte inválido", dados: { tipoTransporte: "ONIBUS" } },
    { caso: "urgência inválida", dados: { urgencia: "ALTA" } },
    { caso: "passageiros acima do limite", dados: { quantidadePassageiros: 16 } },
    { caso: "passageiros negativos", dados: { quantidadePassageiros: -1 } },
    { caso: "passageiros decimais", dados: { quantidadePassageiros: 1.5 } },
    { caso: "passageiros como texto", dados: { quantidadePassageiros: "2" } },
  ])("rejeita $caso", ({ dados }) => {
    expect(criarSolicitacaoSchema.safeParse({ ...valido, ...dados }).success).toBe(false);
  });

  it("exige saída futura, com tolerância de alguns minutos", () => {
    const passada = criarSolicitacaoSchema.safeParse({
      ...valido,
      dataHoraPretendida: emHoras(-1).toISOString(),
    });
    const dentroDaTolerancia = criarSolicitacaoSchema.safeParse({
      ...valido,
      dataHoraPretendida: new Date(Date.now() - 60 * 1000).toISOString(),
    });

    expect(campos(passada)).toEqual(["dataHoraPretendida"]);
    expect(passada.error?.issues[0]?.message).toBe("A data de saída deve ser futura.");
    expect(dentroDaTolerancia.success).toBe(true);
  });

  it("exige retorno posterior à saída", () => {
    const igual = criarSolicitacaoSchema.safeParse({
      ...valido,
      dataHoraRetornoPrevista: valido.dataHoraPretendida,
    });
    const depois = criarSolicitacaoSchema.safeParse({
      ...valido,
      dataHoraRetornoPrevista: emHoras(30).toISOString(),
    });

    expect(campos(igual)).toEqual(["dataHoraRetornoPrevista"]);
    expect(depois.success).toBe(true);
  });

  it("permite zero passageiros só para material biológico e documentos", () => {
    const semPassageiro = (tipoTransporte: string) =>
      criarSolicitacaoSchema.safeParse({ ...valido, tipoTransporte, quantidadePassageiros: 0 });

    expect(semPassageiro("MATERIAL_BIOLOGICO").success).toBe(true);
    expect(semPassageiro("DOCUMENTOS_INSUMOS").success).toBe(true);
    expect(campos(semPassageiro("PASSAGEIROS"))).toEqual(["quantidadePassageiros"]);
    expect(campos(semPassageiro("MISTO"))).toEqual(["quantidadePassageiros"]);
  });

  it("descarta campos que o solicitante não pode definir", () => {
    const resultado = criarSolicitacaoSchema.parse({
      ...valido,
      status: "APROVADA",
      solicitanteId: gestor.id,
      protocolo: "SV-2026-9999",
      veiculoAlocadoId: "00000000-0000-4000-8000-0000000000b1",
      motivoRecusa: "forjado",
    });

    expect(Object.keys(resultado)).not.toContain("status");
    expect(Object.keys(resultado)).not.toContain("solicitanteId");
    expect(Object.keys(resultado)).not.toContain("protocolo");
    expect(Object.keys(resultado)).not.toContain("veiculoAlocadoId");
    expect(Object.keys(resultado)).not.toContain("motivoRecusa");
  });
});

describe("listarSolicitacoesSchema", () => {
  it("usa a paginação padrão", () => {
    expect(listarSolicitacoesSchema.parse({})).toEqual({ page: 1, pageSize: 10 });
  });

  it("aceita status separados por vírgula ou repetidos e ignora valores vazios", () => {
    expect(listarSolicitacoesSchema.parse({ status: "APROVADA, EM_TRANSITO" }).status).toEqual([
      "APROVADA",
      "EM_TRANSITO",
    ]);
    expect(listarSolicitacoesSchema.parse({ status: ["PENDENTE", "RECUSADA"] }).status).toEqual([
      "PENDENTE",
      "RECUSADA",
    ]);
    expect(listarSolicitacoesSchema.parse({ status: "", busca: "  " })).toEqual({
      page: 1,
      pageSize: 10,
    });
  });

  it.each([
    { page: "0" },
    { pageSize: "101" },
    { status: "QUEBRADO" },
    { status: "PENDENTE,QUEBRADO" },
    { urgencia: "ALTA" },
    { tipoTransporte: "ONIBUS" },
    { busca: "x".repeat(101) },
  ])("rejeita %o", (query) => {
    expect(listarSolicitacoesSchema.safeParse(query).success).toBe(false);
  });
});

describe("listarSolicitacoes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findMany.mockResolvedValue([
      {
        ...registro,
        veiculoAlocado: { placa: "BRA2E19", modelo: "Chevrolet Spin" },
        motoristaAlocado: { usuario: { nome: "Carlos Alberto" } },
      },
    ]);
    mocks.count.mockResolvedValue(21);
    mocks.groupBy.mockResolvedValue([
      { status: "PENDENTE", _count: { _all: 4 } },
      { status: "APROVADA", _count: { _all: 2 } },
    ]);
  });

  it("restringe o solicitante às próprias solicitações", async () => {
    await listarSolicitacoes({ page: 1, pageSize: 10 }, solicitante);

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { solicitanteId: usuarioId } }),
    );
    expect(mocks.count).toHaveBeenCalledWith({ where: { solicitanteId: usuarioId } });
    expect(mocks.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { solicitanteId: usuarioId } }),
    );
  });

  it.each([["GESTOR"], ["ADMIN"], ["SOLICITANTE", "GESTOR"]])(
    "lista as solicitações de todos para %s",
    async (...perfis) => {
      await listarSolicitacoes({ page: 1, pageSize: 10 }, { id: usuarioId, perfis });

      expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    },
  );

  it("pagina, ordena pelas mais recentes e aplica os filtros", async () => {
    await listarSolicitacoes(
      {
        page: 3,
        pageSize: 5,
        status: ["APROVADA", "EM_TRANSITO"],
        urgencia: "URGENTE",
        tipoTransporte: "MISTO",
        busca: "itabaiana",
      },
      gestor,
    );

    const whereBase = {
      urgencia: "URGENTE",
      tipoTransporte: "MISTO",
      OR: [
        { protocolo: { contains: "itabaiana", mode: "insensitive" } },
        { origem: { contains: "itabaiana", mode: "insensitive" } },
        { destino: { contains: "itabaiana", mode: "insensitive" } },
      ],
    };
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ...whereBase, status: { in: ["APROVADA", "EM_TRANSITO"] } },
        orderBy: [{ criadoEm: "desc" }, { id: "desc" }],
        skip: 10,
        take: 5,
      }),
    );
    expect(mocks.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: whereBase }));
  });

  it("serializa nomes e relações e devolve a contagem por status", async () => {
    const resultado = await listarSolicitacoes({ page: 1, pageSize: 10 }, gestor);

    expect(resultado.meta).toEqual({
      page: 1,
      pageSize: 10,
      total: 21,
      totalPages: 3,
      porStatus: { PENDENTE: 4, APROVADA: 2, EM_TRANSITO: 0, CONCLUIDA: 0, RECUSADA: 0 },
    });
    expect(resultado.data[0]).toMatchObject({
      protocolo: "SV-2026-0042",
      solicitanteNome: "Marina Costa",
      veiculoAlocado: { placa: "BRA2E19", modelo: "Chevrolet Spin" },
      motoristaAlocado: { nome: "Carlos Alberto" },
    });
    expect(Object.keys(resultado.data[0] ?? {})).not.toContain("solicitante");
  });

  it("devolve motorista sem nome quando ele não tem usuário vinculado", async () => {
    mocks.findMany.mockResolvedValue([{ ...registro, motoristaAlocado: { usuario: null } }]);

    const resultado = await listarSolicitacoes({ page: 1, pageSize: 10 }, gestor);

    expect(resultado.data[0]?.motoristaAlocado).toEqual({ nome: null });
    expect(resultado.data[0]?.veiculoAlocado).toBeNull();
  });
});

describe("criarSolicitacao", () => {
  const agora = new Date("2026-10-24T12:00:00.000Z");

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.usuarioFindUnique.mockResolvedValue({ ativo: true });
    mocks.queryRaw.mockResolvedValue([{ ultimo_valor: 42 }]);
    mocks.create.mockResolvedValue(registro);
    mocks.auditoriaCreate.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
      callback(prisma),
    );
  });

  it("gera o protocolo, cria como PENDENTE e audita na mesma transação", async () => {
    const resposta = await criarSolicitacao(entrada, usuarioId, agora);

    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 5000,
      timeout: 10000,
    });
    expect(mocks.queryRaw).toHaveBeenCalledWith(expect.anything(), "SV", 2026);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          ...entrada,
          protocolo: "SV-2026-0042",
          status: "PENDENTE",
          solicitanteId: usuarioId,
        },
      }),
    );
    expect(mocks.auditoriaCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        usuarioId,
        acao: "CRIAR",
        tabelaAfetada: "solicitacoes_viagem",
        registroId: registro.id,
        dadosNovos: expect.objectContaining({
          protocolo: "SV-2026-0042",
          status: "PENDENTE",
          dataHoraPretendida: "2026-11-10T11:30:00.000Z",
          dataHoraRetornoPrevista: null,
        }),
      }),
    });
    expect(resposta).toMatchObject({ protocolo: "SV-2026-0042", solicitanteNome: "Marina Costa" });
  });

  it("não copia justificativa e observações para a auditoria", async () => {
    await criarSolicitacao({ ...entrada, observacoes: "Contato: ramal 2020" }, usuarioId, agora);

    const auditoria = mocks.auditoriaCreate.mock.calls[0]?.[0] as { data: { dadosNovos: object } };
    expect(Object.keys(auditoria.data.dadosNovos)).not.toContain("justificativa");
    expect(Object.keys(auditoria.data.dadosNovos)).not.toContain("observacoes");
  });

  it("recusa usuário inativo ou inexistente sem abrir transação", async () => {
    mocks.usuarioFindUnique.mockResolvedValue({ ativo: false });

    const erro = await erroDe(criarSolicitacao(entrada, usuarioId, agora));

    expect(erro).toBeInstanceOf(HttpError);
    expect((erro as HttpError).statusCode).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("propaga falhas do banco sem registrar auditoria", async () => {
    mocks.create.mockRejectedValue(new Error("falha de conexão"));

    await expect(criarSolicitacao(entrada, usuarioId, agora)).rejects.toThrow("falha de conexão");
    expect(mocks.auditoriaCreate).not.toHaveBeenCalled();
  });
});

describe("protocolo", () => {
  it("vira o ano à meia-noite do horário de Sergipe (UTC-3)", () => {
    expect(anoDoProtocolo(new Date("2027-01-01T02:59:59.000Z"))).toBe(2026);
    expect(anoDoProtocolo(new Date("2027-01-01T03:00:00.000Z"))).toBe(2027);
  });

  it("completa com zeros até 4 dígitos sem truncar números maiores", () => {
    expect(formatarProtocolo(2026, 7)).toBe("SV-2026-0007");
    expect(formatarProtocolo(2026, 12345)).toBe("SV-2026-12345");
  });
});
