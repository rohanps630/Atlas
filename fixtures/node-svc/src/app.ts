import express from "express";
import ordersRouter from "./express-router.js";

const app = express();
app.get("/health", (_req, _res) => {}); // app-level route, no mount prefix
app.use("/api/v1/orders", ordersRouter); // → router's routes gain this prefix
