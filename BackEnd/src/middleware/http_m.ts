import type { ErrorRequestHandler, RequestHandler } from "express";
import jwt from "jsonwebtoken";

export type ErroDetalhe = { campo: string; mensagem: string };

export class HttpError extends Error {
    constructor(
        public readonly statusCode: number,
        message: string,
        public readonly errors: ErroDetalhe[] = []
    ) {
        super(message);
        this.name = "HttpError";
    }
}

export type UsuarioAutenticado = {
    id: string;
    perfis: string[];
};

export function usuarioAutenticado(res: { locals: Record<string, unknown> }): UsuarioAutenticado {
    const usuario = res.locals.usuario as UsuarioAutenticado | undefined;
    if (!usuario) {
        throw new HttpError(401, "Autenticação necessária.");
    }
    return usuario;
}

export const authenticate: RequestHandler = (req, res, next) => {
    const [esquema, token] = (req.headers.authorization ?? "").split(" ");
    if (esquema !== "Bearer" || !token) {
        return next(new HttpError(401, "Autenticação necessária."));
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
        return next(new HttpError(500, "Configuração de autenticação ausente."));
    }

    try {
        const payload = jwt.verify(token, secret);
        if (
            typeof payload === "string" ||
            typeof payload.sub !== "string" ||
            !Array.isArray(payload.perfis) ||
            !payload.perfis.every((perfil: unknown) => typeof perfil === "string")
        ) {
            return next(new HttpError(401, "Token inválido ou expirado."));
        }

        res.locals.usuario = { id: payload.sub, perfis: payload.perfis } satisfies UsuarioAutenticado;
        return next();
    } catch {
        return next(new HttpError(401, "Token inválido ou expirado."));
    }
};

export function requireRole(...perfisPermitidos: string[]): RequestHandler {
    return (_req, res, next) => {
        const usuario = res.locals.usuario as UsuarioAutenticado | undefined;
        if (!usuario) {
            return next(new HttpError(401, "Autenticação necessária."));
        }
        if (!usuario.perfis.some((perfil) => perfisPermitidos.includes(perfil))) {
            return next(new HttpError(403, "Você não tem permissão para realizar esta operação."));
        }
        return next();
    };
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) {
        return next(error);
    }

    if (error instanceof HttpError) {
        return res
            .status(error.statusCode)
            .json({ statusCode: error.statusCode, message: error.message, errors: error.errors });
    }

    if (error?.type === "entity.parse.failed") {
        return res.status(400).json({ statusCode: 400, message: "JSON inválido.", errors: [] });
    }

    console.error(error);
    return res
        .status(500)
        .json({ statusCode: 500, message: "Erro interno do servidor.", errors: [] });
};