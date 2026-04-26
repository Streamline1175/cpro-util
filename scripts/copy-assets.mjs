import { cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url)) + "/..";
const src = join(root, "src/web");
const dest = join(root, "dist/web");

if (!existsSync(src)) process.exit(0);
await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });
console.log(`copied ${src} -> ${dest}`);
