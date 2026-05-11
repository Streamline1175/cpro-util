/**
 * ai-generate.ts
 *
 * Uses the Anthropic Claude API to generate a complete interactive skin
 * scaffold for the Finalmouse Centerpiece Pro keyboard.
 *
 * Given a plain-English description of the desired visual effect, the model
 * returns:
 *  • setup_interactive.py  — drop-in replacement for the template scaffolder,
 *                            ready to run from the UE 4.27.2 Python console
 *  • skin_concept.md       — human-readable breakdown of assets to create and
 *                            how the effect works
 *  • skin_params.json      — machine-readable parameters for the skin
 *
 * The system prompt is cached so repeat calls in the same session are fast.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { PakInspectResult } from "./pak-inspect.js";

// ---------------------------------------------------------------------------
// System prompt (cached via cache_control)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `\
You are an expert Unreal Engine 4.27.2 developer who specialises in building
interactive skins for the Finalmouse Centerpiece Pro mechanical keyboard.

== HARDWARE CONSTRAINTS ==
• Canvas: 1920 × 550 pixels (16:~4.7 aspect ratio), rendered at 60 fps.
• GPU budget: roughly equivalent to a first-generation Xbox / Wii GPU.
• Keep Niagara particle count ≤ 100 per emitter burst.
• Use CPU Sim target for bursts of 1–100 particles; avoid GPU Compute.
• Keep shader complexity low — a single multiply/lerp layer is ideal.
• Textures must be ASTC-compressed (Android ASTC 6×6 is the cooked format).

== PLUGIN / API ==
The CpSkinAPI plugin exposes:
  • BP_InputEventManager — C++ Actor placed in the Entry level.
      - Delegate: OnKeyboardPressedEvent (KeyIndex: int)
      - Delegate: OnKeyboardReleasedEvent (KeyIndex: int)
      - Function: GetPositionByKeyIndex(KeyIndex) → FVector2D(x, y)
        where x ∈ [0, 1920] and y ∈ [0, 550]
  • Coordinate conversion to UE world-space:
      world_x = pos.x − 960   (centres horizontally)
      world_y = pos.y − 275   (centres vertically)
      world_z = 0

== PROJECT STRUCTURE ==
  /Game/EntryPoint/L_EntryPoint  — boot map; do not modify
  /Game/MySkin/L_MySkin          — your working level
  /Game/MySkin/BP_KeyHighlighter — Blueprint: spawns effects on key press
  /Game/MySkin/NS_KeyHit         — Niagara System

The L_EntryPoint map uses Level Streaming to load L_MySkin at runtime.

== REFERENCE — FIREBALLS PAK ==
A community skin named "Fireballs" uses this asset layout:
  /Game/SG_MySkin/Sprites/Fire/Explotion1/   (1179 frames)
  /Game/SG_MySkin/Sprites/Fire/Explotion2/   (1237 frames)
  /Game/SG_MySkin/Sprites/Fire/Explotion3/   (1351 frames)
  /Game/SG_MySkin/Sprites/Fire/Explotion4/   (1361 frames)
  /Game/SG_MySkin/Sprites/Fire/Explotion5/   (1427 frames)
  /Game/SG_MySkin/Sprites/Fire/Explotion6/   (1428 frames)
  /Game/SG_MySkin/Sprites/Fire/Explotion7/    (848 frames)
  /Game/map/BP_LevelLoader
  /Game/map/M_EntryPointa
It renders fire explosions as sprite-sheet flipbooks instead of Niagara
particles; this is GPU-cheaper and looks spectacular on the tiny keyboard GPU.

== OUTPUT FORMAT ==
Respond with exactly three XML-tagged blocks and nothing else:

<setup_py>
# … complete Python script that can be pasted into the UE 4.27.2 Python console …
</setup_py>

<concept_md>
# … Markdown description …
</concept_md>

<skin_params>
{ … JSON object … }
</skin_params>

Rules for setup_interactive.py:
• Import only "unreal" (always available in the UE Python env).
• Create all assets programmatically via unreal.AssetToolsHelpers / factories.
• Include all Niagara module parameter overrides as Python calls.
• Print progress with unreal.log("[cpro-generate] …").
• End with a main() function guarded by if __name__ == "__main__": main().
• Never reference external files or URLs.

Rules for skin_params JSON:
• Must be valid JSON (no comments, no trailing commas).
• Include: skinName, effectType, primaryColor (hex), secondaryColor (hex),
  particleCount (int ≤ 100), burstDuration (float, seconds),
  niagaraModules (array of string module names), and any effect-specific keys.
`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GenerateSkinOptions {
  /** Plain-English description of the desired interactive effect. */
  prompt: string;
  /** Friendly name for the skin folder, e.g. "IceCrystals". */
  skinName?: string;
  /**
   * Asset manifest from an existing .pak file to use as additional context.
   * Pass the result of inspectPak() if the user provides a reference pak.
   */
  referencePak?: PakInspectResult;
  /**
   * Claude model ID to use.  Defaults to claude-opus-4-7 for maximum quality.
   */
  model?: string;
  onProgress?: (status: string) => void;
}

export interface GeneratedSkin {
  skinName: string;
  /** Full text of setup_interactive.py */
  setupPy: string;
  /** Full text of skin_concept.md */
  conceptMd: string;
  /** Parsed skin_params object (also available as raw JSON string). */
  params: Record<string, unknown>;
  paramsJson: string;
  /** Raw full response text (for debugging). */
  rawResponse: string;
  /** Token usage for billing awareness. */
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
}

export async function generateSkin(opts: GenerateSkinOptions): Promise<GeneratedSkin> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set.\n" +
        "Export it before running:  export ANTHROPIC_API_KEY=sk-ant-…",
    );
  }

  const client = new Anthropic({ apiKey });
  const model = opts.model ?? "claude-opus-4-7";

  opts.onProgress?.(`Connecting to Claude (${model})…`);

  // Build the user message
  let userMsg = buildUserMessage(opts);

  opts.onProgress?.("Generating skin — this may take ~30 s…");

  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        // Cache the large system prompt so repeated calls in one session are fast
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userMsg }],
  });

  const rawResponse = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as Anthropic.TextBlock).text)
    .join("");

  opts.onProgress?.("Parsing response…");

  const setupPy = extractBlock(rawResponse, "setup_py");
  const conceptMd = extractBlock(rawResponse, "concept_md");
  const paramsJson = extractBlock(rawResponse, "skin_params");

  let params: Record<string, unknown>;
  try {
    params = JSON.parse(paramsJson);
  } catch {
    params = { raw: paramsJson };
  }

  const skinName =
    (params.skinName as string | undefined) ?? opts.skinName ?? "GeneratedSkin";

  const usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: (response.usage as unknown as Record<string, number>).cache_read_input_tokens ?? 0,
  };

  return { skinName, setupPy, conceptMd, params, paramsJson, rawResponse, usage };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildUserMessage(opts: GenerateSkinOptions): string {
  const lines: string[] = [];

  lines.push("Generate a Centerpiece Pro interactive skin with this effect:");
  lines.push("");
  lines.push(opts.prompt);

  if (opts.skinName) {
    lines.push("");
    lines.push(`Skin name: ${opts.skinName}`);
  }

  if (opts.referencePak) {
    const pak = opts.referencePak;
    lines.push("");
    lines.push("Reference .pak asset manifest:");
    lines.push(`  File: ${pak.filePath}  (${(pak.fileSize / 1024 / 1024).toFixed(1)} MB)`);
    if (pak.skinFolder) lines.push(`  Skin folder: ${pak.skinFolder}`);
    if (pak.textureFormat) lines.push(`  Texture format: ${pak.textureFormat}`);
    if (pak.gameAssets.length) {
      lines.push("  Game assets:");
      for (const a of pak.gameAssets.slice(0, 40)) lines.push(`    ${a}`);
      if (pak.gameAssets.length > 40)
        lines.push(`    … and ${pak.gameAssets.length - 40} more`);
    }
    if (pak.plugins.length) lines.push(`  Plugins: ${pak.plugins.join(", ")}`);
  }

  return lines.join("\n");
}

function extractBlock(text: string, tag: string): string {
  const re = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, "i");
  const m = text.match(re);
  if (!m) {
    throw new Error(
      `Claude response did not contain a <${tag}> block.\n` +
        "Raw response (first 500 chars):\n" +
        text.slice(0, 500),
    );
  }
  return m[1].trim();
}
