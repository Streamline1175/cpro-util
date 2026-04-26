import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { SPECS, type ConvertOptions, DEFAULT_OPTIONS, clampFps, clampBitrateMbps } from "./specs.js";
import { planFit, ffmpegVideoFilter } from "./fit.js";
import { probe, type ProbeResult } from "./probe.js";
import { FFMPEG } from "./ffmpeg-bin.js";

export interface VideoConversionResult {
  outputPath: string;
  width: number;
  height: number;
  bytes: number;
  durationSec: number;
  fps: number;
  bitrateMbps: number;
  source: ProbeResult;
}

export interface VideoProgress {
  percent: number;
  timeMs: number;
  fps: number;
  speed: number;
}

export async function convertVideo(
  inputPath: string,
  outputPath: string,
  opts: Partial<ConvertOptions> = {},
  onProgress?: (p: VideoProgress) => void,
): Promise<VideoConversionResult> {
  const options = { ...DEFAULT_OPTIONS, ...opts };
  const src = await probe(inputPath);
  if (!src.width || !src.height) throw new Error(`Could not probe dimensions for ${inputPath}`);

  const targetFps = clampFps(options.fps || (src.fps >= SPECS.video.frameRate.min ? src.fps : SPECS.video.frameRate.default));
  const bitrate = clampBitrateMbps(options.bitrateMbps);
  const plan = planFit(src.width, src.height, options.fit, options.cropX, options.cropY);
  const vf = ffmpegVideoFilter(plan, options.background);

  const startSec = options.startSec && options.startSec > 0 ? options.startSec : 0;
  const wantedDuration = options.durationSec && options.durationSec > 0 ? options.durationSec : undefined;
  const remaining = Math.max(0, src.durationSec - startSec);
  const trimmedDuration = wantedDuration ? Math.min(wantedDuration, remaining) : remaining;

  const preInput: string[] = [];
  if (startSec > 0) preInput.push("-ss", startSec.toFixed(3));

  const postInput: string[] = [];
  if (wantedDuration) postInput.push("-t", trimmedDuration.toFixed(3));

  const args: string[] = [
    "-y",
    "-hide_banner",
    "-loglevel", "error",
    "-stats",
    "-progress", "pipe:2",
    ...preInput,
    "-i", inputPath,
    ...postInput,
    "-vf", vf,
    "-r", String(targetFps),
    "-c:v", SPECS.video.codec,
    "-profile:v", SPECS.video.profile,
    "-level:v", SPECS.video.level,
    "-pix_fmt", SPECS.video.pixelFormat,
    "-b:v", `${bitrate}M`,
    "-maxrate", `${SPECS.video.bitrateMbps.max}M`,
    "-bufsize", `${SPECS.video.bitrateMbps.max * 2}M`,
    "-movflags", "+faststart",
    "-an",
    "-f", "mp4",
    outputPath,
  ];

  await runFfmpeg(args, trimmedDuration, onProgress);
  const { size } = await stat(outputPath);

  return {
    outputPath,
    width: SPECS.width,
    height: SPECS.height,
    bytes: size,
    durationSec: trimmedDuration || src.durationSec,
    fps: targetFps,
    bitrateMbps: bitrate,
    source: src,
  };
}

function runFfmpeg(
  args: string[],
  totalDurationSec: number,
  onProgress?: (p: VideoProgress) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    p.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (!onProgress) return;
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^(\w+)=(.*)$/);
        if (!m) continue;
        const [, key, value] = m;
        if (key === "out_time_ms") {
          const n = Number(value);
          if (!Number.isFinite(n) || n < 0) continue;
          const timeMs = n / 1000;
          const percent = totalDurationSec > 0 ? Math.min(100, Math.max(0, (timeMs / (totalDurationSec * 1000)) * 100)) : 0;
          onProgress({ percent, timeMs, fps: 0, speed: 0 });
        }
      }
    });

    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}:\n${stderr}`));
    });
  });
}
