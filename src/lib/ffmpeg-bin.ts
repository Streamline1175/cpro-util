import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

export const FFMPEG: string = (ffmpegStatic as unknown as string) ?? "ffmpeg";
export const FFPROBE: string = ffprobeStatic.path ?? "ffprobe";
