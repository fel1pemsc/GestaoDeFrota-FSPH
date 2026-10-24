import type { Request, Response } from "express";
import { validar } from "./veiculo_c";
import { usuarioAutenticado } from "../middleware/http_m";
import {
  criarSolicitacao,
  criarSolicitacaoSchema,
  listarSolicitacoes,
  listarSolicitacoesSchema,
} from "../service/solicitacao_s";

export async function listarSolicitacoesController(req: Request, res: Response) {
  const filtros = validar(listarSolicitacoesSchema, req.query);
  const resultado = await listarSolicitacoes(filtros, usuarioAutenticado(res));
  return res.status(200).json(resultado);
}

export async function criarSolicitacaoController(req: Request, res: Response) {
  const dados = validar(criarSolicitacaoSchema, req.body ?? {});
  const solicitacao = await criarSolicitacao(dados, usuarioAutenticado(res).id);
  return res.status(201).json(solicitacao);
}
