import * as fs from "node:fs";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import axios from "axios";
import { config } from "./config.js";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Nome de pasta seguro para o "projeto" (agrupa as cenas de um vídeo). */
export function slugify(input: string): string {
  return (
    input
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "default"
  );
}

export function projectDir(project?: string): string {
  const dir = path.join(config.outputDir, slugify(project ?? "default"));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const pad = (n: number) => String(n).padStart(2, "0");

/** Baixa uma URL para disco e só retorna quando o arquivo estiver completo. */
export async function downloadToFile(url: string, dest: string): Promise<string> {
  const res = await axios.get(url, { responseType: "stream", timeout: 5 * 60 * 1000 });
  await pipeline(res.data, fs.createWriteStream(dest));
  return dest;
}

/** Converte arquivo local em data URI (aceito por Fal e Replicate como imagem de entrada). */
export function fileToDataUri(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

export function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data;
    const detail = typeof body === "string" ? body : JSON.stringify(body);
    return `${err.message}${detail ? ` — ${detail.slice(0, 800)}` : ""}`;
  }
  return err instanceof Error ? err.message : String(err);
}
