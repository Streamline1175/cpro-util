# cpro-util Stream Deck Plugin

A Stream Deck plugin for switching skin slots on the Finalmouse Centerpiece keyboard.

## Requirements

- cpro-util server running (`cpro serve`, default port 7777)
- Keyboard connected via USB
- Elgato Stream Deck software ≥ 6.4

## Setup

```bash
cd streamdeck-plugin
npm install
npm run build
streamdeck link    # symlinks the plugin into Stream Deck's plugin folder
```

> On first run, grant **Input Monitoring** in macOS System Preferences if prompted.

## Actions

### Select Slot

Sends a `POST /api/hid/slot/:n/select` request to the local cpro-util server.

**Property Inspector options:**
- **Slot** – which skin slot to activate (1–5)
- **Server port** – cpro-util server port (default: 7777)
- **Refresh preview image** – pulls the current PNG from the keyboard and displays it as the button image

## Architecture

The plugin communicates with cpro-util via HTTP rather than direct HID access, so both the
Stream Deck plugin and the main server can coexist without fighting over the USB device.
