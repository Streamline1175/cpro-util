// Copyright (c) community / cpro-util. MIT License.
// Stub implementation — all bodies are intentionally empty.
// See Public/SkinCreatorLibrary.h for detailed documentation.
#include "SkinCreatorLibrary.h"

// Key pixel-space positions matching GetPositionByKeyIndex() in the
// Finalmouse host app (same table as CpSkinAPIBPLibrary.cpp).
// X spacing: 1920 / 14 ≈ 137 px per key column.
// Y centres for each row: 55, 165, 275, 385, 495.
static const FVector2D KEY_POSITIONS[68] = {
    {0,    0},    // index 0 unused (1-based)
    // Row 0 — Fn / media row
    {69,   55},   {206,  55},  {343,  55},  {480,  55},
    {617,  55},   {754,  55},  {891,  55},  {1028, 55},
    {1165, 55},   {1302, 55},  {1440, 55},  {1577, 55},
    {1714, 55},   {1851, 55},
    // Row 1 — number row
    {69,   165},  {206,  165}, {343,  165}, {480,  165},
    {617,  165},  {754,  165}, {891,  165}, {1028, 165},
    {1165, 165},  {1302, 165}, {1440, 165}, {1577, 165},
    {1714, 165},  {1851, 165},
    // Row 2 — QWERTY
    {69,   275},  {206,  275}, {343,  275}, {480,  275},
    {617,  275},  {754,  275}, {891,  275}, {1028, 275},
    {1165, 275},  {1302, 275}, {1440, 275}, {1577, 275},
    {1714, 275},  {1851, 275},
    // Row 3 — ASDF
    {69,   385},  {206,  385}, {343,  385}, {480,  385},
    {617,  385},  {754,  385}, {891,  385}, {1028, 385},
    {1165, 385},  {1302, 385}, {1440, 385}, {1577, 385},
    {1714, 385},  {1851, 385},
    // Row 4 — ZXCV / shift row (11 keys)
    {69,   495},  {206,  495}, {343,  495}, {480,  495},
    {617,  495},  {754,  495}, {891,  495}, {1028, 495},
    {1165, 495},  {1302, 495}, {1440, 495},
};

FVector2D USkinCreatorLibrary::GetPositionByKeyIndex(int32 KeyIndex)
{
    if (KeyIndex >= 1 && KeyIndex <= 67)
        return KEY_POSITIONS[KeyIndex];
    return FVector2D::ZeroVector;
}

int32 USkinCreatorLibrary::GetKeyCount()
{
    return 67;
}
