import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Raiz do projeto (dist/ ou src/ -> ..). Não usamos process.cwd() porque o
// Claude Desktop inicia o servidor em um diretório arbitrário.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, "..");

// Carrega .env sem dependências e SEM escrever no stdout (stdout = canal MCP).
const envFile = path.join(PROJECT_ROOT, ".env");
if (fs.existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch (err) {
    console.error("[config] Falha ao ler .env:", err);
  }
}

export type VideoProvider = "fal" | "replicate" | "generic";

function parseJson(name: string): Record<string, unknown> {
  const raw = process.env[name];
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    console.error(`[config] ${name} não é um JSON válido, ignorando.`);
    return {};
  }
}

export const config = {
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  imageModel: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1",
  imageQuality: process.env.OPENAI_IMAGE_QUALITY ?? "",

  videoProvider: (process.env.VIDEO_PROVIDER ?? "fal") as VideoProvider,
  videoApiKey: process.env.VIDEO_API_KEY ?? "",
  videoModel:
    process.env.VIDEO_MODEL ?? "fal-ai/kling-video/v2.1/standard/image-to-video",
  videoApiEndpoint: process.env.VIDEO_API_ENDPOINT ?? "",
  videoExtraInput: parseJson("VIDEO_EXTRA_INPUT"),
  videoTimeoutMs: Number(process.env.VIDEO_TIMEOUT_MS ?? 15 * 60 * 1000),
  pollIntervalMs: Number(process.env.VIDEO_POLL_INTERVAL_MS ?? 5000),

  outputDir: path.resolve(PROJECT_ROOT, process.env.OUTPUT_DIR ?? "output"),
};

fs.mkdirSync(config.outputDir, { recursive: true });
