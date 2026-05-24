// Copyright (c) community / cpro-util. MIT License.
#include "CpSkinAPIBPLibrary.h"

// ---------------------------------------------------------------------------
// Key index → approximate 2D screen position on 1920×550 display
//
// The real Finalmouse SDK returns exact per-key coordinates measured from the
// physical switch PCB.  This stub uses a computed grid approximation that is
// close enough for effect positioning during local preview.
//
// Layout (1-based key indices):
//   Row 0 – fn row (y ≈  55): keys  1-14   (14 keys: Esc, F1-F12, Del)
//   Row 1 – num row (y ≈ 165): keys 15-28   (14 keys: `, 1-0, -, =, Bksp)
//   Row 2 – QWERTY  (y ≈ 275): keys 29-42   (14 keys: Tab, Q-P, [, ], \)
//   Row 3 – ASDF    (y ≈ 385): keys 43-56   (14 keys: Caps, A-L, ;, ', Enter)
//   Row 4 – ZXCV    (y ≈ 495): keys 57-67   (11 keys: LShft, Z-/, RShft+arrows)
// ---------------------------------------------------------------------------

struct FCpKeyRow
{
    int32 Start;
    int32 End;
    float Y;
};

static const FCpKeyRow GKeyRows[] =
{
    {  1, 14,  55.0f },
    { 15, 28, 165.0f },
    { 29, 42, 275.0f },
    { 43, 56, 385.0f },
    { 57, 67, 495.0f },
};

static constexpr float GDisplayWidth  = 1920.0f;
static constexpr float GDisplayHeight =  550.0f;
static constexpr int32 GKeyCount      =   67;

FVector2D UCpSkinAPIBPLibrary::GetPositionByKeyIndex(int32 KeyIndex)
{
    const int32 Clamped = FMath::Clamp(KeyIndex, 1, GKeyCount);

    for (const FCpKeyRow& Row : GKeyRows)
    {
        if (Clamped >= Row.Start && Clamped <= Row.End)
        {
            const int32  KeysInRow = Row.End - Row.Start + 1;
            const float  T         = (KeysInRow > 1)
                                        ? static_cast<float>(Clamped - Row.Start) / static_cast<float>(KeysInRow - 1)
                                        : 0.5f;
            const float  X         = T * GDisplayWidth;
            return FVector2D(X, Row.Y);
        }
    }

    // Fallback: center
    return FVector2D(GDisplayWidth * 0.5f, GDisplayHeight * 0.5f);
}

int32 UCpSkinAPIBPLibrary::GetKeyCount()
{
    return GKeyCount;
}
