# CpInteractiveSkin — Centerpiece Interactive Skin Template

A **UE 4.27.2 / Android** project template for authoring interactive Finalmouse
Centerpiece skins that react to real key presses with Niagara particle effects
(or any other UE Blueprint logic).

> **This template is managed by [cpro-util](https://github.com/community/cpro-util).**
> Use `cpro ue pak` commands instead of working with these files directly.

---

## Prerequisites (one-time setup — ~15–30 GB storage)

### 1 · Android Studio

Install **Android Studio** and open the **SDK Manager**. Enable:

| Component | Version |
|---|---|
| SDK Platform | Android 11 (API 30) |
| SDK Build-Tools | 30.0.3 |
| NDK (Side by side) | 21.x (any 21.x) |
| Android SDK Command-line Tools | 8.0 |
| CMake | 3.18.1 |
| SDK Platform-Tools | (latest) |

In the SDK Manager: turn **"Show Package Details"** on and **"Hide Obsolete Packages"** off so all version options appear.

### 2 · Unreal Engine 4.27.2 (source build)

1. Go to [unrealengine.com](https://www.unrealengine.com) → GitHub access → clone **4.27** branch.
2. Run `Setup.bat` (Windows) / `Setup.sh` (Mac/Linux) then `GenerateProjectFiles`.
3. Build the `UE4` target in **Visual Studio 2019** (Release or Development).  
   Workloads needed: `.NET Desktop`, `Desktop development with C++`, `Game development with C++`.

> **Version matters.** Use exactly **4.27.2**.  
> Download the patched commit referenced in the Finalmouse community Discord if you see build errors related to Android signing.

### 3 · Visual Studio 2019

- Install workloads: `.NET Desktop Development`, `Desktop development with C++`, `Game development with C++`.
- **Do not use VS 2022** for UE 4.27 builds — you will get upgrade prompts that add friction.

---

## Project setup

```
cpro ue pak init <my-skin-dir>
```

Then:

1. Right-click `CpInteractiveSkin.uproject` → **Switch Unreal Engine Version** → pick your source build.
2. Open the `.sln` that appears in **Visual Studio 2019**.
3. Build the `CpInteractiveSkin` project (builds the dummy `CpSkinAPI` plugin).
4. Open `CpInteractiveSkin.uproject` in the UE 4.27.2 editor.
5. Run the Python scaffolder from the editor console:
   ```python
   import unreal, sys
   sys.path.insert(0, unreal.Paths.project_dir() + "/Python")
   import setup_interactive; setup_interactive.main()
   ```

---

## Authoring your skin

Your working directory in the Content Browser is `/Game/MySkin`.  
**Do not modify** `/Game/EntryPoint` or `BP_InputEventManager`.

### Blueprint wiring (BeginPlay)

```
[Event BeginPlay]
    └→ Get Actor Of Class (class: BP_InputEventManager)
         └→ Set Variable: inputMgr
              └→ Bind Event to OnKeyboardPressedEvent
                    └→ Create Event → [On Key Pressed]
```

### Blueprint wiring (On Key Pressed)

```
[On Key Pressed]  (receives: int32 KeyIndex)
    └→ GetPositionByKeyIndex(KeyIndex)
         └→ Break Vector2D  →  X, Y
              └→ Make Vector  (X = X-960,  Y = Y-275,  Z = 0)
                   └→ Spawn System At Location (System: NS_KeyHit, Location: ↑)
                         └→ (Auto Destroy: ✓,  Auto Activate: ✓)
```

### Niagara performance tips

The Centerpiece GPU is roughly equivalent to a first-generation Xbox.

| Rule | Guideline |
|---|---|
| Sim target | **CPU Sim** for ≤ 100 particles per burst |
| Sim target | GPU Compute only if you genuinely need > 100 particles and test performance |
| Burst count | Start at 20–30; test on hardware before going higher |
| Forces | Curl Noise + Drag is fine at low counts; disable for budget |
| Material | Keep shader instructions minimal — no expensive layered materials |

---

## Cook & upload

```bash
# Cook assets → .pak (requires UE 4.27.2 root, set UE427_ROOT env or pass --ue-path)
cpro ue pak cook .

# Upload .pak to keyboard slot 0 (auto-discovers keyboard on local network)
cpro ue pak upload dist/skin.pak --slot 0

# If auto-discovery fails, specify the keyboard IP directly
cpro ue pak upload dist/skin.pak --slot 0 --host 192.168.1.42
```

The first cook may need a full Android build from inside the editor:  
**File → Package Project → Android (ASTC)**  
Subsequent cooks via `cpro ue pak cook` are much faster (asset-cook only).

---

## Key index reference

| Index range | Row |
|---|---|
| 1–14  | Fn row — Esc, F1–F12, Del |
| 15–28 | Number row — `, 1–0, -, =, Bksp |
| 29–42 | QWERTY row — Tab, Q–P, [, ], \ |
| 43–56 | ASDF row — Caps, A–L, ;, ', Enter |
| 57–67 | ZXCV row — LShift, Z–/, RShift |

Key 1 = Escape (top-left).  Key 67 = right-most key of bottom row.  
`GetPositionByKeyIndex` returns pixel coordinates: X ∈ [0, 1920], Y ∈ [0, 550].
