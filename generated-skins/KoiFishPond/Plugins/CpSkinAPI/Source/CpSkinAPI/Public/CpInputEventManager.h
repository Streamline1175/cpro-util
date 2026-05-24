// Copyright (c) community / cpro-util. MIT License.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "CpInputEventManager.generated.h"

// ---------------------------------------------------------------------------
// Delegates
// ---------------------------------------------------------------------------

/** Fired when a Centerpiece key is pressed or released.
 *  KeyIndex is 1-based (1 = Escape … 67 = right arrow). */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnCpKeyboardEvent, int32, KeyIndex);

// ---------------------------------------------------------------------------
// Actor
// ---------------------------------------------------------------------------

/**
 * ACpInputEventManager
 *
 * Singleton-style actor placed by the template level.  DO NOT modify or
 * duplicate it — reference it via GetActorOfClass(BP_InputEventManager) and
 * bind to its event dispatchers.
 *
 * On the physical keyboard the Finalmouse SDK feeds hardware key scancodes
 * into this actor.  On a desktop PC we intercept UE keyboard input and map
 * it to Centerpiece key indices (1-67) so you can preview interactivity.
 *
 * Desktop key → Centerpiece index mapping
 * ---------------------------------------
 *   Row 0 (fn):    Esc→1, F1→2 … F12→13, Delete→14
 *   Row 1 (nums):  `→15, 1→16 … 0→25, -→26, =→27, Bksp→28
 *   Row 2 (QWERTY):Tab→29, Q→30 … P→39, [→40, ]→41, \→42
 *   Row 3 (ASDF):  Caps→43, A→44 … L→53, ;→54, '→55, Enter→56
 *   Row 4 (ZXCV):  LShift→57, Z→58 … /→66, RShift→67
 *   (bottom row, space, arrows etc. are not mapped in the stub)
 */
UCLASS(BlueprintType, Blueprintable)
class CPSKINAPI_API ACpInputEventManager : public AActor
{
    GENERATED_BODY()

public:
    ACpInputEventManager();

    // ------------------------------------------------------------------
    // Events — bind to these from your skin Blueprint
    // ------------------------------------------------------------------

    /** Fired the moment a key is pressed. */
    UPROPERTY(BlueprintAssignable, Category = "CpSkinAPI|Events")
    FOnCpKeyboardEvent OnKeyboardPressedEvent;

    /** Fired the moment a key is released. */
    UPROPERTY(BlueprintAssignable, Category = "CpSkinAPI|Events")
    FOnCpKeyboardEvent OnKeyboardReleasedEvent;

protected:
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaTime) override;
    virtual void SetupPlayerInputComponent(class UInputComponent* InputComponent) override;

private:
    /** Build the desktop-key → index lookup table. */
    void BuildKeyMap();

    /** Per-frame polling fallback for keys not supported by action mappings. */
    void PollRawKeys(float DeltaTime);

    TMap<FKey, int32> PressedKeyToIndex;
    TMap<FKey, bool>  KeyWasDown;  // for polling-based keys
};
