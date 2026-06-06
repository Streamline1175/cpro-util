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
import {
  initInteractiveProject as uePakInit,
  cookPak,
  uploadPak,
  resolveUeRoot,
} from "./lib/ue-pak.js";
import { inspectPak } from "./lib/pak-inspect.js";
import { generateSkin } from "./lib/ai-generate.js";
import { isUrl, fetchVideoFromUrl } from "./lib/fetch-url.js";
import {
  isConnected,
  selectSlot,
  pullSlotPreview,
  pullAllPreviews,
  verifySlotUpload,
  enableAdbMode,
  CENTERPIECE_VID,
  CENTERPIECE_PID,
} from "./lib/hid-device.js";
import {
  probeRootShell,
  getDeviceInfo,
  listInstalledSkins,
  streamLogcat,
  pushPakViaShell,
  authorizeAdbKey,
  ROOTSHELLD_PORT,
  ANDROID_SKIN_PATHS,
  SOM_MODEL,
  SOC_CHIP,
  ANDROID_VERSION,
  UART_BAUD_RATE,
  UART_BRIDGE_RESISTORS,
  MCU_RECOVERY_INSTRUCTIONS,
} from "./lib/android-device.js";
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

// ---------------------------------------------------------------------------
// ue pak — interactive skin workflow (UE 5.x + Android SDK → .pak upload)
// ---------------------------------------------------------------------------
const uePak = ue
  .command("pak")
  .description(
    "Interactive skin workflow: UE 5.x + Android SDK → .pak → keyboard upload",
  );

uePak
  .command("init")
  .description(
    "Scaffold a UE 5.x interactive skin project (dummy CpSkinAPI plugin + Python setup)",
  )
  .argument("<dir>", "target directory for the new project")
  .action(async (dir: string) => {
    const target = await uePakInit({ targetDir: dir });
    const abs = resolve(target);
    console.log(`✓ Interactive skin project created at ${abs}`);
    console.log();
    console.log("  Next steps:");
    console.log("  1. Install Android Studio SDK components (see ue-interactive-template/README.md)");
    console.log("  2. Install UE 5.x via the Epic Games Launcher (set UE_ROOT env var if needed)");
    console.log(`  3. Right-click ${abs}/CpInteractiveSkin.uproject`);
    console.log("     → Switch Unreal Engine Version → select your UE 5.x install");
    console.log("  4. Open .uproject → allow it to rebuild the CpSkinAPI plugin");
    console.log("  5. Open .uproject → run Python/setup_interactive.py from the editor console");
    console.log("  6. Author your skin → then: cpro ue pak cook " + abs);
  });

uePak
  .command("cook")
  .description(
    "Cook a UE 5.x interactive skin project to a .pak file via RunUAT (Android ASTC)",
  )
  .argument("<project>", "path to a UE 5.x interactive skin project directory")
  .option("-o, --out <file>", "output .pak path (default: <project>/dist/skin.pak)")
  .option(
    "--ue-path <root>",
    "UE install root (or set UE_ROOT env var)",
  )
  .action(async (projectDir: string, opts) => {
    if (!existsSync(projectDir)) exitError(`Project not found: ${projectDir}`);

    // Validate UE root early for a clear error message
    let ueRoot: string;
    try {
      ueRoot = resolveUeRoot(opts.uePath);
    } catch (e: any) {
      exitError(e.message);
    }

    const outPath = opts.out ? resolve(opts.out as string) : undefined;
    console.log(`→ Cooking interactive skin (Android ASTC)`);
    console.log(`  Project : ${resolve(projectDir)}`);
    console.log(`  UE root : ${ueRoot!}`);
    if (outPath) console.log(`  Output  : ${outPath}`);
    console.log("  (This may take several minutes on first cook — shaders must compile)");

    const result = await cookPak({
      projectDir,
      outPath,
      uePath: opts.uePath,
      onLog: (line) => {
        if (/error|warning|cook|pak|LogInit|LogAndroid/i.test(line)) {
          console.log(`  ${line}`);
        }
      },
    });

    console.log(`✓ PAK ready: ${result.pakPath} (${formatBytes(result.bytes)})`);
    console.log(`  Upload:  cpro ue pak upload "${result.pakPath}" --slot 0`);
  });

uePak
  .command("upload")
  .description(
    "Upload a cooked .pak to a Centerpiece keyboard slot over the local network",
  )
  .argument("<pak>", "path to the cooked .pak file")
  .requiredOption("-s, --slot <n>", "keyboard slot (0–4)", "0")
  .option(
    "--host <ip>",
    "keyboard IP or hostname (auto-discovers via mDNS if omitted)",
  )
  .option("--port <n>", "keyboard HTTP port", "8080")
  .option("--verify", "poll slot preview hash via HID until stable (confirms skin loaded)")
  .action(async (pakPath: string, opts) => {
    const abs = resolve(pakPath);
    if (!existsSync(abs)) exitError(`PAK not found: ${abs}`);

    const slot = Math.max(0, Math.min(4, Number(opts.slot)));
    const port = Number(opts.port);

    console.log(`→ Uploading ${abs} → slot ${slot}`);
    if (opts.host) {
      console.log(`  Host: ${opts.host}:${port}`);
    } else {
      console.log("  Auto-discovering keyboard via mDNS…");
    }

    await uploadPak({
      pakPath: abs,
      slot,
      host: opts.host,
      port,
      onProgress: renderProgress,
    });
    process.stdout.write("\n");
    console.log(`✓ Skin uploaded to slot ${slot} — select it on your keyboard to activate`);

    if (opts.verify) {
      // Slot in ue-pak is 0-based; HID selectSlot expects 1-based
      const hidSlot = slot + 1;
      if (await isConnected()) {
        console.log(`→ Verifying via HID preview hash (slot ${hidSlot})…`);
        const verify = await verifySlotUpload(hidSlot, {
          onPoll: (attempt, sha) =>
            console.log(`  poll ${attempt}: ${sha ? sha.slice(0, 16) + "…" : "(no data)"}`,
          ),
        });
        if (verify.ok) {
          console.log(`✓ Verified — preview hash stable after ${verify.attempts} poll(s)`);
          console.log(`  SHA256: ${verify.finalSha256}`);
        } else {
          console.warn(`⚠ Verification: ${verify.error}`);
        }
      } else {
        console.warn("⚠ --verify: keyboard not found via HID (USB connection required)");
      }
    }
  });

// ---------------------------------------------------------------------------
// ue pak inspect — reverse-engineer an existing .pak file
// ---------------------------------------------------------------------------
uePak
  .command("inspect")
  .description("Show the asset manifest embedded in a cooked .pak file")
  .argument("<pak>", "path to a .pak file")
  .option("--json", "output raw JSON instead of human-readable table")
  .option("--api", "output only the extracted SkinCreatorLibrary API surface as JSON")
  .action(async (pakPath: string, opts) => {
    const abs = resolve(pakPath);
    if (!existsSync(abs)) exitError(`PAK not found: ${abs}`);

    console.log(`→ Inspecting ${abs}…`);
    const manifest = await inspectPak(abs);

    if (opts.api) {
      if (!manifest.skinCreatorApi) {
        exitError("No SkinCreatorLibrary / CpSkinAPI references found in this pak.\n" +
          "  Try a stock Finalmouse skin pak (e.g. from your keyboard's slot backups).");
      }
      console.log(JSON.stringify(manifest.skinCreatorApi, null, 2));
      return;
    }

    if (opts.json) {
      console.log(JSON.stringify(manifest, null, 2));
      return;
    }

    const mb = (manifest.fileSize / 1024 / 1024).toFixed(2);
    console.log(`\nPAK: ${abs}  (${mb} MB)\n`);

    // Version check — keyboard requires pak v11 (UE 5.3)
    if (manifest.pakVersion !== null) {
      const versionLine = `  PAK version   : ${manifest.pakVersion}`;
      if (manifest.pakVersionUnsupported) {
        console.log(`${versionLine}  ⚠  UNSUPPORTED (keyboard requires v11 / UE 5.3)`);
        console.log("  ↳ This pak was cooked with UE 5.4+ which produces v12.");
        console.log("    The Finalmouse skin engine will crash when loading it.");
        console.log("    Re-cook with UE 5.3 to produce a compatible pak.");
      } else {
        console.log(`${versionLine}  ✓`);
      }
    } else {
      console.log("  PAK version   : (could not read footer)");
    }

    if (manifest.skinFolder) {
      console.log(`  Skin folder   : ${manifest.skinFolder}`);
    }
    if (manifest.textureFormat) {
      console.log(`  Texture format: ${manifest.textureFormat}`);
    }
    if (manifest.plugins.length) {
      console.log(`  Plugins       : ${manifest.plugins.join(", ")}`);
    }

    // SkinCreatorLibrary API surface
    const api = manifest.skinCreatorApi;
    if (api) {
      console.log(`\n  Skin Creator API  (${api.className}):`);
      const stubStatus = api.matchesKnownStub
        ? "✓ matches community stub exactly"
        : "⚠ differs from known stub — SDK may have been updated";
      console.log(`    ${stubStatus}`);

      if (api.functions.length) {
        console.log(`\n    Functions (${api.functions.length}):`);
        for (const fn of api.functions) {
          const ret = fn.returnType ?? "void";
          const params = fn.params.map((p) => `${p.type} ${p.name}`).join(", ");
          console.log(`      ${ret} ${fn.name}(${params})`);
        }
      }

      if (api.delegates.length) {
        console.log(`\n    Delegates (${api.delegates.length}):`);
        for (const del of api.delegates) {
          const params = del.params.map((p) => `${p.type} ${p.name}`).join(", ");
          console.log(`      ${del.name}(${params})`);
        }
      }

      if (!api.matchesKnownStub) {
        console.log(
          "\n    New entries detected — update the CpSkinAPI stub to match:\n" +
          "    ue-interactive-template/Plugins/CpSkinAPI/Source/CpSkinAPI/Public/",
        );
      }
    } else {
      console.log("\n  Skin Creator API  : not found (static skin or no Blueprint references)");
    }

    console.log(`\n  Game assets (${manifest.gameAssets.length}):`);
    for (const a of manifest.gameAssets) console.log(`    ${a}`);

    if (manifest.engineAssets.length) {
      console.log(`\n  Engine assets (${manifest.engineAssets.length}):`);
      for (const a of manifest.engineAssets.slice(0, 20)) console.log(`    ${a}`);
      if (manifest.engineAssets.length > 20)
        console.log(`    … and ${manifest.engineAssets.length - 20} more`);
    }
  });

// ---------------------------------------------------------------------------
// ue pak generate — AI-generate a complete interactive skin project
// ---------------------------------------------------------------------------
uePak
  .command("generate")
  .description(
    "Use Claude to generate a new interactive skin project from a plain-English prompt",
  )
  .argument("<dir>", "target directory for the new project (will be created)")
  .requiredOption(
    "--prompt <text>",
    "describe the visual effect (e.g. \"lightning sparks between nearby keys\")",
  )
  .option("--name <name>", "skin name / folder suffix (e.g. Lightning)")
  .option(
    "--ref-pak <file>",
    "path to an existing .pak to use as structural reference",
  )
  .option(
    "--model <id>",
    "Claude model ID to use",
    "claude-opus-4-7",
  )
  .option("--no-scaffold", "skip copying the UE template — only write generated files")
  .action(async (dir: string, opts) => {
    const target = resolve(dir);

    // Optionally inspect a reference pak
    let referencePak;
    if (opts.refPak) {
      const refAbs = resolve(opts.refPak);
      if (!existsSync(refAbs)) exitError(`Reference PAK not found: ${refAbs}`);
      console.log(`→ Inspecting reference pak: ${refAbs}`);
      referencePak = await inspectPak(refAbs);
      console.log(
        `  Found ${referencePak.gameAssets.length} game assets` +
          (referencePak.skinFolder ? ` in ${referencePak.skinFolder}` : ""),
      );
    }

    // Run AI generation
    console.log(`\n→ Generating skin with Claude (${opts.model})…`);
    console.log(`  Prompt: "${opts.prompt}"`);
    if (!process.env.ANTHROPIC_API_KEY) {
      exitError(
        "ANTHROPIC_API_KEY is not set.\n  Export it first:  export ANTHROPIC_API_KEY=sk-ant-…",
      );
    }

    let generated;
    try {
      generated = await generateSkin({
        prompt: opts.prompt,
        skinName: opts.name,
        referencePak,
        model: opts.model,
        onProgress: (s) => console.log(`  ${s}`),
      });
    } catch (e: any) {
      exitError(`Generation failed: ${e.message}`);
    }

    // Scaffold the UE template if requested
    if (opts.scaffold !== false) {
      console.log(`\n→ Scaffolding UE project template into ${target}…`);
      await uePakInit({ targetDir: target });
    } else {
      await mkdir(target, { recursive: true });
    }

    // Write generated files
    const { writeFile } = await import("node:fs/promises");
    const setupPath = resolve(target, "Python", "setup_interactive.py");
    const conceptPath = resolve(target, "skin_concept.md");
    const paramsPath = resolve(target, "skin_params.json");

    await mkdir(resolve(target, "Python"), { recursive: true });
    await writeFile(setupPath, generated!.setupPy, "utf8");
    await writeFile(conceptPath, generated!.conceptMd, "utf8");
    await writeFile(paramsPath, generated!.paramsJson, "utf8");

    const u = generated!.usage;
    console.log(
      `\n✓ Skin "${generated!.skinName}" generated` +
        (u.cacheReadTokens ? ` (${u.cacheReadTokens} cache-read tokens saved)` : ""),
    );
    console.log(`  ${setupPath}`);
    console.log(`  ${conceptPath}`);
    console.log(`  ${paramsPath}`);
    console.log();
    console.log("  Next steps:");
    console.log("  1. Read skin_concept.md for the asset creation guide");
    console.log(`  2. Open ${target}/CpInteractiveSkin.uproject in UE 5.x`);
    console.log("  3. Run Python/setup_interactive.py from the UE Python console");
    console.log(`  4. cpro ue pak cook ${target}`);
    console.log(`  5. cpro ue pak upload dist/skin.pak --slot 0`);
  });

uePak
  .command("preview")
  .description("Open the interactive keyboard skin preview in a browser (1920×550 canvas with clickable keys + particle FX)")
  .option("-p, --port <n>", "port for the preview server", "7779")
  .option("--no-open", "do not auto-open the browser")
  .action(async (opts) => {
    const port = Number(opts.port);
    await startServer({ port, openBrowser: false });
    const url = `http://127.0.0.1:${port}/interactive.html`;
    console.log(`✓ Interactive preview at ${url}`);
    console.log("  • Click any key to see particle effects");
    console.log("  • Press keyboard keys (mapped to Centerpiece indices)");
    console.log("  • Upload a background image or video");
    console.log("  Ctrl+C to stop");
    if (opts.open !== false) {
      const { default: open } = await import("open");
      await open(url);
    }
  });

program
  .command("specs")
  .description("Print the Centerpiece Pro skin specs")
  .action(() => {
    console.log(JSON.stringify(SPECS, null, 2));
  });

// ---------------------------------------------------------------------------
// slot — HID slot control (USB connection required)
// ---------------------------------------------------------------------------
const slot = program
  .command("slot")
  .description("Control Centerpiece slots via USB HID (VID 0x361D / PID 0x0202)");

slot
  .command("status")
  .description("Check if the keyboard is connected via USB HID")
  .action(async () => {
    const connected = await isConnected();
    if (connected) {
      console.log(`✓ Centerpiece connected  (VID 0x${CENTERPIECE_VID.toString(16).toUpperCase()} / PID 0x${CENTERPIECE_PID.toString(16).toUpperCase()})`);
    } else {
      console.log("✗ Centerpiece not detected via HID");
      console.log("  Ensure the keyboard is plugged in via USB.");
      console.log("  On macOS grant Input Monitoring: System Settings → Privacy & Security → Input Monitoring.");
      process.exit(1);
    }
  });

slot
  .command("select")
  .description("Switch the active Centerpiece slot (1–5)")
  .argument("<n>", "slot number (1–5)")
  .action(async (n: string) => {
    const slotNum = Number(n);
    if (!Number.isInteger(slotNum) || slotNum < 1 || slotNum > 5) exitError("Slot must be 1–5");
    console.log(`→ Switching to slot ${slotNum}…`);
    const result = await selectSlot(slotNum);
    if (result.ok) {
      console.log(`✓ Slot ${slotNum} selected`);
    } else {
      exitError(result.error ?? "Unknown HID error");
    }
  });

slot
  .command("preview")
  .description("Pull and save preview PNG(s) from the keyboard")
  .option("-s, --slot <n>", "specific slot (1–5), omit for all 5")
  .option("-o, --out <dir>", "output directory", ".")
  .action(async (opts) => {
    await mkdir(resolve(opts.out), { recursive: true });

    if (opts.slot) {
      const slotNum = Number(opts.slot);
      if (!Number.isInteger(slotNum) || slotNum < 1 || slotNum > 5)
        exitError("Slot must be 1–5");
      console.log(`→ Pulling preview for slot ${slotNum}…`);
      const result = await pullSlotPreview(slotNum);
      if (!result.pngBuffer) exitError(result.error ?? "No preview received");
      const outPath = resolve(opts.out, `slot-${slotNum}-preview.png`);
      await (await import("node:fs/promises")).writeFile(outPath, result.pngBuffer);
      console.log(`✓ Saved ${outPath} (SHA256: ${result.sha256?.slice(0, 16)}…)`);
    } else {
      console.log("→ Pulling previews for all 5 slots…");
      const results = await pullAllPreviews({
        onSlot: async (r) => {
          if (r.pngBuffer) {
            const outPath = resolve(opts.out, `slot-${r.slot}-preview.png`);
            await (await import("node:fs/promises")).writeFile(outPath, r.pngBuffer);
            console.log(`  slot ${r.slot} ✓  ${outPath} (${r.sha256?.slice(0, 16)}…)`);
          } else {
            console.log(`  slot ${r.slot} ✗  ${r.error ?? "no data"}`);
          }
        },
      });
      const ok = results.filter((r) => r.pngBuffer).length;
      console.log(`\n✓ ${ok}/5 previews saved to ${resolve(opts.out)}`);
    }
  });

slot
  .command("verify")
  .description("Poll slot preview hash via HID until stable (confirm a skin has loaded)")
  .argument("<n>", "slot number (1–5)")
  .option("--timeout <ms>", "max wait in milliseconds", "45000")
  .option("--interval <ms>", "poll interval in milliseconds", "3000")
  .action(async (n: string, opts) => {
    const slotNum = Number(n);
    if (!Number.isInteger(slotNum) || slotNum < 1 || slotNum > 5) exitError("Slot must be 1–5");
    console.log(`→ Verifying slot ${slotNum} (up to ${Number(opts.timeout) / 1000}s)…`);
    const result = await verifySlotUpload(slotNum, {
      maxWaitMs: Number(opts.timeout),
      pollIntervalMs: Number(opts.interval),
      onPoll: (attempt, sha) =>
        console.log(`  poll ${attempt}: ${sha ? sha.slice(0, 16) + "…" : "(no data)"}`),
    });
    if (result.ok) {
      console.log(`✓ Verified after ${result.attempts} poll(s)`);
      console.log(`  SHA256: ${result.finalSha256}`);
    } else {
      exitError(result.error ?? "Verification failed");
    }
  });

// ---------------------------------------------------------------------------
// ytdlp — yt-dlp management
// ---------------------------------------------------------------------------
const ytdlp = program
  .command("ytdlp")
  .description("Manage yt-dlp (YouTube/Vimeo downloader)");

ytdlp
  .command("check")
  .description("Check whether yt-dlp is installed and show its version")
  .action(async () => {
    const bin = process.env.YTDLP_PATH ?? "yt-dlp";
    const { execFile } = await import("node:child_process");
    await new Promise<void>((resolve) => {
      execFile(bin, ["--version"], { timeout: 5000 }, (err, stdout) => {
        if (err) {
          console.log("✗ yt-dlp not found");
          console.log("  Install: brew install yt-dlp   (macOS)");
          console.log("           pip install yt-dlp    (any OS)");
        } else {
          console.log(`✓ yt-dlp ${stdout.trim()}`);
        }
        resolve();
      });
    });
  });

ytdlp
  .command("update")
  .description("Update yt-dlp to the latest version (runs yt-dlp -U)")
  .action(async () => {
    const bin = process.env.YTDLP_PATH ?? "yt-dlp";
    const { spawn } = await import("node:child_process");
    console.log(`→ Updating yt-dlp (${bin})…`);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(bin, ["-U"], { stdio: "inherit" });
      child.on("error", (e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") {
          reject(new Error("yt-dlp not found — install it first (brew install yt-dlp)"));
        } else {
          reject(e);
        }
      });
      child.on("close", (code) => {
        if (code === 0) {
          console.log("✓ yt-dlp is up to date");
          resolve();
        } else {
          reject(new Error(`yt-dlp update exited with code ${code}`));
        }
      });
    }).catch((e) => exitError(e.message));
  });

// ---------------------------------------------------------------------------
// device — Android-side access via rootshelld (TCP port 5557)
//
// The Finalmouse Centerpiece runs Android 11 on a Rockchip RK3566 SOM
// (Firefly Core-3566JD4). Reverse engineering by nun.tax revealed an
// unauthenticated root shell service (rootshelld) on TCP port 5557 that
// was not removed before shipping. These commands use that shell to
// inspect and manage the Android side of the keyboard.
//
// Reference: https://nun.tax/blog/reverse-engineering-the-centerpiece-pro/
// ---------------------------------------------------------------------------
const device = program
  .command("device")
  .description(
    "Android-side tools via rootshelld (TCP port 5557, no auth required)\n" +
    "  Requires the keyboard to be on the same LAN. Use --host <ip> if mDNS fails.",
  );

device
  .command("info")
  .description("Show Android system info (OS version, hardware, ADB state) from the keyboard")
  .option("--host <ip>", "keyboard IP (auto-discovers via mDNS if omitted)")
  .action(async (opts) => {
    const host = opts.host ?? (await discoverKeyboardHostOrExit());
    console.log(`→ Connecting to rootshelld at ${host}:${ROOTSHELLD_PORT}…`);

    const available = await probeRootShell(host);
    if (!available) {
      exitError(
        `rootshelld not reachable at ${host}:${ROOTSHELLD_PORT}.\n` +
        "  Make sure the keyboard is on and on the same network.\n" +
        "  Note: rootshelld is a debug service that may be removed in future firmware.",
      );
    }

    console.log("✓ rootshelld connected\n");
    const info = await getDeviceInfo(host);

    console.log(`  Android version : ${info.buildVersion || "(unknown)"}`);
    console.log(`  SDK level       : ${info.sdkVersion || "(unknown)"}`);
    console.log(`  Device model    : ${info.deviceModel || "(unknown)"}`);
    console.log(`  CPU ABI         : ${info.cpuAbi || "(unknown)"}`);
    if (info.uptimeSeconds !== null) {
      const h = Math.floor(info.uptimeSeconds / 3600);
      const m = Math.floor((info.uptimeSeconds % 3600) / 60);
      console.log(`  Uptime          : ${h}h ${m}m`);
    }
    console.log(`  ro.adb.secure   : ${info.adbSecure || "(unknown)"}`);
    if (info.adbSecure === "0") {
      console.log("    ↳ ADB is unauthenticated on this device");
    } else {
      console.log("    ↳ ADB requires authorization (use rootshelld instead)");
    }
    if (info.buildFingerprint) {
      console.log(`  Build           : ${info.buildFingerprint}`);
    }
  });

device
  .command("skins")
  .description("List interactive skin .pak files installed on the keyboard's Android system")
  .option("--host <ip>", "keyboard IP (auto-discovers via mDNS if omitted)")
  .action(async (opts) => {
    const host = opts.host ?? (await discoverKeyboardHostOrExit());
    console.log(`→ Listing skins on ${host} via rootshelld…`);

    const skins = await listInstalledSkins(host);
    if (skins.length === 0) {
      console.log("  No .pak files found in known skin directories:");
      for (const p of ANDROID_SKIN_PATHS) console.log(`    ${p}`);
      return;
    }

    console.log(`\n  Found ${skins.length} skin(s):\n`);
    for (const s of skins) {
      const slotStr = s.slot !== null ? `slot ${s.slot}` : "?    ";
      const mb = s.sizeBytes ? ` (${(s.sizeBytes / 1024 / 1024).toFixed(1)} MB)` : "";
      console.log(`  [${slotStr}]  ${s.filename}${mb}`);
      console.log(`          ${s.path}`);
    }
  });

device
  .command("logs")
  .description("Stream Unreal Engine / skin engine logcat from the keyboard in real time")
  .option("--host <ip>", "keyboard IP (auto-discovers via mDNS if omitted)")
  .option("--filter <spec>", "logcat filter spec", "LogPython:* LogBlueprint:* LogNiagara:* SkinEngine:* *:E")
  .option("--duration <ms>", "stop after N milliseconds (omit to run until Ctrl+C)")
  .action(async (opts) => {
    const host = opts.host ?? (await discoverKeyboardHostOrExit());
    console.log(`→ Streaming logcat from ${host}:${ROOTSHELLD_PORT} (Ctrl+C to stop)\n`);

    const s = streamLogcat(host, (line) => console.log(line), opts.filter);

    if (opts.duration) {
      setTimeout(() => { s.stop(); process.exit(0); }, Number(opts.duration));
    }

    process.on("SIGINT", () => { s.stop(); process.exit(0); });
    // Keep process alive
    await new Promise(() => {});
  });

device
  .command("push")
  .description(
    "Push a .pak file directly to the Android skin directory via rootshelld\n" +
    "  Alternative to HTTP upload — works without the Finalmouse HTTP skin server.",
  )
  .argument("<pak>", "path to the cooked .pak file")
  .requiredOption("-s, --slot <n>", "target slot (0–4)", "0")
  .option("--host <ip>", "keyboard IP (auto-discovers via mDNS if omitted)")
  .option("--skin-dir <path>", "Android destination directory", ANDROID_SKIN_PATHS[0])
  .action(async (pakPath: string, opts) => {
    const abs = resolve(pakPath);
    if (!existsSync(abs)) exitError(`PAK not found: ${abs}`);

    const slot = Math.max(0, Math.min(4, Number(opts.slot)));
    const host = opts.host ?? (await discoverKeyboardHostOrExit());

    console.log(`→ Pushing ${abs} → ${host} slot ${slot} via rootshelld`);
    console.log("  (Uses nc relay — requires netcat on the Android side)");

    const result = await pushPakViaShell(host, abs, slot, {
      skinDir: opts.skinDir,
      onProgress: renderProgress,
    });
    process.stdout.write("\n");

    if (result.ok) {
      console.log(`✓ Pushed to ${result.destPath}`);
      console.log("  Restart the skin engine or switch slots to apply.");
    } else {
      exitError(`Push failed: ${result.error}`);
    }
  });

device
  .command("enable-adb")
  .description(
    "Send the HID command that triggers ADB mode on the keyboard's Android system\n" +
    "  Note: The keyboard shows an ADB auth dialog but has no touch input — you\n" +
    "  cannot accept it through software. Use 'cpro device info/logs/skins' instead.",
  )
  .action(async () => {
    const connected = await isConnected();
    if (!connected) {
      exitError("Centerpiece not found via HID (USB). Plug in the keyboard and try again.");
    }
    console.log("→ Sending ADB enable HID command (opcode 0x12, community-reported)…");
    const result = await enableAdbMode();
    if (!result.ok) exitError(result.error ?? "HID write failed");

    console.log("✓ ADB enable command sent");
    console.log();
    console.log("  The keyboard display may show an ADB authorization prompt.");
    console.log("  Because the keyboard has no touch input you cannot accept it");
    console.log("  through software — ADB will remain unauthorized.");
    console.log();
    console.log("  For Android shell access without hardware mods, use:");
    console.log("    cpro device info    — query Android system properties");
    console.log("    cpro device logs    — stream logcat");
    console.log("    cpro device skins   — list installed skins");
    console.log();
    console.log("  Full ADB requires bridging resistors R70+R71 (UART → pre-auth key).");
    console.log("  Guide: https://nun.tax/blog/reverse-engineering-the-centerpiece-pro/");
  });

device
  .command("authorize-adb")
  .description(
    "Pre-authorize your ADB key on the keyboard via rootshelld — enables software-only ADB\n" +
    "  Writes your ~/.android/adbkey.pub to /data/misc/adb/adb_keys on the keyboard,\n" +
    "  then run 'cpro device enable-adb' to trigger the ADB listener. No hardware mods needed.",
  )
  .option("--host <ip>", "keyboard IP (auto-discovers via mDNS if omitted)")
  .option("--key <file>", "ADB public key file (default: ~/.android/adbkey.pub)")
  .action(async (opts) => {
    const host = opts.host ?? (await discoverKeyboardHostOrExit());
    console.log(`→ Connecting to rootshelld at ${host}:${ROOTSHELLD_PORT}…`);

    const available = await probeRootShell(host);
    if (!available) {
      exitError(
        `rootshelld not reachable at ${host}:${ROOTSHELLD_PORT}.\n` +
        "  Ensure the keyboard is on the same network and rootshelld is running.",
      );
    }

    console.log("✓ rootshelld connected");
    console.log("→ Writing ADB public key to keyboard…");

    const result = await authorizeAdbKey(host, opts.key);
    if (!result.ok) {
      exitError(result.error ?? "Failed to write ADB key");
    }

    console.log("✓ ADB key written to /data/misc/adb/adb_keys");
    console.log();
    console.log("  Next — enable ADB and connect:");
    console.log("    1. cpro device enable-adb    (triggers ADB listener via HID)");
    console.log("    2. adb connect <keyboard-ip>:5555");
    console.log("       (or the port shown after enabling — typically 5555)");
    console.log();
    console.log("  Your key is pre-authorized so no dialog needs to be accepted.");
    console.log(`  Key: ${result.publicKey?.slice(0, 48)}…`);
  });

device
  .command("mcu-recovery")
  .description("Show instructions for entering MCU recovery mode (dump/flash MCU firmware)")
  .action(() => {
    console.log("MCU Recovery Mode — Centerpiece Pro\n");
    console.log("  The MCU (keyboard logic microcontroller) ships with a built-in bootloader");
    console.log("  that exposes the flash for reading and writing when in recovery mode.");
    console.log("  This does not require JTAG or any hardware modifications.\n");
    console.log("  To enter recovery mode:");
    console.log(`    ${MCU_RECOVERY_INSTRUCTIONS}\n`);
    console.log("  Once in recovery mode, the MCU flash is accessible via USB.");
    console.log("  Use your MCU vendor's DFU or recovery tool to read/write firmware.\n");
    console.log("  Hardware reference:");
    console.log(`    SOM  : ${SOM_MODEL} (${SOC_CHIP})`);
    console.log(`    OS   : Android ${ANDROID_VERSION}`);
    console.log(`    UART : ${UART_BAUD_RATE.toLocaleString()} baud`);
    console.log(`           Bridge resistors ${UART_BRIDGE_RESISTORS.join(" + ")} for serial access`);
    console.log();
    console.log("  Further reading:");
    console.log("    https://nun.tax/blog/reverse-engineering-the-centerpiece-pro/");
    console.log("    https://wiki.t-firefly.com/en/Core-3566JD4/");
  });

async function discoverKeyboardHostOrExit(): Promise<string> {
  const { discoverKeyboard } = await import("./lib/ue-pak.js");
  try {
    return await discoverKeyboard();
  } catch (e: any) {
    exitError(
      `Could not discover keyboard on the network: ${e.message}\n` +
      "  Pass --host <keyboard-ip> to specify the address explicitly.",
    );
  }
}

program.parseAsync().catch((e) => {
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
