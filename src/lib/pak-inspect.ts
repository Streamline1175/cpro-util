/**
 * pak-inspect.ts
 *
 * Extracts the asset manifest from a cooked UE .pak file by scanning for
 * printable-ASCII strings that match Unreal asset path conventions.
 * Works without unrealpak because the asset name table is stored as plain
 * UTF-8 in all UE pak versions up to UE5.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const execFileAsync = promisify(execFile);

export interface PakAssetCategory {
  game: string[];
  engine: string[];
  script: string[];
}

export interface PakInspectResult {
  filePath: string;
  /** Raw file size in bytes. */
  fileSize: number;
  /** /Game/ prefixed asset paths found in the pak. */
  gameAssets: string[];
  /** /Engine/ prefixed asset paths. */
  engineAssets: string[];
  /**
   * Top-level skin folder, e.g. "/Game/SG_MySkin".
   * Derived from the first /Game/<folder> that is not "map" / "EntryPoint".
   */
  skinFolder: string | null;
  /**
   * Android texture pixel format detected in the file (e.g. "PF_ASTC_6x6").
   * Null when the pak was not cooked for Android.
   */
  textureFormat: string | null;
  /**
   * Non-engine plugin modules referenced via /Script/<Name>.
   */
  plugins: string[];
}

const CORE_SCRIPTS = new Set(["CoreUObject", "Engine", "Core"]);

export async function inspectPak(pakPath: string): Promise<PakInspectResult> {
  const abs = resolve(pakPath);
  const { size } = await stat(abs);

  const rawStrings = await extractStrings(abs);
  const lines = rawStrings.split("\n");

  const seenGame = new Set<string>();
  const seenEngine = new Set<string>();
  const gameAssets: string[] = [];
  const engineAssets: string[] = [];
  const plugins = new Set<string>();

  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith("/")) continue;

    if (/^\/Game\/[\w/.\\-]+$/.test(t) && !seenGame.has(t)) {
      seenGame.add(t);
      gameAssets.push(t);
    } else if (/^\/Engine\/[\w/.\\-]+$/.test(t) && !seenEngine.has(t)) {
      seenEngine.add(t);
      engineAssets.push(t);
    } else if (/^\/Script\/\w+$/.test(t)) {
      const name = t.slice("/Script/".length);
      if (!CORE_SCRIPTS.has(name)) plugins.add(name);
    }
  }

  const fmtMatch = rawStrings.match(/PF_\w+/);
  const textureFormat = fmtMatch ? fmtMatch[0] : null;

  let skinFolder: string | null = null;
  for (const p of gameAssets) {
    const m = p.match(/^\/Game\/([^/]+)/);
    if (m && m[1] !== "map" && m[1] !== "EntryPoint") {
      skinFolder = `/Game/${m[1]}`;
      break;
    }
  }

  return {
    filePath: abs,
    fileSize: size,
    gameAssets,
    engineAssets,
    skinFolder,
    textureFormat,
    plugins: [...plugins].sort(),
  };
}

async function extractStrings(filePath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("strings", [filePath]);
    return stdout;
  } catch {
    // strings(1) not available — scan the buffer manually
    const buf = await readFile(filePath);
    return scanBuffer(buf);
  }
}

function scanBuffer(buf: Buffer): string {
  const MIN = 4;
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c >= 0x20 && c <= 0x7e) {
      cur += String.fromCharCode(c);
    } else {
      if (cur.length >= MIN) out.push(cur);
      cur = "";
    }
  }
  if (cur.length >= MIN) out.push(cur);
  return out.join("\n");
}
