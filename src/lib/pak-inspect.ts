/**
 * pak-inspect.ts
 *
 * Extracts the asset manifest from a cooked UE .pak file by scanning for
 * printable-ASCII strings that match Unreal asset path conventions.
 * Works without unrealpak because the asset name table is stored as plain
 * UTF-8 in all UE pak versions up to UE5.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat, readFile, open } from "node:fs/promises";
import { resolve } from "node:path";

const execFileAsync = promisify(execFile);

export interface PakAssetCategory {
  game: string[];
  engine: string[];
  script: string[];
}

/**
 * UE pak format versions relevant to the Centerpiece keyboard.
 * The keyboard firmware requires pak v11 (produced by UE 5.3).
 * UE 5.4+ produces v12, which crashes the Finalmouse skin engine.
 *
 * Reference: https://nun.tax/blog/reverse-engineering-the-centerpiece-pro/
 */
export const PAK_VERSION_REQUIRED = 11;
export const PAK_MAGIC = 0x5a6f12e1;

export interface PakInspectResult {
  filePath: string;
  /** Raw file size in bytes. */
  fileSize: number;
  /**
   * Pak format version read from the file footer.
   * Null if the footer could not be parsed.
   * The Centerpiece keyboard requires version 11 (UE 5.3).
   * Version 12+ (UE 5.4+) will crash the skin engine.
   */
  pakVersion: number | null;
  /**
   * True when pakVersion > PAK_VERSION_REQUIRED (11).
   * Upload will fail on the keyboard if this is true.
   */
  pakVersionUnsupported: boolean;
  /** /Game/ prefixed asset paths found in the pak. */
  gameAssets: string[];
  /** /Engine/ prefixed asset paths. */
  engineAssets: string[];
  /**
   * Top-level skin folder, e.g. "/Game/SG_MySkin".
   * Derived from the first /Game/<folder> that is not "map" / "EntryPoint".
   */
  skinFolder: string | null;
  /**
   * Android texture pixel format detected in the file (e.g. "PF_ASTC_6x6").
   * Null when the pak was not cooked for Android.
   */
  textureFormat: string | null;
  /**
   * Non-engine plugin modules referenced via /Script/<Name>.
   */
  plugins: string[];
  /**
   * USkinCreatorLibrary API surface extracted from UE reflection data
   * embedded in the pak file.
   *
   * Every cooked Blueprint stores the full names, parameter types and return
   * types of every native class/function/delegate it references so the UE
   * reflection system can resolve them at runtime by name. This means the
   * complete API surface of the Finalmouse SDK is readable directly from any
   * stock skin .pak without source code or a running device.
   *
   * Technique documented at:
   * https://nun.tax/blog/reverse-engineering-the-centerpiece-pro/
   *
   * Null when no USkinCreatorLibrary or CpSkinAPI references are found
   * (e.g. a static skin pak with no interactive Blueprints).
   */
  skinCreatorApi: SkinCreatorApi | null;
}

/**
 * API surface of the Finalmouse USkinCreatorLibrary (or the community
 * CpSkinAPI stub), as extracted from a cooked .pak file's reflection data.
 */
export interface SkinCreatorApi {
  /** The native class name found in the pak (e.g. "USkinCreatorLibrary") */
  className: string;
  /** Callable Blueprint functions with their signatures */
  functions: SkinCreatorFunction[];
  /** Multicast delegate types (events skins can bind to) */
  delegates: SkinCreatorDelegate[];
  /**
   * Whether the signatures match the community stub exactly.
   * False means the Finalmouse SDK has been updated — check for new entries.
   */
  matchesKnownStub: boolean;
}

export interface SkinCreatorFunction {
  name: string;
  /** Return type as a UE reflection type string, e.g. "Vector2D" */
  returnType: string | null;
  /** Parameter list as extracted from reflection data */
  params: SkinCreatorParam[];
  /** Raw display name if found in the pak (from meta DisplayName) */
  displayName: string | null;
}

export interface SkinCreatorDelegate {
  name: string;
  /** Parameter list bound by this delegate */
  params: SkinCreatorParam[];
}

export interface SkinCreatorParam {
  name: string;
  type: string;
}

/**
 * Known-good signatures from the community stub / reverse engineering.
 * Used to set matchesKnownStub on the extracted result.
 */
const KNOWN_FUNCTIONS: Record<string, { returnType: string | null; params: string[] }> = {
  GetPositionByKeyIndex: { returnType: "Vector2D", params: ["int32"] },
  GetKeyCount:           { returnType: "int32",    params: [] },
};

const KNOWN_DELEGATES: Record<string, string[]> = {
  OnKeyboardPressedEvent:  ["int32"],
  OnKeyboardReleasedEvent: ["int32"],
};

/** Native class names used by the Finalmouse SDK and community stub */
const SKIN_API_CLASS_NAMES = [
  "USkinCreatorLibrary",
  "UCpSkinAPIBPLibrary",
  "ACpInputEventManager",
  "SkinCreatorLibrary",
  "CpSkinAPIBPLibrary",
  "CpInputEventManager",
];

/** UE type-name tokens used in property/function reflection metadata */
const UE_TYPE_MAP: Record<string, string> = {
  IntProperty:       "int32",
  FloatProperty:     "float",
  DoubleProperty:    "double",
  BoolProperty:      "bool",
  StrProperty:       "FString",
  NameProperty:      "FName",
  TextProperty:      "FText",
  ObjectProperty:    "UObject*",
  ClassProperty:     "UClass*",
  StructProperty:    "struct",
  Vector2DProperty:  "Vector2D",
  VectorProperty:    "FVector",
  RotatorProperty:   "FRotator",
  LinearColorProperty: "FLinearColor",
  ByteProperty:      "uint8",
  Int64Property:     "int64",
  EnumProperty:      "enum",
};

const CORE_SCRIPTS = new Set(["CoreUObject", "Engine", "Core"]);

export async function inspectPak(pakPath: string): Promise<PakInspectResult> {
  const abs = resolve(pakPath);
  const { size } = await stat(abs);

  const rawStrings = await extractStrings(abs);
  const lines = rawStrings.split("\n");

  const seenGame = new Set<string>();
  const seenEngine = new Set<string>();
  const gameAssets: string[] = [];
  const engineAssets: string[] = [];
  const plugins = new Set<string>();

  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith("/")) continue;

    if (/^\/Game\/[\w/.\\-]+$/.test(t) && !seenGame.has(t)) {
      seenGame.add(t);
      gameAssets.push(t);
    } else if (/^\/Engine\/[\w/.\\-]+$/.test(t) && !seenEngine.has(t)) {
      seenEngine.add(t);
      engineAssets.push(t);
    } else if (/^\/Script\/\w+$/.test(t)) {
      const name = t.slice("/Script/".length);
      if (!CORE_SCRIPTS.has(name)) plugins.add(name);
    }
  }

  const fmtMatch = rawStrings.match(/PF_\w+/);
  const textureFormat = fmtMatch ? fmtMatch[0] : null;

  let skinFolder: string | null = null;
  for (const p of gameAssets) {
    const m = p.match(/^\/Game\/([^/]+)/);
    if (m && m[1] !== "map" && m[1] !== "EntryPoint") {
      skinFolder = `/Game/${m[1]}`;
      break;
    }
  }

  const pakVersion = await readPakVersion(abs, size);
  const skinCreatorApi = extractSkinCreatorApi(rawStrings);

  return {
    filePath: abs,
    fileSize: size,
    pakVersion,
    pakVersionUnsupported: pakVersion !== null && pakVersion > PAK_VERSION_REQUIRED,
    gameAssets,
    engineAssets,
    skinFolder,
    textureFormat,
    plugins: [...plugins].sort(),
    skinCreatorApi,
  };
}

/**
 * Extract the USkinCreatorLibrary (or CpSkinAPI) API surface from UE
 * reflection metadata embedded in a cooked .pak file.
 *
 * How it works:
 *   Cooked Blueprints store every native class/function/delegate reference as
 *   plain strings in the serialized asset name table so the UE reflection
 *   system can resolve them at runtime by name. The full function and delegate
 *   signatures — names, parameter types, return types — are all present in the
 *   raw binary and readable with a simple string scan.
 *
 *   Patterns extracted:
 *     Function names   — e.g. "GetPositionByKeyIndex", "GetKeyCount"
 *     Delegate names   — e.g. "OnKeyboardPressedEvent"
 *     Return types     — discovered from adjacent UE property-type tokens
 *     Parameter types  — parsed from the same token context
 *
 *   The technique was documented by nun.tax while reverse engineering the
 *   Finalmouse Centerpiece Pro:
 *   https://nun.tax/blog/reverse-engineering-the-centerpiece-pro/
 */
function extractSkinCreatorApi(rawStrings: string): SkinCreatorApi | null {
  const lines = rawStrings.split("\n").map((l) => l.trim()).filter(Boolean);

  // ── Step 1: find which API class name is present ────────────────────────
  let className: string | null = null;
  for (const cls of SKIN_API_CLASS_NAMES) {
    if (lines.some((l) => l.includes(cls))) {
      className = cls;
      break;
    }
  }
  if (!className) return null;

  // ── Step 2: collect function names ──────────────────────────────────────
  // UE stores functions under the class object path, e.g.:
  //   "/Script/CpSkinAPI.CpSkinAPIBPLibrary:GetPositionByKeyIndex"
  //   "GetPositionByKeyIndex"   ← also appears standalone
  //
  // We match both the qualified form and standalone identifiers that appear
  // near the class name in the string table.
  const functionNames = new Set<string>();
  const delegateNames = new Set<string>();

  // Qualified references: ClassName:FunctionName or ClassName::FunctionName
  const qualifiedRe = new RegExp(
    `(?:${SKIN_API_CLASS_NAMES.join("|")})[:.]{1,2}(\\w+)`,
    "g",
  );
  for (const line of lines) {
    let m: RegExpExecArray | null;
    qualifiedRe.lastIndex = 0;
    while ((m = qualifiedRe.exec(line)) !== null) {
      const name = m[1];
      if (/^[A-Z]/.test(name)) {
        if (/Event$|Delegate$|^On[A-Z]/.test(name)) {
          delegateNames.add(name);
        } else {
          functionNames.add(name);
        }
      }
    }
  }

  // Delegate declarations: DECLARE_DYNAMIC_MULTICAST_DELEGATE patterns
  // and FOn* type names which mark delegate types
  const delegateRe = /\bF(On[A-Z]\w+(?:Event|Delegate)?)\b/g;
  for (const line of lines) {
    let m: RegExpExecArray | null;
    delegateRe.lastIndex = 0;
    while ((m = delegateRe.exec(line)) !== null) {
      delegateNames.add(m[1]);
    }
  }

  // Standalone well-known function names that appear adjacent to class tokens
  // These are always present in the UE name table for any referenced function
  const knownFnNames = Object.keys(KNOWN_FUNCTIONS);
  const knownDelNames = Object.keys(KNOWN_DELEGATES);
  for (const line of lines) {
    for (const fn of knownFnNames) {
      if (line.includes(fn)) functionNames.add(fn);
    }
    for (const del of knownDelNames) {
      if (line.includes(del)) delegateNames.add(del);
    }
  }

  // Remove delegate-like names from functions
  for (const d of delegateNames) functionNames.delete(d);
  // Remove constructor/generated noise
  for (const noise of ["StaticClass", "GetClass", "GENERATED_BODY", className]) {
    functionNames.delete(noise);
  }

  // ── Step 3: resolve parameter types from adjacent UE property tokens ────
  // UE serializes function parameters with their property-type names nearby.
  // We look for property-type tokens within a few lines of each function name.
  const functions: SkinCreatorFunction[] = [];
  for (const name of [...functionNames].sort()) {
    // Check known stub first — gives precise params even when pak data is sparse
    const known = KNOWN_FUNCTIONS[name];
    if (known) {
      functions.push({
        name,
        returnType: known.returnType,
        params: known.params.map((t, i) => ({ name: `Param${i}`, type: t })),
        displayName: toDisplayName(name),
      });
      continue;
    }

    // Fallback: scan nearby lines for UE property type tokens
    const params = resolveParamsNearName(name, lines);
    const returnType = resolveReturnTypeNearName(name, lines);
    functions.push({ name, returnType, params, displayName: toDisplayName(name) });
  }

  const delegates: SkinCreatorDelegate[] = [];
  for (const name of [...delegateNames].sort()) {
    const known = KNOWN_DELEGATES[name];
    if (known) {
      delegates.push({
        name,
        params: known.map((t, i) => ({ name: `Param${i}`, type: t })),
      });
      continue;
    }
    const params = resolveParamsNearName(name, lines);
    delegates.push({ name, params });
  }

  // ── Step 4: validate against known stub ─────────────────────────────────
  const knownFnSet = new Set(Object.keys(KNOWN_FUNCTIONS));
  const knownDelSet = new Set(Object.keys(KNOWN_DELEGATES));
  const foundFnNames = new Set(functions.map((f) => f.name));
  const foundDelNames = new Set(delegates.map((d) => d.name));

  // matchesKnownStub = all known items are present AND no unknown extras
  const allKnownFnsFound = [...knownFnSet].every((n) => foundFnNames.has(n));
  const allKnownDelsFound = [...knownDelSet].every((n) => foundDelNames.has(n));
  const noUnknownFns = [...foundFnNames].every((n) => knownFnSet.has(n));
  const noUnknownDels = [...foundDelNames].every((n) => knownDelSet.has(n));

  const matchesKnownStub =
    allKnownFnsFound && allKnownDelsFound && noUnknownFns && noUnknownDels;

  return { className, functions, delegates, matchesKnownStub };
}

/** Scan lines near a symbol name for UE property-type tokens → params */
function resolveParamsNearName(name: string, lines: string[]): SkinCreatorParam[] {
  const params: SkinCreatorParam[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(name)) continue;
    // Scan a ±10-line window around the match
    const start = Math.max(0, i - 10);
    const end = Math.min(lines.length - 1, i + 10);
    for (let j = start; j <= end; j++) {
      for (const [token, type] of Object.entries(UE_TYPE_MAP)) {
        if (lines[j].includes(token) && !seen.has(type)) {
          // Extract a plausible param name from nearby content
          const paramName = extractParamName(lines[j]) ?? `Param${params.length}`;
          params.push({ name: paramName, type });
          seen.add(type);
        }
      }
    }
    break; // only use the first occurrence
  }
  return params;
}

/** Scan lines near a symbol for a return-type hint */
function resolveReturnTypeNearName(name: string, lines: string[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(name)) continue;
    const start = Math.max(0, i - 5);
    const end = Math.min(lines.length - 1, i + 5);
    for (let j = start; j <= end; j++) {
      // "ReturnValue" or "RetVal" adjacent to a type token is a strong signal
      if (/ReturnValue|RetVal/i.test(lines[j])) {
        for (const [token, type] of Object.entries(UE_TYPE_MAP)) {
          if (lines[j].includes(token)) return type;
        }
      }
    }
    break;
  }
  return null;
}

/** Try to extract a human-readable parameter name from a reflection string */
function extractParamName(line: string): string | null {
  // UE often stores param names like "KeyIndex", "InKeyIndex", etc.
  const m = line.match(/\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/);
  return m ? m[1] : null;
}

/** Convert a PascalCase function name to a display name with spaces */
function toDisplayName(name: string): string {
  return name.replace(/([A-Z])/g, " $1").trim();
}

/**
 * Read the pak format version from the file footer.
 *
 * The UE pak footer ends the file and contains the magic 0x5A6F12E1 followed
 * immediately by the 4-byte little-endian version number.
 *
 * Footer layout (version >= 9 / UE 4.25+):
 *   [EncryptionKeyGuid: 16][bEncryptedIndex: 1][Magic: 4][Version: 4]
 *   [IndexOffset: 8][IndexSize: 8][IndexHash: 20][bIndexIsFrozen: 1]
 *   = 62 bytes total
 *
 * We search the last 512 bytes for the magic rather than using a fixed offset
 * to handle any footer size variations across minor UE versions.
 */
async function readPakVersion(filePath: string, fileSize: number): Promise<number | null> {
  if (fileSize < 62) return null;
  const readSize = Math.min(512, fileSize);
  const buf = Buffer.alloc(readSize);
  let handle;
  try {
    handle = await open(filePath, "r");
    await handle.read(buf, 0, readSize, fileSize - readSize);
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }

  // Magic in little-endian: E1 12 6F 5A
  const MAGIC_LE = Buffer.from([0xe1, 0x12, 0x6f, 0x5a]);
  for (let i = buf.length - 4; i >= 0; i--) {
    if (
      buf[i]     === MAGIC_LE[0] &&
      buf[i + 1] === MAGIC_LE[1] &&
      buf[i + 2] === MAGIC_LE[2] &&
      buf[i + 3] === MAGIC_LE[3]
    ) {
      if (i + 8 <= buf.length) {
        return buf.readUInt32LE(i + 4);
      }
    }
  }
  return null;
}

async function extractStrings(filePath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("strings", [filePath]);
    return stdout;
  } catch {
    // strings(1) not available — scan the buffer manually
    const buf = await readFile(filePath);
    return scanBuffer(buf);
  }
}

function scanBuffer(buf: Buffer): string {
  const MIN = 4;
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c >= 0x20 && c <= 0x7e) {
      cur += String.fromCharCode(c);
    } else {
      if (cur.length >= MIN) out.push(cur);
      cur = "";
    }
  }
  if (cur.length >= MIN) out.push(cur);
  return out.join("\n");
}
