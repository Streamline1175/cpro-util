import Fastify from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { mkdir, writeFile, stat, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import open from "open";
import { classifyByExtension } from "./lib/classify.js";
import { convertImage } from "./lib/convert-image.js";
import { convertVideo } from "./lib/convert-video.js";
import { DEFAULT_OPTIONS, SPECS, clampFps, clampBitrateMbps, parseTimeToSeconds, type FitStrategy } from "./lib/specs.js";
import { fetchVideoFromUrl, isUrl } from "./lib/fetch-url.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ServerOptions {
  port: number;
  openBrowser: boolean;
  workDir?: string;
}

type ProgressSink = (event: string, data: string) => void;
const progressSinks = new Map<string, ProgressSink>();

export async function startServer(opts: ServerOptions) {
  const workDir = opts.workDir ?? join(tmpdir(), "cpro-util");
  await mkdir(join(workDir, "in"), { recursive: true });
  await mkdir(join(workDir, "out"), { recursive: true });

  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 * 1024 });
  await app.register(multipart, { limits: { fileSize: 1024 * 1024 * 1024 } });

  const webDir = resolveWebDir();
  await app.register(fastifyStatic, { root: webDir, prefix: "/" });

  // SSE progress stream for URL conversion jobs
  app.get("/api/progress/:jobId", (req, reply) => {
    const jobId = (req.params as { jobId: string }).jobId.replace(/[^a-zA-Z0-9\-]/g, "");
    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    raw.write(": connected\n\n");

    const sink: ProgressSink = (event, data) => {
      raw.write(`event: ${event}\ndata: ${data}\n\n`);
    };
    progressSinks.set(jobId, sink);

    req.raw.on("close", () => {
      progressSinks.delete(jobId);
    });
  });

  app.get("/api/specs", async () => SPECS);

  // Key layout data — same positions as GetPositionByKeyIndex() in CpSkinAPIBPLibrary.cpp
  app.get("/api/keys", async () => {
    const rows = [
      { startIndex: 1,  count: 14, y: 55  },
      { startIndex: 15, count: 14, y: 165 },
      { startIndex: 29, count: 14, y: 275 },
      { startIndex: 43, count: 14, y: 385 },
      { startIndex: 57, count: 11, y: 495 },
    ];
    const labels: Record<number, string> = {
      1:"Esc",2:"F1",3:"F2",4:"F3",5:"F4",6:"F5",7:"F6",
      8:"F7",9:"F8",10:"F9",11:"F10",12:"F11",13:"F12",14:"Del",
      15:"`",16:"1",17:"2",18:"3",19:"4",20:"5",21:"6",
      22:"7",23:"8",24:"9",25:"0",26:"-",27:"=",28:"Bksp",
      29:"Tab",30:"Q",31:"W",32:"E",33:"R",34:"T",35:"Y",
      36:"U",37:"I",38:"O",39:"P",40:"[",41:"]",42:"\\",
      43:"Caps",44:"A",45:"S",46:"D",47:"F",48:"G",49:"H",
      50:"J",51:"K",52:"L",53:";",54:"'",55:"Enter",56:"Enter",
      57:"LShift",58:"Z",59:"X",60:"C",61:"V",62:"B",63:"N",
      64:"M",65:",",66:".",67:"/",
    };
    const keys = rows.flatMap((row) =>
      Array.from({ length: row.count }, (_, i) => {
        const index = row.startIndex + i;
        const t     = row.count > 1 ? i / (row.count - 1) : 0.5;
        const x     = t * SPECS.width;
        return { index, label: labels[index] ?? String(index), x, y: row.y };
      }),
    );
    return { keys, width: SPECS.width, height: SPECS.height };
  });

  app.get("/api/ytdlp-check", async (_req, reply) => {
    const bin = process.env.YTDLP_PATH || "yt-dlp";
    return new Promise<void>((resolve) => {
      execFile(bin, ["--version"], { timeout: 5000 }, (err, stdout) => {
        if (err) {
          reply.send({ installed: false });
        } else {
          reply.send({ installed: true, version: stdout.trim() });
        }
        resolve();
      });
    });
  });

  app.get("/api/output/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id.replace(/[^a-zA-Z0-9.\-_]/g, "");
    const filePath = join(workDir, "out", id);
    if (!existsSync(filePath)) return reply.code(404).send({ error: "not found" });
    const ext = extname(filePath).toLowerCase();
    reply.header("Content-Type", ext === ".mp4" ? "video/mp4" : "image/png");
    reply.header("Cache-Control", "no-store");
    return reply.send(await readFile(filePath));
  });

  app.get("/api/download/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id.replace(/[^a-zA-Z0-9.\-_]/g, "");
    const filePath = join(workDir, "out", id);
    if (!existsSync(filePath)) return reply.code(404).send({ error: "not found" });
    reply.header("Content-Disposition", `attachment; filename="${basename(filePath)}"`);
    reply.header("Content-Type", "application/octet-stream");
    return reply.send(await readFile(filePath));
  });

  app.post("/api/convert", async (req, reply) => {
    const mp = await req.file({ limits: { fileSize: 1024 * 1024 * 1024 } });
    if (!mp) return reply.code(400).send({ error: "no file uploaded" });

    const fields = mp.fields as Record<string, { value?: string } | undefined>;
    const fit = validateFit(fields.fit?.value ?? DEFAULT_OPTIONS.fit);
    const background = fields.background?.value ?? DEFAULT_OPTIONS.background;
    const fps = clampFps(Number(fields.fps?.value ?? DEFAULT_OPTIONS.fps));
    const bitrateMbps = clampBitrateMbps(Number(fields.bitrate?.value ?? DEFAULT_OPTIONS.bitrateMbps));
    const cropX = clamp01(Number(fields.cropX?.value ?? DEFAULT_OPTIONS.cropX));
    const cropY = clamp01(Number(fields.cropY?.value ?? DEFAULT_OPTIONS.cropY));
    let startSec: number | undefined;
    let durationSec: number | undefined;
    try {
      startSec = parseTimeToSeconds(fields.start?.value);
      durationSec = parseTimeToSeconds(fields.duration?.value);
    } catch (e: any) {
      return reply.code(400).send({ ok: false, error: String(e.message ?? e) });
    }

    const originalName = mp.filename ?? "upload";
    const kind = classifyByExtension(originalName);
    if (!kind) return reply.code(400).send({ error: `Unsupported type: ${originalName}` });

    const id = randomUUID();
    const inPath = join(workDir, "in", `${id}${extname(originalName) || ""}`);
    const outExt = kind === "image" ? ".png" : ".mp4";
    const outName = stripExt(originalName) + ".skin" + outExt;
    const outId = `${id}${outExt}`;
    const outPath = join(workDir, "out", outId);

    const buf = await mp.toBuffer();
    await writeFile(inPath, buf);

    const options = { fit, background, fps, bitrateMbps, cropX, cropY, startSec, durationSec };
    try {
      if (kind === "image") {
        const r = await convertImage(inPath, outPath, options);
        await writeFile(join(workDir, "out", `${id}.meta.json`), JSON.stringify({ filename: outName, kind: "image", inPath })).catch(() => {});
        return {
          ok: true,
          kind,
          id: outId,
          filename: outName,
          bytes: r.bytes,
          width: r.width,
          height: r.height,
        };
      } else {
        const r = await convertVideo(inPath, outPath, options);
        await writeFile(join(workDir, "out", `${id}.meta.json`), JSON.stringify({ filename: outName, kind: "video", inPath })).catch(() => {});
        return {
          ok: true,
          kind,
          id: outId,
          filename: outName,
          bytes: r.bytes,
          width: r.width,
          height: r.height,
          fps: r.fps,
          bitrateMbps: r.bitrateMbps,
          durationSec: r.durationSec,
        };
      }
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: String(err?.message ?? err) });
    }
  });

  app.post("/api/convert-url", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url || !isUrl(url)) return reply.code(400).send({ ok: false, error: "Provide a valid http(s) URL" });

    const fit = validateFit(typeof body.fit === "string" ? body.fit : DEFAULT_OPTIONS.fit);
    const background = typeof body.background === "string" ? body.background : DEFAULT_OPTIONS.background;
    const fps = clampFps(Number(body.fps ?? DEFAULT_OPTIONS.fps));
    const bitrateMbps = clampBitrateMbps(Number(body.bitrate ?? DEFAULT_OPTIONS.bitrateMbps));
    const cropX = clamp01(Number(body.cropX ?? DEFAULT_OPTIONS.cropX));
    const cropY = clamp01(Number(body.cropY ?? DEFAULT_OPTIONS.cropY));
    let startSec: number | undefined;
    let durationSec: number | undefined;
    try {
      startSec = parseTimeToSeconds(body.start as string | number | undefined);
      durationSec = parseTimeToSeconds(body.duration as string | number | undefined);
    } catch (e: any) {
      return reply.code(400).send({ ok: false, error: String(e.message ?? e) });
    }

    const jobId = typeof body.jobId === "string" ? body.jobId.replace(/[^a-zA-Z0-9\-]/g, "") : "";
    const push = (event: string, data: object) => {
      const sink = jobId ? progressSinks.get(jobId) : undefined;
      if (sink) sink(event, JSON.stringify(data));
    };

    try {
      const fetched = await fetchVideoFromUrl(url, {
        workDir: join(workDir, "in", randomUUID()),
        startSec,
        durationSec,
        onProgress: (p) => push("download", { percent: p.percent, speed: p.speed, eta: p.eta }),
      });
      const id = randomUUID();
      const outId = `${id}.mp4`;
      const outName = sanitizeName(fetched.title) + ".skin.mp4";
      const outPath = join(workDir, "out", outId);

      const r = await convertVideo(fetched.filePath, outPath, {
        fit, background, fps, bitrateMbps, cropX, cropY,
      }, (p) => push("encode", { percent: p.percent }));
      await writeFile(join(workDir, "out", `${id}.meta.json`), JSON.stringify({ filename: outName, kind: "video", inPath: dirname(fetched.filePath) })).catch(() => {});
      return {
        ok: true,
        kind: "video" as const,
        id: outId,
        filename: outName,
        bytes: r.bytes,
        width: r.width,
        height: r.height,
        fps: r.fps,
        bitrateMbps: r.bitrateMbps,
        durationSec: r.durationSec,
        sourceTitle: fetched.title,
      };
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: String(err?.message ?? err) });
    }
  });

  app.get("/api/files", async () => {
    const outDir = join(workDir, "out");
    let entries: string[];
    try { entries = await readdir(outDir); } catch { return []; }
    const mediaFiles = entries.filter(f => /\.(mp4|png)$/i.test(f));
    const results = await Promise.all(mediaFiles.map(async (name) => {
      const filePath = join(outDir, name);
      const metaPath = join(outDir, name.replace(/\.[^.]+$/, ".meta.json"));
      const [fileStat, metaRaw] = await Promise.all([
        stat(filePath).catch(() => null),
        readFile(metaPath, "utf8").catch(() => null),
      ]);
      if (!fileStat) return null;
      const meta = metaRaw ? JSON.parse(metaRaw) : null;
      return {
        id: name,
        filename: meta?.filename ?? name,
        kind: (meta?.kind ?? (name.endsWith(".mp4") ? "video" : "image")) as "video" | "image",
        bytes: fileStat.size,
        createdAt: fileStat.mtime.toISOString(),
      };
    }));
    return results
      .filter(Boolean)
      .sort((a, b) => new Date(b!.createdAt).getTime() - new Date(a!.createdAt).getTime());
  });

  app.delete("/api/files/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id.replace(/[^a-zA-Z0-9.\-_]/g, "");
    if (!id) return reply.code(400).send({ ok: false, error: "invalid id" });
    const outDir = join(workDir, "out");
    const filePath = join(outDir, id);
    const metaPath = join(outDir, id.replace(/\.[^.]+$/, ".meta.json"));
    let inPath: string | null = null;
    try {
      const metaRaw = await readFile(metaPath, "utf8");
      inPath = JSON.parse(metaRaw)?.inPath ?? null;
    } catch { /* no meta, skip */ }
    await Promise.allSettled([
      rm(filePath, { force: true }),
      rm(metaPath, { force: true }),
      inPath ? rm(inPath, { recursive: true, force: true }) : Promise.resolve(),
    ]);
    return { ok: true };
  });

  app.delete("/api/files", async () => {
    const inDir = join(workDir, "in");
    const outDir = join(workDir, "out");
    await Promise.allSettled([
      rm(inDir, { recursive: true, force: true }),
      rm(outDir, { recursive: true, force: true }),
    ]);
    await mkdir(inDir, { recursive: true });
    await mkdir(outDir, { recursive: true });
    return { ok: true };
  });

  await app.listen({ port: opts.port, host: "127.0.0.1" });
  const url = `http://127.0.0.1:${opts.port}`;
  if (opts.openBrowser) {
    await open(url);
  }
  return app;
}

function resolveWebDir(): string {
  // dist/server.js → ../src/web when running from source via tsx
  // dist/server.js → ./web when compiled + assets copied
  const packaged = resolve(__dirname, "web");
  if (existsSync(packaged)) return packaged;
  return resolve(__dirname, "../src/web");
}

function validateFit(v: string): FitStrategy {
  if (v === "cover" || v === "contain" || v === "stretch") return v;
  return DEFAULT_OPTIONS.fit;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.max(0, Math.min(1, v));
}

function stripExt(name: string): string {
  return name.replace(/\.[^./\\]+$/, "");
}

function sanitizeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120) || "skin";
}
