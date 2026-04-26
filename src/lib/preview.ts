import { readFile } from "node:fs/promises";
import { extname, basename } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import open from "open";
import { SPECS } from "./specs.js";

export interface PreviewOptions {
  port: number;
  openBrowser: boolean;
}

export async function previewFile(filePath: string, opts: Partial<PreviewOptions> = {}): Promise<FastifyInstance> {
  const options: PreviewOptions = { port: 7778, openBrowser: true, ...opts };
  const app = Fastify({ logger: false });
  const ext = extname(filePath).toLowerCase();
  const mime = ext === ".mp4" ? "video/mp4" : ext === ".png" ? "image/png" : "application/octet-stream";
  const name = basename(filePath);

  app.get("/media", async (_req, reply) => {
    const buf = await readFile(filePath);
    reply.header("Content-Type", mime);
    reply.header("Cache-Control", "no-store");
    return reply.send(buf);
  });

  app.get("/", async (_req, reply) => {
    reply.header("Content-Type", "text/html; charset=utf-8");
    return reply.send(renderHtml(name, mime, SPECS.width, SPECS.height));
  });

  await app.listen({ port: options.port, host: "127.0.0.1" });
  const url = `http://127.0.0.1:${options.port}`;
  if (options.openBrowser) {
    await open(url);
  }
  return app;
}

function renderHtml(name: string, mime: string, w: number, h: number): string {
  const isVideo = mime.startsWith("video");
  const media = isVideo
    ? `<video src="/media" autoplay muted loop playsinline></video>`
    : `<img src="/media" alt="${name}" />`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>cpro preview — ${escapeHtml(name)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0b0b0d; color: #e7e7ea; font: 14px/1.4 -apple-system, Inter, system-ui, sans-serif; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 24px; padding: 24px; }
  .label { opacity: 0.7; font-variant-numeric: tabular-nums; letter-spacing: 0.02em; }
  .stage {
    --w: ${w}; --h: ${h};
    width: min(calc(100vw - 48px), calc((100vh - 120px) * (var(--w) / var(--h))));
    aspect-ratio: ${w} / ${h};
    background: #000; border-radius: 10px; overflow: hidden;
    box-shadow: 0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06) inset;
  }
  .stage img, .stage video { width: 100%; height: 100%; display: block; object-fit: fill; }
  .kbd { font-family: ui-monospace, monospace; background: #1a1a1f; padding: 2px 6px; border-radius: 4px; }
</style>
</head>
<body>
  <div class="label">Centerpiece Pro preview · ${w}×${h} · <span class="kbd">${escapeHtml(name)}</span></div>
  <div class="stage">${media}</div>
  <div class="label">press <span class="kbd">Ctrl+C</span> in the terminal to stop</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
