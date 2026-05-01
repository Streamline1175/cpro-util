import { spawn } from "node:child_process";
import { mkdir, readdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { FFMPEG } from "./ffmpeg-bin.js";

export interface FetchProgress {
  percent: number;
  speed?: string;
  eta?: string;
}

export interface FetchResult {
  filePath: string;
  title: string;
  bytes: number;
}

const URL_RE = /^https?:\/\//i;

export function isUrl(input: string): boolean {
  return URL_RE.test(input.trim());
}

export interface FetchOptions {
  workDir?: string;
  onProgress?: (p: FetchProgress) => void;
  /** Trim start in seconds. Combined with durationSec, passed to yt-dlp `--download-sections`. */
  startSec?: number;
  /** Trim duration in seconds from start. */
  durationSec?: number;
}

export async function fetchVideoFromUrl(
  url: string,
  opts: FetchOptions = {},
): Promise<FetchResult> {
  const bin = process.env.YTDLP_PATH || "yt-dlp";
  const dir = opts.workDir ?? join(tmpdir(), "cpro-util", "fetch", randomUUID());
  await mkdir(dir, { recursive: true });

  const outTemplate = join(dir, "%(title).100B [%(id)s].%(ext)s");
  const args = [
    "--no-playlist",
    "--no-progress",
    "--newline",
    "--restrict-filenames",
    "--ffmpeg-location", dirname(FFMPEG),
    "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
    "--merge-output-format", "mp4",
    "-o", outTemplate,
  ];

  const start = opts.startSec && opts.startSec > 0 ? opts.startSec : 0;
  const duration = opts.durationSec && opts.durationSec > 0 ? opts.durationSec : undefined;
  if (start > 0 || duration) {
    const end = duration ? start + duration : undefined;
    const range = end ? `*${start.toFixed(3)}-${end.toFixed(3)}` : `*${start.toFixed(3)}-inf`;
    args.push("--download-sections", range, "--force-keyframes-at-cuts");
  }

  args.push(url);

  await runYtDlp(bin, args, opts.onProgress);

  const entries = await readdir(dir);
  const mp4 = entries.find((f) => /\.(mp4|mkv|webm|mov)$/i.test(f));
  if (!mp4) throw new Error(`yt-dlp produced no video file in ${dir}`);
  const filePath = join(dir, mp4);
  const { size } = await stat(filePath);
  const title = mp4.replace(/\.[^.]+$/, "");
  return { filePath, title, bytes: size };
}

function runYtDlp(
  bin: string,
  args: string[],
  onProgress?: (p: FetchProgress) => void,
): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    let proc;
    try {
      proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e: any) {
      rejectP(ytDlpMissingError(e));
      return;
    }

    let stderr = "";
    let lastBuf = "";

    proc.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") rejectP(ytDlpMissingError(e));
      else rejectP(e);
    });

    proc.stdout.on("data", (chunk) => {
      lastBuf += chunk.toString();
      const lines = lastBuf.split(/\r?\n/);
      lastBuf = lines.pop() ?? "";
      for (const line of lines) parseProgress(line, onProgress);
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) resolveP();
      else rejectP(new Error(`yt-dlp exited ${code}:\n${stderr.trim()}`));
    });
  });
}

function parseProgress(line: string, onProgress?: (p: FetchProgress) => void): void {
  if (!onProgress) return;
  const m = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%(?:\s+of\s+\S+)?(?:\s+at\s+(\S+))?(?:\s+ETA\s+(\S+))?/);
  if (!m) return;
  const percent = Number(m[1]);
  if (!Number.isFinite(percent)) return;
  onProgress({ percent, speed: m[2], eta: m[3] });
}

function ytDlpMissingError(orig: Error): Error {
  return new Error(
    `yt-dlp not found. Install it (e.g. \`brew install yt-dlp\` or \`pipx install yt-dlp\`) or set YTDLP_PATH. (${orig.message})`,
  );
}
