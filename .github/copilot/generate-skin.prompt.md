---
mode: ask
---

You are helping the user generate a new interactive skin for the Finalmouse
Centerpiece Pro keyboard using the cpro-util toolbox.

Ask the user:
1. What visual effect they want when a key is pressed (describe it in plain English)
2. What they want to name the skin (e.g. "PlasmaWave", "IceCrystals")
3. Primary and secondary colours (hex codes or colour names)

Once you have that information, generate a complete `setup_interactive.py` file
(a UE 4.27.2 Python scaffolding script) following these rules:

**Hardware constraints**
- Canvas: 1920 × 550 px at 60 fps
- GPU budget: ~first-gen Xbox/Wii equivalent
- Niagara particle burst count ≤ 100
- Sim Target: CPU Sim (not GPU Compute)
- Shader complexity: minimal (≤ 2 instruction layers)

**Required structure**
The script must:
- Import only `unreal`
- Create `/Game/EntryPoint/L_EntryPoint` (entry level, boot map)
- Create `/Game/<SkinName>/L_MySkin` (working level)
- Create `BP_KeyHighlighter` Blueprint actor with the key-press wiring below
- Create `NS_KeyHit` Niagara system
- Print all Niagara module configuration instructions via `unreal.log()`
- End with `if __name__ == "__main__": main()`

**CpSkinAPI wiring (Blueprint pseudo-code)**
```
Event BeginPlay
  → GetActorOfClass(BP_InputEventManager) → Set self.inputMgr
  → self.inputMgr.OnKeyboardPressedEvent.AddDynamic(self, OnKeyPressed)

Event OnKeyPressed (KeyIndex: int32)
  → self.inputMgr.GetPositionByKeyIndex(KeyIndex) → Break Vector2D (X, Y)
  → Make Vector(X = X − 960, Y = Y − 275, Z = 50)
  → SpawnSystemAtLocation(NS_KeyHit, location, AutoDestroy=true)
    → SetNiagaraVariableInt("User.BurstCount", N)
    → SetNiagaraVariableLinearColor("User.Color", primaryColor)
    → SetNiagaraVariableFloat("User.Speed", speed)
    → Activate
```

After generating the script, also provide:
- A brief `skin_params.json` with `skinName`, `effectType`, `primaryColor`,
  `secondaryColor`, `particleCount`, `burstDuration`, `niagaraModules`
- A short deployment reminder:
  ```
  cpro ue pak init ./my-skin
  # copy the generated setup_interactive.py → ./my-skin/Python/
  # open ./my-skin/CpInteractiveSkin.uproject in UE 4.27.2
  # run Python/setup_interactive.py from the editor Python console
  cpro ue pak cook ./my-skin
  cpro ue pak upload dist/skin.pak --slot 0
  ```

Refer to `.github/copilot-instructions.md` for the full API reference and
effect archetypes (sparks, plasma, ice, lightning, fire, cosmic dust).
