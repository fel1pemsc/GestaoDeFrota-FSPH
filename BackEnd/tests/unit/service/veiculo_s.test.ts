import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    findMany: vi.fn(),
    count: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    fornecedorFindUnique: vi.fn(),
    registrarAuditoria: vi.fn(),
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
    },
}))
vi.mock('../../../src/service/auditoria_s', () => ({ registrarAuditoria: mocks.registrarAuditoria }))

import { HttpError } from '../../../src/middleware/http_m'
import {
    criarVeiculo,
    criarVeiculoSchema,
    listarVeiculos,
    listarVeiculosSchema,
    normalizarPlaca,
    type CriarVeiculoInput,
} from '../../../src/service/veiculo_s'
import { validar } from '../../../src/controller/veiculo_c'

const usuarioId = '00000000-0000-4000-8000-000000000001'
const fornecedorId = '00000000-0000-4000-8000-0000000000f1'

const entrada: CriarVeiculoInput = {
    placa: 'ABC1D23',
    modelo: 'Fiat Ducato',
    tipoFrota: 'ADMINISTRATIVA',
    propriedade: 'PROPRIO',
    capacidadeMaxima: 4,
    odometroAtual: 0,
    status: 'DISPONIVEL',
}

const registro = {
    id: '00000000-0000-4000-8000-0000000000a1',
    ...entrada,
    fornecedorId: null,
    ano: null,
    combustivel: null,
    odometroAtual: new Prisma.Decimal('1234.50'),
    ativo: true,
    criadoEm: new Date('2026-10-17T12:00:00.000Z'),
    atualizadoEm: new Date('2026-10-17T12:00:00.000Z'),
}

async function erroDe(promessa: Promise<unknown>) {
    try {
        await promessa
    } catch (error) {
        return error
    }
    return undefined
}

describe('listarVeiculos', () => {
    beforeEach(() => {
        vi.resetAllMocks()
        mocks.findMany.mockResolvedValue([registro])
        mocks.count.mockResolvedValue(25)
    })

    it('pagina, ordena por placa e converte o odômetro para número', async () => {
        const resultado = await listarVeiculos({ page: 3, pageSize: 10, ativo: true })

        expect(mocks.findMany).toHaveBeenCalledWith({
            where: { ativo: true },
            orderBy: [{ placa: 'asc' }],
            skip: 20,
            take: 10,
        })
        expect(resultado.meta).toEqual({ page: 3, pageSize: 10, total: 25, totalPages: 3 })
        expect(resultado.data[0]?.odometroAtual).toBe(1234.5)
    })

    it('aplica os filtros e usa o mesmo where na contagem', async () => {
        await listarVeiculos({
            page: 1,
            pageSize: 5,
            tipoFrota: 'SVO',
            status: 'DISPONIVEL',
            propriedade: 'LOCADO',
            ativo: false,
            busca: 'abc-1',
        })

        const where = {
            ativo: false,
            tipoFrota: 'SVO',
            status: 'DISPONIVEL',
            propriedade: 'LOCADO',
            OR: [{ placa: { contains: 'ABC1' } }, { modelo: { contains: 'abc-1', mode: 'insensitive' } }],
        }
        expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }))
        expect(mocks.count).toHaveBeenCalledWith({ where })
    })

    it('retorna lista vazia com zero páginas', async () => {
        mocks.findMany.mockResolvedValue([])
        mocks.count.mockResolvedValue(0)

        const resultado = await listarVeiculos({ page: 1, pageSize: 10, ativo: true })

        expect(resultado).toEqual({ data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } })
    })
})

describe('criarVeiculo', () => {
    beforeEach(() => {
        vi.resetAllMocks()
        mocks.findUnique.mockResolvedValue(null)
        mocks.create.mockResolvedValue(registro)
        mocks.registrarAuditoria.mockResolvedValue({})
    })

    it('cria o veículo, audita a operação e devolve o odômetro numérico', async () => {
        const resposta = await criarVeiculo(entrada, usuarioId)

        expect(mocks.create).toHaveBeenCalledWith({ data: entrada })
        expect(resposta.odometroAtual).toBe(1234.5)
        expect(mocks.registrarAuditoria).toHaveBeenCalledWith(
            expect.objectContaining({
                usuarioId,
                acao: 'CRIAR',
                tabelaAfetada: 'veiculos',
                registroId: registro.id,
                dadosNovos: expect.objectContaining({ placa: 'ABC1D23', odometroAtual: 1234.5 }),
            })
        )
    })

    it('retorna 409 quando a placa já existe, sem criar nem auditar', async () => {
        mocks.findUnique.mockResolvedValue({ id: 'existente' })

        const erro = await erroDe(criarVeiculo(entrada, usuarioId))

        expect(erro).toBeInstanceOf(HttpError)
        expect((erro as HttpError).statusCode).toBe(409)
        expect(mocks.create).not.toHaveBeenCalled()
        expect(mocks.registrarAuditoria).not.toHaveBeenCalled()
    })

    it('converte violação de unicidade (corrida) em 409', async () => {
        mocks.create.mockRejectedValue(
            new Prisma.PrismaClientKnownRequestError('duplicado', { code: 'P2002', clientVersion: 'teste' })
        )

        const erro = await erroDe(criarVeiculo(entrada, usuarioId))

        expect((erro as HttpError).statusCode).toBe(409)
        expect(mocks.registrarAuditoria).not.toHaveBeenCalled()
    })

    it('repassa erros inesperados do banco', async () => {
        mocks.create.mockRejectedValue(new Error('falha de conexão'))

        await expect(criarVeiculo(entrada, usuarioId)).rejects.toThrow('falha de conexão')
    })

    it.each([
        { caso: 'inexistente', fornecedor: null },
        { caso: 'inativo', fornecedor: { ativo: false } },
    ])('retorna 422 para fornecedor $caso', async ({ fornecedor }) => {
        mocks.fornecedorFindUnique.mockResolvedValue(fornecedor)

        const erro = await erroDe(criarVeiculo({ ...entrada, propriedade: 'LOCADO', fornecedorId }, usuarioId))

        expect((erro as HttpError).statusCode).toBe(422)
        expect(mocks.create).not.toHaveBeenCalled()
    })

    it('aceita fornecedor ativo', async () => {
        mocks.fornecedorFindUnique.mockResolvedValue({ ativo: true })

        await criarVeiculo({ ...entrada, propriedade: 'LOCADO', fornecedorId }, usuarioId)

        expect(mocks.create).toHaveBeenCalledOnce()
    })
})

const valido = { placa: 'ABC1D23', modelo: 'Fiat Ducato', tipoFrota: 'ADMINISTRATIVA' }

describe('normalizarPlaca', () => {
    it.each([
        ['abc-1d23', 'ABC1D23'],
        [' ABC 1234 ', 'ABC1234'],
        ['abc1d23', 'ABC1D23'],
    ])('normaliza %s para %s', (entrada, esperado) => {
        expect(normalizarPlaca(entrada)).toBe(esperado)
    })
})

describe('criarVeiculoSchema (validação)', () => {
    it('aplica os valores padrão e normaliza a placa', () => {
        const resultado = criarVeiculoSchema.parse({ ...valido, placa: 'abc-1d23', modelo: '  Fiat Ducato  ' })

        expect(resultado).toEqual({
            placa: 'ABC1D23',
            modelo: 'Fiat Ducato',
            tipoFrota: 'ADMINISTRATIVA',
            propriedade: 'PROPRIO',
            capacidadeMaxima: 4,
            odometroAtual: 0,
            status: 'DISPONIVEL',
        })
    })

    it.each(['ABC1234', 'ABC-1234', 'ABC1D23', 'abc1d23'])('aceita a placa %s', (placa) => {
        expect(criarVeiculoSchema.safeParse({ ...valido, placa }).success).toBe(true)
    })

    it.each(['', 'AB1234', 'ABCD123', '1234ABC', 'ABC12345', 'ABC1D2', 'ABC!234'])(
        'rejeita a placa inválida "%s"',
        (placa) => {
            expect(criarVeiculoSchema.safeParse({ ...valido, placa }).success).toBe(false)
        }
    )

    it.each([
        { campo: 'placa ausente', dados: { modelo: 'X1', tipoFrota: 'SVO' } },
        { campo: 'modelo curto', dados: { ...valido, modelo: 'A' } },
        { campo: 'tipo de frota inválido', dados: { ...valido, tipoFrota: 'COMUM' } },
        { campo: 'status inválido', dados: { ...valido, status: 'QUEBRADO' } },
        { campo: 'propriedade inválida', dados: { ...valido, propriedade: 'ALUGADO' } },
        { campo: 'capacidade zero', dados: { ...valido, capacidadeMaxima: 0 } },
        { campo: 'capacidade decimal', dados: { ...valido, capacidadeMaxima: 2.5 } },
        { campo: 'odômetro negativo', dados: { ...valido, odometroAtual: -1 } },
        { campo: 'odômetro como texto', dados: { ...valido, odometroAtual: '100' } },
        { campo: 'ano anterior a 1950', dados: { ...valido, ano: 1949 } },
        { campo: 'ano muito no futuro', dados: { ...valido, ano: 3000 } },
        { campo: 'fornecedorId inválido', dados: { ...valido, fornecedorId: 'abc' } },
    ])('rejeita $campo', ({ dados }) => {
        expect(criarVeiculoSchema.safeParse(dados).success).toBe(false)
    })

    it('exige fornecedor para veículo locado', () => {
        const resultado = criarVeiculoSchema.safeParse({ ...valido, propriedade: 'LOCADO' })

        expect(resultado.success).toBe(false)
        expect(resultado.error?.issues[0]?.path).toEqual(['fornecedorId'])
        expect(criarVeiculoSchema.safeParse({ ...valido, propriedade: 'LOCADO', fornecedorId }).success).toBe(true)
    })

    it('permite DESINFECCAO somente na frota SVO', () => {
        const administrativa = criarVeiculoSchema.safeParse({ ...valido, status: 'DESINFECCAO' })
        const svo = criarVeiculoSchema.safeParse({ ...valido, tipoFrota: 'SVO', status: 'DESINFECCAO' })

        expect(administrativa.success).toBe(false)
        expect(administrativa.error?.issues[0]?.path).toEqual(['status'])
        expect(svo.success).toBe(true)
    })
})

describe('listarVeiculosSchema', () => {
    it('usa paginação padrão e lista apenas veículos ativos', () => {
        expect(listarVeiculosSchema.parse({})).toEqual({ page: 1, pageSize: 10, ativo: true })
    })

    it('converte os parâmetros de query (strings) para os tipos corretos', () => {
        const resultado = listarVeiculosSchema.parse({
            page: '2',
            pageSize: '25',
            tipoFrota: 'SVO',
            status: 'DISPONIVEL',
            ativo: 'false',
            busca: '  abc  ',
        })

        expect(resultado).toEqual({
            page: 2,
            pageSize: 25,
            tipoFrota: 'SVO',
            status: 'DISPONIVEL',
            ativo: false,
            busca: 'abc',
        })
    })

    it.each([
        { page: '0' },
        { page: '-1' },
        { page: 'x' },
        { pageSize: '0' },
        { pageSize: '101' },
        { tipoFrota: 'COMUM' },
        { status: 'QUEBRADO' },
        { ativo: 'talvez' },
    ])('rejeita %o', (query) => {
        expect(listarVeiculosSchema.safeParse(query).success).toBe(false)
    })
})

describe('validar', () => {
    it('retorna os dados convertidos quando válidos', () => {
        expect(validar(listarVeiculosSchema, { page: '3' }).page).toBe(3)
    })

    it('lança HttpError 400 com o detalhe de cada campo inválido', () => {
        try {
            validar(criarVeiculoSchema, { placa: 'xx', modelo: '', tipoFrota: 'SVO' })
            expect.unreachable()
        } catch (error) {
            expect(error).toBeInstanceOf(HttpError)
            const httpError = error as HttpError
            expect(httpError.statusCode).toBe(400)
            expect(httpError.message).toBe('Dados inválidos.')
            expect(httpError.errors.map((detalhe) => detalhe.campo).sort()).toEqual(['modelo', 'placa'])
        }
    })
})