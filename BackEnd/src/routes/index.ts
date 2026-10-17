import { Router } from "express";
import { criarVeiculoController, listarVeiculosController } from "../controller/veiculo_c";
import { healthController } from "../controller/health_c";
import { authenticate, requireRole } from "../middleware/http_m";
import authRoutes from "./auth_r";

const router = Router();
const veiculos = Router();

// Consultar carrinhos (VrumVrum)
veiculos.use(authenticate, requireRole("ADMIN", "GESTOR"));
veiculos.get("/", listarVeiculosController);
veiculos.post("/", criarVeiculoController);

router.get("/health", healthController);
router.use("/auth", authRoutes);

router.use("/api/v1/auth", authRoutes);
router.use("/api/v1/veiculos", veiculos);

export default router;