/**
 * ue-pak.ts
 *
 * Interactive skin workflow for the Finalmouse Centerpiece keyboard.
 *
 * Wraps the UE 4.27.2 + Android SDK cook pipeline (RunUAT → .pak) and the
 * pak-upload step that pushes the skin to a keyboard slot, bypassing the
 * Finalmouse website's community-upload restriction.
 *
 * Workflow summary (derived from the community tutorial):
 *   1. cpro ue pak init <dir>          – scaffold UE 4.27.2 project template
 *   2. (open in VS 2019, build dummy plugin, open .uproject, author skin)
 *   3. cpro ue pak cook <project>      – RunUAT cook → .pak
 *   4. cpro ue pak upload <pak> -s <n> – push to keyboard slot n
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, cp, readFile, writeFile, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lookup as dnsLookup } from "node:dns/promises";
import { createReadStream } from "node:fs";
import * as http from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Template resolution
// ---------------------------------------------------------------------------

export function interactiveTemplateDir(): string {
  // dist/lib/ue-pak.js → ../../ue-interactive-template
  return resolve(__dirname, "../../ue-interactive-template");
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

export interface PakInitOptions {
  targetDir: string;
}

/**
 * Copy the UE 4.27.2 interactive skin template into `targetDir`.
 * The caller still needs to:
 *   1. Obtain and build UE 4.27.2 from source (+ Android SDK)
 *   2. Open the .uproject, switch engine to the source build
 *   3. Build CpInteractiveSkin in VS 2019 (compiles the dummy plugin)
 *   4. Author their skin in the UE editor
 */
export async function initInteractiveProject(opts: PakInitOptions): Promise<string> {
  const src = interactiveTemplateDir();
  if (!existsSync(src)) {
    throw new Error(
      `Interactive template not found at ${src}. ` +
        "Reinstall cpro-util or clone the full repository.",
    );
  }
  const target = resolve(opts.targetDir);
  await mkdir(target, { recursive: true });
  await cp(src, target, { recursive: true, errorOnExist: false });
  return target;
}

// ---------------------------------------------------------------------------
// cook (RunUAT → .pak)
// ---------------------------------------------------------------------------

export interface PakCookOptions {
  /** Path to the UE 4.27.2 project directory (contains .uproject). */
  projectDir: string;
  /**
   * Root of the UE 4.27.2 source build.
   * Falls back to `UE427_ROOT` / `UE_ROOT` env vars, then common install paths.
   */
  ue427Path?: string;
  /**
   * Where to place the final .pak.  Defaults to <projectDir>/dist/skin.pak.
   */
  outPath?: string;
  onLog?: (line: string) => void;
}

export interface PakCookResult {
  pakPath: string;
  bytes: number;
}

export async function cookPak(opts: PakCookOptions): Promise<PakCookResult> {
  const projectDir = resolve(opts.projectDir);
  const uproject = findUProject(projectDir);
  if (!uproject) throw new Error(`No .uproject found in ${projectDir}`);

  const ueRoot = resolveUe427Root(opts.ue427Path);
  const runUat = resolveRunUat(ueRoot);

  // Output directory for staged build
  const stageDir = join(projectDir, "Saved", "StagedBuilds");

  const args = [
    "BuildCookRun",
    `-project=${uproject}`,
    "-platform=Android_ASTC",
    "-clientconfig=Development",
    "-cook",
    "-pak",
    "-stage",
    `-stagingdirectory=${stageDir}`,
    "-unattended",
    "-nop4",
    "-NoXGE",
    "-utf8output",
    // Skip full compile — user already built the plugin in VS
    "-nocompileeditor",
    "-skipbuildeditor",
  ];

  opts.onLog?.(`→ RunUAT: ${runUat} ${args.slice(0, 3).join(" ")} …`);
  await runCmd(runUat, args, {}, opts.onLog);

  // Locate the generated .pak
  const projectName = basename(uproject, ".uproject");
  const pakGlob = join(stageDir, "Android_ASTC", projectName, "Content", "Paks");
  const pak = findPakFile(pakGlob) ?? findPakFile(join(stageDir, "Android_ASTC", "Content", "Paks"));
  if (!pak) {
    throw new Error(
      `Cook completed but no .pak found under ${pakGlob}. ` +
        "Try running File → Package Project → Android (ASTC) once from the editor first.",
    );
  }

  const outPath = resolve(opts.outPath ?? join(projectDir, "dist", "skin.pak"));
  await mkdir(dirname(outPath), { recursive: true });

  // Copy to output
  const { size } = await stat(pak);
  await cp(pak, outPath);

  return { pakPath: outPath, bytes: size };
}

function findPakFile(dir: string): string | null {
  if (!existsSync(dir)) return null;
  for (const f of readdirSync(dir)) {
    if (f.endsWith(".pak")) return join(dir, f);
  }
  return null;
}

// ---------------------------------------------------------------------------
// upload
// ---------------------------------------------------------------------------

export interface PakUploadOptions {
  pakPath: string;
  /** Slot index (0-based; keyboard displays 1-based). Default 0. */
  slot: number;
  /**
   * Keyboard IP or hostname.  If omitted the upload tries to resolve
   * `centerpiece.local` via mDNS (works on macOS/Linux with Bonjour/Avahi;
   * set this explicitly on Windows or when auto-detect fails).
   */
  host?: string;
  /** HTTP port the keyboard listens on.  Default 8080. */
  port?: number;
  onProgress?: (percent: number) => void;
}

const DEFAULT_PORT = 8080;
const UPLOAD_TIMEOUT_MS = 60_000;

/**
 * Upload a cooked .pak file to a Centerpiece keyboard slot.
 *
 * The keyboard exposes a simple HTTP endpoint on the local network.
 * This replicates what `upload_ue.js` does: POST the pak with its size
 * and target slot so the Centerpiece app can hot-swap it without a reboot.
 *
 * Protocol (community reverse-engineered):
 *   POST http://<keyboard-ip>:<port>/api/skins/interactive
 *   Headers:
 *     Content-Type: application/octet-stream
 *     X-Skin-Slot: <slot>          (0-based)
 *     X-File-Size: <bytes>
 *   Body: raw .pak bytes
 *
 * If the keyboard firmware is updated by Finalmouse and the endpoint
 * changes, pass --host + --port explicitly and open a cpro-util issue.
 */
export async function uploadPak(opts: PakUploadOptions): Promise<void> {
  const pakPath = resolve(opts.pakPath);
  if (!existsSync(pakPath)) throw new Error(`PAK not found: ${pakPath}`);

  const { size } = await stat(pakPath);
  const slot = Math.max(0, Math.min(4, opts.slot));
  const port = opts.port ?? DEFAULT_PORT;

  // Keyboard discovery
  let host = opts.host;
  if (!host) {
    host = await discoverKeyboard();
  }

  opts.onProgress?.(0);

  await new Promise<void>((resolveP, reject) => {
    const req = http.request(
      {
        hostname: host,
        port,
        path: "/api/skins/interactive",
        method: "POST",
        timeout: UPLOAD_TIMEOUT_MS,
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": size,
          "X-Skin-Slot": String(slot),
          "X-File-Size": String(size),
          "X-Skin-Kind": "ue-pak",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            opts.onProgress?.(100);
            resolveP();
          } else {
            reject(
              new Error(
                `Keyboard returned HTTP ${res.statusCode}: ${body.slice(0, 200)}`,
              ),
            );
          }
        });
      },
    );

    req.on("error", (e) => reject(new Error(`Upload failed: ${e.message}`)));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Upload timed out after ${UPLOAD_TIMEOUT_MS / 1000}s`));
    });

    let sent = 0;
    const stream = createReadStream(pakPath);
    stream.on("data", (chunk) => {
      sent += (chunk as Buffer).length;
      opts.onProgress?.(Math.min(99, Math.round((sent / size) * 100)));
    });
    stream.pipe(req);
    stream.on("error", (e) => reject(new Error(`Read error: ${e.message}`)));
  });
}

// ---------------------------------------------------------------------------
// Keyboard discovery
// ---------------------------------------------------------------------------

const MDNS_CANDIDATES = [
  "centerpiece.local",
  "finalmouse-centerpiece.local",
  "finalmouse.local",
];

async function discoverKeyboard(): Promise<string> {
  for (const hostname of MDNS_CANDIDATES) {
    try {
      const { address } = await dnsLookup(hostname, { family: 4 });
      return address;
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    "Could not auto-discover the keyboard on the local network.\n" +
      "Make sure the keyboard is connected to the same WiFi network, then either:\n" +
      "  a) Pass --host <keyboard-ip>  (find the IP in your router's device list)\n" +
      "  b) Ensure Bonjour/Avahi/mDNS is running on this machine",
  );
}

// ---------------------------------------------------------------------------
// UE 4.27.2 resolution
// ---------------------------------------------------------------------------

export function resolveUe427Root(hint?: string): string {
  const candidates: string[] = [];
  if (hint) candidates.push(hint);

  const envRoot = process.env.UE427_ROOT ?? process.env.UE_ROOT;
  if (envRoot) candidates.push(envRoot);

  // Common install paths for source builds
  if (process.platform === "win32") {
    candidates.push(
      "C:\\UnrealEngine",
      "C:\\UE_4.27",
      "C:\\Program Files\\Epic Games\\UE_4.27",
      "D:\\UnrealEngine",
    );
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Users/Shared/UnrealEngine",
      "/Users/Shared/Epic Games/UE_4.27",
      `${process.env.HOME}/UnrealEngine`,
    );
  } else {
    candidates.push(
      "/opt/UnrealEngine",
      `${process.env.HOME}/UnrealEngine`,
    );
  }

  for (const c of candidates) {
    if (c && existsSync(join(c, "Engine"))) return c;
  }

  throw new Error(
    "Could not locate UE 4.27.2 source build.\n" +
      "Pass --ue-path <root> or set UE427_ROOT to the engine root directory\n" +
      "(the folder that contains Engine/, e.g. ~/UnrealEngine).",
  );
}

function resolveRunUat(ueRoot: string): string {
  if (process.platform === "win32") {
    const p = join(ueRoot, "Engine", "Build", "BatchFiles", "RunUAT.bat");
    if (!existsSync(p)) throw new Error(`RunUAT.bat not found at ${p}`);
    return p;
  }
  const p = join(ueRoot, "Engine", "Build", "BatchFiles", "RunUAT.sh");
  if (!existsSync(p)) throw new Error(`RunUAT.sh not found at ${p}`);
  return p;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findUProject(dir: string): string | null {
  for (const f of readdirSync(dir)) {
    if (f.endsWith(".uproject")) return join(dir, f);
  }
  return null;
}

function runCmd(
  cmd: string,
  args: string[],
  extraEnv: Record<string, string>,
  onLog?: (line: string) => void,
): Promise<void> {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...extraEnv },
      // RunUAT.bat requires a shell on Windows
      shell: process.platform === "win32",
    });

    const logLine = (chunk: Buffer) => {
      const text = chunk.toString();
      if (onLog) {
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) onLog(line);
        }
      }
    };

    p.stdout.on("data", logLine);
    p.stderr.on("data", logLine);
    p.on("error", rej);
    p.on("close", (code) => {
      if (code === 0) res();
      else rej(new Error(`RunUAT exited with code ${code}`));
    });
  });
}
