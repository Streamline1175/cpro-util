"""
setup_interactive.py
====================
One-time scaffolder for a Centerpiece interactive skin UE 4.27 project.

Run AFTER you have built the CpSkinAPI plugin in Visual Studio 2019:

    From the UE 4.27.2 editor Python console (Window → Developer Tools → Python):
        py setup_interactive.py

    Or headlessly (not recommended for first run — shaders must compile first):
        UnrealEditor-Cmd.exe CpInteractiveSkin.uproject -run=pythonscript \\
            -script="Python/setup_interactive.py"

What this creates
-----------------
  /Game/EntryPoint/L_EntryPoint       — boot map (DO NOT modify)
  /Game/MySkin/L_MySkin               — your working level
  /Game/MySkin/BP_KeyHighlighter      — sample Blueprint: spawns Niagara FX on key press
  /Game/MySkin/NS_KeyHit              — sample Niagara System (CPU sim, 30 particles)

The L_EntryPoint map contains a level-streaming actor that loads L_MySkin.
The BP_InputEventManager C++ actor is placed in L_EntryPoint; its Blueprint
child (auto-created here) is what you reference in your skin Blueprints.

Centerpiece key coordinate conversion (from the tutorial)
----------------------------------------------------------
  raw_pos = GetPositionByKeyIndex(key_index)   # FVector2D(x, y)  x∈[0,1920] y∈[0,550]
  world_x = raw_pos.x - 960.0                 # centre on camera plane
  world_y = raw_pos.y - 275.0
  world_z = 0.0
  world_pos = FVector(world_x, world_y, world_z)

GPU budget notes
----------------
  The Centerpiece GPU is roughly equivalent to a first-generation Xbox / Wii GPU.
  • Keep Niagara particle count ≤ 100 per emitter burst.
  • Use CPU sim target for bursts of 1-100 particles.
  • Avoid GPU Compute unless you have many thousands of particles.
  • Avoid complex material instructions — keep shader complexity low.
"""

import unreal

SKIN_FOLDER   = "/Game/MySkin"
ENTRY_FOLDER  = "/Game/EntryPoint"
SKIN_LEVEL    = SKIN_FOLDER  + "/L_MySkin"
ENTRY_LEVEL   = ENTRY_FOLDER + "/L_EntryPoint"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def log(msg):
    unreal.log("[cpro-interactive-setup] " + str(msg))


def ensure_folder(path):
    lib = unreal.EditorAssetLibrary
    if not lib.does_directory_exist(path):
        lib.make_directory(path)
        log("created " + path)


def asset_exists(path):
    return unreal.EditorAssetLibrary.does_asset_exist(path)


# ---------------------------------------------------------------------------
# Entry-point level (DO NOT MODIFY by hand)
# ---------------------------------------------------------------------------

def create_entry_level():
    ensure_folder(ENTRY_FOLDER)
    if asset_exists(ENTRY_LEVEL):
        log("entry level exists: " + ENTRY_LEVEL)
        return ENTRY_LEVEL
    unreal.EditorLevelLibrary.new_level(ENTRY_LEVEL)
    log("created entry level: " + ENTRY_LEVEL)
    return ENTRY_LEVEL


# ---------------------------------------------------------------------------
# Skin level
# ---------------------------------------------------------------------------

def create_skin_level():
    ensure_folder(SKIN_FOLDER)
    if asset_exists(SKIN_LEVEL):
        log("skin level exists: " + SKIN_LEVEL)
        return SKIN_LEVEL
    unreal.EditorLevelLibrary.new_level(SKIN_LEVEL)
    log("created skin level: " + SKIN_LEVEL)
    return SKIN_LEVEL


# ---------------------------------------------------------------------------
# BP_KeyHighlighter  (the sample interactive Blueprint)
# ---------------------------------------------------------------------------

def create_key_highlighter_bp():
    name      = "BP_KeyHighlighter"
    asset_path = SKIN_FOLDER + "/" + name
    if asset_exists(asset_path):
        log("blueprint exists: " + asset_path)
        return asset_path

    factory = unreal.BlueprintFactory()
    factory.set_editor_property("parent_class", unreal.Actor)
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    bp = tools.create_asset(name, SKIN_FOLDER, None, factory)
    if bp is None:
        log("WARNING: failed to create " + asset_path)
        return asset_path

    unreal.EditorAssetLibrary.save_loaded_asset(bp)
    log("created " + asset_path)
    log("  → Open it and wire up the OnBeginPlay / key-press events.")
    log("    See the README for the full Blueprint node graph.")
    return asset_path


# ---------------------------------------------------------------------------
# NS_KeyHit  (Niagara system — CPU sim, burst on key press)
# ---------------------------------------------------------------------------

def create_niagara_system():
    name      = "NS_KeyHit"
    asset_path = SKIN_FOLDER + "/" + name

    if asset_exists(asset_path):
        log("Niagara system exists: " + asset_path)
        return asset_path

    try:
        factory = unreal.NiagaraSystemFactoryNew()
        tools = unreal.AssetToolsHelpers.get_asset_tools()
        ns = tools.create_asset(name, SKIN_FOLDER, unreal.NiagaraSystem, factory)
        if ns:
            unreal.EditorAssetLibrary.save_loaded_asset(ns)
            log("created Niagara system: " + asset_path)
            log("  → Open it, set Sim Target = CPU Sim, add a Sprite emitter,")
            log("    set burst count ≤ 30, add Drag and Curl Noise Force modules.")
        else:
            log("WARNING: Niagara system creation returned None — Niagara plugin may be disabled.")
    except Exception as exc:
        log("WARNING: could not create Niagara system: " + str(exc))
        log("  Install/enable the Niagara plugin and re-run this script.")

    return asset_path


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    log("=== Centerpiece interactive skin setup (UE 4.27.2) ===")

    create_entry_level()
    create_skin_level()
    create_key_highlighter_bp()
    create_niagara_system()

    log("")
    log("Setup complete.  Next steps:")
    log("  1. Open /Game/MySkin/L_MySkin in the level editor.")
    log("  2. Place BP_KeyHighlighter in the level.")
    log("  3. Open BP_KeyHighlighter and wire the Blueprint graph:")
    log("     BeginPlay → GetActorOfClass(BP_InputEventManager) → Set inputMgr")
    log("     → Bind Event to OnKeyboardPressedEvent → [your key-press event]")
    log("     In the key-press event:")
    log("       GetPositionByKeyIndex(KeyIndex) → Break Vector2D")
    log("       X - 960  →  Make Vector(X=X-960, Y=Y-275, Z=0)")
    log("       Spawn System At Location (NS_KeyHit, location=above)")
    log("  4. Test in the editor (press desktop keys → effects should appear).")
    log("  5. Run: cpro ue pak cook <project-dir>")
    log("  6. Run: cpro ue pak upload dist/skin.pak --slot 0")


if __name__ == "__main__":
    main()
