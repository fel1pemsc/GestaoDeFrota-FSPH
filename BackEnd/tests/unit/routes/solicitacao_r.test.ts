import { getAuthConfig } from "../../../src/config/auth";
vi.mock("../../../src/config/auth", () => ({ getAuthConfig: vi.fn() }));
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

import { app } from "../../../src/app";
import { prisma } from "../../../src/lib/prisma";

const secret = "chave-sintetica-exclusiva-dos-testes";
const usuarioId = "00000000-0000-4000-8000-000000000001";

const registro = {
  id: "00000000-0000-4000-8000-0000000000a1",
  protocolo: "SV-2026-0001",
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

const valido = {
  setorOrigem: "LACEN",
  origem: "LACEN — Rua Campo do Brito",
  destino: "Hospital Regional de Itabaiana",
  dataHoraPretendida: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  justificativa: "Coleta de amostras para análise laboratorial.",
};

let server: Server;
let baseUrl: string;

type Corpo = {
  statusCode?: number;
  message?: string;
  data?: Array<Record<string, unknown>>;
  meta?: Record<string, unknown>;
  errors?: Array<{ campo: string; mensagem: string }>;
  [chave: string]: unknown;
};

type Opcoes = { perfis?: string[]; body?: unknown };

async function chamar(caminho: string, { perfis, body }: Opcoes = {}) {
  const temCorpo = body !== undefined;
  const resposta = await fetch(`${baseUrl}/api/v1/solicitacoes${caminho}`, {
    method: temCorpo ? "POST" : "GET",
    headers: {
      ...(temCorpo && { "content-type": "application/json" }),
      ...(perfis && {
        authorization: `Bearer ${jwt.sign({ perfis }, secret, { subject: usuarioId })}`,
      }),
    },
    body: !temCorpo ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: resposta.status, json: (await resposta.json()) as Corpo };
}

beforeAll(async () => {
  vi.mocked(getAuthConfig).mockReturnValue({ secret, expiresIn: 28800 });
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  vi.mocked(getAuthConfig).mockReturnValue({ secret, expiresIn: 28800 });
  mocks.usuarioFindUnique.mockResolvedValue({ ativo: true });
  mocks.findMany.mockResolvedValue([registro]);
  mocks.count.mockResolvedValue(1);
  mocks.groupBy.mockResolvedValue([{ status: "PENDENTE", _count: { _all: 1 } }]);
  mocks.queryRaw.mockResolvedValue([{ ultimo_valor: 1 }]);
  mocks.create.mockResolvedValue(registro);
  mocks.auditoriaCreate.mockResolvedValue({});
  mocks.transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
    callback(prisma),
  );
});

describe("GET /api/v1/solicitacoes", () => {
  it("exige autenticação", async () => {
    const resposta = await chamar("");

    expect(resposta.status).toBe(401);
    expect(resposta.json).toEqual({
      statusCode: 401,
      message: "Autenticação necessária.",
      errors: [],
    });
  });

  it.each(["MOTORISTA", "SVO", "ATENDENTE_SVO"])("retorna 403 para o perfil %s", async (perfil) => {
    expect((await chamar("", { perfis: [perfil] })).status).toBe(403);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("lista só as solicitações do solicitante logado", async () => {
    const resposta = await chamar("", { perfis: ["SOLICITANTE"] });

    expect(resposta.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { solicitanteId: usuarioId } }),
    );
    expect(resposta.json.meta).toEqual({
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1,
      porStatus: { PENDENTE: 1, APROVADA: 0, EM_TRANSITO: 0, CONCLUIDA: 0, RECUSADA: 0 },
    });
    expect(resposta.json.data?.[0]).toMatchObject({
      protocolo: "SV-2026-0001",
      solicitanteNome: "Marina Costa",
      dataHoraPretendida: "2026-11-10T11:30:00.000Z",
      veiculoAlocado: null,
      motoristaAlocado: null,
    });
  });

  it.each(["GESTOR", "ADMIN"])("lista as solicitações de todos para %s", async (perfil) => {
    const resposta = await chamar("", { perfis: [perfil] });

    expect(resposta.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it("repassa paginação e filtros da query", async () => {
    await chamar("?page=2&pageSize=5&status=APROVADA,EM_TRANSITO&urgencia=URGENTE", {
      perfis: ["GESTOR"],
    });

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { urgencia: "URGENTE", status: { in: ["APROVADA", "EM_TRANSITO"] } },
        skip: 5,
        take: 5,
      }),
    );
  });

  it.each(["?pageSize=1000", "?page=0", "?status=QUEBRADO", "?urgencia=ALTA"])(
    "retorna 400 para a query %s",
    async (query) => {
      const resposta = await chamar(query, { perfis: ["GESTOR"] });

      expect(resposta.status).toBe(400);
      expect(resposta.json.message).toBe("Dados inválidos.");
      expect(mocks.findMany).not.toHaveBeenCalled();
    },
  );
});

describe("POST /api/v1/solicitacoes", () => {
  it("exige autenticação", async () => {
    expect((await chamar("", { body: valido })).status).toBe(401);
  });

  it("retorna 403 para perfis sem acesso", async () => {
    expect((await chamar("", { perfis: ["MOTORISTA"], body: valido })).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each(["SOLICITANTE", "GESTOR", "ADMIN"])("cria a solicitação para %s", async (perfil) => {
    const resposta = await chamar("", { perfis: [perfil], body: valido });

    expect(resposta.status).toBe(201);
    expect(resposta.json).toMatchObject({ protocolo: "SV-2026-0001", status: "PENDENTE" });
    expect(mocks.auditoriaCreate).toHaveBeenCalledOnce();
  });

  it("gera o protocolo no servidor e ignora campos proibidos no body", async () => {
    await chamar("", {
      perfis: ["SOLICITANTE"],
      body: {
        ...valido,
        status: "APROVADA",
        protocolo: "SV-2026-9999",
        solicitanteId: "00000000-0000-4000-8000-000000000099",
        veiculoAlocadoId: "00000000-0000-4000-8000-0000000000b1",
      },
    });

    expect(mocks.create).toHaveBeenCalledOnce();
    const chamada = mocks.create.mock.calls[0]?.[0] as
      { data: Record<string, unknown> } | undefined;
    const data = chamada?.data ?? {};
    expect(data).toMatchObject({ status: "PENDENTE", solicitanteId: usuarioId });
    expect(data.protocolo).toMatch(/^SV-\d{4}-0001$/);
    expect(Object.keys(data)).not.toContain("veiculoAlocadoId");
  });

  it("retorna 400 com cada campo obrigatório ausente", async () => {
    const resposta = await chamar("", { perfis: ["SOLICITANTE"], body: {} });

    expect(resposta.status).toBe(400);
    expect(resposta.json.errors?.map((erro) => erro.campo).sort()).toEqual([
      "dataHoraPretendida",
      "destino",
      "justificativa",
      "origem",
      "setorOrigem",
    ]);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("retorna 400 para saída no passado", async () => {
    const resposta = await chamar("", {
      perfis: ["SOLICITANTE"],
      body: { ...valido, dataHoraPretendida: "2020-01-01T08:00:00-03:00" },
    });

    expect(resposta.status).toBe(400);
    expect(resposta.json.errors).toEqual([
      { campo: "dataHoraPretendida", mensagem: "A data de saída deve ser futura." },
    ]);
  });

  it("retorna 400 para JSON malformado", async () => {
    const resposta = await chamar("", { perfis: ["SOLICITANTE"], body: "{quebrado" });

    expect(resposta.status).toBe(400);
    expect(resposta.json.message).toBe("JSON inválido.");
  });

  it("retorna 403 para usuário inativo", async () => {
    mocks.usuarioFindUnique.mockResolvedValue({ ativo: false });

    const resposta = await chamar("", { perfis: ["SOLICITANTE"], body: valido });

    expect(resposta.status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("retorna 500 sem detalhes internos quando o banco falha", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.create.mockRejectedValue(new Error("falha de conexão"));

    const resposta = await chamar("", { perfis: ["SOLICITANTE"], body: valido });

    expect(resposta.status).toBe(500);
    expect(resposta.json).toEqual({
      statusCode: 500,
      message: "Erro interno do servidor.",
      errors: [],
    });
  });
});
