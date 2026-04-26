import { extname } from "node:path";

export type MediaKind = "image" | "video";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".tif", ".tiff", ".bmp", ".heic", ".heif"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".gif", ".apng"]);

export function classifyByExtension(filePath: string): MediaKind | null {
  const ext = extname(filePath).toLowerCase();
  if (IMAGE_EXT.has(ext)) return "image";
  if (VIDEO_EXT.has(ext)) return "video";
  return null;
}

export function suggestOutputName(inputPath: string, kind: MediaKind): string {
  const base = inputPath.replace(/\.[^./\\]+$/, "");
  return kind === "image" ? `${base}.skin.png` : `${base}.skin.mp4`;
}
