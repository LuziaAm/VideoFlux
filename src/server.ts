#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { config } from "./config.js";
import { generateImage } from "./image.js";
import { generateVideoI2V } from "./video.js";
import { assembleVideo, listScenes } from "./assemble.js";
import { errorMessage } from "./utils.js";

// IMPORTANTE: em STDIO, o stdout é o canal do protocolo. Use apenas console.error para logs.

const server = new Server(
  { name: "flux-video-pipeline", version: "1.0.0" },
  {
    capabilities: { tools: {} },
    instructions:
      "Pipeline de vídeo vertical 9:16. Fluxo recomendado: (1) decupe o tema em cenas; " +
      "(2) para cada cena chame generate_image; (3) passe o image_path retornado para generate_video_i2v " +
      "com um motion_prompt de câmera/movimento; (4) ao final chame assemble_video para juntar os clipes. " +
      "Use o mesmo 'project' em todas as chamadas do mesmo vídeo.",
  },
);

const projectProp = {
  type: "string",
  description: "Nome do projeto/vídeo. Agrupa os arquivos em output/<project>/. Use o mesmo em todas as cenas.",
};

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "generate_image",
      description:
        "Gera um keyframe vertical 9:16 via OpenAI e salva em output/<project>/scene_XX.png. " +
        "Retorna image_path (use-o em generate_video_i2v).",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Descrição visual detalhada da cena." },
          scene_index: { type: "number", description: "Número sequencial da cena (1, 2, 3...)." },
          project: projectProp,
        },
        required: ["prompt", "scene_index"],
      },
    },
    {
      name: "generate_video_i2v",
      description:
        "Anima um keyframe (Image-to-Video) com comandos de câmera/movimento e salva " +
        "output/<project>/scene_XX.mp4. Pode levar alguns minutos.",
      inputSchema: {
        type: "object",
        properties: {
          image_path: { type: "string", description: "Caminho local retornado por generate_image (preferido)." },
          image_url: { type: "string", description: "Alternativa: URL pública da imagem." },
          motion_prompt: {
            type: "string",
            description: "Câmera/física/ação, ex.: 'slow dolly in, hair moving in the wind, cinematic'.",
          },
          scene_index: { type: "number", description: "Número sequencial da cena." },
          duration: { type: "number", description: "Duração em segundos (ex.: 5 ou 10), se o modelo suportar." },
          negative_prompt: { type: "string", description: "O que evitar (opcional)." },
          project: projectProp,
        },
        required: ["motion_prompt", "scene_index"],
      },
    },
    {
      name: "assemble_video",
      description:
        "Concatena todos os scene_XX.mp4 do projeto, em ordem, num único final.mp4 1080x1920.",
      inputSchema: {
        type: "object",
        properties: {
          project: projectProp,
          output_name: { type: "string", description: "Nome do arquivo final (padrão: final.mp4)." },
        },
      },
    },
    {
      name: "list_outputs",
      description: "Lista imagens, clipes e vídeos finais já gerados para um projeto.",
      inputSchema: { type: "object", properties: { project: projectProp } },
    },
  ],
}));

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify({ success: true, ...(data as object) }, null, 2) }],
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;
  const args = (request.params.arguments ?? {}) as Record<string, any>;
  console.error(`[tool] ${name}`, JSON.stringify(args).slice(0, 300));

  try {
    switch (name) {
      case "generate_image":
        return ok(await generateImage({ prompt: args.prompt, scene_index: args.scene_index, project: args.project }));

      case "generate_video_i2v":
        return ok(
          await generateVideoI2V({
            image_path: args.image_path,
            image_url: args.image_url,
            motion_prompt: args.motion_prompt,
            scene_index: args.scene_index,
            duration: args.duration,
            negative_prompt: args.negative_prompt,
            project: args.project,
          }),
        );

      case "assemble_video":
        return ok(await assembleVideo({ project: args.project, output_name: args.output_name }));

      case "list_outputs":
        return ok(listScenes(args.project));

      default:
        throw new Error(`Ferramenta desconhecida: ${name}`);
    }
  } catch (err) {
    const msg = errorMessage(err);
    console.error(`[tool] ${name} falhou:`, msg);
    return { isError: true, content: [{ type: "text" as const, text: `Erro: ${msg}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(
  `[flux-video] MCP pronto. provider=${config.videoProvider} model=${config.videoModel} output=${config.outputDir}`,
);
