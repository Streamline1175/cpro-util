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
  body { background: #0b0b0d; color: #e7e7ea; font: 14px/1.4 -apple-system, Inter, system-ui, sans-serif; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 24px; }
  .label { opacity: 0.7; font-variant-numeric: tabular-nums; letter-spacing: 0.02em; }
  .stage {
    --w: ${w}; --h: ${h};
    width: min(calc(100vw - 48px), calc((100vh - 160px) * (var(--w) / var(--h))));
    aspect-ratio: ${w} / ${h};
    background: #000; border-radius: 10px; overflow: hidden; position: relative;
    box-shadow: 0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06) inset;
  }
  .stage img, .stage video { width: 100%; height: 100%; display: block; object-fit: fill; }
  .kbd { font-family: ui-monospace, monospace; background: #1a1a1f; padding: 2px 6px; border-radius: 4px; }
  /* keyboard overlay */
  .kbd-overlay { position: absolute; inset: 0; pointer-events: none; }
  .kbd-keys, .kbd-legends { opacity: 0; transition: opacity 0.2s; }
  .stage.show-keys    .kbd-keys    { opacity: 1; }
  .stage.show-legends .kbd-legends { opacity: 1; }
  .kbd-keys rect { fill: rgba(255,255,255,.07); stroke: rgba(255,255,255,.45); stroke-width: 1.5px; }
  .kbd-legends text { fill: rgba(255,255,255,.88); }
  /* toggle buttons */
  .kbd-controls { display: flex; align-items: center; gap: 8px; }
  .kbd-lbl { font-size: 11px; color: #8a8a94; text-transform: uppercase; letter-spacing: 0.07em; }
  .kbd-btn {
    padding: 4px 12px; font-size: 12px; border-radius: 6px; cursor: pointer; font: inherit;
    background: #1a1a1f; color: #8a8a94; border: 1px solid #26262e;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .kbd-btn.active { background: rgba(106,166,255,.15); color: #6aa6ff; border-color: #6aa6ff; }
</style>
</head>
<body>
  <div class="label">Centerpiece Pro preview · ${w}×${h} · <span class="kbd">${escapeHtml(name)}</span></div>
  <div class="kbd-controls">
    <span class="kbd-lbl">Overlay:</span>
    <button class="kbd-btn" id="btn-keys">Keys</button>
    <button class="kbd-btn" id="btn-legends">Legends</button>
  </div>
  <div class="stage" id="stage">
    ${media}
    <div class="kbd-overlay">${buildKbdSvg(w, h)}</div>
  </div>
  <div class="label">press <span class="kbd">Ctrl+C</span> in the terminal to stop</div>
  <script>
    var stage = document.getElementById('stage');
    ['keys', 'legends'].forEach(function(k) {
      document.getElementById('btn-' + k).addEventListener('click', function() {
        var on = this.classList.toggle('active');
        stage.classList.toggle('show-' + k, on);
      });
    });
  </script>
</body>
</html>`;
}

function buildKbdSvg(w: number, h: number): string {
  const U = 102;
  const G = 6;
  const L = Math.round((w - 16.5 * U) / 2);
  const T = Math.round((h -  5   * U) / 2);

  const KEYS: [number, number, number, string][] = [
    // Row 1 — number row
    [0, 0, 1, "Esc"], [1, 0, 1, "1"], [2, 0, 1, "2"], [3, 0, 1, "3"],
    [4, 0, 1, "4"],   [5, 0, 1, "5"], [6, 0, 1, "6"], [7, 0, 1, "7"],
    [8, 0, 1, "8"],   [9, 0, 1, "9"], [10, 0, 1, "0"], [11, 0, 1, "-"],
    [12, 0, 1, "="],  [13, 0, 2, "Bksp"], [15.5, 0, 1, "Del"],
    // Row 2 — QWERTY
    [0, 1, 1.5, "Tab"],
    [1.5, 1, 1, "Q"], [2.5, 1, 1, "W"], [3.5, 1, 1, "E"], [4.5, 1, 1, "R"],
    [5.5, 1, 1, "T"], [6.5, 1, 1, "Y"], [7.5, 1, 1, "U"], [8.5, 1, 1, "I"],
    [9.5, 1, 1, "O"], [10.5, 1, 1, "P"], [11.5, 1, 1, "["], [12.5, 1, 1, "]"],
    [13.5, 1, 1.5, "\\"], [15.5, 1, 1, "PgUp"],
    // Row 3 — home row
    [0, 2, 1.75, "Caps"],
    [1.75, 2, 1, "A"], [2.75, 2, 1, "S"], [3.75, 2, 1, "D"], [4.75, 2, 1, "F"],
    [5.75, 2, 1, "G"], [6.75, 2, 1, "H"], [7.75, 2, 1, "J"], [8.75, 2, 1, "K"],
    [9.75, 2, 1, "L"], [10.75, 2, 1, ";"], [11.75, 2, 1, "'"],
    [12.75, 2, 2.25, "Enter"], [15.5, 2, 1, "PgDn"],
    // Row 4 — shift row
    [0, 3, 2.25, "Shift"],
    [2.25, 3, 1, "Z"], [3.25, 3, 1, "X"], [4.25, 3, 1, "C"], [5.25, 3, 1, "V"],
    [6.25, 3, 1, "B"], [7.25, 3, 1, "N"], [8.25, 3, 1, "M"], [9.25, 3, 1, ","],
    [10.25, 3, 1, "."], [11.25, 3, 1, "/"], [12.25, 3, 1.75, "Shift"],
    [15.5, 3, 1, "\u2191"],
    // Row 5 — bottom row
    [0, 4, 1.25, "Ctrl"], [1.25, 4, 1.25, "Win"], [2.5, 4, 1.25, "Alt"],
    [3.75, 4, 6.25, ""],
    [10, 4, 1, "Alt"], [11, 4, 1, "Fn"], [12, 4, 1, "Ctrl"],
    [13.5, 4, 1, "\u2190"], [14.5, 4, 1, "\u2193"], [15.5, 4, 1, "\u2192"],
  ];

  let rects = "";
  let texts = "";
  for (const [xu, yu, wu, label] of KEYS) {
    const kx = (L + xu * U + G * 0.5).toFixed(1);
    const ky = (T + yu * U + G * 0.5).toFixed(1);
    const kw = (wu * U - G).toFixed(1);
    const kh = (U - G).toFixed(1);
    rects += `<rect x="${kx}" y="${ky}" width="${kw}" height="${kh}" rx="8"/>`;
    if (label) {
      const cx = (L + xu * U + G * 0.5 + (wu * U - G) * 0.5).toFixed(1);
      const cy = (T + yu * U + G * 0.5 + (U - G) * 0.5).toFixed(1);
      const n = label.length;
      const fs = n === 1 ? 32 : n <= 3 ? 22 : n <= 4 ? 18 : 14;
      texts += `<text x="${cx}" y="${cy}" font-size="${fs}">${escapeHtml(label)}</text>`;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="100%">` +
    `<g class="kbd-keys">${rects}</g>` +
    `<g class="kbd-legends" text-anchor="middle" dominant-baseline="middle"` +
    ` font-family="ui-monospace,monospace" font-weight="700">${texts}</g>` +
    `</svg>`
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
