# cpro-util — Copilot Workspace Instructions

## What this project is

**cpro-util** is the open-source CLI and web toolbox for building skins for the
**Finalmouse Centerpiece Pro** mechanical keyboard. The keyboard has a built-in
1920 × 550 px display and an embedded GPU. Skins are either:

- **Static skins** — PNG or H.264 MP4 files (handled by `cpro convert`)
- **Interactive skins** — Unreal Engine 5.3 apps cooked to Android ASTC `.pak` files
  (pak version 11 — the keyboard firmware requires v11; UE 5.4+ produces v12 which crashes)
  that react to keypresses in real time via Niagara particle effects

---

## Interactive skin authoring

All interactive skin work lives under `cpro ue pak` commands and the
`ue-interactive-template/` folder.

### CpSkinAPI plugin (already in the template)

The plugin lives at `ue-interactive-template/Plugins/CpSkinAPI/`. It exposes:

```cpp
// C++ Actor placed in /Game/EntryPoint/L_EntryPoint
class BP_InputEventManager : public AActor {
  // Fired when a physical key is pressed
  UPROPERTY(BlueprintAssignable)
  FOnKeyboardPressedEvent OnKeyboardPressedEvent;   // (int32 KeyIndex)

  UPROPERTY(BlueprintAssignable)
  FOnKeyboardReleasedEvent OnKeyboardReleasedEvent; // (int32 KeyIndex)

  // Returns the pixel-space centre of a key (x∈[0,1920], y∈[0,550])
  UFUNCTION(BlueprintCallable)
  FVector2D GetPositionByKeyIndex(int32 KeyIndex);
}
```

Convert to world-space for Niagara spawn location:
```
world_x = pos.x − 960
world_y = pos.y − 275
world_z = 0
```

Key indices 1–67 map to all physical keys. Spacebar is NOT indexed.

---

## Project file structure

```
ue-interactive-template/
  CpInteractiveSkin.uproject
  Plugins/CpSkinAPI/          ← C++ plugin stub
  Python/setup_interactive.py ← scaffolding script (run once in UE editor)
  Config/
src/
  cli.ts                      ← main CLI entry point
  server.ts                   ← web UI + /api/generate endpoint
  lib/
    ue-pak.ts                 ← cook + upload logic
    pak-inspect.ts            ← .pak asset extraction
    ai-generate.ts            ← Claude API skin generation
```

---

## GPU budget

The keyboard GPU is roughly equivalent to a first-gen Xbox / Wii GPU:

- Niagara particle burst count **≤ 100** per emitter
- Use **CPU Sim** target for bursts (not GPU Compute)
- Keep shader complexity minimal (≤ 2 instruction layers)
- Textures cook as **ASTC 6×6** (Android compressed)

---

## Niagara particle effects — preferred technique

When generating `setup_interactive.py` for an interactive skin, always use
**Niagara particle systems** as the primary effect mechanism. Sprite-sheet
flipbooks are only a fallback.

### Creating a Niagara system in Python (UE 5.3)

```python
import unreal

factory = unreal.NiagaraSystemFactoryNew()
tools   = unreal.AssetToolsHelpers.get_asset_tools()
ns      = tools.create_asset("NS_KeyHit", "/Game/MySkin",
                              unreal.NiagaraSystem, factory)
unreal.EditorAssetLibrary.save_loaded_asset(ns)
```

After creation, open `NS_KeyHit` in the Niagara editor and configure:
- **Sim Target** → CPU Sim
- Add **Spawn Burst Instantaneous** (count = `User.BurstCount`)
- Add **Initialize Particle** (set Lifetime, Color, SpriteSize from User params)
- Add **Drag** module (value ≈ 3.0 for sparks)
- Optionally add **Curl Noise Force** for organic swirl

### Exposed User parameters (set at runtime from Blueprint)

```
User.BurstCount   int      — particles per keypress (default 30)
User.Lifetime     float    — particle lifespan in seconds (default 0.9)
User.Color        color    — primary tint (linear RGBA)
User.Size         vector2  — sprite pixel size (default 8×8)
User.Speed        float    — initial velocity magnitude (default 300)
```

### Blueprint wiring pattern (BP_KeyHighlighter)

```
Event BeginPlay
  → GetActorOfClass(BP_InputEventManager) → Set inputMgr
  → inputMgr.OnKeyboardPressedEvent.AddDynamic → OnKeyPressed

Event OnKeyPressed (KeyIndex: int32)
  → inputMgr.GetPositionByKeyIndex(KeyIndex) → Break Vector2D
  → Make Vector(X=X-960, Y=Y-275, Z=50)
  → SpawnSystemAtLocation(NS_KeyHit, location, AutoDestroy=true)
    → SetNiagaraVariableInt("User.BurstCount", 30)
    → SetNiagaraVariableLinearColor("User.Color", primaryColor)
    → Activate
```

---

## Effect archetypes

| Effect       | BurstCount | Lifetime | Speed  | Key modules                       |
|-------------|-----------|---------|-------|----------------------------------|
| Sparks       | 20–40     | 0.6–1.0 | 300   | Drag 3.0, Gravity −80           |
| Plasma       | 50–80     | 0.3–0.7 | 600   | Drag 6.0, Curl Noise Force      |
| Ice shards   | 15–25     | 1.2–2.0 | 200   | Drag 1.5, Gravity −30, Rotation |
| Fire embers  | rate 60/s | 0.8–1.4 | 120   | Drag 2.0, Dynamic Color Curve   |
| Lightning    | 8–16      | 0.2–0.4 | 900   | Drag 12.0, Ribbon Renderer      |
| Cosmic dust  | 40–60     | 2.0–3.0 | 80    | Drag 0.5, Curl Noise, Low grav  |

---

## AI skin generation

Users can generate a complete skin project with:

```bash
# CLI
cpro ue pak generate ./my-skin --prompt "Describe the effect" --name MySkin

# Web UI
cpro serve   # then open http://localhost:7777/generate.html

# VS Code task
# Ctrl+Shift+P → "cpro: Generate Interactive Skin"
```

The generator (powered by Claude) produces:
1. `Python/setup_interactive.py` — run in UE 5.3 editor Python console
2. `skin_concept.md` — asset creation guide
3. `skin_params.json` — effect parameters

Requires `ANTHROPIC_API_KEY` environment variable.

---

## CLI command reference

```bash
cpro ue pak init <dir>                     # scaffold UE 5.3 project template
cpro ue pak generate <dir> --prompt "…"   # AI-generate skin (requires ANTHROPIC_API_KEY)
cpro ue pak inspect <pak>                  # show asset manifest from a .pak file
cpro ue pak cook <project> -o dist/skin.pak
cpro ue pak upload <pak> --slot 0 [--host <ip>]
cpro ue pak preview                        # browser preview at localhost:7779
```

---

## When writing setup_interactive.py

- Import only `unreal` (always available in the UE Python environment)
- Create all assets via `unreal.AssetToolsHelpers` / factory classes
- Print progress with `unreal.log("[cpro-generate] …")`
- After creating any Niagara system, `unreal.log()` the exact module settings
  the user should apply in the Niagara editor (Python cannot set internal
  emitter module parameters directly in UE 4.27)
- End with `if __name__ == "__main__": main()`
- Never reference external files or URLs
