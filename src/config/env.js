/**
 * Environment configuration — loaded once, validated with Zod, frozen.
 * The app boots against the PLATFORM database; per-tenant DB creds are resolved
 * at request time and are NOT in this file. See doc/DB_ARCHITECTURE.md.
 */
"use strict";

require("dotenv").config();
const { z } = require("zod");

const bool = (def) =>
  z.string().optional().transform((v) => (v === undefined ? def : /^(1|true|yes|on)$/i.test(v)));
const int = (def) =>
  z.string().optional().transform((v) => (v === undefined || v === "" ? def : Number(v))).pipe(z.number().int());

function fromUrl(url) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: u.port ? Number(u.port) : 5432,
      database: u.pathname.replace(/^\//, ""),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
    };
  } catch {
    return {};
  }
}
const urlParts = process.env.DATABASE_URL ? fromUrl(process.env.DATABASE_URL) : {};

const Schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: int(8080),
  APP_BASE_DOMAIN: z.string().default("praxisls.com"),
  // Dev-only convenience: when NODE_ENV=development, resolve a tenant on
  // localhost without a hosts-file entry. A request may still override per-call
  // with the `X-Praxis-Tenant: <slug>` header (see host-tenent-resolver.js).
  DEV_TENANT_SLUG: z.string().default(""),
  LOG_LEVEL: z.string().default("info"),
  APP_NAME: z.string().default("praxis-ls-api"),
  CORS_ORIGINS: z.string().default(""),

  DB_HOST: z.string().default(urlParts.host || "localhost"),
  DB_PORT: int(urlParts.port || 5432),
  DB_NAME: z.string().default(urlParts.database || "praxis_platform"),
  DB_USER: z.string().default(urlParts.user || "praxis_app"),
  DB_PASSWORD: z.string().default(urlParts.password || ""),
  DB_SSL: bool(false),
  DB_POOL_MIN: int(2),
  DB_POOL_MAX: int(10),
  DB_STATEMENT_TIMEOUT_MS: int(30000),
  DB_PLATFORM_SCHEMA: z.string().default("platform"),
  RLS_READ_ENFORCE: bool(false),

  TENANT_DB_HOST_DEFAULT: z.string().default(urlParts.host || "localhost"),
  TENANT_DB_PORT_DEFAULT: int(urlParts.port || 5432),
  TENANT_DB_SUPERUSER: z.string().default("postgres"),
  TENANT_DB_SUPERUSER_PASSWORD: z.string().default(""),
  TENANT_DB_APP_ROLE: z.string().default(""),
  TENANT_POOL_MAX: int(8),

  REDIS_URL: z.string().default("redis://localhost:6379"),

  JWT_ACCESS_SECRET: z.string().default("__dev_access__"),
  JWT_REFRESH_SECRET: z.string().default("__dev_refresh__"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),
  SESSION_INACTIVITY_MIN: int(30),

  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "must be 64 hex chars (32 bytes)")
    .default("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),

  AI_ENABLED_DEFAULT: bool(false),
  DEEPSEEK_API_KEY: z.string().default(""),
  DEEPSEEK_BASE_URL: z.string().default("https://api.deepseek.com"),
  DEEPSEEK_MODEL: z.string().default("deepseek-chat"),
  GEMINI_API_KEY: z.string().default(""),
  GEMINI_MODEL: z.string().default("gemini-1.5-pro"),
  GROQ_API_KEY: z.string().default(""),
  WHISPER_BASE_URL: z.string().default(""),
  AI_MONTHLY_CAP_XAF: int(0),

  EMBEDDINGS_PROVIDER: z.string().default("openai"),
  EMBEDDINGS_MODEL: z.string().default("text-embedding-3-small"),
  EMBEDDINGS_DIM: int(1536),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),

  EXCHANGERATE_API_KEY: z.string().default(""),
  FX_SYNC_CRON: z.string().default("0 0 * * *"),

  SMTP_HOST: z.string().default(""),
  SMTP_PORT: int(587),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  MAIL_FALLBACK_DOMAIN: z.string().default("nmail.praxisls.com"),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_PATH: z.string().default("./data/vault"),
  CDN_BASE_URL: z.string().default(""),
  S3_ENDPOINT: z.string().default(""),
  S3_BUCKET: z.string().default(""),
  S3_ACCESS_KEY: z.string().default(""),
  S3_SECRET_KEY: z.string().default(""),
  S3_REGION: z.string().default("us-east-1"),
  // Path-style (bucket in the path, not the host) — required for MinIO and most
  // S3-compatible providers; virtual-hosted style is the AWS default.
  S3_FORCE_PATH_STYLE: bool(true),

  PUPPETEER_EXECUTABLE_PATH: z.string().default(""),
  SANDBOX_WIPE_DAYS: int(14),
});

const parsed = Schema.safeParse(process.env);
if (!parsed.success) {
  /// eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Environment validation failed — see errors above.");
}

// Production safety guard: the schema ships dev-safe defaults so the app boots
// without a .env. Those published defaults are a full auth-bypass in production,
// so refuse to boot in production unless real values are set.
const INSECURE_DEFAULTS = {
  JWT_ACCESS_SECRET: "__dev_access__",
  JWT_REFRESH_SECRET: "__dev_refresh__",
  ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
};
if (parsed.data.NODE_ENV === "production") {
  const offenders = [];
  for (const [key, insecure] of Object.entries(INSECURE_DEFAULTS)) {
    if (parsed.data[key] === insecure) offenders.push(key);
  }
  if (parsed.data.JWT_ACCESS_SECRET === parsed.data.JWT_REFRESH_SECRET) {
    offenders.push("JWT_ACCESS_SECRET_and_REFRESH_must_differ");
  }
  if (!parsed.data.DB_PASSWORD) offenders.push("DB_PASSWORD_empty");
  if (offenders.length) {
    /// eslint-disable-next-line no-console
    console.error("Refusing to boot in production with insecure/default secrets:", offenders.join(", "));
    throw new Error("Insecure production configuration — set real values for: " + offenders.join(", "));
  }
}

const config = Object.freeze(parsed.data);

const groups = Object.freeze({
  platform: {
    host: config.DB_HOST, port: config.DB_PORT, database: config.DB_NAME,
    user: config.DB_USER, password: config.DB_PASSWORD, schema: config.DB_PLATFORM_SCHEMA,
  },
  redis: { url: config.REDIS_URL },
  jwt: {
    accessSecret: config.JWT_ACCESS_SECRET, refreshSecret: config.JWT_REFRESH_SECRET,
    accessTtl: config.JWT_ACCESS_TTL, refreshTtl: config.JWT_REFRESH_TTL,
  },
  ai: {
    enabledDefault: config.AI_ENABLED_DEFAULT,
    deepseek: { key: config.DEEPSEEK_API_KEY, baseUrl: config.DEEPSEEK_BASE_URL, model: config.DEEPSEEK_MODEL },
    gemini: { key: config.GEMINI_API_KEY, model: config.GEMINI_MODEL },
    groq: { key: config.GROQ_API_KEY, whisperBaseUrl: config.WHISPER_BASE_URL },
    embeddings: {
      provider: config.EMBEDDINGS_PROVIDER, model: config.EMBEDDINGS_MODEL, dim: config.EMBEDDINGS_DIM,
      openaiKey: config.OPENAI_API_KEY, openaiBaseUrl: config.OPENAI_BASE_URL,
    },
    monthlyCapXaf: config.AI_MONTHLY_CAP_XAF,
  },
  storage: {
    driver: config.STORAGE_DRIVER, localPath: config.STORAGE_LOCAL_PATH,
    s3: { endpoint: config.S3_ENDPOINT, bucket: config.S3_BUCKET, accessKey: config.S3_ACCESS_KEY, secretKey: config.S3_SECRET_KEY },
  },
});

module.exports = { config, groups };
