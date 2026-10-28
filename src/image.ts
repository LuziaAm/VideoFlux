import * as fs from "node:fs";
import * as path from "node:path";
import OpenAI from "openai";
import { config } from "./config.js";
import { downloadToFile, pad, projectDir } from "./utils.js";

let client: OpenAI | null = null;
function openai(): OpenAI {
  if (!config.openaiApiKey) throw new Error("OPENAI_API_KEY não configurada.");
  client ??= new OpenAI({ apiKey: config.openaiApiKey });
  return client;
}

export interface ImageResult {
  scene_index: number;
  image_path: string;
  image_url?: string; // URL remota temporária (somente dall-e-3; expira em ~1h)
  model: string;
}

export async function generateImage(opts: {
  prompt: string;
  scene_index: number;
  project?: string;
}): Promise<ImageResult> {
  const model = config.imageModel;
  const isDalle3 = model === "dall-e-3";
  const fullPrompt = `${opts.prompt}. Vertical 9:16 composition, cinematic framing, highly detailed.`;

  const params: Record<string, unknown> = {
    model,
    prompt: fullPrompt,
    n: 1,
    // dall-e-3 suporta 1024x1792; gpt-image-* usa 1024x1536 para retrato.
    size: isDalle3 ? "1024x1792" : "1024x1536",
  };
  if (config.imageQuality) params.quality = config.imageQuality;
  if (isDalle3) params.response_format = "url";

  const response = await openai().images.generate(params as any);
  const item = (response as any).data?.[0];
  if (!item) throw new Error("A OpenAI não retornou nenhuma imagem.");

  const dest = path.join(projectDir(opts.project), `scene_${pad(opts.scene_index)}.png`);

  if (item.b64_json) {
    fs.writeFileSync(dest, Buffer.from(item.b64_json, "base64"));
  } else if (item.url) {
    await downloadToFile(item.url, dest);
  } else {
    throw new Error("Resposta da OpenAI sem b64_json nem url.");
  }

  return { scene_index: opts.scene_index, image_path: dest, image_url: item.url, model };
}
