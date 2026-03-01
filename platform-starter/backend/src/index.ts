import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import generateRoute from "./routes/generate.js";
import developerRoute from "./routes/developer.js";

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (env.allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    methods: ["GET", "POST", "PATCH"],
    credentials: false
  })
);
app.use(express.json({ limit: "1mb" }));

app.use(
  rateLimit({
    windowMs: 60_000,
    max: env.GLOBAL_RATE_LIMIT_PER_MIN,
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    mode: env.NODE_ENV
  });
});

app.use(generateRoute);
app.use(developerRoute);
app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`Developer API starter listening on http://localhost:${env.PORT}`);
});
