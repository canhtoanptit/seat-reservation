import pino from "pino";
import { env } from "./env";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "seat-reservation" },
  redact: {
    paths: [
      "password",
      "password_hash",
      "token",
      "cookie",
      "headers.cookie",
      "headers.authorization",
      "*.password",
      "*.token",
    ],
    censor: "[REDACTED]",
  },
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});
