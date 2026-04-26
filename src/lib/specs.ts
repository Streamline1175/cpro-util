export const SPECS = {
  width: 1920,
  height: 550,
  aspectRatio: 1920 / 550,
  video: {
    codec: "libx264",
    profile: "main",
    level: "4.2",
    pixelFormat: "yuv420p",
    frameRate: { min: 30, max: 60, default: 60 },
    bitrateMbps: { min: 5, max: 10, default: 8 },
    container: "mp4",
    audio: false,
  },
  image: { format: "png" },
  slots: 5,
} as const;

export type FitStrategy = "cover" | "contain" | "stretch";

export interface ConvertOptions {
  fit: FitStrategy;
  background: string;
  fps: number;
  bitrateMbps: number;
  cropX: number;
  cropY: number;
  /** Trim: start offset in seconds (video only). */
  startSec?: number;
  /** Trim: duration in seconds from start (video only). */
  durationSec?: number;
}

/**
 * Parse a time spec into seconds. Accepts:
 *   "12", "12.5"          → seconds
 *   "1:30", "1:30.5"      → m:s
 *   "1:02:03", "01:02:03" → h:m:s
 * Empty / undefined → undefined. Throws on garbage.
 */
export function parseTimeToSeconds(input: string | number | undefined | null): number | undefined {
  if (input === undefined || input === null || input === "") return undefined;
  if (typeof input === "number") return Number.isFinite(input) && input >= 0 ? input : undefined;
  const s = String(input).trim();
  if (!s) return undefined;
  const parts = s.split(":");
  if (parts.length > 3) throw new Error(`Invalid time "${input}"`);
  let secs = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid time "${input}"`);
    secs = secs * 60 + n;
  }
  return secs;
}

export const DEFAULT_OPTIONS: ConvertOptions = {
  fit: "cover",
  background: "#000000",
  fps: SPECS.video.frameRate.default,
  bitrateMbps: SPECS.video.bitrateMbps.default,
  cropX: 0.5,
  cropY: 0.5,
};

export function clampFps(fps: number): number {
  return Math.max(SPECS.video.frameRate.min, Math.min(SPECS.video.frameRate.max, Math.round(fps)));
}

export function clampBitrateMbps(mbps: number): number {
  return Math.max(SPECS.video.bitrateMbps.min, Math.min(SPECS.video.bitrateMbps.max, mbps));
}
