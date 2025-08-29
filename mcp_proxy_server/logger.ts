import winston from "winston";

export function createLogger(module: string): winston.Logger {
  return winston.createLogger({
    level: process.env.LOG_LEVEL || "info",
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json(),
      winston.format.printf(
        ({ timestamp, level, message, module: logModule, ...meta }) => {
          return JSON.stringify({
            timestamp,
            level,
            module: logModule || module,
            message,
            ...meta,
          });
        }
      )
    ),
    defaultMeta: { module },
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        ),
      }),
    ],
  });
}
