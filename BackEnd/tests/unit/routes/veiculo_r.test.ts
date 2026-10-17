import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import jwt from 'jsonwebtoken'
import { Prisma } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    findMany: vi.fn(),
    count: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    fornecedorFindUnique: vi.fn(),
    auditoriaCreate: vi.fn(),
}))

vi.mock('../../../src/lib/prisma', () => ({
    prisma: {
        veiculo: {
            findMany: mocks.findMany,
            count: mocks.count,
            findUnique: mocks.findUnique,
            create: mocks.create,
        },
        fornecedor: { findUnique: mocks.fornecedorFindUnique },
        auditoriaSistema: { create: mocks.auditoriaCreate },
        usuario: { findUnique: vi.fn() },
    },
}))

import { app } from '../../../src/app'

const secret = 'chave-sintetica-exclusiva-dos-testes'
const usuarioId = '00000000-0000-4000-8000-000000000001'
const veiculoId = '00000000-0000-4000-8000-0000000000a1'

const registro = {
    id: veiculoId,
    placa: 'ABC1D23',
    modelo: 'Fiat Ducato',
    tipoFrota: 'ADMINISTRATIVA',
    propriedade: 'PROPRIO',
    fornecedorId: null,
    ano: 2022,
    combustivel: 'Diesel',
    capacidadeMaxima: 4,
    odometroAtual: new Prisma.Decimal('10.5'),
    status: 'DISPONIVEL',
    ativo: true,
    criadoEm: new Date('2026-10-17T12:00:00.000Z'),
    atualizadoEm: new Date('2026-10-17T12:00:00.000Z'),
}

let server: Server
let baseUrl: string

function token(perfis: string[]) {
    return jwt.sign({ perfis }, secret, { subject: usuarioId })
}

type Corpo = {
    statusCode?: number
    message?: string
    data?: Array<Record<string, unknown>>
    meta?: Record<string, unknown>
    errors?: Array<{ campo: string; mensagem: string }>
    [chave: string]: unknown
}

type Opcoes = { perfis?: string[]; body?: unknown }

async function chamar(caminho: string, { perfis, body }: Opcoes = {}) {
    const temCorpo = body !== undefined
    const resposta = await fetch(`${baseUrl}${caminho}`, {
        method: temCorpo ? 'POST' : 'GET',
        headers: {
            ...(temCorpo && { 'content-type': 'application/json' }),
            ...(perfis && { authorization: `Bearer ${token(perfis)}` }),
        },
        body: !temCorpo ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    })
    return {
        status: resposta.status,
        location: resposta.headers.get('location'),
        json: (await resposta.json()) as Corpo,
    }
}

beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', secret)
    server = app.listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise((resolve) => server.close(resolve)))

beforeEach(() => {
    vi.stubEnv('JWT_SECRET', secret)
    mocks.findMany.mockResolvedValue([registro])
    mocks.count.mockResolvedValue(1)
    mocks.findUnique.mockResolvedValue(null)
    mocks.create.mockResolvedValue(registro)
    mocks.auditoriaCreate.mockResolvedValue({})
    mocks.fornecedorFindUnique.mockResolvedValue({ ativo: true })
})

describe('GET /api/v1/veiculos', () => {
    it('exige autenticação', async () => {
        const resposta = await chamar('/api/v1/veiculos')

        expect(resposta.status).toBe(401)
        expect(resposta.json).toEqual({ statusCode: 401, message: 'Autenticação necessária.', errors: [] })
    })

    it.each(['MOTORISTA', 'SOLICITANTE', 'ATENDENTE_SVO'])('retorna 403 para o perfil %s', async (perfil) => {
        expect((await chamar('/api/v1/veiculos', { perfis: [perfil] })).status).toBe(403)
    })

    it.each(['ADMIN', 'GESTOR'])('lista com paginação para o perfil %s', async (perfil) => {
        const resposta = await chamar('/api/v1/veiculos?page=1&pageSize=5', { perfis: [perfil] })

        expect(resposta.status).toBe(200)
        expect(resposta.json.meta).toEqual({ page: 1, pageSize: 5, total: 1, totalPages: 1 })
        expect(resposta.json.data?.[0]).toMatchObject({ placa: 'ABC1D23', odometroAtual: 10.5 })
    })

    it('repassa os filtros da query ao banco', async () => {
        await chamar('/api/v1/veiculos?tipoFrota=SVO&status=DISPONIVEL&busca=ducato', { perfis: ['GESTOR'] })

        expect(mocks.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ ativo: true, tipoFrota: 'SVO', status: 'DISPONIVEL' }),
            })
        )
    })

    it('retorna 400 padronizado para filtros inválidos', async () => {
        const resposta = await chamar('/api/v1/veiculos?tipoFrota=COMUM&pageSize=1000', { perfis: ['GESTOR'] })

        expect(resposta.status).toBe(400)
        expect(resposta.json).toMatchObject({ statusCode: 400, message: 'Dados inválidos.' })
        expect((resposta.json.errors ?? []).map((erro) => erro.campo).sort()).toEqual(['pageSize', 'tipoFrota'])
        expect(mocks.findMany).not.toHaveBeenCalled()
    })
})

describe('POST /api/v1/veiculos', () => {
    const corpo = { placa: 'abc-1d23', modelo: 'Fiat Ducato', tipoFrota: 'ADMINISTRATIVA' }

    it('exige autenticação', async () => {
        expect((await chamar('/api/v1/veiculos', { body: corpo })).status).toBe(401)
        expect(mocks.create).not.toHaveBeenCalled()
    })

    it('retorna 403 para perfil sem permissão', async () => {
        expect((await chamar('/api/v1/veiculos', { perfis: ['MOTORISTA'], body: corpo })).status).toBe(403)
        expect(mocks.create).not.toHaveBeenCalled()
    })

    it('cria o veículo (201), normaliza a placa e grava a auditoria', async () => {
        const resposta = await chamar('/api/v1/veiculos', { perfis: ['GESTOR'], body: corpo })

        expect(resposta.status).toBe(201)
        expect(resposta.location).toBe(`/api/v1/veiculos/${veiculoId}`)
        expect(resposta.json).toMatchObject({ id: veiculoId, odometroAtual: 10.5 })
        expect(mocks.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ placa: 'ABC1D23', status: 'DISPONIVEL', propriedade: 'PROPRIO' }),
        })
        expect(mocks.auditoriaCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({ usuarioId, acao: 'CRIAR', tabelaAfetada: 'veiculos', registroId: veiculoId }),
        })
    })

    it('retorna 400 com os campos inválidos', async () => {
        const resposta = await chamar('/api/v1/veiculos', {
            perfis: ['GESTOR'],
            body: { placa: 'xx', modelo: '', tipoFrota: 'COMUM' },
        })

        expect(resposta.status).toBe(400)
        expect(resposta.json.errors?.length).toBeGreaterThanOrEqual(3)
        expect(mocks.create).not.toHaveBeenCalled()
    })

    it('retorna 400 quando o corpo está vazio', async () => {
        const resposta = await chamar('/api/v1/veiculos', { perfis: ['GESTOR'], body: {} })

        expect(resposta.status).toBe(400)
    })

    it('retorna 400 para JSON malformado', async () => {
        const resposta = await chamar('/api/v1/veiculos', { perfis: ['GESTOR'], body: '{invalido' })

        expect(resposta.status).toBe(400)
        expect(resposta.json).toEqual({ statusCode: 400, message: 'JSON inválido.', errors: [] })
    })

    it('retorna 409 para placa duplicada', async () => {
        mocks.findUnique.mockResolvedValue({ id: 'existente' })

        const resposta = await chamar('/api/v1/veiculos', { perfis: ['GESTOR'], body: corpo })

        expect(resposta.status).toBe(409)
        expect(resposta.json.statusCode).toBe(409)
    })

    it('retorna 500 genérico sem vazar detalhes de erro inesperado', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        mocks.create.mockRejectedValue(new Error('senha do banco: segredo'))

        const resposta = await chamar('/api/v1/veiculos', { perfis: ['GESTOR'], body: corpo })

        expect(resposta.status).toBe(500)
        expect(resposta.json).toEqual({ statusCode: 500, message: 'Erro interno do servidor.', errors: [] })
    })
})

describe('autenticação (JWT)', () => {
    async function comToken(valor: string) {
        const resposta = await fetch(`${baseUrl}/api/v1/veiculos`, { headers: { authorization: valor } })
        return resposta.status
    }

    it.each([
        { caso: 'esquema diferente de Bearer', valor: 'Basic abc' },
        { caso: 'Bearer sem token', valor: 'Bearer' },
        { caso: 'token malformado', valor: 'Bearer abc.def.ghi' },
        { caso: 'token de outra chave', valor: `Bearer ${jwt.sign({ perfis: ['ADMIN'] }, 'outra', { subject: usuarioId })}` },
        { caso: 'token expirado', valor: `Bearer ${jwt.sign({ perfis: ['ADMIN'] }, secret, { subject: usuarioId, expiresIn: -10 })}` },
        { caso: 'token sem perfis', valor: `Bearer ${jwt.sign({}, secret, { subject: usuarioId })}` },
        { caso: 'token sem subject', valor: `Bearer ${jwt.sign({ perfis: ['ADMIN'] }, secret)}` },
    ])('retorna 401 para $caso', async ({ valor }) => {
        expect(await comToken(valor)).toBe(401)
    })

    it('retorna 500 quando JWT_SECRET não está configurado', async () => {
        vi.stubEnv('JWT_SECRET', '')

        expect(await comToken(`Bearer ${token(['ADMIN'])}`)).toBe(500)
    })
})