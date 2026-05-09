// Copyright (c) community / cpro-util. MIT License.
#include "CpInputEventManager.h"
#include "CpSkinAPIBPLibrary.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/PlayerInput.h"

// ---------------------------------------------------------------------------
// Desktop key → Centerpiece key index table
// ---------------------------------------------------------------------------

using FKeyRow = TPair<FKey, int32>;

static const FKeyRow GDesktopKeyMap[] =
{
    // Row 0 – function row (keys 1-14)
    { EKeys::Escape,      1  },
    { EKeys::F1,          2  },
    { EKeys::F2,          3  },
    { EKeys::F3,          4  },
    { EKeys::F4,          5  },
    { EKeys::F5,          6  },
    { EKeys::F6,          7  },
    { EKeys::F7,          8  },
    { EKeys::F8,          9  },
    { EKeys::F9,          10 },
    { EKeys::F10,         11 },
    { EKeys::F11,         12 },
    { EKeys::F12,         13 },
    { EKeys::Delete,      14 },

    // Row 1 – number row (keys 15-28)
    { EKeys::Tilde,       15 },
    { EKeys::One,         16 },
    { EKeys::Two,         17 },
    { EKeys::Three,       18 },
    { EKeys::Four,        19 },
    { EKeys::Five,        20 },
    { EKeys::Six,         21 },
    { EKeys::Seven,       22 },
    { EKeys::Eight,       23 },
    { EKeys::Nine,        24 },
    { EKeys::Zero,        25 },
    { EKeys::Hyphen,      26 },
    { EKeys::Equals,      27 },
    { EKeys::BackSpace,   28 },

    // Row 2 – QWERTY (keys 29-42)
    { EKeys::Tab,         29 },
    { EKeys::Q,           30 },
    { EKeys::W,           31 },
    { EKeys::E,           32 },
    { EKeys::R,           33 },
    { EKeys::T,           34 },
    { EKeys::Y,           35 },
    { EKeys::U,           36 },
    { EKeys::I,           37 },
    { EKeys::O,           38 },
    { EKeys::P,           39 },
    { EKeys::LeftBracket, 40 },
    { EKeys::RightBracket,41 },
    { EKeys::Backslash,   42 },

    // Row 3 – ASDF (keys 43-56)
    { EKeys::CapsLock,    43 },
    { EKeys::A,           44 },
    { EKeys::S,           45 },
    { EKeys::D,           46 },
    { EKeys::F,           47 },
    { EKeys::G,           48 },
    { EKeys::H,           49 },
    { EKeys::J,           50 },
    { EKeys::K,           51 },
    { EKeys::L,           52 },
    { EKeys::Semicolon,   53 },
    { EKeys::Apostrophe,  54 },
    { EKeys::Enter,       55 }, // Maps to Enter / right side of row 3

    // Row 4 – ZXCV + arrows (keys 57-67)
    { EKeys::LeftShift,   57 },
    { EKeys::Z,           58 },
    { EKeys::X,           59 },
    { EKeys::C,           60 },
    { EKeys::V,           61 },
    { EKeys::B,           62 },
    { EKeys::N,           63 },
    { EKeys::M,           64 },
    { EKeys::Comma,       65 },
    { EKeys::Period,      66 },
    { EKeys::Slash,       67 },
};

// ---------------------------------------------------------------------------
// Actor implementation
// ---------------------------------------------------------------------------

ACpInputEventManager::ACpInputEventManager()
{
    PrimaryActorTick.bCanEverTick = true;
    // Allow this actor to receive input
    AutoReceiveInput = EAutoReceiveInput::Player0;
}

void ACpInputEventManager::BeginPlay()
{
    Super::BeginPlay();
    BuildKeyMap();
}

void ACpInputEventManager::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);
    PollRawKeys(DeltaTime);
}

void ACpInputEventManager::SetupPlayerInputComponent(UInputComponent* InputComponent)
{
    Super::SetupPlayerInputComponent(InputComponent);
    // Input is polled in Tick via PollRawKeys; action bindings are defined in
    // DefaultInput.ini for editor convenience (not strictly needed at runtime).
}

void ACpInputEventManager::BuildKeyMap()
{
    PressedKeyToIndex.Empty();
    KeyWasDown.Empty();

    for (const FKeyRow& Pair : GDesktopKeyMap)
    {
        PressedKeyToIndex.Add(Pair.Key, Pair.Value);
        KeyWasDown.Add(Pair.Key, false);
    }
}

void ACpInputEventManager::PollRawKeys(float /*DeltaTime*/)
{
    APlayerController* PC = GetWorld() ? GetWorld()->GetFirstPlayerController() : nullptr;
    if (!PC || !PC->PlayerInput) return;

    for (auto& Pair : PressedKeyToIndex)
    {
        const FKey&  Key      = Pair.Key;
        const int32  KeyIndex = Pair.Value;
        const bool   IsDown   = PC->IsInputKeyDown(Key);
        bool&        WasDown  = KeyWasDown.FindOrAdd(Key);

        if (IsDown && !WasDown)
        {
            OnKeyboardPressedEvent.Broadcast(KeyIndex);
        }
        else if (!IsDown && WasDown)
        {
            OnKeyboardReleasedEvent.Broadcast(KeyIndex);
        }
        WasDown = IsDown;
    }
}
