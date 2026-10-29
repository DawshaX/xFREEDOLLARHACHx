import express, { type Express } from "express";
import cors from "cors";
import compression from "compression";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(compression({ level: 6, threshold: 1024 }));
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

app.use("/api", router);

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "CyberNova API Server is running",
    version: "1.0.0",
    endpoints: ["/api", "/live-agent"]
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

app.get("/api/ping", (req, res) => {
  res.json({ status: "pong", timestamp: new Date().toISOString() });
});

export default app;
