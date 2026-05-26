import path from "node:path";
import fs from "node:fs";
import pino from "pino";
import { pinoHttp } from "pino-http";
import { readConfigFile } from "../config-file.js";
import { resolveDefaultLogsDir, resolveHomeAwarePath } from "../home-paths.js";
import { shouldSilenceHttpSuccessLog } from "./http-log-policy.js";

function resolveServerLogDir(): string {
  const envOverride = process.env.NORALOS_LOG_DIR?.trim();
  if (envOverride) return resolveHomeAwarePath(envOverride);

  const fileLogDir = readConfigFile()?.logging.logDir?.trim();
  if (fileLogDir) return resolveHomeAwarePath(fileLogDir);

  return resolveDefaultLogsDir();
}

const logDir = resolveServerLogDir();
fs.mkdirSync(logDir, { recursive: true });

const logFile = path.join(logDir, "server.log");

const sharedOpts = {
  translateTime: "SYS:HH:MM:ss",
  ignore: "pid,hostname",
  singleLine: true,
};

// Pino redact paths covering every place a secret material value could
// otherwise land. Pino accepts wildcards via `*`, so `req.body.value`
// covers any request body shape that uses `value` as the top-level key,
// and `*.material` traverses nested record-like structures from agent /
// plugin payloads. Extending this list when new secret-bearing fields
// land elsewhere in the codebase is cheap and safe; missing one is not.
const SECRET_REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['xi-api-key']",
  "req.body.value",
  "req.body.material",
  "req.body.apiKey",
  "req.body.authToken",
  "req.body.bearerToken",
  "req.body.password",
  "req.body.clientSecret",
  "req.body.refreshToken",
  "req.body.signingSecret",
  "req.body.hmacSecret",
  "req.body.privateKey",
  "*.value",
  "*.material",
  "*.apiKey",
  "*.authToken",
  "*.bearerToken",
  "*.password",
  "*.clientSecret",
  "*.refreshToken",
  "*.signingSecret",
  "*.hmacSecret",
  "*.privateKey",
];

export const logger = pino({
  level: "debug",
  redact: SECRET_REDACT_PATHS,
}, pino.transport({
  targets: [
    {
      target: "pino-pretty",
      options: { ...sharedOpts, ignore: "pid,hostname,req,res,responseTime", colorize: true, destination: 1 },
      level: "info",
    },
    {
      target: "pino-pretty",
      options: { ...sharedOpts, colorize: false, destination: logFile, mkdir: true },
      level: "debug",
    },
  ],
}));

export const httpLogger = pinoHttp({
  logger,
  customLogLevel(_req, res, err) {
    if (shouldSilenceHttpSuccessLog(_req.method, _req.url, res.statusCode)) {
      return "silent";
    }
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  customSuccessMessage(req, res) {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },
  customErrorMessage(req, res, err) {
    const ctx = (res as any).__errorContext;
    const errMsg = ctx?.error?.message || err?.message || (res as any).err?.message || "unknown error";
    return `${req.method} ${req.url} ${res.statusCode} — ${errMsg}`;
  },
  customProps(req, res) {
    if (res.statusCode >= 400) {
      const ctx = (res as any).__errorContext;
      if (ctx) {
        return {
          errorContext: ctx.error,
          reqBody: ctx.reqBody,
          reqParams: ctx.reqParams,
          reqQuery: ctx.reqQuery,
        };
      }
      const props: Record<string, unknown> = {};
      const { body, params, query } = req as any;
      if (body && typeof body === "object" && Object.keys(body).length > 0) {
        props.reqBody = body;
      }
      if (params && typeof params === "object" && Object.keys(params).length > 0) {
        props.reqParams = params;
      }
      if (query && typeof query === "object" && Object.keys(query).length > 0) {
        props.reqQuery = query;
      }
      if ((req as any).route?.path) {
        props.routePath = (req as any).route.path;
      }
      return props;
    }
    return {};
  },
});
