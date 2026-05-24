// Copyright (c) community / cpro-util. MIT License.
#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "CpSkinAPIBPLibrary.generated.h"

/**
 * Blueprint function library that exposes the Finalmouse Centerpiece skin API.
 *
 * On the physical keyboard the real Finalmouse SDK provides these functions.
 * This dummy implementation lets you build and test interactive skins on a
 * desktop PC before cooking and uploading to the keyboard.
 *
 * Key index convention (1-based):
 *   1  = Escape   (top-left of display)
 *   67 = → arrow  (bottom-right of display)
 *
 * Coordinate system: X ∈ [0, 1920],  Y ∈ [0, 550]  (top-left origin)
 */
UCLASS()
class CPSKINAPI_API UCpSkinAPIBPLibrary : public UBlueprintFunctionLibrary
{
    GENERATED_BODY()

public:
    /**
     * Returns the approximate 2-D screen position (pixels) of a key, given its
     * hardware key index.  Use this to spawn Niagara effects directly at the
     * key that was pressed.
     *
     * Subtract (960, 275) from the result to convert from screen-space to the
     * world-space used by the default template camera / plane setup.
     *
     * @param KeyIndex  1-based hardware key index (1 = Esc … 67 = → arrow).
     * @return          Pixel position on the 1920×550 Centerpiece display.
     */
    UFUNCTION(BlueprintCallable, BlueprintPure, Category = "CpSkinAPI",
              meta = (DisplayName = "Get Position By Key Index"))
    static FVector2D GetPositionByKeyIndex(int32 KeyIndex);

    /**
     * Returns the total number of keys the Centerpiece keyboard reports.
     * Always 67 on retail hardware.
     */
    UFUNCTION(BlueprintCallable, BlueprintPure, Category = "CpSkinAPI",
              meta = (DisplayName = "Get Key Count"))
    static int32 GetKeyCount();
};
