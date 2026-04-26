import { mkdir, writeFile, readFile, copyFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { SPECS, type ConvertOptions, DEFAULT_OPTIONS } from "./specs.js";
import { classifyByExtension, type MediaKind } from "./classify.js";
import { convertImage } from "./convert-image.js";
import { convertVideo } from "./convert-video.js";

export interface SlotManifest {
  index: number;
  label: string;
  kind: MediaKind | null;
  source: string | null;
  output: string | null;
  options: ConvertOptions | null;
  updatedAt: string | null;
}

export interface SkinSetManifest {
  version: 1;
  name: string;
  device: "centerpiece-pro";
  dimensions: { width: number; height: number };
  slots: SlotManifest[];
  createdAt: string;
  updatedAt: string;
}

const MANIFEST_NAME = "manifest.json";
const EXTENSION = ".cproskinset";

export function isSkinSetDir(path: string): boolean {
  return path.endsWith(EXTENSION);
}

export async function createSkinSet(dirPath: string, name = basename(dirPath, EXTENSION)): Promise<SkinSetManifest> {
  const dir = dirPath.endsWith(EXTENSION) ? dirPath : dirPath + EXTENSION;
  await mkdir(join(dir, "sources"), { recursive: true });
  await mkdir(join(dir, "skins"), { recursive: true });

  const now = new Date().toISOString();
  const manifest: SkinSetManifest = {
    version: 1,
    name,
    device: "centerpiece-pro",
    dimensions: { width: SPECS.width, height: SPECS.height },
    slots: Array.from({ length: SPECS.slots }, (_, i) => ({
      index: i,
      label: defaultSlotLabel(i),
      kind: null,
      source: null,
      output: null,
      options: null,
      updatedAt: null,
    })),
    createdAt: now,
    updatedAt: now,
  };
  await writeManifest(dir, manifest);
  return manifest;
}

export async function readManifest(dir: string): Promise<SkinSetManifest> {
  const p = join(dir, MANIFEST_NAME);
  if (!existsSync(p)) throw new Error(`No manifest at ${p} — is this a .cproskinset?`);
  const raw = await readFile(p, "utf8");
  return JSON.parse(raw) as SkinSetManifest;
}

export async function writeManifest(dir: string, manifest: SkinSetManifest): Promise<void> {
  manifest.updatedAt = new Date().toISOString();
  await writeFile(join(dir, MANIFEST_NAME), JSON.stringify(manifest, null, 2));
}

export interface AssignSlotArgs {
  setDir: string;
  slotIndex: number;
  sourcePath: string;
  label?: string;
  options?: Partial<ConvertOptions>;
  onVideoProgress?: (percent: number) => void;
}

export async function assignSlot(args: AssignSlotArgs): Promise<SlotManifest> {
  const { setDir, slotIndex, sourcePath } = args;
  const manifest = await readManifest(setDir);
  if (slotIndex < 0 || slotIndex >= manifest.slots.length) {
    throw new Error(`Slot ${slotIndex} out of range (0-${manifest.slots.length - 1})`);
  }
  const kind = classifyByExtension(sourcePath);
  if (!kind) throw new Error(`Unsupported file type: ${sourcePath}`);

  await stat(sourcePath); // throws if missing

  const sourceName = basename(sourcePath);
  const sourceDest = join(setDir, "sources", `slot-${slotIndex}${extname(sourcePath)}`);
  await copyFile(sourcePath, sourceDest);

  const outputExt = kind === "image" ? ".png" : ".mp4";
  const outputDest = join(setDir, "skins", `slot-${slotIndex}${outputExt}`);
  const options = { ...DEFAULT_OPTIONS, ...(args.options ?? {}) };

  if (kind === "image") {
    await convertImage(sourceDest, outputDest, options);
  } else {
    await convertVideo(sourceDest, outputDest, options, args.onVideoProgress
      ? (p) => args.onVideoProgress!(p.percent)
      : undefined);
  }

  const slot: SlotManifest = {
    index: slotIndex,
    label: args.label ?? manifest.slots[slotIndex].label ?? defaultSlotLabel(slotIndex),
    kind,
    source: `sources/${basename(sourceDest)}`,
    output: `skins/${basename(outputDest)}`,
    options,
    updatedAt: new Date().toISOString(),
  };
  manifest.slots[slotIndex] = slot;
  await writeManifest(setDir, manifest);
  return slot;
}

export async function clearSlot(setDir: string, slotIndex: number): Promise<void> {
  const manifest = await readManifest(setDir);
  manifest.slots[slotIndex] = {
    index: slotIndex,
    label: defaultSlotLabel(slotIndex),
    kind: null,
    source: null,
    output: null,
    options: null,
    updatedAt: null,
  };
  await writeManifest(setDir, manifest);
}

export async function renameSlot(setDir: string, slotIndex: number, label: string): Promise<void> {
  const manifest = await readManifest(setDir);
  manifest.slots[slotIndex].label = label;
  manifest.slots[slotIndex].updatedAt = new Date().toISOString();
  await writeManifest(setDir, manifest);
}

export function resolveSlotOutput(setDir: string, slot: SlotManifest): string | null {
  return slot.output ? resolve(setDir, slot.output) : null;
}

function defaultSlotLabel(i: number): string {
  const hotkey = ["Q", "W", "E", "R", "T"][i] ?? `${i + 1}`;
  return `Slot ${i + 1} (L1+${hotkey})`;
}
