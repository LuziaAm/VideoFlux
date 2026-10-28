import * as fs from "node:fs";
import * as path from "node:path";
import axios from "axios";
import { config } from "./config.js";
import { downloadToFile, fileToDataUri, pad, projectDir, sleep } from "./utils.js";

export interface VideoResult {
  scene_index: number;
  video_path: string;
  video_url: string;
  provider: string;
  model: string;
}

interface I2VInput {
  image: string; // URL http(s) ou data URI
  prompt: string;
  duration?: number;
  negative_prompt?: string;
}

/** Procura recursivamente a primeira URL de vídeo em respostas de formatos variados. */
function findVideoUrl(data: unknown): string | undefined {
  if (!data) return undefined;
  if (typeof data === "string") return /^https?:\/\//.test(data) ? data : undefined;
  if (Array.isArray(data)) {
    for (const d of data) {
      const u = findVideoUrl(d);
      if (u) return u;
    }
    return undefined;
  }
  if (typeof data === "object") {
    const o = data as Record<string, any>;
    for (const key of ["video", "output", "video_url", "url", "videos", "result"]) {
      const u = findVideoUrl(o[key]);
      if (u) return u;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------- Fal.ai (fila)
async function runFal(input: I2VInput): Promise<string> {
  const headers = { Authorization: `Key ${config.videoApiKey}`, "Content-Type": "application/json" };
  const body: Record<string, unknown> = {
    prompt: input.prompt,
    image_url: input.image,
    ...(input.duration ? { duration: String(input.duration) } : {}),
    ...(input.negative_prompt ? { negative_prompt: input.negative_prompt } : {}),
    ...config.videoExtraInput,
  };

  const submit = await axios.post(`https://queue.fal.run/${config.videoModel}`, body, {
    headers,
    maxBodyLength: Infinity,
  });
  const { status_url, response_url, request_id } = submit.data;
  console.error(`[fal] request ${request_id} enviado`);

  const deadline = Date.now() + config.videoTimeoutMs;
  while (Date.now() < deadline) {
    await sleep(config.pollIntervalMs);
    const { data: st } = await axios.get(status_url, { headers });
    if (st.status === "COMPLETED") {
      const { data: result } = await axios.get(response_url, { headers });
      const url = findVideoUrl(result);
      if (!url) throw new Error(`Fal concluiu sem URL de vídeo: ${JSON.stringify(result).slice(0, 500)}`);
      return url;
    }
    if (st.status === "FAILED" || st.error) {
      throw new Error(`Fal falhou: ${JSON.stringify(st).slice(0, 500)}`);
    }
  }
  throw new Error(`Timeout aguardando o Fal (request ${request_id}).`);
}

// ------------------------------------------------------------------- Replicate
async function runReplicate(input: I2VInput): Promise<string> {
  const headers = {
    Authorization: `Bearer ${config.videoApiKey}`,
    "Content-Type": "application/json",
    Prefer: "wait=60",
  };
  // VIDEO_MODEL = "owner/name" (modelo oficial) ou "owner/name:versionhash"
  const [ref, version] = config.videoModel.split(":");
  const url = version
    ? "https://api.replicate.com/v1/predictions"
    : `https://api.replicate.com/v1/models/${ref}/predictions`;

  const payload: Record<string, unknown> = {
    input: {
      prompt: input.prompt,
      start_image: input.image,
      ...(input.duration ? { duration: input.duration } : {}),
      ...(input.negative_prompt ? { negative_prompt: input.negative_prompt } : {}),
      ...config.videoExtraInput, // ex.: {"image": "..."} se o modelo usar outro nome de campo
    },
  };
  if (version) payload.version = version;

  let { data: pred } = await axios.post(url, payload, { headers, maxBodyLength: Infinity });
  const deadline = Date.now() + config.videoTimeoutMs;
  while (!["succeeded", "failed", "canceled"].includes(pred.status)) {
    if (Date.now() > deadline) throw new Error(`Timeout aguardando Replicate (${pred.id}).`);
    await sleep(config.pollIntervalMs);
    ({ data: pred } = await axios.get(pred.urls.get, { headers }));
  }
  if (pred.status !== "succeeded") throw new Error(`Replicate ${pred.status}: ${pred.error ?? ""}`);
  const out = findVideoUrl(pred.output);
  if (!out) throw new Error(`Replicate sem URL de vídeo: ${JSON.stringify(pred.output)}`);
  return out;
}

// --------------------------------------------- Genérico (POST síncrono simples)
async function runGeneric(input: I2VInput): Promise<string> {
  if (!config.videoApiEndpoint) throw new Error("VIDEO_API_ENDPOINT não configurado para provider 'generic'.");
  const { data } = await axios.post(
    config.videoApiEndpoint,
    {
      image_url: input.image,
      prompt: input.prompt,
      aspect_ratio: "9:16",
      ...(input.duration ? { duration: input.duration } : {}),
      ...config.videoExtraInput,
    },
    {
      headers: { Authorization: `Key ${config.videoApiKey}`, "Content-Type": "application/json" },
      timeout: config.videoTimeoutMs,
      maxBodyLength: Infinity,
    },
  );
  const url = findVideoUrl(data);
  if (!url) throw new Error(`Resposta sem URL de vídeo: ${JSON.stringify(data).slice(0, 500)}`);
  return url;
}

export async function generateVideoI2V(opts: {
  scene_index: number;
  motion_prompt: string;
  image_path?: string;
  image_url?: string;
  project?: string;
  duration?: number;
  negative_prompt?: string;
}): Promise<VideoResult> {
  if (!config.videoApiKey) throw new Error("VIDEO_API_KEY não configurada.");

  // Prioriza o arquivo local (não expira); cai para a URL se não houver.
  let image: string;
  if (opts.image_path) {
    if (!fs.existsSync(opts.image_path)) throw new Error(`Imagem não encontrada: ${opts.image_path}`);
    image = fileToDataUri(opts.image_path);
  } else if (opts.image_url) {
    image = opts.image_url;
  } else {
    throw new Error("Informe image_path ou image_url.");
  }

  const input: I2VInput = {
    image,
    prompt: opts.motion_prompt,
    duration: opts.duration,
    negative_prompt: opts.negative_prompt,
  };

  const runners = { fal: runFal, replicate: runReplicate, generic: runGeneric };
  const run = runners[config.videoProvider];
  if (!run) throw new Error(`VIDEO_PROVIDER inválido: ${config.videoProvider}`);

  const videoUrl = await run(input);
  const dest = path.join(projectDir(opts.project), `scene_${pad(opts.scene_index)}.mp4`);
  await downloadToFile(videoUrl, dest);

  return {
    scene_index: opts.scene_index,
    video_path: dest,
    video_url: videoUrl,
    provider: config.videoProvider,
    model: config.videoModel,
  };
}
