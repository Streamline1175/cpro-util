"""
setup_interactive.py — Koi Fish Pond
=====================================
Centerpiece Pro interactive skin: a tranquil koi pond fills the 1920×550
canvas. Five koi fish swim autonomously using idle wandering AI. When any
key is pressed, a water ripple expands from that key's position; fish within
range are startled and flee, then gradually calm and resume wandering.

Run ONCE from the UE 4.27.2 editor Python console after building CpSkinAPI:

    import unreal, sys
    sys.path.insert(0, unreal.Paths.project_dir() + "/Python")
    import setup_interactive; setup_interactive.main()

What this creates
-----------------
  /Game/KoiFishPond/L_KoiFishPond   — working level (stream-loaded by entry)
  /Game/EntryPoint/L_EntryPoint     — boot map (DO NOT modify)
  /Game/KoiFishPond/M_WaterSurface  — deep teal pond material
  /Game/KoiFishPond/M_WaterRing     — thin ring material for ripple sprites
  /Game/KoiFishPond/NS_WaterRipple  — expanding concentric ring Niagara FX
  /Game/KoiFishPond/NS_FishSplash   — tiny water droplets when fish flees
  /Game/KoiFishPond/BP_KoiFish      — autonomous fish actor (wandering + flee AI)
  /Game/KoiFishPond/BP_PondManager  — key-event handler: ripple + scare logic

GPU budget
----------
  The Centerpiece GPU is ~first-gen Xbox/Wii equivalent.
  NS_WaterRipple:  3 ring particles per keypress    (well within budget)
  NS_FishSplash:   8 droplet particles per fish     (within budget)
  Peak live particles: ~43 (5×8 droplets + 3 rings)
"""

import unreal

SKIN_FOLDER  = "/Game/KoiFishPond"
ENTRY_FOLDER = "/Game/EntryPoint"
SKIN_LEVEL   = SKIN_FOLDER  + "/L_KoiFishPond"
ENTRY_LEVEL  = ENTRY_FOLDER + "/L_EntryPoint"
NUM_FISH     = 5


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def log(msg):
    unreal.log("[cpro-koi] " + str(msg))


def ensure_folder(path):
    lib = unreal.EditorAssetLibrary
    if not lib.does_directory_exist(path):
        lib.make_directory(path)
        log("  created folder: " + path)


def asset_exists(path):
    return unreal.EditorAssetLibrary.does_asset_exist(path)


# ---------------------------------------------------------------------------
# Levels
# ---------------------------------------------------------------------------

def create_entry_level():
    ensure_folder(ENTRY_FOLDER)
    if asset_exists(ENTRY_LEVEL):
        log("entry level already exists: " + ENTRY_LEVEL)
        return
    unreal.EditorLevelLibrary.new_level(ENTRY_LEVEL)
    log("created entry level: " + ENTRY_LEVEL)


def create_skin_level():
    ensure_folder(SKIN_FOLDER)
    if asset_exists(SKIN_LEVEL):
        log("skin level already exists: " + SKIN_LEVEL)
        return
    unreal.EditorLevelLibrary.new_level(SKIN_LEVEL)
    log("created skin level: " + SKIN_LEVEL)


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------

def create_water_surface_material():
    name = "M_WaterSurface"
    path = SKIN_FOLDER + "/" + name
    if asset_exists(path):
        log("M_WaterSurface already exists — skipping")
        return path

    factory = unreal.MaterialFactoryNew()
    tools   = unreal.AssetToolsHelpers.get_asset_tools()
    mat     = tools.create_asset(name, SKIN_FOLDER, unreal.Material, factory)
    if mat:
        unreal.EditorAssetLibrary.save_loaded_asset(mat)
        log("created: " + path)

    log("")
    log("=== M_WaterSurface — open in Material editor and build: ===")
    log("")
    log("  Blend Mode:    Opaque")
    log("  Shading Model: Default Lit")
    log("")
    log("  Node 1: Constant3Vector (0.008, 0.075, 0.13)")
    log("          → Base Color")
    log("          (deep midnight teal — dark pond water)")
    log("")
    log("  Node 2: Constant  0.88  → Metallic")
    log("  Node 3: Constant  0.06  → Roughness")
    log("          (near-mirror surface for water reflections)")
    log("")
    log("  OPTIONAL — animated water shimmer (adds ~2 shader instructions):")
    log("    a. TextureCoordinate  (Tiling U=5.0, V=1.5)")
    log("    b. Panner  (SpeedX=0.007, SpeedY=0.003)")
    log("    c. TextureSample  /Engine/EngineMaterials/T_Default_Material_Grid_N")
    log("       → Normal")
    log("    This adds a gentle shimmering ripple to the static pond surface.")
    log("")

    return path


def create_ring_material():
    name = "M_WaterRing"
    path = SKIN_FOLDER + "/" + name
    if asset_exists(path):
        log("M_WaterRing already exists — skipping")
        return path

    factory = unreal.MaterialFactoryNew()
    tools   = unreal.AssetToolsHelpers.get_asset_tools()
    mat     = tools.create_asset(name, SKIN_FOLDER, unreal.Material, factory)
    if mat:
        unreal.EditorAssetLibrary.save_loaded_asset(mat)
        log("created: " + path)

    log("")
    log("=== M_WaterRing — used by NS_WaterRipple Niagara sprites ===")
    log("")
    log("  Blend Mode:    Translucent")
    log("  Shading Model: Unlit")
    log("  Two Sided:     true")
    log("  Cast Shadows:  false")
    log("")
    log("  Graph (creates a thin circular ring from a billboard sprite):")
    log("")
    log("  1. TexCoord                             → UV")
    log("  2. UV - Constant2Vector(0.5, 0.5)       → centred UV")
    log("  3. Length(centred UV)                   → radial distance (0 centre, 0.5 edge)")
    log("  4. Abs(radialDist - 0.5)                → dist from ring edge")
    log("  5. OneMinus(above)                      → ring shape (high=on ring)")
    log("  6. Power(above, 12.0)                   → very sharp thin ring")
    log("  7. Power result × ParticleColor.RGB     → Emissive Color")
    log("  8. Power result × ParticleColor.A       → Opacity")
    log("")
    log("  Result: a crisp luminous ring that fades as Niagara decays alpha.")
    log("")

    return path


# ---------------------------------------------------------------------------
# Niagara systems
# ---------------------------------------------------------------------------

def create_ripple_niagara():
    name = "NS_WaterRipple"
    path = SKIN_FOLDER + "/" + name
    if asset_exists(path):
        log("NS_WaterRipple already exists — skipping")
        return path

    try:
        factory = unreal.NiagaraSystemFactoryNew()
        tools   = unreal.AssetToolsHelpers.get_asset_tools()
        ns      = tools.create_asset(name, SKIN_FOLDER, unreal.NiagaraSystem, factory)
        if ns:
            unreal.EditorAssetLibrary.save_loaded_asset(ns)
            log("created Niagara system: " + path)
        else:
            log("WARNING: NiagaraSystem returned None — Niagara plugin may be off.")
    except Exception as exc:
        log("WARNING: could not create NS_WaterRipple: " + str(exc))

    log("")
    log("=== NS_WaterRipple — configure in the Niagara editor ===")
    log("")
    log("  System Settings:")
    log("    Sim Target:    CPU Sim")
    log("    Fixed Bounds:  ON  Min(-200,-200,-2)  Max(200,200,2)")
    log("")
    log("  EMITTER 'Rings':")
    log("  ┌─ Emitter State")
    log("  │    Life Cycle Mode: Self")
    log("  │    Inactive Response: Complete")
    log("  │")
    log("  ├─ Spawn Burst Instantaneous")
    log("  │    SpawnCount: 3          ← 3 concentric rings per keypress")
    log("  │")
    log("  ├─ Initialize Particle")
    log("  │    Lifetime: RandomRange(0.4, 1.8)")
    log("  │      (staggered lifetimes give cascading ring effect)")
    log("  │    Sprite Size Mode: Uniform")
    log("  │    Sprite Size: 4.0  (tiny at birth — scaled up below)")
    log("  │    Color: User.RippleColor  (link to user param)")
    log("  │")
    log("  ├─ Scale Sprite Size  (add via + → Size → Scale Sprite Size)")
    log("  │    Scale Factor: Float Curve")
    log("  │      Key 0.0 → 1.0   (tiny at birth)")
    log("  │      Key 1.0 → 58.0  (expands to ~232px radius at death)")
    log("  │    Curve tangents: Linear (not smoothstep)")
    log("  │    Multiply by User.RippleScale parameter")
    log("  │")
    log("  ├─ Scale Color  (alpha envelope)")
    log("  │    Alpha curve:")
    log("  │      Key 0.00 → 0.0   (born invisible)")
    log("  │      Key 0.12 → 1.0   (snap to full visibility)")
    log("  │      Key 1.00 → 0.0   (fades to nothing)")
    log("  │")
    log("  └─ Sprite Renderer")
    log("       Material:    M_WaterRing")
    log("       Alignment:   View Facing  (always face camera)")
    log("       Sort Mode:   View Depth")
    log("")
    log("  USER PARAMETERS (System > User Parameters):")
    log("    User.RippleColor   LinearColor  default (0.62, 0.86, 1.0, 1.0)")
    log("    User.RippleScale   float        default 1.0")
    log("")

    return path


def create_splash_niagara():
    name = "NS_FishSplash"
    path = SKIN_FOLDER + "/" + name
    if asset_exists(path):
        log("NS_FishSplash already exists — skipping")
        return path

    try:
        factory = unreal.NiagaraSystemFactoryNew()
        tools   = unreal.AssetToolsHelpers.get_asset_tools()
        ns      = tools.create_asset(name, SKIN_FOLDER, unreal.NiagaraSystem, factory)
        if ns:
            unreal.EditorAssetLibrary.save_loaded_asset(ns)
            log("created Niagara system: " + path)
        else:
            log("WARNING: NiagaraSystem returned None.")
    except Exception as exc:
        log("WARNING: could not create NS_FishSplash: " + str(exc))

    log("")
    log("=== NS_FishSplash — tiny water droplet burst when a fish is startled ===")
    log("")
    log("  EMITTER 'Droplets':")
    log("  ├─ Spawn Burst Instantaneous:  SpawnCount = 8")
    log("  ├─ Initialize Particle")
    log("  │    Lifetime: RandomRange(0.25, 0.45)")
    log("  │    Color:    (0.78, 0.93, 1.0, 1.0)  ← pale water-drop")
    log("  │    Sprite Size: RandomRange(2.0, 5.0)")
    log("  ├─ Add Velocity (Sphere Random)")
    log("  │    Speed Min: 55    Speed Max: 150")
    log("  ├─ Drag        value = 4.5")
    log("  ├─ Gravity Force  Z = -110")
    log("  ├─ Scale Color  Alpha: 1.0 → 0.0  (linear fade)")
    log("  └─ Sprite Renderer  (default additive sprite material is fine)")
    log("")

    return path


# ---------------------------------------------------------------------------
# Blueprints
# ---------------------------------------------------------------------------

def create_koi_fish_bp():
    name = "BP_KoiFish"
    path = SKIN_FOLDER + "/" + name
    if asset_exists(path):
        log("BP_KoiFish already exists — skipping")
        return path

    factory = unreal.BlueprintFactory()
    factory.set_editor_property("parent_class", unreal.Actor)
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    bp    = tools.create_asset(name, SKIN_FOLDER, None, factory)
    if bp:
        unreal.EditorAssetLibrary.save_loaded_asset(bp)
        log("created: " + path)

    log("")
    log("=" * 62)
    log("BP_KoiFish — complete Blueprint wiring guide")
    log("=" * 62)
    log("")
    log("COMPONENTS:")
    log("  Root: DefaultSceneRoot")
    log("  Child: BillboardComponent")
    log("    Sprite: any small texture (64×32 px koi silhouette preferred)")
    log("    OR: StaticMeshComponent using a plane mesh, scaled 0.60 × 0.28")
    log("    The Billboard/Mesh uses fishColor as the material tint.")
    log("")
    log("VARIABLES (add via My Blueprint → + Variable):")
    log("  swimSpeed      float  = 110.0       calm cruising speed (units/s)")
    log("  fleeSpeed      float  = 360.0       frightened escape speed")
    log("  scaredTimer    float  = 0.0         countdown; >0 means fleeing")
    log("  targetPos      Vector = (0,0,5)     current destination")
    log("  swimPhase      float  = 0.0         sine accumulator for body wiggle")
    log("  fishColor      LinearColor = (1.0, 0.28, 0.04, 1.0)  [orange koi]")
    log("  splashFX       Object Ref (Niagara System) → NS_FishSplash")
    log("")
    log("EVENT GRAPH:")
    log("")
    log("── [Event BeginPlay] ─────────────────────────────────────────")
    log("  RandomFloatInRange(-800, 800)  → tX")
    log("  RandomFloatInRange(-220, 220)  → tY")
    log("  MakeVector(tX, tY, 5.0)        → Set targetPos")
    log("  SetActorLocation(targetPos)")
    log("  RandomFloatInRange(0.0, 6.28)  → Set swimPhase  (unique start phase)")
    log("")
    log("── [Event Tick]  (DeltaSeconds: float) ──────────────────────")
    log("")
    log("  ▶ Determine speed")
    log("    Branch scaredTimer > 0")
    log("      True  → currentSpeed = fleeSpeed")
    log("              scaredTimer = Max(0, scaredTimer - DeltaSeconds)")
    log("      False → currentSpeed = swimSpeed")
    log("")
    log("  ▶ Advance body-wiggle phase")
    log("    swimPhase += DeltaSeconds × 2.9")
    log("    wiggleAmt = Sin(swimPhase) × 16.0")
    log("")
    log("  ▶ Compute heading 2D")
    log("    myLoc     = GetActorLocation")
    log("    toTarget  = Make2D(targetPos.X - myLoc.X, targetPos.Y - myLoc.Y)")
    log("    heading   = Normalize2D(toTarget)")
    log("")
    log("  ▶ Perpendicular offset (fish body undulation)")
    log("    perp = Make2D(-heading.Y, heading.X)")
    log("    offsetX = perp.X × wiggleAmt")
    log("    offsetY = perp.Y × wiggleAmt")
    log("")
    log("  ▶ Move toward (target + wiggle)")
    log("    effectiveTarget = MakeVector(")
    log("        targetPos.X + offsetX,")
    log("        targetPos.Y + offsetY,")
    log("        5.0)")
    log("    dir3D  = Normalize(effectiveTarget - myLoc)")
    log("    newLoc = myLoc + (dir3D × currentSpeed × DeltaSeconds)")
    log("    SetActorLocation(newLoc)")
    log("")
    log("  ▶ Face direction of travel")
    log("    rot = MakeRotFromX(dir3D)")
    log("    SetActorRotation(rot)")
    log("")
    log("  ▶ Clamp to pond bounds")
    log("    clampedX = Clamp(newLoc.X, -920, 920)")
    log("    clampedY = Clamp(newLoc.Y, -252, 252)")
    log("    SetActorLocation(MakeVector(clampedX, clampedY, 5.0))")
    log("")
    log("  ▶ Pick new wander target when close")
    log("    dist2D = VectorLength2D(targetPos.XY - GetActorLocation.XY)")
    log("    Branch dist2D < 65.0")
    log("      True →")
    log("        RandomFloatInRange(-830, 830)  → newTX")
    log("        RandomFloatInRange(-235, 235)  → newTY")
    log("        Set targetPos = MakeVector(newTX, newTY, 5.0)")
    log("")
    log("── [Custom Event: Scare]  inputs: ScareOrigin (Vector) ──────")
    log("")
    log("  1. Set scaredTimer = 2.8")
    log("  2. awayDir = Normalize(GetActorLocation - ScareOrigin)")
    log("  3. fleeX = Clamp(GetActorLocation.X + awayDir.X × 540, -900, 900)")
    log("     fleeY = Clamp(GetActorLocation.Y + awayDir.Y × 540, -245, 245)")
    log("  4. Set targetPos = MakeVector(fleeX, fleeY, 5.0)")
    log("  5. SpawnSystemAtLocation(")
    log("       NSS = splashFX,")
    log("       Location = GetActorLocation,")
    log("       AutoDestroy = true)")
    log("     → Activate")
    log("")
    log("  The Tick event drives all movement — Scare just re-aims the fish.")
    log("")

    return path


def create_pond_manager_bp():
    name = "BP_PondManager"
    path = SKIN_FOLDER + "/" + name
    if asset_exists(path):
        log("BP_PondManager already exists — skipping")
        return path

    factory = unreal.BlueprintFactory()
    factory.set_editor_property("parent_class", unreal.Actor)
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    bp    = tools.create_asset(name, SKIN_FOLDER, None, factory)
    if bp:
        unreal.EditorAssetLibrary.save_loaded_asset(bp)
        log("created: " + path)

    log("")
    log("=" * 62)
    log("BP_PondManager — complete Blueprint wiring guide")
    log("=" * 62)
    log("")
    log("VARIABLES:")
    log("  inputMgr    Object Ref (BP_InputEventManager)  = None")
    log("  rippleFX    Object Ref (NiagaraSystem)         → NS_WaterRipple")
    log("  fishActors  Array<Object Ref (BP_KoiFish)>     = []")
    log("  scareRadius float = 450.0  (units; ~¼ of 1920 width)")
    log("")
    log("── [Event BeginPlay] ─────────────────────────────────────────")
    log("  1. GetActorOfClass(BP_InputEventManager)  → Set inputMgr")
    log("  2. inputMgr.OnKeyboardPressedEvent")
    log("        .AddDynamic(self, FunctionName='OnKeyPressed')")
    log("  3. GetAllActorsOfClass(BP_KoiFish)  → Set fishActors")
    log("     (auto-discovers all fish placed in the level)")
    log("")
    log("── [Custom Event: OnKeyPressed]  KeyIndex: int32 ────────────")
    log("")
    log("  ▶ Key → world position")
    log("    inputMgr.GetPositionByKeyIndex(KeyIndex)")
    log("    → BreakVector2D(X, Y)")
    log("    → rippleOrigin = MakeVector(X - 960.0, Y - 275.0, 0.0)")
    log("")
    log("  ▶ Spawn expanding ripple rings")
    log("    SpawnSystemAtLocation(")
    log("        NSS    = rippleFX  (load from Object Ref),")
    log("        Location = rippleOrigin,")
    log("        Rotation = (0,0,0),")
    log("        AutoDestroy = true)")
    log("    → comp (UNiagaraComponent)")
    log("        SetNiagaraVariableLinearColor(")
    log("            'User.RippleColor', (0.62, 0.86, 1.0, 1.0))")
    log("        SetNiagaraVariableFloat('User.RippleScale', 1.0)")
    log("        Activate")
    log("")
    log("  ▶ ForEach Loop  (Array = fishActors)")
    log("      fish  = Array Element")
    log("      dist  = VectorLength(fish.GetActorLocation - rippleOrigin)")
    log("      Branch dist < scareRadius")
    log("        True →")
    log("          CastToBP_KoiFish(fish)")
    log("          → Call Scare(ScareOrigin = rippleOrigin)")
    log("")

    return path


# ---------------------------------------------------------------------------
# Level setup instructions
# ---------------------------------------------------------------------------

def print_level_setup():
    log("")
    log("=" * 62)
    log("L_KoiFishPond — LEVEL SETUP GUIDE")
    log("=" * 62)
    log("")
    log("Open L_KoiFishPond in the UE level editor, then:")
    log("")
    log("1. WATER SURFACE PLANE")
    log("   Place → Basic → Plane")
    log("   Location:  (0, 0, -2)")
    log("   Scale:     (19.20, 5.50, 1.0)   ← exactly fills the 1920×550 canvas")
    log("   Material:  M_WaterSurface")
    log("")
    log("2. POND MANAGER")
    log("   Drag BP_PondManager from Content Browser into the level.")
    log("   Location: (0, 0, 0)")
    log("   Details panel: assign rippleFX → NS_WaterRipple")
    log("   (fishActors array is populated automatically via GetAllActorsOfClass)")
    log("")
    log("3. KOI FISH — place 5 BP_KoiFish actors")
    log("   Each fish wanders autonomously; exact spawn positions don't matter.")
    log("   Suggested positions and colours:")
    log("")
    log("   Fish 1  Location(-680, -140, 5)  fishColor(1.00, 0.28, 0.03, 1.0) orange")
    log("   Fish 2  Location(-220,  120, 5)  fishColor(1.00, 0.55, 0.05, 1.0) gold")
    log("   Fish 3  Location(  80,  -80, 5)  fishColor(1.00, 1.00, 1.00, 1.0) white")
    log("   Fish 4  Location( 420,  160, 5)  fishColor(0.85, 0.15, 0.08, 1.0) red")
    log("   Fish 5  Location( 760, -170, 5)  fishColor(0.90, 0.45, 0.00, 1.0) tangerine")
    log("")
    log("   For each fish, set fishColor in the Details panel.")
    log("   For the visible mesh: a small plane (60×25 units) with a simple")
    log("   translucent material whose base colour is driven by fishColor works")
    log("   great at this GPU budget. A koi silhouette texture makes it perfect.")
    log("")
    log("4. CAMERA — top-down orthographic")
    log("   Place a Camera Actor:")
    log("   Location:  (0, 0, 560)")
    log("   Rotation:  (-90, 0, 0)   ← looking straight down")
    log("   Projection: Orthographic")
    log("   Ortho Width: 1920")
    log("   Make this the default PlayerStart / lock it in GameMode settings.")
    log("")
    log("5. LIGHTING — dark pond ambiance")
    log("   Delete or disable the default Sky Sphere and Atmospheric Sky.")
    log("   Add SkyLight:")
    log("     Intensity: 0.35")
    log("     Light Color: (0.5, 0.7, 1.0)  ← cool blue overcast sky")
    log("   Add PointLight (above the scene):")
    log("     Location:  (0, 0, 400)")
    log("     Intensity: 1.8  Color: (1.0, 0.95, 0.85)  ← warm sunlight")
    log("   Disable Contact Shadows, RTX, and Screen-Space Reflections")
    log("   (these exceed the GPU budget).")
    log("")
    log("6. LEVEL STREAMING")
    log("   Open L_EntryPoint:")
    log("   Window → Levels → Add Existing → select L_KoiFishPond")
    log("   Set streaming state to: Always Loaded")
    log("")
    log("7. TEST IN EDITOR")
    log("   Play-in-Editor → press keyboard keys → ripples should appear")
    log("   at each key's canvas position and nearby fish should scatter.")
    log("")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    log("=" * 62)
    log("Koi Fish Pond — Centerpiece Pro interactive skin")
    log("cpro-util AI skin generator")
    log("=" * 62)
    log("")

    create_entry_level()
    create_skin_level()
    create_water_surface_material()
    create_ring_material()
    create_ripple_niagara()
    create_splash_niagara()
    create_koi_fish_bp()
    create_pond_manager_bp()
    print_level_setup()

    log("")
    log("=" * 62)
    log("COMPLETE — all assets created in /Game/KoiFishPond/")
    log("=" * 62)
    log("")
    log("Pre-cook checklist:")
    log("  [ ] M_WaterSurface graph built in Material editor")
    log("  [ ] M_WaterRing graph built in Material editor")
    log("  [ ] NS_WaterRipple emitter configured (ring scale curve + user params)")
    log("  [ ] NS_FishSplash emitter configured")
    log("  [ ] BP_KoiFish Tick + Scare events wired")
    log("  [ ] BP_PondManager BeginPlay + OnKeyPressed wired")
    log("  [ ] L_KoiFishPond populated (plane, 5 fish, manager, camera)")
    log("  [ ] L_EntryPoint streams L_KoiFishPond (Always Loaded)")
    log("")
    log("Cook and deploy:")
    log("  cpro ue pak cook ./KoiFishPond")
    log("  cpro ue pak upload dist/skin.pak --slot 0")


if __name__ == "__main__":
    main()
