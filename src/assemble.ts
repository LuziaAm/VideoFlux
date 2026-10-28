import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import { projectDir } from "./utils.js";

const ffmpegPath = (ffmpegStatic as unknown as string) || "ffmpeg";

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg saiu com código ${code}: ${stderr.slice(-1500)}`)),
    );
  });
}

export function listScenes(project?: string) {
  const dir = projectDir(project);
  const files = fs.readdirSync(dir).sort();
  return {
    dir,
    images: files.filter((f) => /^scene_\d+\.png$/.test(f)).map((f) => path.join(dir, f)),
    videos: files.filter((f) => /^scene_\d+\.mp4$/.test(f)).map((f) => path.join(dir, f)),
    finals: files.filter((f) => /^final.*\.mp4$/.test(f)).map((f) => path.join(dir, f)),
  };
}

/**
 * Concatena os clipes scene_XX.mp4 do projeto em ordem, normalizando para
 * 1080x1920 @30fps (provedores diferentes podem devolver resoluções diferentes).
 */
export async function assembleVideo(opts: { project?: string; output_name?: string; with_audio?: boolean }) {
  const { dir, videos } = listScenes(opts.project);
  if (videos.length === 0) throw new Error(`Nenhum clipe scene_XX.mp4 em ${dir}`);

  const out = path.join(dir, opts.output_name ?? "final.mp4");
  const args: string[] = ["-y"];
  videos.forEach((v) => args.push("-i", v));

  const norm = videos
    .map(
      (_, i) =>
        `[${i}:v]scale=1080:1920:force_original_aspect_ratio=decrease,` +
        `pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}]`,
    )
    .join(";");
  const concatInputs = videos.map((_, i) => `[v${i}]`).join("");
  args.push(
    "-filter_complex",
    `${norm};${concatInputs}concat=n=${videos.length}:v=1:a=0[outv]`,
    "-map",
    "[outv]",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-movflags",
    "+faststart",
    "-an",
    out,
  );

  await runFfmpeg(args);
  return { output_path: out, clips: videos };
}
