import { SPECS, type FitStrategy } from "./specs.js";

export interface FitPlan {
  scaleW: number;
  scaleH: number;
  offsetX: number;
  offsetY: number;
  padLeft: number;
  padTop: number;
}

/**
 * Given source dimensions and a fit strategy, compute how the source should be
 * scaled and positioned inside a 1920x550 canvas.
 */
export function planFit(srcW: number, srcH: number, strategy: FitStrategy, cropX = 0.5, cropY = 0.5): FitPlan {
  const W = SPECS.width;
  const H = SPECS.height;

  if (strategy === "stretch") {
    return { scaleW: W, scaleH: H, offsetX: 0, offsetY: 0, padLeft: 0, padTop: 0 };
  }

  const srcRatio = srcW / srcH;
  const dstRatio = W / H;

  if (strategy === "cover") {
    let scaleW: number, scaleH: number;
    if (srcRatio > dstRatio) {
      scaleH = H;
      scaleW = Math.round(H * srcRatio);
    } else {
      scaleW = W;
      scaleH = Math.round(W / srcRatio);
    }
    const maxOffsetX = Math.max(0, scaleW - W);
    const maxOffsetY = Math.max(0, scaleH - H);
    const offsetX = Math.round(maxOffsetX * clamp01(cropX));
    const offsetY = Math.round(maxOffsetY * clamp01(cropY));
    return { scaleW, scaleH, offsetX, offsetY, padLeft: 0, padTop: 0 };
  }

  // contain
  let scaleW: number, scaleH: number;
  if (srcRatio > dstRatio) {
    scaleW = W;
    scaleH = Math.round(W / srcRatio);
  } else {
    scaleH = H;
    scaleW = Math.round(H * srcRatio);
  }
  scaleW = ensureEven(Math.min(scaleW, W));
  scaleH = ensureEven(Math.min(scaleH, H));
  const padLeft = Math.round((W - scaleW) / 2);
  const padTop = Math.round((H - scaleH) / 2);
  return { scaleW, scaleH, offsetX: 0, offsetY: 0, padLeft, padTop };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function ensureEven(v: number): number {
  return v % 2 === 0 ? v : v - 1;
}

/**
 * ffmpeg -vf filter chain for a fit plan. Output is exactly 1920x550.
 */
export function ffmpegVideoFilter(plan: FitPlan, background: string): string {
  const { scaleW, scaleH, offsetX, offsetY, padLeft, padTop } = plan;
  const W = SPECS.width;
  const H = SPECS.height;

  if (padLeft > 0 || padTop > 0) {
    const bg = background.replace("#", "0x");
    return `scale=${scaleW}:${scaleH}:flags=lanczos,pad=${W}:${H}:${padLeft}:${padTop}:color=${bg},setsar=1`;
  }
  if (scaleW > W || scaleH > H) {
    return `scale=${scaleW}:${scaleH}:flags=lanczos,crop=${W}:${H}:${offsetX}:${offsetY},setsar=1`;
  }
  return `scale=${W}:${H}:flags=lanczos,setsar=1`;
}
