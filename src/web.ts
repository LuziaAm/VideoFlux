#!/usr/bin/env node
/**
 * Interface web local do FluxVideo.
 * Servidor HTTP sem dependências extras que expõe as mesmas funções do MCP
 * (generate_image, generate_video_i2v, assemble_video, list_outputs) via JSON
 * e serve o frontend estático de public/ e os arquivos gerados de output/.
 */
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { config, PROJECT_ROOT } from "./config.js";
import { generateImage } from "./image.js";
import { generateVideoI2V } from "./video.js";
import { assembleVideo, listScenes } from "./assemble.js";
import { errorMessage, slugify } from "./utils.js";

const PORT = Number(process.env.WEB_PORT ?? 3000);
const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".svg": "image/svg+xml",
};

function sendJson(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

/** Resolve um caminho dentro de `base`, bloqueando path traversal. */
function safeJoin(base: string, rel: string): string | null {
  const full = path.resolve(base, "." + path.sep + rel);
  return full === base || full.startsWith(base + path.sep) ? full : null;
}

/** Serve arquivo estático com suporte a Range (necessário para <video> navegar). */
function serveFile(req: http.IncomingMessage, res: http.ServerResponse, file: string | null) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end("Not found");
    return;
  }
  const { size } = fs.statSync(file);
  const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);

  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, {
      "Content-Type": type,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
    });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes" });
  fs.createReadStream(file).pipe(res);
}

/** Converte caminhos absolutos de output/ em URLs /files/... para o navegador. */
const toUrl = (p: string) => "/files/" + path.relative(config.outputDir, p).split(path.sep).map(encodeURIComponent).join("/");

function projectSummary(project: string) {
  const { dir, images, videos, finals } = listScenes(project);
  const mtime = (f: string) => fs.statSync(f).mtimeMs;
  return {
    project: path.basename(dir),
    images: images.map((p) => ({ path: p, url: `${toUrl(p)}?t=${mtime(p)}` })),
    videos: videos.map((p) => ({ path: p, url: `${toUrl(p)}?t=${mtime(p)}` })),
    finals: finals.map((p) => ({ path: p, url: `${toUrl(p)}?t=${mtime(p)}` })),
  };
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
  const method = req.method ?? "GET";

  if (method === "GET" && pathname === "/api/config") {
    return sendJson(res, 200, {
      imageModel: config.imageModel,
      videoProvider: config.videoProvider,
      videoModel: config.videoModel,
      hasOpenAiKey: Boolean(config.openaiApiKey),
      hasVideoKey: Boolean(config.videoApiKey),
    });
  }

  if (method === "GET" && pathname === "/api/projects") {
    const projects = fs
      .readdirSync(config.outputDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => ({ name: d.name, mtime: fs.statSync(path.join(config.outputDir, d.name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .map((d) => d.name);
    return sendJson(res, 200, { projects });
  }

  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (method === "GET" && projectMatch) {
    return sendJson(res, 200, projectSummary(decodeURIComponent(projectMatch[1])));
  }

  if (method !== "POST") return sendJson(res, 404, { error: "Rota não encontrada" });
  const body = await readBody(req);
  const project = slugify(body.project ?? "default");

  switch (pathname) {
    case "/api/image": {
      const r = await generateImage({ prompt: body.prompt, scene_index: Number(body.scene_index), project });
      return sendJson(res, 200, { ...r, url: `${toUrl(r.image_path)}?t=${Date.now()}` });
    }
    case "/api/video": {
      const r = await generateVideoI2V({
        image_path: body.image_path,
        motion_prompt: body.motion_prompt,
        scene_index: Number(body.scene_index),
        duration: body.duration ? Number(body.duration) : undefined,
        negative_prompt: body.negative_prompt || undefined,
        project,
      });
      return sendJson(res, 200, { ...r, url: `${toUrl(r.video_path)}?t=${Date.now()}` });
    }
    case "/api/assemble": {
      const r = await assembleVideo({ project, output_name: body.output_name || undefined });
      return sendJson(res, 200, { ...r, url: `${toUrl(r.output_path)}?t=${Date.now()}` });
    }
    default:
      return sendJson(res, 404, { error: "Rota não encontrada" });
  }
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  try {
    if (pathname.startsWith("/api/")) return await handleApi(req, res, pathname);
    if (pathname.startsWith("/files/")) {
      return serveFile(req, res, safeJoin(config.outputDir, decodeURIComponent(pathname.slice(7))));
    }
    const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
    return serveFile(req, res, safeJoin(PUBLIC_DIR, rel));
  } catch (err) {
    const msg = errorMessage(err);
    console.error(`[web] ${req.method} ${pathname} falhou:`, msg);
    if (!res.headersSent) sendJson(res, 500, { error: msg });
  }
});

// Geração de vídeo pode levar vários minutos: desliga o timeout padrão de 5 min.
server.requestTimeout = 0;
server.timeout = 0;

server.listen(PORT, "127.0.0.1", () => {
  console.error(`[flux-video] Interface web em http://localhost:${PORT}`);
});
