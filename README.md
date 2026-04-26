# cpro-util

Media conversion toolbox for the **Finalmouse Centerpiece Founders Edition** keyboard display.

Converts any image, video, GIF, or YouTube/Vimeo URL into a ready-to-upload skin for the Centerpiece Pro panel (1920×550). Ships with a drag-and-drop web UI and a CLI.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js 20+** | [nodejs.org](https://nodejs.org) — check with `node --version` |
| **ffmpeg / ffprobe** | **Bundled automatically** via npm — no separate install needed |
| **yt-dlp** *(optional)* | Only needed for YouTube/Vimeo URL conversion. `brew install yt-dlp` or `pip install yt-dlp` |

---

## Quick setup (recommended)

Clone or download the repo, then run the setup script — it checks prerequisites, installs dependencies, builds, and offers to launch the web UI:

```bash
git clone https://github.com/your-username/cpro-util.git
cd cpro-util
bash setup.sh
```

Or with npm:

```bash
npm run setup
```

---

## Manual setup

```bash
npm install        # install dependencies (ffmpeg/ffprobe bundled here)
npm run build      # compile TypeScript → dist/
```

Launch the web UI:

```bash
npm run serve      # opens http://127.0.0.1:7777 in your browser
```

Optional — install as a global `cpro` command:

```bash
npm link
cpro serve
```

---

## Web UI

The easiest way to use cpro-util. After running `npm run serve`:

1. Open **http://127.0.0.1:7777** in your browser
2. Drop a file (image, video, or GIF) onto the drop zone — or paste a YouTube/Vimeo URL
3. A **side-by-side preview** shows Cover / Contain / Stretch instantly so you can pick the right fit before converting
4. Adjust fit, background color, crop anchor, FPS, bitrate, and optional trim
5. Click **Convert** — a live progress bar tracks the download (for URLs) and encoding separately
6. Download the finished `.mp4` or `.png` skin

Upload the finished file at [xpanel.finalmouse.com](https://xpanel.finalmouse.com) → Keyboard → Skins → your slot.

> **YouTube/Vimeo URLs** require `yt-dlp` installed on your system (`brew install yt-dlp`). Local file and GIF conversion works without it.

---

## CLI

Convert a single file:

```bash
cpro convert scene.mov --out scene.skin.mp4
cpro convert poster.jpg                        # writes poster.skin.png
cpro convert clip.mov --fit contain --bg "#111"
```

Convert from a URL (requires `yt-dlp`):

```bash
cpro convert "https://www.youtube.com/watch?v=dQw4w9WgXcQ" --fit cover
```

Open the web UI:

```bash
cpro serve
```

Preview a finished skin at device aspect:

```bash
cpro preview my-skin.mp4
```

Manage a 5-slot loadout:

```bash
cpro set init ~/skins/main
cpro set assign ~/skins/main.cproskinset 0 ~/videos/neon.mov --label Neon
cpro set assign ~/skins/main.cproskinset 1 ~/images/logo.png --fit contain
cpro set show   ~/skins/main.cproskinset
cpro set preview ~/skins/main.cproskinset 0
```

Print device specs as JSON:

```bash
cpro specs
```

---

## Commands

| Command | Purpose |
|---|---|
| `cpro convert <file-or-url>` | Convert an image, video, or URL to a skin file |
| `cpro preview <file>` | Open a browser preview at 1920×550 aspect |
| `cpro serve` | Launch the drag-and-drop web UI |
| `cpro set init <dir>` | Create a `.cproskinset` (5-slot project) |
| `cpro set show <dir>` | Show slot assignments |
| `cpro set assign <dir> <slot> <src>` | Convert + attach a source to a slot |
| `cpro set clear <dir> <slot>` | Empty a slot |
| `cpro set rename <dir> <slot> <label>` | Rename a slot |
| `cpro set preview <dir> <slot>` | Preview the skin in a slot |
| `cpro specs` | Print device specs |

---

## Fit strategies

The Centerpiece Pro panel is ~3.49:1 — almost no source content will be that ratio. The web UI shows all three options side-by-side as a live preview when you drop a file.

- **cover** *(default)*: scales to fill 1920×550, crops overflow. Tune with `--crop-x` / `--crop-y` (0–1) to shift the crop anchor.
- **contain**: scales so the whole source fits, pads the remainder with `--bg <color>`.
- **stretch**: distorts to fill exactly.

---

## Video encoding details

| Setting | Value |
|---|---|
| Codec | `libx264`, profile `main`, level `4.2` |
| Pixel format | `yuv420p` |
| Frame rate | 30–60 fps (default 60), clamped to spec |
| Bitrate | 5–10 Mbps (default 8 Mbps), maxrate 10 Mbps |
| Container | `.mp4`, `+faststart` |
| Audio | Stripped (`-an`) |

These match the published spec at <https://docs.finalmouse.com/> for Centerpiece Pro skins.

---

## Project file: `.cproskinset`

```
my-loadout.cproskinset/
├── manifest.json          # labels, fit, crop, fps, bitrate per slot
├── sources/               # original input files
│   ├── slot-0.mov
│   └── slot-1.png
└── skins/                 # converted, ready-to-upload
    ├── slot-0.mp4
    └── slot-1.png
```

The manifest tracks all settings per slot so you can re-export or tweak a single slot without losing the source.

---

## Unreal Engine skin staging kit

Centerpiece Pro also supports interactive skins running on SkinEngine (UE4). Finalmouse has not released the SDK yet, but this repo ships an authoring staging kit at [ue-skin-template/](ue-skin-template/):

```bash
cpro ue init ~/skins/my-skin         # copies the template
cpro ue export ~/skins/my-skin -o neon.skin.mp4   # renders to a compliant .mp4
```

Requires UE 5.4+. Pass `--ue-path` or set `UE_ROOT` if the tool can't auto-locate `UnrealEditor-Cmd`. See [ue-skin-template/README.md](ue-skin-template/README.md) for details.

---

## Uploading to the device

This tool produces files — it does not interface with hardware directly. Upload finished `.mp4` or `.png` skins via [xpanel.finalmouse.com](https://xpanel.finalmouse.com) → Keyboard → Skins → select a slot → Upload.

