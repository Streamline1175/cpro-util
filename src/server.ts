import Fastify from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { mkdir, writeFile, stat, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
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
