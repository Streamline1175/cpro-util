# cpro-util

Convert any image, video, GIF, or YouTube/Vimeo URL into a ready-to-upload skin for the **Finalmouse Centerpiece Pro** keyboard panel (1920×550).

Comes with a drag-and-drop browser UI — no coding required to use it. Just follow the steps below.

---

## Get up and running (5 minutes, no experience needed)

> **No IDE, no git, no prior setup required.** Just follow the steps for your operating system.

### Step 1 — Install Node.js

Node.js is the only thing you need to install. ffmpeg (the video tool) is bundled automatically.

1. Go to **[nodejs.org](https://nodejs.org)**
2. Click the **"LTS"** download button (the one labeled "Recommended For Most Users")
3. Run the installer and follow the prompts — all defaults are fine

To verify it worked, continue to Step 2 and it will be checked automatically.

> **Already have Node.js?** You need version 20 or higher. Run `node --version` in a terminal to check.

---

### Step 2 — Download this tool

**You do not need git or any developer tools.** Just download the ZIP:

1. Click the green **"Code"** button at the top of this GitHub page
2. Click **"Download ZIP"**
3. Once downloaded, **unzip/extract** the folder somewhere easy to find (e.g. your Desktop or Documents)

---

### Step 3 — Open a terminal in the folder

This is the only "technical" step. You just need to open a command window pointed at the folder you just extracted.

<details>
<summary><strong>macOS instructions</strong></summary>

1. Open the extracted folder in Finder
2. Right-click (or Control-click) on an empty area inside the folder
3. Select **"New Terminal at Folder"** — if you don't see this option, go to **System Settings → Privacy & Security → Developer Tools** and enable Terminal, or just open **Terminal** from Applications and type:
   ```
   cd ~/Desktop/cpro-util
   ```
   (adjust the path to wherever you extracted it)

</details>

<details>
<summary><strong>Windows instructions</strong></summary>

1. Open the extracted folder in File Explorer
2. Click in the **address bar** at the top (where it shows the folder path)
3. Type `cmd` and press **Enter** — this opens Command Prompt already in the right folder

</details>

<details>
<summary><strong>Linux instructions</strong></summary>

Right-click inside the extracted folder and select **"Open Terminal Here"** (wording varies by distro), or open a terminal and `cd` to the folder path.

</details>

---

### Step 4 — Run setup

Paste the appropriate command into the terminal window and press Enter:

**macOS / Linux:**
```bash
bash setup.sh
```

**Windows:**
```cmd
npm install && npm run build
```

The script will check your Node.js version, install all dependencies (including ffmpeg — no separate download needed), and build the tool. This takes about 1–2 minutes on a normal connection.

---

### Step 5 — Launch the web UI

**macOS / Linux** — the setup script will ask if you want to launch now. Press `Y` and Enter.

**Windows** (or any time after first setup):
```cmd
npm run serve
```

Your browser will open to **http://127.0.0.1:7777** with the full UI. You're done.

---

### Step 6 — (Optional) Enable YouTube/Vimeo URL downloads

The tool can pull video directly from a URL if you have `yt-dlp` installed. Without it, local file and GIF conversion works fine.

<details>
<summary><strong>macOS — install yt-dlp</strong></summary>

If you have Homebrew:
```bash
brew install yt-dlp
```

No Homebrew? Install it with Python:
```bash
pip3 install yt-dlp
```

No Python either? Download the binary directly from [github.com/yt-dlp/yt-dlp/releases](https://github.com/yt-dlp/yt-dlp/releases) — grab `yt-dlp_macos` and move it to `/usr/local/bin/yt-dlp`.

</details>

<details>
<summary><strong>Windows — install yt-dlp</strong></summary>

**Option A — winget (easiest):** Open Command Prompt and run:
```cmd
winget install yt-dlp
```

**Option B — manual:** Download `yt-dlp.exe` from [github.com/yt-dlp/yt-dlp/releases](https://github.com/yt-dlp/yt-dlp/releases) and place it in the same folder as the tool, or anywhere on your PATH.

**Option C — pip:** If you have Python installed:
```cmd
pip install yt-dlp
```

</details>

<details>
<summary><strong>Linux — install yt-dlp</strong></summary>

```bash
pip install yt-dlp
# or
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod +x /usr/local/bin/yt-dlp
```

</details>

---

### Returning after first setup

You only need to do Steps 1–4 once. After that, just open a terminal in the folder and run:

```bash
npm run serve
```

---

## How to use the web UI

1. Open **http://127.0.0.1:7777** in your browser (it opens automatically on first launch)
2. Drop a file onto the drop zone — or paste a YouTube/Vimeo URL into the URL field
3. A **side-by-side preview** shows Cover / Contain / Stretch so you can pick the right fit
4. Adjust fit, crop anchor, FPS, bitrate, and optional trim
5. Click **Convert** — a progress bar tracks downloading (for URLs) and encoding separately
6. Click **Download** when it finishes

Upload the finished `.mp4` or `.png` at **[xpanel.finalmouse.com](https://xpanel.finalmouse.com)** → Keyboard → Skins → select a slot → Upload.

---

---

## For developers

If you want to use the CLI, install globally, or contribute:

```bash
git clone https://github.com/your-username/cpro-util.git
cd cpro-util
npm install && npm run build
npm link          # optional: installs the `cpro` command globally
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

> **YouTube/Vimeo URLs** require `yt-dlp` installed on your system. See the [Optional: Enable YouTube/Vimeo URL downloads](#step-6--optional-enable-youtubevimeo-url-downloads) section above. Local file and GIF conversion works without it.

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

