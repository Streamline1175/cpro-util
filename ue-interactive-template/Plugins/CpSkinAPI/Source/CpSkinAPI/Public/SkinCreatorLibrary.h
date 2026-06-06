// Copyright (c) community / cpro-util. MIT License.
#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "SkinCreatorLibrary.generated.h"

/**
 * USkinCreatorLibrary — stub matching the native class compiled into the
 * Finalmouse Centerpiece host application.
 *
 * === WHY THIS FILE EXISTS ===
 *
 * Reverse engineering of the stock Finalmouse skin .pak files (documented at
 * https://nun.tax/blog/reverse-engineering-the-centerpiece-pro/) revealed that
 * every skin references a native UE class called USkinCreatorLibrary, not this
 * plugin's UCpSkinAPIBPLibrary. The class is compiled into the host app and is
 * never shipped in a .pak file. Skins reference it by name; the UE reflection
 * system resolves the reference at runtime against the host app binary.
 *
 * === WHAT THIS STUB DOES ===
 *
 * Because Blueprint cooked assets only need to resolve names (not link against
 * actual bodies), a stub with matching signatures is enough. This stub lets you:
 *   - Author skins that reference USkinCreatorLibrary directly (full compat)
 *   - Cook those skins and upload them alongside skins from community authors
 *     who wrote against the real Finalmouse SDK
 *
 * The stub bodies are empty — they are stripped at cook time and are never
 * invoked. At runtime on the keyboard, the reflection system resolves all
 * calls against the real USkinCreatorLibrary in the host app binary.
 *
 * === DELEGATE SIGNATURES (from pak reverse engineering) ===
 *
 * DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnKeyboardPressedEvent, int32, KeyIndex);
 * DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnKeyboardReleasedEvent, int32, KeyIndex);
 *
 * === FUNCTION SIGNATURES (from pak reverse engineering) ===
 *
 * GetPositionByKeyIndex(int32 KeyIndex) → FVector2D
 *   Returns pixel-space key centre: X ∈ [0, 1920], Y ∈ [0, 550]
 *   Subtract (960, 275) to get world-space for Niagara spawn locations.
 *
 * === KEY INDEX MAP ===
 *
 * Indices 1–67 map to all physical keys; the spacebar is NOT indexed.
 *   Row 0: Esc=1, F1=2 … F12=13, Del=14
 *   Row 1: `=15, 1=16 … 0=25, -=26, ==27, Bksp=28
 *   Row 2: Tab=29, Q=30 … P=39, [=40, ]=41, \=42
 *   Row 3: Caps=43, A=44 … L=52, ;=53, '=54, Enter=55,56
 *   Row 4: LShift=57, Z=58 … /=66, RShift=67
 */

// ── Delegates ────────────────────────────────────────────────────────────────

/** Fired when a physical key is pressed (KeyIndex 1–67). */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnKeyboardPressedEvent,  int32, KeyIndex);

/** Fired when a physical key is released (KeyIndex 1–67). */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnKeyboardReleasedEvent, int32, KeyIndex);

// ── Library ──────────────────────────────────────────────────────────────────

UCLASS()
class CPSKINAPI_API USkinCreatorLibrary : public UBlueprintFunctionLibrary
{
    GENERATED_BODY()

public:
    // -------------------------------------------------------------------------
    // Events — these are instance properties on BP_InputEventManager in
    // community skins, but the signatures must match exactly for runtime
    // reflection to resolve them.  Bind from your skin Blueprint via
    // GetActorOfClass(BP_InputEventManager) → Cast → bind here.
    // -------------------------------------------------------------------------

    /** Fired the moment a physical key is pressed. */
    UPROPERTY(BlueprintAssignable, Category = "SkinCreator|Events")
    FOnKeyboardPressedEvent  OnKeyboardPressedEvent;

    /** Fired the moment a physical key is released. */
    UPROPERTY(BlueprintAssignable, Category = "SkinCreator|Events")
    FOnKeyboardReleasedEvent OnKeyboardReleasedEvent;

    // -------------------------------------------------------------------------
    // Functions
    // -------------------------------------------------------------------------

    /**
     * Returns the approximate pixel-space position of a key on the 1920×550
     * Centerpiece display.  Subtract (960, 275) to convert to world-space.
     *
     * @param KeyIndex  1-based hardware key index (1 = Esc … 67 = right arrow).
     */
    UFUNCTION(BlueprintCallable, BlueprintPure, Category = "SkinCreator",
              meta = (DisplayName = "Get Position By Key Index"))
    static FVector2D GetPositionByKeyIndex(int32 KeyIndex);

    /** Always returns 67 on retail hardware. */
    UFUNCTION(BlueprintCallable, BlueprintPure, Category = "SkinCreator",
              meta = (DisplayName = "Get Key Count"))
    static int32 GetKeyCount();
};
