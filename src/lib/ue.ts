import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, cp, readFile, rm } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { convertVideo } from "./convert-video.js";
import { DEFAULT_OPTIONS, type ConvertOptions } from "./specs.js";

export interface UeInitOptions {
  targetDir: string;
}

export interface UeExportOptions {
  projectDir: string;
  outPath: string;
  uePath?: string;
  convert?: Partial<ConvertOptions>;
  onLog?: (line: string) => void;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

export function templateDir(): string {
  // dist/lib/ue.js → ../../ue-skin-template (shipped as part of repo)
  const packaged = resolve(__dirname, "../../ue-skin-template");
  if (existsSync(packaged)) return packaged;
  // fallback when running via tsx from src/
  return resolve(__dirname, "../../ue-skin-template");
}

export async function initProject(opts: UeInitOptions): Promise<string> {
  const src = templateDir();
  if (!existsSync(src)) {
    throw new Error(`Template not found at ${src} — reinstall cpro-util.`);
  }
  const target = resolve(opts.targetDir);
  await mkdir(target, { recursive: true });
  await cp(src, target, { recursive: true, errorOnExist: false });
  return target;
}

export function resolveUnrealEditorCmd(uePath?: string): string {
  const env = process.env.UE_ROOT ?? process.env.UNREAL_ROOT;
  const candidates: string[] = [];
  if (uePath) candidates.push(uePath);
  if (env) candidates.push(env);

  const platformCandidates = buildPlatformCandidates();
  candidates.push(...platformCandidates);

  for (const c of candidates) {
    if (!c) continue;
    const expanded = existsSync(c) ? c : null;
    if (expanded) return expanded;
  }
  throw new Error(
    "Could not locate UnrealEditor-Cmd. Pass --ue-path <exe> or set UE_ROOT to your UE install " +
    "(e.g. /Users/Shared/Epic Games/UE_5.4/Engine/Binaries/Mac/UnrealEditor-Cmd).",
  );
}

function buildPlatformCandidates(): string[] {
  const out: string[] = [];
  const versions = ["5.4", "5.5", "5.3", "5.2"];
  if (process.platform === "darwin") {
    for (const v of versions) {
      out.push(`/Users/Shared/Epic Games/UE_${v}/Engine/Binaries/Mac/UnrealEditor-Cmd`);
    }
  } else if (process.platform === "win32") {
    for (const v of versions) {
      out.push(`C:\\Program Files\\Epic Games\\UE_${v}\\Engine\\Binaries\\Win64\\UnrealEditor-Cmd.exe`);
    }
  } else {
    for (const v of versions) {
      out.push(`/opt/UnrealEngine/UE_${v}/Engine/Binaries/Linux/UnrealEditor-Cmd`);
    }
  }
  return out;
}

export async function exportSkin(opts: UeExportOptions): Promise<string> {
  const projectDir = resolve(opts.projectDir);
  const uproject = findUProject(projectDir);
  if (!uproject) throw new Error(`No .uproject in ${projectDir}`);

  const ueCmd = resolveUnrealEditorCmd(opts.uePath);
  const pyScript = join(projectDir, "Python", "render_skin.py");
  if (!existsSync(pyScript)) {
    throw new Error(`render_skin.py not found at ${pyScript} — reinitialize with "cpro ue init".`);
  }

  const stagingDir = join(projectDir, "Saved", "SkinExport");
  const marker = join(stagingDir, ".cpro_out_path");
  await mkdir(stagingDir, { recursive: true });
  if (existsSync(marker)) await rm(marker);

  const stagingOut = join(stagingDir, "skin_source.mov");
  const args = [
    uproject,
    "-run=pythonscript",
    `-script=${pyScript}`,
    "-unattended",
    "-nosplash",
    "-nop4",
  ];

  await runCmd(ueCmd, args, {
    CPRO_OUT: stagingOut,
  }, opts.onLog);

  const sourcePath = existsSync(marker) ? (await readFile(marker, "utf8")).trim() : stagingOut;
  const resolvedSource = await waitForFile(sourcePath, 30_000);
  if (!resolvedSource) {
    throw new Error(`UE render did not produce ${sourcePath}. Check the editor log.`);
  }

  const convertOpts = { ...DEFAULT_OPTIONS, ...(opts.convert ?? {}) };
  await convertVideo(resolvedSource, opts.outPath, convertOpts);
  return opts.outPath;
}

function findUProject(dir: string): string | null {
  for (const f of readdirSync(dir)) {
    if (f.endsWith(".uproject")) return join(dir, f);
  }
  return null;
}

async function waitForFile(path: string, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return path;
    // Sequencer sometimes appends .0001 frame index etc. — accept any file with the basename stem.
    const stem = basename(path).replace(/\.[^./\\]+$/, "");
    const parent = dirname(path);
    if (existsSync(parent)) {
      const candidate = readdirSync(parent).find((f) => f.startsWith(stem));
      if (candidate) return join(parent, candidate);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

function runCmd(
  cmd: string,
  args: string[],
  extraEnv: Record<string, string>,
  onLog?: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...extraEnv },
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
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`UnrealEditor-Cmd exited ${code}`));
    });
  });
}
