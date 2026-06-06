/**
 * android-device.ts
 *
 * Android-side access to the Finalmouse Centerpiece keyboard.
 *
 * The keyboard runs Android 11 on a Rockchip RK3566 SOM (Firefly Core-3566JD4).
 * Reverse engineering by nun.tax revealed two access paths:
 *
 *   1. rootshelld — unauthenticated TCP shell on port 5557
 *      An undocumented debug service that was not removed before shipping.
 *      Runs as system with SELinux context u:r:rootshelld:s0.
 *      Equivalent to a root shell for practical purposes.
 *
 *   2. ADB over TCP — can be triggered via a HID command (see hid-device.ts).
 *      The ADB authorization dialog appears on the keyboard display but
 *      the keyboard has no touch input, making authorization impossible
 *      through software alone. ADB requires a pre-authorized key or
 *      physical hardware mods (bridge resistors R70+R71 for UART access).
 *
 * Reference: https://nun.tax/blog/reverse-engineering-the-centerpiece-pro/
 *
 * Skin file locations on Android (community-confirmed):
 *   /data/local/skins/         — primary skin slot storage
 *   /sdcard/Android/data/com.finalmouse.centerpiece/files/skins/
 */

import * as net from "node:net";
import * as readline from "node:readline";
import { createReadStream } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

// ── Hardware constants ────────────────────────────────────────────────────────
// Source: https://nun.tax/blog/reverse-engineering-the-centerpiece-pro/

/** System on Module: Firefly Core-3566JD4 */
export const SOM_MODEL = "Firefly Core-3566JD4";
/** Application processor inside the SOM */
export const SOC_CHIP = "Rockchip RK3566";
/** Android OS version shipped on the keyboard */
export const ANDROID_VERSION = 11;
/** UART baud rate for the SOM serial console (as documented on Firefly wiki) */
export const UART_BAUD_RATE = 1_500_000;
/**
 * PCB resistors that must be bridged to enable the UART pinout.
 * Finalmouse deliberately left R70 and R71 unpopulated to disable UART.
 * Bridging R118+R71 causes a boot loop — only R70+R71 are correct.
 */
export const UART_BRIDGE_RESISTORS = ["R70", "R71"] as const;
/**
 * Android path where trusted ADB public keys are stored.
 * Writing your adbkey.pub here (via rootshelld) pre-authorizes ADB
 * without needing to accept the dialog on the keyboard display.
 */
export const ADB_KEYS_PATH = "/data/misc/adb/adb_keys";
/** SELinux context that rootshelld runs under */
export const ROOTSHELLD_SELINUX_CONTEXT = "u:r:rootshelld:s0";
/**
 * MCU recovery mode: hold the button on the side of the keyboard while
 * plugging it in via USB. The built-in MCU bootloader exposes the flash
 * for reading/writing without JTAG.
 */
export const MCU_RECOVERY_INSTRUCTIONS =
  "Hold the side button, then plug the keyboard in via USB.";

export const ROOTSHELLD_PORT = 5557;

/**
 * Candidate paths searched in order when listing or pushing skins.
 * The first path that contains .pak files wins.
 */
export const ANDROID_SKIN_PATHS = [
  "/data/local/skins",
  "/sdcard/Android/data/com.finalmouse.centerpiece/files/skins",
  "/data/data/com.finalmouse.centerpiece/files/skins",
];

// ── Connectivity ─────────────────────────────────────────────────────────────

/**
 * Returns true if rootshelld is reachable on the given host.
 * A fast probe — does not send any commands.
 */
export async function probeRootShell(
  host: string,
  timeoutMs = 3_000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, timeoutMs);
    socket.once("connect", () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once("error",   () => { clearTimeout(timer); resolve(false); });
    socket.connect(ROOTSHELLD_PORT, host);
  });
}

// ── Shell execution ───────────────────────────────────────────────────────────

/**
 * Run a single shell command via rootshelld and return its stdout.
 *
 * Uses a unique sentinel string to detect command completion, avoiding the
 * need for a pty or shell prompt parsing.
 */
export async function runShellCommand(
  host: string,
  command: string,
  timeoutMs = 10_000,
): Promise<string> {
  // A per-call sentinel that cannot accidentally appear in command output
  const sentinel = `__CPRO_${Math.random().toString(36).slice(2).toUpperCase()}__`;
  const wire = `${command}; echo ${sentinel}\n`;

  return new Promise((resolveP, reject) => {
    const socket = new net.Socket();
    let output = "";
    let done = false;
    let timer: ReturnType<typeof setTimeout>;

    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) return reject(err);
      const idx = output.indexOf(sentinel);
      resolveP(idx >= 0 ? output.slice(0, idx).trim() : output.trim());
    };

    timer = setTimeout(
      () => finish(new Error(`rootshelld timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );

    socket.once("error", (err) => finish(err));
    socket.once("connect", () => socket.write(wire));
    socket.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes(sentinel)) finish();
    });

    socket.connect(ROOTSHELLD_PORT, host);
  });
}

// ── Device information ────────────────────────────────────────────────────────

export interface AndroidDeviceInfo {
  /** Android platform version string, e.g. "11" */
  buildVersion: string;
  /** Android SDK level, e.g. "30" */
  sdkVersion: string;
  /** Product model / device name */
  deviceModel: string;
  /** Full build fingerprint */
  buildFingerprint: string;
  /** Primary CPU ABI */
  cpuAbi: string;
  /** System uptime in seconds (null if unavailable) */
  uptimeSeconds: number | null;
  /** ro.adb.secure value — "0" means ADB is unauthenticated */
  adbSecure: string;
}

/**
 * Query Android system properties via rootshelld.
 * Equivalent to running `adb shell getprop` remotely.
 */
export async function getDeviceInfo(host: string): Promise<AndroidDeviceInfo> {
  const props = await runShellCommand(host, "getprop", 15_000);

  const getProp = (key: string): string => {
    const m = props.match(
      new RegExp(`\\[${key.replace(/\./g, "\\.")}\\]:\\s*\\[([^\\]]*)\\]`),
    );
    return m ? m[1] : "";
  };

  let uptimeSeconds: number | null = null;
  try {
    const raw = await runShellCommand(host, "cat /proc/uptime", 5_000);
    uptimeSeconds = parseFloat(raw.split(" ")[0]) || null;
  } catch { /* non-fatal */ }

  return {
    buildVersion:    getProp("ro.build.version.release"),
    sdkVersion:      getProp("ro.build.version.sdk"),
    deviceModel:     getProp("ro.product.model") || getProp("ro.product.device"),
    buildFingerprint: getProp("ro.build.fingerprint"),
    cpuAbi:          getProp("ro.product.cpu.abi"),
    uptimeSeconds,
    adbSecure:       getProp("ro.adb.secure"),
  };
}

// ── Skin listing ──────────────────────────────────────────────────────────────

export interface InstalledSkin {
  /** Slot index parsed from filename (null if not determinable) */
  slot: number | null;
  /** Full Android path to the .pak file */
  path: string;
  /** File size in bytes */
  sizeBytes: number;
  /** Filename component of the path */
  filename: string;
}

/**
 * List interactive skin .pak files installed on the keyboard's Android system.
 * Searches all known skin storage paths and returns the first non-empty result.
 */
export async function listInstalledSkins(host: string): Promise<InstalledSkin[]> {
  for (const skinDir of ANDROID_SKIN_PATHS) {
    let output: string;
    try {
      output = await runShellCommand(
        host,
        `find "${skinDir}" -name "*.pak" -type f 2>/dev/null`,
        8_000,
      );
    } catch {
      continue;
    }
    if (!output) continue;

    const paths = output.split("\n").map((l) => l.trim()).filter(Boolean);
    if (paths.length === 0) continue;

    const skins: InstalledSkin[] = [];
    for (const p of paths) {
      let sizeBytes = 0;
      try {
        const sizeLine = await runShellCommand(host, `stat -c %s "${p}" 2>/dev/null`, 5_000);
        sizeBytes = parseInt(sizeLine, 10) || 0;
      } catch { /* size unavailable */ }

      const filename = p.split("/").pop() ?? p;
      // Parse slot from names like slot0.pak, slot_1.pak, skin_2.pak
      const slotMatch = filename.match(/(?:slot|skin)[_-]?(\d)/i);
      const slot = slotMatch ? parseInt(slotMatch[1], 10) : null;

      skins.push({ slot, path: p, sizeBytes, filename });
    }
    return skins;
  }
  return [];
}

// ── ADB key authorization ─────────────────────────────────────────────────────

export interface AuthorizeAdbKeyResult {
  ok: boolean;
  /**
   * The public key that was written to /data/misc/adb/adb_keys.
   * null when ok is false.
   */
  publicKey: string | null;
  error?: string;
}

/**
 * Pre-authorize an ADB public key on the keyboard without hardware mods.
 *
 * The blog author's discovery enables a fully software-only path to ADB:
 *   1. rootshelld (port 5557) lets us write to /data/misc/adb/adb_keys
 *   2. Writing our adbkey.pub there pre-authorizes our ADB client
 *   3. `cpro device enable-adb` triggers the ADB listener via HID
 *   4. ADB connects with our pre-authorized key — no dialog needed
 *
 * The public key is read from `~/.android/adbkey.pub` by default, which
 * is where `adb` writes it when you first run any adb command.
 *
 * @param host       Keyboard IP or hostname
 * @param pubKeyPath Override the public key file path
 */
export async function authorizeAdbKey(
  host: string,
  pubKeyPath?: string,
): Promise<AuthorizeAdbKeyResult> {
  const keyPath = pubKeyPath ?? join(homedir(), ".android", "adbkey.pub");
  let pubKey: string;
  try {
    const raw = await readFile(keyPath, "utf8");
    pubKey = raw.trim();
  } catch {
    return {
      ok: false,
      publicKey: null,
      error:
        `Could not read ADB public key at ${keyPath}.\n` +
        "Run any 'adb' command first to generate the key pair, then retry.",
    };
  }

  if (!pubKey.startsWith("QAAAA") && !pubKey.startsWith("AAAAB")) {
    return {
      ok: false,
      publicKey: null,
      error: `${keyPath} does not look like an ADB public key (unexpected prefix).`,
    };
  }

  // Escape single-quotes in the key for the shell printf command
  const escaped = pubKey.replace(/'/g, "'\\''" );

  // Use printf instead of echo to avoid shell interpretation of key content
  const cmd = [
    `mkdir -p "$(dirname '${ADB_KEYS_PATH}')"`,
    `printf '%s\\n' '${escaped}' >> '${ADB_KEYS_PATH}'`,
    // Remove duplicates while preserving order
    `sort -u '${ADB_KEYS_PATH}' -o '${ADB_KEYS_PATH}'`,
    `restorecon '${ADB_KEYS_PATH}' 2>/dev/null || true`,
  ].join(" && ");

  try {
    await runShellCommand(host, cmd, 15_000);
    return { ok: true, publicKey: pubKey };
  } catch (err: any) {
    return { ok: false, publicKey: null, error: String(err?.message ?? err) };
  }
}

// ── Logcat streaming ──────────────────────────────────────────────────────────

export interface LogcatStream {
  /** Call to stop the logcat stream and close the connection. */
  stop: () => void;
}

/**
 * Stream Android logcat from the keyboard via rootshelld.
 * Unreal Engine skin logs appear under the tags "LogPython", "LogBlueprint",
 * "LogNiagara", and "SkinEngine".
 *
 * @param host      Keyboard IP or hostname
 * @param onLine    Callback fired for each logcat line
 * @param filter    Logcat filter spec (default: UE + error tags)
 */
export function streamLogcat(
  host: string,
  onLine: (line: string) => void,
  filter = "LogPython:* LogBlueprint:* LogNiagara:* SkinEngine:* *:E",
): LogcatStream {
  const socket = new net.Socket();
  let stopped = false;

  // readline wraps the socket stream so we get clean line callbacks
  const rl = readline.createInterface({ input: socket as unknown as NodeJS.ReadableStream });
  rl.on("line", onLine);

  socket.once("connect", () => {
    socket.write(`logcat -v time ${filter}\n`);
  });
  socket.once("error", (err) => {
    if (!stopped) onLine(`[rootshelld] error: ${err.message}`);
  });
  socket.connect(ROOTSHELLD_PORT, host);

  return {
    stop: () => {
      stopped = true;
      rl.close();
      socket.destroy();
    },
  };
}

// ── PAK push via netcat relay ─────────────────────────────────────────────────

const NC_RELAY_PORT = 9998;

export interface ShellPushResult {
  ok: boolean;
  /** Destination path on the Android filesystem */
  destPath: string;
  error?: string;
}

/**
 * Push a cooked .pak file directly to the Android skin directory via rootshelld.
 *
 * Uses a two-step approach:
 *   1. Opens a rootshelld command that starts `nc -l -p 9998` on the device,
 *      piping its output into the destination .pak file.
 *   2. Streams the local .pak file to port 9998 via a separate TCP connection.
 *
 * This is an alternative to the HTTP upload (`cpro ue pak upload`) that works
 * even when the Finalmouse HTTP skin server is not running or has changed its
 * API. It requires rootshelld access (port 5557) and `nc` (netcat) on the device.
 *
 * Typical skin files are 50-200 MB; the transfer runs at LAN speed.
 */
export async function pushPakViaShell(
  host: string,
  pakPath: string,
  slot: number,
  opts: {
    skinDir?: string;
    onProgress?: (percent: number) => void;
    timeoutMs?: number;
  } = {},
): Promise<ShellPushResult> {
  const absPath = resolve(pakPath);
  const { size } = await stat(absPath);
  const skinDir = opts.skinDir ?? ANDROID_SKIN_PATHS[0];
  const destPath = `${skinDir}/slot${slot}.pak`;
  const timeoutMs = opts.timeoutMs ?? 180_000;

  // Step 1: Start nc listener on the device via rootshelld
  const listenSocket = new net.Socket();
  await new Promise<void>((res, rej) => {
    const t = setTimeout(() => { listenSocket.destroy(); rej(new Error("rootshelld connect timeout")); }, 5_000);
    listenSocket.once("connect", () => { clearTimeout(t); res(); });
    listenSocket.once("error", (err) => { clearTimeout(t); rej(err); });
    listenSocket.connect(ROOTSHELLD_PORT, host);
  });

  // Send the nc listen + mkdir command — nc will exit after first connection closes
  listenSocket.write(`mkdir -p "${skinDir}" && nc -l -p ${NC_RELAY_PORT} > "${destPath}"\n`);

  // Brief pause to let nc start listening
  await new Promise((r) => setTimeout(r, 600));

  // Step 2: Connect to the nc relay port and stream the file
  return new Promise<ShellPushResult>((resolveP) => {
    const fileSocket = new net.Socket();
    let sent = 0;
    let done = false;
    let timer: ReturnType<typeof setTimeout>;

    const finish = (ok: boolean, error?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fileSocket.destroy();
      listenSocket.destroy();
      resolveP({ ok, destPath, error });
    };

    timer = setTimeout(
      () => finish(false, `Push timed out after ${timeoutMs / 1000}s`),
      timeoutMs,
    );

    fileSocket.once("error", (err) => finish(false, err.message));

    fileSocket.once("connect", () => {
      opts.onProgress?.(0);
      const stream = createReadStream(absPath, { highWaterMark: 65_536 });
      stream.on("data", (chunk) => {
        sent += (chunk as Buffer).length;
        opts.onProgress?.(Math.min(99, Math.round((sent / size) * 100)));
      });
      stream.on("end", () => {
        opts.onProgress?.(100);
        // Give nc time to flush before closing
        setTimeout(() => finish(true), 1_500);
      });
      stream.on("error", (err) => finish(false, `File read error: ${err.message}`));
      stream.pipe(fileSocket, { end: true });
    });

    fileSocket.connect(NC_RELAY_PORT, host);
  });
}

// ── Firmware / MCU info ───────────────────────────────────────────────────────

/**
 * Read UE skin engine log lines from the Finalmouse host app via logcat.
 * Collects lines for a fixed window then resolves with the batch.
 *
 * Useful for one-shot diagnostics without a persistent stream.
 */
export async function captureSkinEngineLogs(
  host: string,
  durationMs = 5_000,
): Promise<string[]> {
  const lines: string[] = [];
  return new Promise((resolveP) => {
    const s = streamLogcat(host, (line) => lines.push(line));
    setTimeout(() => { s.stop(); resolveP(lines); }, durationMs);
  });
}
