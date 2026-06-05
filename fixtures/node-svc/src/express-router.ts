// An Express router whose routes are relative; the base path is applied where
// it is mounted (../app.ts), in a different file — exercises cross-file mount
// resolution (ADR 0014).
import { Router } from "express";

const router = Router();
router.get("/:id", getOrder);
router.post("/", createOrder);

function getOrder(_req: unknown, _res: unknown): void {}
function createOrder(_req: unknown, _res: unknown): void {}

export default router;
