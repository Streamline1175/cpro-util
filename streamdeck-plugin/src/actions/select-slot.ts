import {
  action,
  KeyDownEvent,
  SendToPluginEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";

/** Settings stored per action instance (configured in the PI). */
interface SelectSlotSettings {
  slot: number;       // 1–5
  serverPort: number; // default 7777
}

const DEFAULT_SETTINGS: SelectSlotSettings = { slot: 1, serverPort: 7777 };

@action({ UUID: "com.cpro-util.streamdeck.select-slot" })
export class SelectSlotAction extends SingletonAction<SelectSlotSettings> {
  /** Called when the key is pressed on the Stream Deck. */
  override async onKeyDown(ev: KeyDownEvent<SelectSlotSettings>): Promise<void> {
    const settings = { ...DEFAULT_SETTINGS, ...ev.payload.settings };
    const { slot, serverPort } = settings;

    const url = `http://localhost:${serverPort}/api/hid/slot/${slot}/select`;
    try {
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) {
        await ev.action.showAlert();
        return;
      }
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (data.ok) {
        await ev.action.showOk();
        await ev.action.setTitle(`Slot ${slot}`);
      } else {
        await ev.action.showAlert();
      }
    } catch {
      // Server not running or keyboard disconnected
      await ev.action.showAlert();
    }
  }

  /** Called when the action appears on the deck — update title from settings. */
  override async onWillAppear(ev: WillAppearEvent<SelectSlotSettings>): Promise<void> {
    const settings = { ...DEFAULT_SETTINGS, ...ev.payload.settings };
    await ev.action.setTitle(`Slot ${settings.slot}`);
    // Optionally fetch and display the slot preview as the button image
    this._loadPreviewImage(ev.action, settings).catch(() => {});
  }

  /** Called when the Property Inspector sends a message (e.g., "refresh preview"). */
  override async onSendToPlugin(ev: SendToPluginEvent<{ event: string }, SelectSlotSettings>): Promise<void> {
    const settings = { ...DEFAULT_SETTINGS, ...ev.payload.settings };
    if (ev.payload.event === "refreshPreview") {
      await this._loadPreviewImage(ev.action, settings);
    }
  }

  private async _loadPreviewImage(
    action: KeyDownEvent<SelectSlotSettings>["action"],
    settings: SelectSlotSettings
  ): Promise<void> {
    const { slot, serverPort } = settings;
    const url = `http://localhost:${serverPort}/api/hid/slot/${slot}/preview`;
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const data = (await res.json()) as { ok: boolean; dataUrl?: string };
      if (data.ok && data.dataUrl) {
        await action.setImage(data.dataUrl);
      }
    } catch {
      // Server not running – ignore
    }
  }
}
