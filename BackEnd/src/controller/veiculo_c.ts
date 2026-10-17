import type { Request, Response } from "express";
import type { z } from "zod";
import { HttpError, usuarioAutenticado } from "../middleware/http_m";
import {
    criarVeiculo,
    criarVeiculoSchema,
    listarVeiculos,
    listarVeiculosSchema,
} from "../service/veiculo_s";

//  Validar com o mega Zod e converte falhas para o erro 400. 
export function validar<T extends z.ZodType>(schema: T, dados: unknown): z.infer<T> {
    const resultado = schema.safeParse(dados);
    if (resultado.success) {
        return resultado.data;
    }
    throw new HttpError(
        400,
        "Dados inválidos.",
        resultado.error.issues.map((issue) => ({
            campo: issue.path.join("."),
            mensagem: issue.message,
        }))
    );
}

export async function listarVeiculosController(req: Request, res: Response) {
    const filtros = validar(listarVeiculosSchema, req.query);
    const resultado = await listarVeiculos(filtros);
    return res.status(200).json(resultado);
}

export async function criarVeiculoController(req: Request, res: Response) {
    const dados = validar(criarVeiculoSchema, req.body ?? {});
    const veiculo = await criarVeiculo(dados, usuarioAutenticado(res).id);
    return res.status(201).location(`/api/v1/veiculos/${veiculo.id}`).json(veiculo);
}