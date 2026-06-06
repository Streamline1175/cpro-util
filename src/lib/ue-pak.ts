/**
 * ue-pak.ts
 *
 * Interactive skin workflow for the Finalmouse Centerpiece keyboard.
 *
 * Wraps the UE 5.7 + Android SDK cook pipeline (RunUAT → .pak) and the
 * pak-upload step that pushes the skin to a keyboard slot, bypassing the
 * Finalmouse website's community-upload restriction.
 *
 * Workflow summary (derived from the community tutorial):
 *   1. cpro ue pak init <dir>          – scaffold UE 5.7 project template
 *   2. (open in VS 2019, build dummy plugin, open .uproject, author skin)
 *   3. cpro ue pak cook <project>      – RunUAT cook → .pak
 *   4. cpro ue pak upload <pak> -s <n> – push to keyboard slot n
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, cp, readFile, writeFile, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
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
 * Copy the UE 5.7 interactive skin template into `targetDir`.
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
  /** Path to the UE project directory (contains .uproject). */
  projectDir: string;
  /**
   * Root of the UE install or source build.
   * Falls back to `UE_ROOT` / `UE5_ROOT` / `UE427_ROOT` env vars, then common install paths.
   */
  uePath?: string;
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

  const ueRoot = resolveUeRoot(opts.uePath);
  const projectName = basename(uproject, ".uproject");

  // Step 1: Cook content for Android by calling the cook commandlet directly.
  // We bypass RunUAT entirely because UAT always tries to compile Android
  // client binaries (requires NDK) even when only cooking is needed.
  const unrealEditorCmd = resolveUnrealEditorCmd(ueRoot);
  const cookLogPath = join(projectDir, "Saved", "Logs", "Cook-Android.txt");
  const cookArgs = [
    uproject,
    "-run=Cook",
    "-TargetPlatform=Android",
    "-unversioned",
    `-abslog=${cookLogPath}`,
    "-stdout",
    "-unattended",
    "-NoLogTimes",
  ];

  opts.onLog?.(`→ Cook: ${unrealEditorCmd} -run=Cook -TargetPlatform=Android …`);
  await mkdir(join(projectDir, "Saved", "Logs"), { recursive: true });
  await runCmd(unrealEditorCmd, cookArgs, {}, opts.onLog);

  // Step 2: Pack the cooked content with UnrealPak directly.
  const cookedDir = join(projectDir, "Saved", "Cooked", "Android", projectName);
  if (!existsSync(cookedDir)) {
    throw new Error(
      `Cook completed but cooked directory not found: ${cookedDir}\n` +
        "Make sure the project opened and saved all maps in the UE editor first.",
    );
  }

  const outPath = resolve(opts.outPath ?? join(projectDir, "dist", "skin.pak"));
  await mkdir(dirname(outPath), { recursive: true });

  opts.onLog?.(`→ Packing ${cookedDir} with UnrealPak …`);
  await runUnrealPak(ueRoot, cookedDir, projectName, outPath, opts.onLog);

  const { size } = await stat(outPath);
  return { pakPath: outPath, bytes: size };
}

function resolveUnrealEditorCmd(ueRoot: string): string {
  const p =
    process.platform === "win32"
      ? join(ueRoot, "Engine", "Binaries", "Win64", "UnrealEditor-Cmd.exe")
      : join(ueRoot, "Engine", "Binaries", "Mac", "UnrealEditor-Cmd");
  if (!existsSync(p)) throw new Error(`UnrealEditor-Cmd not found at ${p}`);
  return p;
}

function resolveUnrealPak(ueRoot: string): string {
  const p =
    process.platform === "win32"
      ? join(ueRoot, "Engine", "Binaries", "Win64", "UnrealPak.exe")
      : join(ueRoot, "Engine", "Binaries", "Mac", "UnrealPak");
  if (!existsSync(p)) throw new Error(`UnrealPak not found at ${p}`);
  return p;
}

function collectFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...collectFiles(full));
    else results.push(full);
  }
  return results;
}

async function runUnrealPak(
  ueRoot: string,
  cookedDir: string,
  projectName: string,
  outPath: string,
  onLog?: (line: string) => void,
): Promise<void> {
  const unrealPak = resolveUnrealPak(ueRoot);
  const files = collectFiles(cookedDir);
  if (files.length === 0) throw new Error(`No cooked files found in ${cookedDir}`);

  // UnrealPak response file: "<source>" "<virtual_mount_path>"
  const lines = files.map((f) => {
    const rel = relative(cookedDir, f).replace(/\\/g, "/");
    return `"${f}" "../../../${projectName}/${rel}"`;
  });
  const responseFile = join(dirname(outPath), "pak_response.txt");
  await writeFile(responseFile, lines.join("\n") + "\n");

  onLog?.(`  Including ${files.length} cooked files → ${outPath}`);
  await runCmd(unrealPak, [outPath, `-Create=${responseFile}`, "-compress"], {}, onLog);
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

export async function discoverKeyboard(): Promise<string> {
  const result = await discoverKeyboardHost();
  if (result.host) return result.host;
  throw new Error(
    "Could not auto-discover the keyboard on the local network.\n" +
      "Make sure the keyboard is connected to the same WiFi network, then either:\n" +
      "  a) Pass --host <keyboard-ip>  (find the IP in your router's device list)\n" +
      "  b) Ensure Bonjour/Avahi/mDNS is running on this machine",
  );
}

export interface KeyboardDiscoveryResult {
  found: boolean;
  host: string | null;
  hostname: string | null;
  candidates: string[];
}

export async function discoverKeyboardHost(): Promise<KeyboardDiscoveryResult> {
  for (const hostname of MDNS_CANDIDATES) {
    try {
      const { address } = await dnsLookup(hostname, { family: 4 });
      return { found: true, host: address, hostname, candidates: MDNS_CANDIDATES };
    } catch {
      // try next candidate
    }
  }
  return { found: false, host: null, hostname: null, candidates: MDNS_CANDIDATES };
}

// ---------------------------------------------------------------------------
// UE root resolution (supports UE 4.27.2 and UE 5.x)
// ---------------------------------------------------------------------------

export function resolveUeRoot(hint?: string): string {
  const candidates: string[] = [];
  if (hint) candidates.push(hint);

  const envRoot =
    process.env.UE_ROOT ??
    process.env.UE5_ROOT ??
    process.env.UE427_ROOT;
  if (envRoot) candidates.push(envRoot);

  // Common install paths — launcher installs first, then source build defaults
  if (process.platform === "win32") {
    candidates.push(
      "C:\\Program Files\\Epic Games\\UE_5.5",
      "C:\\Program Files\\Epic Games\\UE_5.4",
      "C:\\Program Files\\Epic Games\\UE_5.3",
      "C:\\Program Files\\Epic Games\\UE_4.27",
      "C:\\UnrealEngine",
      "C:\\UE_5.5",
      "C:\\UE_4.27",
      "D:\\UnrealEngine",
    );
  } else if (process.platform === "darwin") {
    candidates.push(
      // UE 5.3 is the newest version that produces pak v11 (required by keyboard firmware).
      // Newer versions (5.4+) produce pak v12 which the keyboard cannot load.
      "/Users/Shared/Epic Games/UE_5.3",
      "/Users/Shared/Epic Games/UE_5.2",
      "/Users/Shared/Epic Games/UE_5.1",
      "/Users/Shared/Epic Games/UE_5.7",
      "/Users/Shared/Epic Games/UE_5.5",
      "/Users/Shared/Epic Games/UE_5.4",
      "/Users/Shared/Epic Games/UE_4.27",
      "/Users/Shared/UnrealEngine",
      `${process.env.HOME}/UnrealEngine`,
      `${process.env.HOME}/UE_5.3`,
      `${process.env.HOME}/UE_5.7`,
    );
  } else {
    candidates.push(
      "/opt/UnrealEngine",
      `${process.env.HOME}/UnrealEngine`,
      `${process.env.HOME}/UE_5.5`,
    );
  }

  for (const c of candidates) {
    if (c && existsSync(join(c, "Engine"))) return c;
  }

  throw new Error(
    "Could not locate an Unreal Engine installation.\n" +
      "Pass --ue-path <root> or set UE_ROOT to the engine root directory\n" +
      "(the folder that contains Engine/, e.g. /Users/Shared/Epic Games/UE_5.5).\n" +
      "For UE5 on macOS, install via the Epic Games Launcher.",
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
