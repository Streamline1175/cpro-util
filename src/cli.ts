#!/usr/bin/env node
import { Command } from "commander";
import { resolve, extname, basename } from "node:path";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { classifyByExtension, suggestOutputName } from "./lib/classify.js";
import { convertImage } from "./lib/convert-image.js";
import { convertVideo } from "./lib/convert-video.js";
import { previewFile } from "./lib/preview.js";
import { SPECS, DEFAULT_OPTIONS, clampFps, clampBitrateMbps, parseTimeToSeconds, type FitStrategy } from "./lib/specs.js";
import {
  createSkinSet,
  readManifest,
  assignSlot,
  clearSlot,
  renameSlot,
  resolveSlotOutput,
} from "./lib/bundle.js";
import { startServer } from "./server.js";
import { initProject as ueInitProject, exportSkin as ueExportSkin } from "./lib/ue.js";
import { isUrl, fetchVideoFromUrl } from "./lib/fetch-url.js";

const program = new Command();
program
  .name("cpro")
  .description("Convert and manage media for Finalmouse Centerpiece Pro skins (1920×550)")
  .version("0.1.0");

program
  .command("convert")
  .description("Convert an image, video, or URL into a Centerpiece Pro skin file")
  .argument("<input>", "source file or URL (YouTube, Vimeo, etc. — anything yt-dlp supports)")
  .option("-o, --out <file>", "output path")
  .option("--fit <strategy>", "cover | contain | stretch", DEFAULT_OPTIONS.fit)
  .option("--bg <color>", "background for contain fit", DEFAULT_OPTIONS.background)
  .option("--fps <n>", "target frame rate (30-60)", String(DEFAULT_OPTIONS.fps))
  .option("--bitrate <mbps>", "video bitrate in Mbps (5-10)", String(DEFAULT_OPTIONS.bitrateMbps))
  .option("--crop-x <0..1>", "horizontal crop anchor (0=left, 1=right)", String(DEFAULT_OPTIONS.cropX))
  .option("--crop-y <0..1>", "vertical crop anchor (0=top, 1=bottom)", String(DEFAULT_OPTIONS.cropY))
  .option("--start <time>", "trim start (seconds, or H:M:S / M:S)")
  .option("--duration <time>", "trim duration from start (seconds, or H:M:S / M:S)")
  .option("--preview", "open a browser preview after conversion")
  .action(async (input: string, opts) => {
    let startSec: number | undefined;
    let durationSec: number | undefined;
    try {
      startSec = parseTimeToSeconds(opts.start);
      durationSec = parseTimeToSeconds(opts.duration);
    } catch (e: any) {
      exitError(e.message);
    }

    let abs: string;
    let suggestedBase: string | null = null;
    let trimAlreadyApplied = false;
    if (isUrl(input)) {
      console.log(`→ Fetching ${input}${startSec || durationSec ? ` (trim ${startSec ?? 0}s${durationSec ? ` +${durationSec}s` : ""})` : ""}`);
      const fetched = await fetchVideoFromUrl(input, {
        startSec,
        durationSec,
        onProgress: (p) => renderProgress(p.percent),
      });
      process.stdout.write("\n");
      console.log(`✓ Downloaded ${fetched.title} (${formatBytes(fetched.bytes)})`);
      abs = fetched.filePath;
      suggestedBase = fetched.title;
      trimAlreadyApplied = true;
    } else {
      abs = resolve(input);
      if (!existsSync(abs)) exitError(`Input not found: ${abs}`);
    }

    const kind = classifyByExtension(abs);
    if (!kind) exitError(`Unsupported file type: ${extname(abs)}`);

    const fit = validateFit(opts.fit);
    const options = {
      fit,
      background: String(opts.bg),
      fps: clampFps(Number(opts.fps)),
      bitrateMbps: clampBitrateMbps(Number(opts.bitrate)),
      cropX: clamp01(Number(opts.cropX)),
      cropY: clamp01(Number(opts.cropY)),
      startSec: trimAlreadyApplied ? undefined : startSec,
      durationSec: trimAlreadyApplied ? undefined : durationSec,
    };
    const defaultOut = suggestedBase
      ? resolve(`${suggestedBase}.skin${kind === "image" ? ".png" : ".mp4"}`)
      : suggestOutputName(abs, kind);
    const outPath = resolve(opts.out ?? defaultOut);

    console.log(`→ ${kind === "image" ? "Image" : "Video"} · fit=${options.fit} · out=${outPath}`);

    if (kind === "image") {
      const r = await convertImage(abs, outPath, options);
      console.log(`✓ PNG ${r.width}×${r.height} · ${formatBytes(r.bytes)}`);
    } else {
      const r = await convertVideo(abs, outPath, options, (p) => renderProgress(p.percent));
      process.stdout.write("\n");
      console.log(
        `✓ MP4 ${r.width}×${r.height} · ${r.fps}fps · ${r.bitrateMbps}Mbps · ` +
          `${r.durationSec.toFixed(1)}s · ${formatBytes(r.bytes)}`,
      );
    }

    if (opts.preview) {
      console.log("Opening preview…");
      await previewFile(outPath);
    }
  });

program
  .command("preview")
  .description("Open a browser preview of a skin file at 1920×550 aspect")
  .argument("<file>", "path to a .mp4 or .png skin")
  .option("-p, --port <n>", "port", "7778")
  .action(async (file: string, opts) => {
    const abs = resolve(file);
    if (!existsSync(abs)) exitError(`File not found: ${abs}`);
    await previewFile(abs, { port: Number(opts.port), openBrowser: true });
    console.log(`Preview at http://127.0.0.1:${opts.port} · Ctrl+C to stop`);
  });

program
  .command("serve")
  .description("Launch the drag-and-drop web UI")
  .option("-p, --port <n>", "port", "7777")
  .option("--no-open", "do not auto-open the browser")
  .action(async (opts) => {
    const port = Number(opts.port);
    await startServer({ port, openBrowser: opts.open !== false });
    console.log(`cpro web UI at http://127.0.0.1:${port} · Ctrl+C to stop`);
  });

const set = program.command("set").description("Manage local skin-sets (5-slot loadouts)");

set
  .command("init")
  .description("Create a new .cproskinset project")
  .argument("<dir>", "path (a .cproskinset folder)")
  .option("--name <name>", "friendly name")
  .action(async (dir: string, opts) => {
    const target = dir.endsWith(".cproskinset") ? dir : dir + ".cproskinset";
    await mkdir(target, { recursive: true });
    const m = await createSkinSet(target, opts.name);
    console.log(`✓ Created ${target}`);
    console.log(`  ${m.slots.length} empty slots · ${m.dimensions.width}×${m.dimensions.height}`);
  });

set
  .command("show")
  .description("Show slots in a skin-set")
  .argument("<dir>", "path to a .cproskinset")
  .action(async (dir: string) => {
    const m = await readManifest(dir);
    console.log(`${m.name} · ${m.dimensions.width}×${m.dimensions.height} · updated ${m.updatedAt}`);
    for (const s of m.slots) {
      const status = s.output ? `${s.kind} · ${s.output}` : "empty";
      console.log(`  [${s.index}] ${s.label} — ${status}`);
    }
  });

set
  .command("assign")
  .description("Convert a source file and assign it to a slot")
  .argument("<dir>", "path to a .cproskinset")
  .argument("<slot>", "slot index (0-4)")
  .argument("<source>", "path to source media")
  .option("--label <label>", "slot label")
  .option("--fit <strategy>", "cover | contain | stretch", DEFAULT_OPTIONS.fit)
  .option("--bg <color>", "background", DEFAULT_OPTIONS.background)
  .option("--fps <n>", "frame rate", String(DEFAULT_OPTIONS.fps))
  .option("--bitrate <mbps>", "bitrate Mbps", String(DEFAULT_OPTIONS.bitrateMbps))
  .action(async (dir: string, slotArg: string, source: string, opts) => {
    const slotIndex = Number(slotArg);
    const abs = resolve(source);
    if (!existsSync(abs)) exitError(`Source not found: ${abs}`);

    const fit = validateFit(opts.fit);
    await assignSlot({
      setDir: dir,
      slotIndex,
      sourcePath: abs,
      label: opts.label,
      options: {
        fit,
        background: opts.bg,
        fps: clampFps(Number(opts.fps)),
        bitrateMbps: clampBitrateMbps(Number(opts.bitrate)),
      },
      onVideoProgress: renderProgress,
    });
    process.stdout.write("\n");
    console.log(`✓ Slot ${slotIndex} assigned`);
  });

set
  .command("clear")
  .description("Empty a slot")
  .argument("<dir>", "path to a .cproskinset")
  .argument("<slot>", "slot index (0-4)")
  .action(async (dir: string, slotArg: string) => {
    await clearSlot(dir, Number(slotArg));
    console.log(`✓ Slot ${slotArg} cleared`);
  });

set
  .command("rename")
  .description("Rename a slot label")
  .argument("<dir>", "path to a .cproskinset")
  .argument("<slot>", "slot index (0-4)")
  .argument("<label>", "new label")
  .action(async (dir: string, slotArg: string, label: string) => {
    await renameSlot(dir, Number(slotArg), label);
    console.log(`✓ Slot ${slotArg} renamed to "${label}"`);
  });

set
  .command("preview")
  .description("Preview the skin currently assigned to a slot")
  .argument("<dir>", "path to a .cproskinset")
  .argument("<slot>", "slot index (0-4)")
  .option("-p, --port <n>", "port", "7778")
  .action(async (dir: string, slotArg: string, opts) => {
    const m = await readManifest(dir);
    const slot = m.slots[Number(slotArg)];
    const out = resolveSlotOutput(dir, slot);
    if (!out) exitError(`Slot ${slotArg} is empty`);
    await previewFile(out!, { port: Number(opts.port), openBrowser: true });
  });

const ue = program.command("ue").description("Unreal Engine skin authoring (staging kit — full interactivity requires Finalmouse SDK)");

ue
  .command("init")
  .description("Copy the UE 5.x skin project template into a target directory")
  .argument("<dir>", "target directory")
  .action(async (dir: string) => {
    const target = await ueInitProject({ targetDir: dir });
    console.log(`✓ Template copied to ${target}`);
    console.log(`  Next:`);
    console.log(`    1. Open ${resolve(target)}/CpSkinTemplate.uproject in UE 5.4+`);
    console.log(`    2. Run Python/setup_skin_project.py from the editor to scaffold /Game/Skin`);
    console.log(`    3. Author visuals in BP_SkinActor + LS_Skin sequence`);
    console.log(`    4. Render with "cpro ue export ${target} -o my-skin.mp4"`);
  });

ue
  .command("export")
  .description("Render the UE project's level sequence to a compliant Centerpiece Pro skin .mp4")
  .argument("<project>", "path to a UE project directory")
  .option("-o, --out <file>", "output .mp4 path", "skin.mp4")
  .option("--ue-path <path>", "override UnrealEditor-Cmd path (or set UE_ROOT)")
  .option("--fit <strategy>", "cover | contain | stretch", DEFAULT_OPTIONS.fit)
  .option("--bg <color>", "background for contain", DEFAULT_OPTIONS.background)
  .option("--fps <n>", "frame rate", String(DEFAULT_OPTIONS.fps))
  .option("--bitrate <mbps>", "bitrate", String(DEFAULT_OPTIONS.bitrateMbps))
  .action(async (projectDir: string, opts) => {
    if (!existsSync(projectDir)) exitError(`Project not found: ${projectDir}`);
    const outPath = resolve(opts.out);
    console.log(`→ Rendering UE project ${projectDir}`);
    await ueExportSkin({
      projectDir,
      outPath,
      uePath: opts.uePath,
      convert: {
        fit: validateFit(opts.fit),
        background: opts.bg,
        fps: clampFps(Number(opts.fps)),
        bitrateMbps: clampBitrateMbps(Number(opts.bitrate)),
      },
      onLog: (line) => {
        if (/error|warning|LogPython|Render/.test(line)) console.log(`  ${line}`);
      },
    });
    console.log(`✓ Skin written to ${outPath}`);
  });

program
  .command("specs")
  .description("Print the Centerpiece Pro skin specs")
  .action(() => {
    console.log(JSON.stringify(SPECS, null, 2));
  });

program.parseAsync().catch((e) => {
  console.error("Error:", e.message || e);
  process.exit(1);
});

function exitError(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function validateFit(v: string): FitStrategy {
  if (v === "cover" || v === "contain" || v === "stretch") return v;
  exitError(`Invalid --fit "${v}". Use cover | contain | stretch.`);
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.max(0, Math.min(1, v));
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

let lastProgress = -1;
function renderProgress(percent: number): void {
  if (!Number.isFinite(percent)) return;
  const p = Math.max(0, Math.min(100, Math.floor(percent)));
  if (p === lastProgress) return;
  lastProgress = p;
  const width = 30;
  const filled = Math.max(0, Math.min(width, Math.round((p / 100) * width)));
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  process.stdout.write(`\r  ${bar} ${p.toString().padStart(3)}%`);
}
