import { spawn } from "node:child_process";
import { FFPROBE } from "./ffmpeg-bin.js";

export interface ProbeResult {
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  codec: string;
  hasAudio: boolean;
  isAnimated: boolean;
}

export async function probe(inputPath: string): Promise<ProbeResult> {
  const args = [
    "-v", "error",
    "-print_format", "json",
    "-show_streams",
    "-show_format",
    inputPath,
  ];
  const json = await run(FFPROBE, args);
  const parsed = JSON.parse(json);
  const streams: any[] = parsed.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  if (!v) throw new Error(`No video stream in ${inputPath}`);

  const fps = parseFps(v.avg_frame_rate || v.r_frame_rate || "0/1");
  const duration = parseFloat(parsed.format?.duration ?? v.duration ?? "0") || 0;

  return {
    width: Number(v.width) || 0,
    height: Number(v.height) || 0,
    fps,
    durationSec: duration,
    codec: String(v.codec_name ?? "unknown"),
    hasAudio: streams.some((s) => s.codec_type === "audio"),
    isAnimated: duration > 0 && Number(v.nb_frames ?? 0) !== 1,
  };
}

function parseFps(rate: string): number {
  const [num, den] = rate.split("/").map(Number);
  if (!num || !den) return 0;
  return num / den;
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exited ${code}: ${err}`));
    });
  });
}
