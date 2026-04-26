import sharp from "sharp";
import { SPECS, type ConvertOptions, DEFAULT_OPTIONS } from "./specs.js";
import { planFit } from "./fit.js";

export interface ImageConversionResult {
  outputPath: string;
  width: number;
  height: number;
  bytes: number;
}

export async function convertImage(
  inputPath: string,
  outputPath: string,
  opts: Partial<ConvertOptions> = {},
): Promise<ImageConversionResult> {
  const options = { ...DEFAULT_OPTIONS, ...opts };
  const W = SPECS.width;
  const H = SPECS.height;

  const input = sharp(inputPath, { failOn: "none", animated: false }).rotate();
  const meta = await input.metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`Could not read dimensions for ${inputPath}`);
  }

  const plan = planFit(meta.width, meta.height, options.fit, options.cropX, options.cropY);

  let pipeline = input.resize(plan.scaleW, plan.scaleH, { kernel: "lanczos3", fit: "fill" });

  if (plan.padLeft > 0 || plan.padTop > 0) {
    pipeline = pipeline.extend({
      left: plan.padLeft,
      top: plan.padTop,
      right: W - plan.scaleW - plan.padLeft,
      bottom: H - plan.scaleH - plan.padTop,
      background: options.background,
    });
  } else if (plan.scaleW > W || plan.scaleH > H) {
    pipeline = pipeline.extract({
      left: plan.offsetX,
      top: plan.offsetY,
      width: W,
      height: H,
    });
  }

  const buf = await pipeline.png({ compressionLevel: 9 }).toBuffer();
  await (await import("node:fs/promises")).writeFile(outputPath, buf);

  return { outputPath, width: W, height: H, bytes: buf.length };
}
