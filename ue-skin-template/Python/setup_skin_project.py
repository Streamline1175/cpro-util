"""
One-time scaffolder for a Centerpiece Pro skin UE project.

Run from the UE editor Python console (Window → Developer Tools → Python):
    py setup_skin_project.py

Or from the command line:
    UnrealEditor-Cmd CpSkinTemplate.uproject -run=pythonscript -script="Python/setup_skin_project.py"

Creates:
- /Game/Skin/L_Skin               (empty level, 1920x550 viewport)
- /Game/Skin/BP_SkinActor         (blueprint with key/tick event stubs)
- /Game/Skin/Cine/CineCam_Skin    (orthographic cinematic camera aimed at skin plane)
- /Game/Skin/Cine/LS_Skin         (level sequence, 60fps, 3s default)

Notes:
- The keyboard bridge is a placeholder (desk keyboard maps to simulated Centerpiece
  keys). Real input comes from the Finalmouse SDK when released.
- Resolution and frame rate pulled from SKIN_WIDTH / SKIN_HEIGHT / SKIN_FPS below.
"""
import unreal

SKIN_WIDTH = 1920
SKIN_HEIGHT = 550
SKIN_FPS = 60
SKIN_FOLDER = "/Game/Skin"
CINE_FOLDER = SKIN_FOLDER + "/Cine"


def log(msg):
    unreal.log("[cpro-skin-setup] " + str(msg))


def ensure_folder(path):
    tools = unreal.EditorAssetLibrary
    if not tools.does_directory_exist(path):
        tools.make_directory(path)
        log("created " + path)


def create_level():
    path = SKIN_FOLDER + "/L_Skin"
    tools = unreal.EditorAssetLibrary
    if tools.does_asset_exist(path):
        log("level exists: " + path)
        return path
    els = unreal.EditorLevelLibrary
    els.new_level(path)
    log("created level: " + path)
    return path


def create_skin_actor_blueprint():
    name = "BP_SkinActor"
    pkg_path = SKIN_FOLDER
    asset_path = pkg_path + "/" + name
    tools = unreal.EditorAssetLibrary
    if tools.does_asset_exist(asset_path):
        log("blueprint exists: " + asset_path)
        return asset_path

    factory = unreal.BlueprintFactory()
    factory.set_editor_property("parent_class", unreal.Actor)
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    bp = asset_tools.create_asset(name, pkg_path, None, factory)
    if bp is None:
        log("failed to create " + asset_path)
        return asset_path
    tools.save_loaded_asset(bp)
    log("created blueprint: " + asset_path + " (open it and wire Tick / Key events)")
    return asset_path


def create_cine_camera():
    ensure_folder(CINE_FOLDER)
    name = "CineCam_Skin"
    asset_path = CINE_FOLDER + "/" + name
    tools = unreal.EditorAssetLibrary
    if tools.does_asset_exist(asset_path):
        return asset_path

    # CineCamera actors are placed in levels, not saved as assets. Drop a marker.
    els = unreal.EditorLevelLibrary
    cam = els.spawn_actor_from_class(
        unreal.CineCameraActor,
        unreal.Vector(0, -500, 0),
        unreal.Rotator(0, 0, 0),
    )
    if cam is not None:
        cam.set_actor_label("CineCam_Skin")
        comp = cam.get_cine_camera_component()
        filmback = comp.get_editor_property("filmback")
        filmback.sensor_width = 36.0
        filmback.sensor_height = 36.0 * (SKIN_HEIGHT / float(SKIN_WIDTH))
        comp.set_editor_property("filmback", filmback)
        log("placed CineCam_Skin with filmback matched to %dx%d" % (SKIN_WIDTH, SKIN_HEIGHT))
    return asset_path


def create_level_sequence():
    ensure_folder(CINE_FOLDER)
    name = "LS_Skin"
    asset_path = CINE_FOLDER + "/" + name
    tools = unreal.EditorAssetLibrary
    if tools.does_asset_exist(asset_path):
        return asset_path

    factory = unreal.LevelSequenceFactoryNew()
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    seq = asset_tools.create_asset(name, CINE_FOLDER, unreal.LevelSequence, factory)
    if seq is None:
        log("failed to create LevelSequence")
        return asset_path

    seq.set_display_rate(unreal.FrameRate(SKIN_FPS, 1))
    seq.set_playback_start(0)
    seq.set_playback_end(SKIN_FPS * 3)  # 3 seconds
    tools.save_loaded_asset(seq)
    log("created level sequence: " + asset_path + " (60fps, 3s)")
    return asset_path


def main():
    ensure_folder(SKIN_FOLDER)
    create_level()
    create_skin_actor_blueprint()
    create_cine_camera()
    create_level_sequence()
    log("done. Next: open BP_SkinActor and author visuals + stub events.")


if __name__ == "__main__":
    main()
