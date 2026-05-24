/**
 * hid-device.ts
 *
 * Cross-platform HID communication with the Finalmouse Centerpiece keyboard.
 *
 * Protocol (reverse-engineered by the community — LeiterConsulting/finalmouse_centerpiece):
 *   Device VID/PID : 0x361D : 0x0202
 *   Report length  : 1024 bytes
 *   Frame header   : [report_id=0x01, payload_len_low, payload_len_high, msg_type, ...payload]
 *   0x30 OUT : slot switch  — 1-byte payload (try 1-based then 0-based)
 *   0x08 OUT : metadata request
 *   0x07 IN  : preview PNG chunks (chunk index in payload bytes 1-2)
 *   0x10 OUT : asset upload stream (JSON metadata frame + raw file bytes)
 *   0x20 IN  : upload completion status
 *
 * node-hid is listed as an optionalDependency so that the app runs normally
 * even if native compilation fails. All exports gracefully return null / false
 * when the module is unavailable.
 */

import { createHash } from "node:crypto";

// ── Constants ────────────────────────────────────────────────────────────────

export const CENTERPIECE_VID = 0x361d;
export const CENTERPIECE_PID = 0x0202;

const REPORT_LEN = 1024;
const FRAME_HEADER_LEN = 4;
const MAX_PAYLOAD = REPORT_LEN - FRAME_HEADER_LEN;
const SLOT_COUNT = 5;

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IEND = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

// ── Lazy-load node-hid ───────────────────────────────────────────────────────

type HidStatic = typeof import("node-hid");
type HidDevice = import("node-hid").HID;

let _hid: HidStatic | null | "unresolved" = "unresolved";

async function getHid(): Promise<HidStatic | null> {
  if (_hid !== "unresolved") return _hid;
  try {
    _hid = (await import("node-hid")).default as unknown as HidStatic;
  } catch {
    _hid = null;
  }
  return _hid;
}

// ── Device discovery ─────────────────────────────────────────────────────────

export interface DeviceInfo {
  path: string;
  interface: number;
}

export async function listConnectedDevices(): Promise<DeviceInfo[]> {
  const hid = await getHid();
  if (!hid) return [];
  const devs = hid.devices(CENTERPIECE_VID, CENTERPIECE_PID);
  return devs
    .filter((d) => !!d.path)
    .map((d) => ({ path: d.path!, interface: d.interface ?? -1 }));
}

export async function isConnected(): Promise<boolean> {
  const devs = await listConnectedDevices();
  return devs.length > 0;
}

/** Opens the best HID interface for control commands. Prefers MI_01. */
async function openControlDevice(): Promise<HidDevice | null> {
  const hid = await getHid();
  if (!hid) return null;
  const devs = hid.devices(CENTERPIECE_VID, CENTERPIECE_PID);
  if (devs.length === 0) return null;

  // Prefer MI_01 (interface 1) — confirmed to handle slot switch + preview
  const preferred =
    devs.find((d) => d.path?.toUpperCase().includes("MI_01")) ??
    devs.find((d) => (d.interface ?? -1) === 1) ??
    devs[0];

  if (!preferred.path) return null;
  try {
    return new hid.HID(preferred.path);
  } catch {
    // Try fallback interfaces if preferred fails
    for (const d of devs) {
      if (!d.path || d.path === preferred.path) continue;
      try { return new hid.HID(d.path); } catch { /* next */ }
    }
    return null;
  }
}

// ── HID framing helpers ──────────────────────────────────────────────────────

function makeReport(msgType: number, payload: Buffer = Buffer.alloc(0)): number[] {
  if (payload.length > MAX_PAYLOAD) throw new Error("HID payload too large");
  const rep = Buffer.alloc(REPORT_LEN, 0);
  rep[0] = 0x01; // report ID
  rep[1] = payload.length & 0xff;
  rep[2] = (payload.length >> 8) & 0xff;
  rep[3] = msgType & 0xff;
  payload.copy(rep, FRAME_HEADER_LEN);
  return Array.from(rep);
}

interface ParsedFrame {
  msgType: number;
  payload: Buffer;
}

function parseFrame(data: Buffer | number[]): ParsedFrame | null {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length < FRAME_HEADER_LEN) return null;
  const payloadLen = buf[1] + buf[2] * 256;
  if (payloadLen > buf.length - FRAME_HEADER_LEN) return null;
  return {
    msgType: buf[3],
    payload: buf.slice(FRAME_HEADER_LEN, FRAME_HEADER_LEN + payloadLen),
  };
}

// ── Slot selection ───────────────────────────────────────────────────────────

export interface SelectSlotResult {
  ok: boolean;
  slot: number;
  /** Which payload value the device responded to (1-based or 0-based). */
  usedPayload?: number;
  error?: string;
}

/**
 * Switch the active Centerpiece slot via HID.
 * Tries both 1-based (slot) and 0-based (slot-1) payload conventions.
 */
export async function selectSlot(
  slotOneBased: number,
  opts: { timeoutMs?: number } = {},
): Promise<SelectSlotResult> {
  if (slotOneBased < 1 || slotOneBased > SLOT_COUNT) {
    return { ok: false, slot: slotOneBased, error: `Slot must be 1–${SLOT_COUNT}` };
  }

  const dev = await openControlDevice();
  if (!dev) {
    return { ok: false, slot: slotOneBased, error: "Centerpiece keyboard not found via HID" };
  }

  const settleMs = 50;
  // The device firmware varies: some use 1-based payload, some 0-based.
  // Try both; we emit 0x30 for each candidate and optionally verify via 0x07.
  const candidates = Array.from(new Set([slotOneBased, slotOneBased - 1])).filter(
    (v) => v >= 0,
  );

  try {
    for (const payload of candidates) {
      dev.write(makeReport(0x30, Buffer.from([payload & 0xff])));
      await sleep(settleMs);
    }
    return { ok: true, slot: slotOneBased };
  } catch (err: any) {
    return { ok: false, slot: slotOneBased, error: String(err?.message ?? err) };
  } finally {
    safeClose(dev);
  }
}

// ── Preview pull ─────────────────────────────────────────────────────────────

export interface SlotPreview {
  slot: number;
  pngBuffer: Buffer | null;
  sha256: string | null;
  error?: string;
}

/**
 * Pull the preview PNG for a single slot via HID type=0x07 chunked protocol.
 *
 * Steps (matching community-documented behavior):
 *   1. Send 0x30 (select slot) so the device sets focus
 *   2. Send 0x08 (metadata request) — device may respond with JSON metadata
 *   3. Send 0x07 (preview request) — device streams IN 0x07 chunks
 *   4. Reassemble chunks by chunk index, locate PNG signature, cut at IEND
 */
export async function pullSlotPreview(
  slotOneBased: number,
  opts: { timeoutMs?: number } = {},
): Promise<SlotPreview> {
  const timeoutMs = opts.timeoutMs ?? 8000;

  if (slotOneBased < 1 || slotOneBased > SLOT_COUNT) {
    return { slot: slotOneBased, pngBuffer: null, sha256: null, error: "Invalid slot" };
  }

  const dev = await openControlDevice();
  if (!dev) {
    return {
      slot: slotOneBased,
      pngBuffer: null,
      sha256: null,
      error: "Centerpiece keyboard not found via HID",
    };
  }

  return new Promise<SlotPreview>((resolve) => {
    const chunks = new Map<number, Buffer>();
    let done = false;
    let timer: ReturnType<typeof setTimeout>;

    const finish = (png: Buffer | null, error?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      safeClose(dev);
      if (png) {
        const sha256 = createHash("sha256").update(png).digest("hex").toUpperCase();
        resolve({ slot: slotOneBased, pngBuffer: png, sha256 });
      } else {
        resolve({ slot: slotOneBased, pngBuffer: null, sha256: null, error });
      }
    };

    timer = setTimeout(() => {
      // Attempt to assemble whatever chunks we received before timing out
      const assembled = assembleChunks(chunks);
      const png = assembled ? cutPng(assembled) : null;
      if (png) {
        finish(png);
      } else {
        finish(null, "Timeout waiting for preview PNG");
      }
    }, timeoutMs);

    dev.on("error", (err: Error) => finish(null, err.message));

    dev.on("data", (rawData: Buffer | number[]) => {
      const frame = parseFrame(rawData);
      if (!frame || frame.msgType !== 0x07 || frame.payload.length < 6) return;

      const { chunkIndex, dataOffset } = parseChunkHeader(frame.payload);
      const chunkData = frame.payload.slice(dataOffset);
      if (chunkData.length > 0) {
        chunks.set(chunkIndex, chunkData);
      }

      // After each chunk, try to find a complete PNG
      const assembled = assembleChunks(chunks);
      if (assembled) {
        const png = cutPng(assembled);
        if (png) finish(png);
      }
    });

    // Send slot-switch + preview request sequences
    const slotCandidates = Array.from(new Set([slotOneBased, slotOneBased - 1])).filter(
      (v) => v >= 0,
    );

    const sendSequence = async () => {
      for (const payload of slotCandidates) {
        const p = Buffer.from([payload & 0xff]);
        try {
          dev.write(makeReport(0x30, p));
          await sleep(60);
          dev.write(makeReport(0x08, p));
          await sleep(60);
          dev.write(makeReport(0x07, p));
          await sleep(60);
        } catch { /* device may have closed */ }
      }
    };

    sendSequence().catch(() => {/* ignore */});
  });
}

/** Pull preview PNGs for all 5 slots sequentially. */
export async function pullAllPreviews(
  opts: { perSlotTimeoutMs?: number; onSlot?: (result: SlotPreview) => void } = {},
): Promise<SlotPreview[]> {
  const results: SlotPreview[] = [];
  for (let slot = 1; slot <= SLOT_COUNT; slot++) {
    const result = await pullSlotPreview(slot, { timeoutMs: opts.perSlotTimeoutMs ?? 8000 });
    results.push(result);
    opts.onSlot?.(result);
  }
  return results;
}

// ── Upload verification ──────────────────────────────────────────────────────

export interface VerifyResult {
  ok: boolean;
  slot: number;
  finalSha256?: string;
  attempts: number;
  error?: string;
}

/**
 * After uploading a skin, poll the slot preview hash until it stabilizes.
 * Two consecutive identical hashes ≥ minBytes = confirmed load.
 */
export async function verifySlotUpload(
  slotOneBased: number,
  opts: {
    maxWaitMs?: number;
    pollIntervalMs?: number;
    stableN?: number;
    minBytes?: number;
    onPoll?: (attempt: number, sha: string | null) => void;
  } = {},
): Promise<VerifyResult> {
  const maxWaitMs = opts.maxWaitMs ?? 45_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 3_000;
  const stableN = opts.stableN ?? 2;
  const minBytes = opts.minBytes ?? 20_000;

  const history: string[] = [];
  let attempts = 0;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    await sleep(attempts === 0 ? 3_000 : pollIntervalMs); // wait before first poll
    attempts++;

    const result = await pullSlotPreview(slotOneBased, { timeoutMs: 10_000 });
    const sha = result.sha256;
    opts.onPoll?.(attempts, sha);

    if (sha && result.pngBuffer && result.pngBuffer.length >= minBytes) {
      history.push(sha);
      if (history.length >= stableN) {
        const tail = history.slice(-stableN);
        if (tail.every((h) => h === tail[0])) {
          return { ok: true, slot: slotOneBased, finalSha256: tail[0], attempts };
        }
      }
    }
  }

  return {
    ok: false,
    slot: slotOneBased,
    attempts,
    error: "Timed out waiting for stable preview hash",
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseChunkHeader(payload: Buffer): { chunkIndex: number; dataOffset: number } {
  // payload[1-2] = chunk index (little-endian)
  const chunkIndex = payload[1] + payload[2] * 256;
  // payload[3-4] == 0x54 0x00 → data starts at byte 5, otherwise byte 3
  const dataOffset =
    payload.length >= 5 && payload[3] === 0x54 && payload[4] === 0x00 ? 5 : 3;
  return { chunkIndex, dataOffset };
}

function assembleChunks(chunks: Map<number, Buffer>): Buffer | null {
  if (chunks.size === 0) return null;
  const sorted = Array.from(chunks.entries()).sort(([a], [b]) => a - b);
  return Buffer.concat(sorted.map(([, v]) => v));
}

function cutPng(blob: Buffer): Buffer | null {
  const sigIdx = indexOfBytes(blob, PNG_SIG);
  if (sigIdx < 0) return null;
  const trimmed = blob.slice(sigIdx);
  const iendIdx = indexOfBytes(trimmed, PNG_IEND);
  if (iendIdx < 0) return null;
  const end = iendIdx + PNG_IEND.length + 4; // IEND + 4-byte CRC
  return end <= trimmed.length ? trimmed.slice(0, end) : null;
}

function indexOfBytes(haystack: Buffer, needle: Buffer): number {
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    if (haystack.slice(i, i + needle.length).equals(needle)) return i;
  }
  return -1;
}

function safeClose(dev: HidDevice): void {
  try { dev.close(); } catch { /* ignore */ }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
