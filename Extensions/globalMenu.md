# Global Menu Bridge (Linux / KDE Plasma)

**Global Menu** integration for Spotify on Linux desktop environments supporting the DBusMenu specification (primarily **KDE Plasma**, as well as Unity, XFCE AppMenu, and other compatible desktop panels).

---

## 🌟 Features

- **Standard D-Bus Menu (`com.canonical.dbusmenu`)**: Exported on object path `/MenuBar` under bus name `org.spicetify.GlobalMenu`.
- **Comprehensive Menu Support**:
  - **File**: New Playlist, Preferences/Settings, Close Window, Quit Spotify.
  - **Edit**: Undo, Redo, Cut, Copy, Paste, Select All, Search.
  - **Playback**: Dynamic Play/Pause, Next Track, Previous Track, Seek 10s Forward/Backward, Shuffle & Repeat (with checkmark toggles), Volume Up/Down, Mute.
  - **View**: Home, Search, Your Library, Toggle Lyrics (supports Lyrics-Plus), Full Screen, Zoom In/Out/Reset.
  - **Help**: About Spotify, Spicetify Documentation, Dynamic *Now Playing* label.
- **Automatic Window Attachment**: Automatically detects Spotify windows (X11 / XWayland) and attaches the necessary X11 window properties (`_KDE_NET_WM_APPMENU_SERVICE_NAME` and `_KDE_NET_WM_APPMENU_OBJECT_PATH`).
- **MPRIS Fallback**: Essential playback controls remain functional directly through Spotify's native MPRIS D-Bus interface even if the JavaScript extension is disconnected or loading.
- **Autostart Manager**: Built-in CLI commands to easily manage desktop autostart on user login.

---

## 📐 Architecture

Because Spotify on Linux is built on top of the Chromium Embedded Framework (CEF), JavaScript running in the web renderer cannot directly communicate with system D-Bus sockets or manipulate X11 window atoms. This feature uses a lightweight hybrid two-component architecture:

```
[ KDE Plasma Global Menu (Top Panel) ]
                 ▲
                 │ (D-Bus: com.canonical.dbusmenu)
                 ▼
[ Spicetify Global Menu Daemon (Go) ]
                 ▲
                 │ (Local WebSocket: ws://127.0.0.1:23819/ws)
                 ▼
[ Spicetify Extension: globalMenu.js ]
                 │ (Spicetify.Platform & Spicetify.Player APIs)
                 ▼
          [ Spotify Client ]
```

---

## 🚀 Installation & Usage

### 1. Enable the Extension in Spotify

Ensure the wrapper bundle is built, then enable the `globalMenu.js` extension:

```bash
# Build the wrapper bundle (required on recent versions of Spicetify)
pnpm build:wrapper

# Register the extension and apply customizations to Spotify
spicetify config extensions globalMenu.js
spicetify apply
```

### 2. Run the Daemon

Start the daemon in your terminal or background:

```bash
spicetify global-menu
```

### 3. Autostart on Desktop Login (Optional & Recommended)

To run the daemon automatically in the background whenever you log into your desktop:

```bash
# Install autostart desktop entry (~/.config/autostart/)
spicetify global-menu --install-autostart

# To remove autostart at any time:
spicetify global-menu --uninstall-autostart
```

---

## ⚙️ CLI Options & Flags

```
USAGE
    spicetify global-menu [flags]

FLAGS
    --port <number>            Port for WebSocket connection (default: 23819)
    --install-autostart        Create desktop autostart entry (~/.config/autostart/)
    --uninstall-autostart      Remove desktop autostart entry
    -h, --help                 Display help message
```

---

## 🔧 Troubleshooting

### 1. Spotify Screen is Blank or `Spicetify is not defined`
Make sure the `jsHelper/spicetifyWrapper.js` bundle has been compiled before applying:
```bash
pnpm install
pnpm build:wrapper
spicetify apply
```

### 2. Menu Does Not Appear in KDE Panel
1. Make sure the **Global Menu** widget is added to your KDE Plasma panel.
2. Confirm the daemon is running (`pgrep -a spicetify` should show `spicetify global-menu`).
3. Check if the D-Bus service is exported correctly:
   ```bash
   busctl --user introspect org.spicetify.GlobalMenu /MenuBar
   ```
4. Verify window properties on the Spotify window:
   ```bash
   xprop -id $(xdotool search --class spotify | head -n 1) _KDE_NET_WM_APPMENU_SERVICE_NAME _KDE_NET_WM_APPMENU_OBJECT_PATH
   ```
