"""
Headlessly render /Game/Skin/Cine/LS_Skin at 1920x550@60fps to a ProRes .mov.

Invoked by `cpro ue export`. Writes to the path supplied via the CPRO_OUT env
var; defaults to ./Saved/SkinExport/skin_source.mov. The JS wrapper then pipes
the output through ffmpeg to produce a spec-compliant .mp4 skin.

Run from the command line:
    UnrealEditor-Cmd CpSkinTemplate.uproject -run=pythonscript -script="Python/render_skin.py"
"""
import os
import sys
import unreal

SKIN_WIDTH = 1920
SKIN_HEIGHT = 550
SKIN_FPS = 60
LEVEL_PATH = "/Game/Skin/L_Skin"
SEQUENCE_PATH = "/Game/Skin/Cine/LS_Skin"


def log(msg):
    unreal.log("[cpro-skin-render] " + str(msg))


def resolve_output():
    out = os.environ.get("CPRO_OUT")
    if out:
        return out
    project_dir = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
    return os.path.join(project_dir, "Saved", "SkinExport", "skin_source.mov")


def build_preset():
    preset = unreal.MoviePipelineMasterConfig()
    preset.find_or_add_setting_by_class(unreal.MoviePipelineDeferredPassBase)

    out_setting = preset.find_or_add_setting_by_class(unreal.MoviePipelineOutputSetting)
    out_setting.output_resolution = unreal.IntPoint(SKIN_WIDTH, SKIN_HEIGHT)
    out_setting.output_frame_rate = unreal.FrameRate(SKIN_FPS, 1)
    out_setting.use_custom_frame_rate = True

    out_path = resolve_output()
    out_setting.output_directory = unreal.DirectoryPath(os.path.dirname(out_path))
    out_setting.file_name_format = os.path.splitext(os.path.basename(out_path))[0]

    preset.find_or_add_setting_by_class(unreal.MoviePipelineAppleProResOutput)
    return preset, out_path


def main():
    subsystem = unreal.get_editor_subsystem(unreal.MoviePipelineQueueSubsystem)
    queue = subsystem.get_queue()
    queue.delete_all_jobs()

    job = queue.allocate_new_job(unreal.MoviePipelineExecutorJob)
    job.sequence = unreal.SoftObjectPath(SEQUENCE_PATH)
    job.map = unreal.SoftObjectPath(LEVEL_PATH)

    preset, out_path = build_preset()
    job.set_configuration(preset)

    log("rendering " + SEQUENCE_PATH + " → " + out_path + " ({}x{}@{}fps)".format(SKIN_WIDTH, SKIN_HEIGHT, SKIN_FPS))

    executor = subsystem.render_queue_with_executor(unreal.MoviePipelinePIEExecutor)
    if executor is None:
        log("executor returned None — render may have failed to start")
        sys.exit(2)

    # Mark a marker file so the Node wrapper knows where to find the output.
    marker = os.path.join(os.path.dirname(out_path), ".cpro_out_path")
    os.makedirs(os.path.dirname(marker), exist_ok=True)
    with open(marker, "w") as fh:
        fh.write(out_path)
    log("wrote marker " + marker)


if __name__ == "__main__":
    main()
