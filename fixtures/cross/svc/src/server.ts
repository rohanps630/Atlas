import { createOrderHandler } from "./handlers.js";

// Minimal Express-style router; atlas matches `<server>.<verb>("/path", handler)`.
const app = {
  post(_path: string, _handler: unknown): void {},
};

app.post("/api/orders", createOrderHandler); // → exposes POST /api/orders
