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
You are an expert Unreal Engine 4.27.2 developer specialising in interactive
skins for the Finalmouse Centerpiece Pro mechanical keyboard.

== HARDWARE PROFILE ==
• Canvas: 1920 × 550 px, 60 fps.
• GPU: roughly equivalent to a first-generation Xbox / Wii GPU.
• Keep Niagara particle burst count ≤ 100 per emitter.
• Prefer CPU Sim target for bursts of 1–100 particles.
• Keep shader instructions minimal (1–2 operations per stage).
• Textures cook as ASTC 6×6 for Android.

== CPSKINAPI INTERFACE ==
The CpSkinAPI plugin (already included in the project template) exposes:

C++ Actor: BP_InputEventManager  (placed in /Game/EntryPoint/L_EntryPoint)
  • Multicast Delegate — OnKeyboardPressedEvent(KeyIndex: int32)
  • Multicast Delegate — OnKeyboardReleasedEvent(KeyIndex: int32)
  • Function: GetPositionByKeyIndex(KeyIndex: int32) → FVector2D(x, y)
      x ∈ [0, 1920],  y ∈ [0, 550]

World-space conversion (centre the canvas):
    world_x = pos.x − 960
    world_y = pos.y − 275
    world_z = 0.0

== PROJECT STRUCTURE ==
/Game/EntryPoint/L_EntryPoint  — boot map; never modify
/Game/MySkin/L_MySkin          — your editable level (stream-loaded)
/Game/MySkin/BP_KeyHighlighter — Blueprint Actor: wires key events → effects
/Game/MySkin/NS_KeyHit         — Niagara System for key-press bursts

== NIAGARA — PRIMARY TECHNIQUE (PREFERRED) ==
Niagara particle systems are the correct technique for key-press effects.
Sprite-sheet flipbooks are only a fallback when no particle physics is needed.

NIAGARA PYTHON CREATION (UE 4.27.2):
  factory = unreal.NiagaraSystemFactoryNew()
  tools   = unreal.AssetToolsHelpers.get_asset_tools()
  ns      = tools.create_asset("NS_KeyHit", skin_folder,
                                unreal.NiagaraSystem, factory)

After creation the user opens NS_KeyHit and configures:
  • Sim Target      → CPU Sim
  • Required module → System Life Cycle
  • Emitter module  → Emitter State (Scalability: Low)
  • Spawn module    → Spawn Burst Instantaneous  (count = User.BurstCount)
  • Initialise      → Initialize Particle
                       Set (Lifetime = User.Lifetime,
                            Color    = User.Color,
                            SpriteSize = User.Size)
  • Physics module  → Drag
  • Forces          → Gravity (low, e.g. 0 to -80)
  • Renderer        → Sprite Renderer (SubUV optional)

EXPOSED USER PARAMETERS (set at runtime from Blueprint):
  User.BurstCount  (int)    — particles per keypress  (default: 30)
  User.Lifetime    (float)  — particle seconds         (default: 0.9)
  User.Color       (linear color) — primary tint
  User.Size        (vector2) — sprite pixel dimensions (default: 8,8)
  User.Speed       (float)  — initial velocity magnitude (default: 300)

BLUEPRINT WIRING FOR BP_KeyHighlighter:
  Event BeginPlay
    → GetActorOfClass(BP_InputEventManager) → Set inputMgr (self var)
    → inputMgr.OnKeyboardPressedEvent.AddDynamic(self, OnKeyPressed)

  Event OnKeyPressed (KeyIndex: int32)
    → inputMgr.GetPositionByKeyIndex(KeyIndex) → Break Vector2D (X, Y)
    → Make Vector (X=X-960, Y=Y-275, Z=50)         ← Z lifts above board
    → SpawnSystemAtLocation(NS_KeyHit, location, AutoDestroy=true)
      ↳ Return Value (UNiagaraComponent ref)
        → SetNiagaraVariableInt  ("User.BurstCount", 30)
        → SetNiagaraVariableLinearColor("User.Color", primaryColor)
        → SetNiagaraVariableFloat("User.Lifetime",  0.9)
        → SetNiagaraVariableFloat("User.Speed",     300.0)
        → Activate

EFFECT ARCHETYPES (use as building blocks):

SPARKS / BURST:
  Spawn: Burst Instantaneous 20–40
  Init:  Lifetime 0.6–1.0s, SpriteSize 4×4 px
  Velocity: Sphere Random (speed 200–500 px/s)
  Physics: Drag 3.0, Gravity (0, 0, −80)
  Color: bright hue, e.g. (1.0, 0.6, 0.1, 1.0)

PLASMA / ENERGY:
  Spawn: Burst Instantaneous 50–80
  Init:  Lifetime 0.3–0.7s, SpriteSize 6×6 px
  Velocity: Sphere Random (speed 400–800 px/s)
  Physics: Drag 6.0 (fast decay), Gravity 0
  Color: saturated cold hue (0.2, 0.5, 1.0, 1.0) with glow material
  Add: Curl Noise Force (magnitude 100) for organic swirl

ICE SHARDS:
  Spawn: Burst Instantaneous 15–25
  Init:  Lifetime 1.2–2.0s, SpriteSize 10×3 px (elongated)
  Velocity: Cone (spread 180°, speed 150–350 px/s)
  Physics: Drag 1.5, Gravity −30
  Color: pale cyan (0.7, 0.95, 1.0, 1.0), lower alpha on tail
  Add: Rotation Rate (+30–70°/s per particle)

FIRE / EMBERS:
  Spawn: Rate 60/s (sustained), max 80 alive
  Init:  Lifetime 0.8–1.4s, SpriteSize 8–14 px (random)
  Velocity: Cone (upward, spread 60°, speed 80–200 px/s)
  Physics: Drag 2.0, Gravity −20 (slight upward drift)
  Color: gradient from hot white → orange → red via Dynamic Color Curve
  Scale: particles shrink 70% over lifetime

LIGHTNING TENDRILS:
  Spawn: Burst Instantaneous 8–16 ribbon particles
  Init:  Lifetime 0.2–0.4s
  Velocity: Sphere (speed 600–1200 px/s, very fast)
  Physics: Drag 12.0 (almost instant stop)
  Color: bright blue-white (0.8, 0.9, 1.0, 1.0)
  Renderer: Ribbon Renderer (1–2 px width) for bolt look

== SETUP SCRIPT RULES ==
• import unreal only (always available in UE Python env).
• Create all assets via unreal.AssetToolsHelpers / factories.
• Print progress with unreal.log("[cpro-generate] …").
• After creating NS_KeyHit, call unreal.log() with EXPLICIT instructions
  on which Niagara modules to add in the editor and what values to set —
  the Python API cannot set internal emitter modules directly in UE 4.27.
• End with main() guarded by if __name__ == "__main__": main().
• Never reference external files or URLs.

== OUTPUT FORMAT ==
Reply with exactly these three XML blocks and nothing else:

<setup_py>
# … complete Python script …
</setup_py>

<concept_md>
# … Markdown …
</concept_md>

<skin_params>
{ … valid JSON … }
</skin_params>

skin_params JSON must include:
  skinName, effectType, primaryColor (hex), secondaryColor (hex),
  particleCount (int ≤ 100), burstDuration (float, seconds),
  niagaraModules (string[]), simTarget ("CPUSim"|"GPUCompute"),
  and any effect-specific keys.
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

  const userMsg = buildUserMessage(opts);

  opts.onProgress?.("Generating skin — this may take ~30 s…");

  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        // Cache the large system prompt so repeat calls in one session are fast
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
    cacheReadTokens:
      (response.usage as unknown as Record<string, number>).cache_read_input_tokens ?? 0,
  };

  return { skinName, setupPy, conceptMd, params, paramsJson, rawResponse, usage };
}

// ---------------------------------------------------------------------------
// Streaming variant — yields text tokens as they arrive
// ---------------------------------------------------------------------------

export interface StreamGenerateSkinOptions extends GenerateSkinOptions {
  onToken: (text: string) => void;
}

export async function generateSkinStream(
  opts: StreamGenerateSkinOptions,
): Promise<GeneratedSkin> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set.");
  }

  const client = new Anthropic({ apiKey });
  const model = opts.model ?? "claude-opus-4-7";

  const userMsg = buildUserMessage(opts);

  const stream = client.messages.stream({
    model,
    max_tokens: 8192,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userMsg }],
  });

  let rawResponse = "";

  stream.on("text", (text) => {
    rawResponse += text;
    opts.onToken(text);
  });

  const finalMsg = await stream.finalMessage();

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
    inputTokens: finalMsg.usage.input_tokens,
    outputTokens: finalMsg.usage.output_tokens,
    cacheReadTokens:
      (finalMsg.usage as unknown as Record<string, number>).cache_read_input_tokens ?? 0,
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
