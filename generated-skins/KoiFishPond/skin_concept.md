# Koi Fish Pond — Interactive Centerpiece Pro Skin

## Concept

A serene Japanese koi pond fills the entire 1920 × 550 keyboard canvas, viewed
from directly above. Five koi fish swim lazily across the dark water in
continuous figure-eight wander paths. When you press any key, a ripple expands
outward from that key's exact position on the canvas — as if your fingertip
broke the water's surface. Fish close to the impact point are startled, dart
away with a tiny water-droplet splash, then gradually calm and resume their
gentle wandering.

---

## Visual Layers

### 1. Water Surface (`M_WaterSurface`)
A deep midnight-teal plane (`#02131F`) covers the entire canvas. High metallic
(0.88) and low roughness (0.06) give it near-mirror reflectivity — the koi
colours reflect subtly in the surface. An optional animated normal map
(`T_Default_Material_Grid_N`) panned at `(0.007, 0.003)` creates a slow,
barely-perceptible shimmer across the whole pond.

### 2. Koi Fish (`BP_KoiFish`)
Five actors, each a small coloured billboard or plane mesh (≈60 × 25 units):

| # | Colour      | Hex approx  | Variety       |
|---|------------|-------------|---------------|
| 1 | Deep orange | `#FF4808`   | Classic koi   |
| 2 | Golden      | `#FF8C0D`   | Ogon koi      |
| 3 | Pure white  | `#FFFFFF`   | Shiro Utsuri  |
| 4 | Crimson red | `#D92614`   | Benigoi       |
| 5 | Tangerine   | `#E67200`   | Orenji koi    |

Each fish uses a sine-wave lateral offset (body undulation) layered on top of
a steering algorithm that smoothly turns toward a random wander target. When a
target is reached, a new one is picked anywhere in the ±820 × ±235 unit range.

### 3. Water Ripple (`NS_WaterRipple`)
3 concentric ring particles spawn simultaneously at the keypress world position.
Each ring is a Niagara sprite using `M_WaterRing` — a thin luminous circle
created by a radial-distance shader node. The rings:
- Born at size 4 units (tiny)
- Scale to ≈232 units (radius) over their 0.4–1.8 s lifetime
- Fade in sharply (0 → 1 over first 12% of life), then fade out slowly
- Colour: pale sky blue `rgb(158, 219, 255)` with additive alpha

The staggered lifetimes (0.4 / 1.1 / 1.8 s) create the classic three-ring
pond ripple pattern without any timing Blueprint logic.

### 4. Fish Startled Splash (`NS_FishSplash`)
8 tiny water-droplet particles burst outward from each fish that is within
450 units of the ripple origin. They arc up and fall back down via gravity
(Z = −110), fade out in ~0.35 s. Small, subtle — just enough to sell the
"scared fish" moment.

---

## Interaction Design

```
Key pressed
    │
    ├─ Map key index → canvas pixel → world position (X−960, Y−275)
    │
    ├─ Spawn NS_WaterRipple at world position
    │    └─ 3 rings expand + fade over 0.4–1.8 s
    │
    └─ For each BP_KoiFish:
          dist = distance(fish, ripple origin)
          if dist < 450 units:
              └─ Call Scare(origin)
                   ├─ Set scaredTimer = 2.8 s
                   ├─ Pick flee target (away from origin, 540 units)
                   └─ Spawn NS_FishSplash (8 droplets)

Fish behaviour loop (runs every Tick):
    if scaredTimer > 0:
        speed = 360 units/s  (flee)
        scaredTimer -= deltaTime
    else:
        speed = 110 units/s  (wander)

    swimPhase += deltaTime × 2.9
    wiggle = sin(swimPhase) × 16  (body undulation)
    move toward (targetPos + perpendicular wiggle offset)
    rotate to face direction of travel
    if near target: pick new random wander target
```

---

## Asset Checklist

| Asset | Type | Notes |
|-------|------|-------|
| `L_EntryPoint` | Level | Boot map — do not edit |
| `L_KoiFishPond` | Level | Working level, stream-loaded |
| `M_WaterSurface` | Material | Opaque, high metallic, teal |
| `M_WaterRing` | Material | Translucent, unlit, ring shader |
| `NS_WaterRipple` | Niagara System | 3 rings, CPU sim, sprite renderer |
| `NS_FishSplash` | Niagara System | 8 droplets, CPU sim |
| `BP_KoiFish` | Blueprint Actor | Wander + flee AI |
| `BP_PondManager` | Blueprint Actor | Key event → ripple + scare |

---

## GPU Budget

| Effect | Particles | Duration |
|--------|-----------|---------|
| NS_WaterRipple (per keypress) | 3 | 0.4–1.8 s |
| NS_FishSplash (per scared fish) | 8 | ~0.35 s |
| Max simultaneous (all 5 fish scared) | 43 | — |
| Budget ceiling | 100 | — |

Well within the Centerpiece GPU limit. The fish Tick AI (5 actors × 1 Tick)
adds negligible CPU overhead.

---

## Visual References

The skin is inspired by the **Finalmouse Centerpiece Pro announcement video**
featuring a koi pond. Notable differences and improvements:
- Fish colours use the traditional Japanese koi breed palette
- Water surface uses physically-based metallic shading for more realistic
  reflections instead of a flat painted texture
- Ripple rings expand via Niagara `Scale Sprite Size` (shader-correct scaling)
  rather than sprite-sheet flipbooks, giving smoother expansion at lower cost
- Fish scatter uses real physics-informed flee AI, not scripted animation paths

---

## Deployment

```bash
# After wiring all Blueprints and configuring the Niagara systems:
cpro ue pak cook  ./KoiFishPond
cpro ue pak upload dist/skin.pak --slot 0
```

Upload to any of the five keyboard slots (0–4). The skin activates immediately
without a keyboard reboot.
