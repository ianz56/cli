// NAME: Global Menu Bridge
// AUTHOR: spicetify
// DESCRIPTION: Connects Spotify with the Spicetify Global Menu daemon for KDE Plasma and Linux desktops.

/// <reference path="../globals.d.ts" />

(function GlobalMenuBridge() {
	if (!window.Spicetify || !Spicetify.Player || !Spicetify.Platform || !Spicetify.Platform.History) {
		setTimeout(GlobalMenuBridge, 300);
		return;
	}

	const WS_URL = "ws://127.0.0.1:23819/ws";
	let ws = null;
	let reconnectTimer = null;

	function sendState() {
		if (!ws || ws.readyState !== WebSocket.OPEN) return;
		try {
			const data = Spicetify.Player.data || {};
			const item = data.item || {};
			const meta = item.metadata || {};

			const state = {
				type: "state",
				isPaused: !Spicetify.Player.isPlaying(),
				shuffle: Boolean(Spicetify.Player.getShuffle()),
				repeat: Boolean(Spicetify.Player.getRepeat()),
				repeatState: Spicetify.Player.getRepeat(),
				volume: Spicetify.Player.getVolume(),
				title: meta.title || "",
				artist: meta.artist_name || "",
				album: meta.album_title || "",
				uri: item.uri || "",
			};
			ws.send(JSON.stringify(state));
		} catch (e) {
			console.error("[GlobalMenu] Failed to send state:", e);
		}
	}

	function handleAction(action) {
		console.log("[GlobalMenu] Received action:", action);
		switch (action) {
			case "play-pause":
				Spicetify.Player.togglePlay();
				break;
			case "next":
				Spicetify.Player.next();
				break;
			case "prev":
				Spicetify.Player.back();
				break;
			case "shuffle":
				Spicetify.Player.toggleShuffle();
				break;
			case "repeat":
				Spicetify.Player.toggleRepeat();
				break;
			case "volume-up":
				Spicetify.Player.setVolume(Math.min(1, Spicetify.Player.getVolume() + 0.05));
				break;
			case "volume-down":
				Spicetify.Player.setVolume(Math.max(0, Spicetify.Player.getVolume() - 0.05));
				break;
			case "volume-mute":
				Spicetify.Player.setVolume(0);
				break;
			case "seek-forward":
				Spicetify.Player.seek(Spicetify.Player.getProgress() + 10000);
				break;
			case "seek-backward":
				Spicetify.Player.seek(Math.max(0, Spicetify.Player.getProgress() - 10000));
				break;
			case "nav-home":
				Spicetify.Platform.History.push({ pathname: "/" });
				break;
			case "nav-search":
				Spicetify.Platform.History.push({ pathname: "/search" });
				break;
			case "nav-library":
				Spicetify.Platform.History.push({ pathname: "/collection" });
				break;
			case "preferences":
				Spicetify.Platform.History.push({ pathname: "/preferences" });
				break;
			case "new-playlist":
				if (Spicetify.Platform.RootlistAPI) {
					Spicetify.Platform.RootlistAPI.createPlaylist("New Playlist");
				}
				break;
			case "toggle-lyrics": {
				const lyricsBtn =
					document.querySelector('button[data-testid="lyrics-button"]') ||
					document.querySelector('button[aria-label="Lyrics"]') ||
					document.querySelector('button[aria-label="Lirik"]');
				if (lyricsBtn) {
					lyricsBtn.click();
				} else {
					Spicetify.Platform.History.push({ pathname: "/lyrics-plus" });
				}
				break;
			}
			case "like-song":
				Spicetify.Player.toggleHeart();
				break;
			case "copy-link":
				if (Spicetify.Player.data?.item?.uri && Spicetify.Platform.ClipboardAPI) {
					Spicetify.Platform.ClipboardAPI.copy(Spicetify.Player.data.item.uri);
					if (typeof Spicetify.showNotification === "function") {
						Spicetify.showNotification("Copied link to clipboard!");
					}
				}
				break;
			case "quit":
				if (Spicetify.CosmosAsync) {
					Spicetify.CosmosAsync.post(
						"sp://esperanto/spotify.desktop.lifecycle_esperanto.proto.DesktopLifecycle/Shutdown"
					);
					Spicetify.CosmosAsync.post("sp://desktop/v1/shutdown");
				}
				break;
			default:
				console.warn("[GlobalMenu] Unknown action:", action);
		}
	}

	function connect() {
		if (ws) {
			try {
				ws.close();
			} catch (_) {}
			ws = null;
		}

		try {
			ws = new WebSocket(WS_URL);
		} catch (_) {
			scheduleReconnect();
			return;
		}

		ws.onopen = () => {
			console.log("[GlobalMenu] Connected to Global Menu daemon");
			sendState();
		};

		ws.onmessage = (event) => {
			try {
				const msg = JSON.parse(event.data);
				if (msg.action) {
					handleAction(msg.action);
				}
			} catch (e) {
				console.error("[GlobalMenu] Error processing message:", e);
			}
		};

		ws.onclose = () => {
			scheduleReconnect();
		};

		ws.onerror = () => {
			scheduleReconnect();
		};
	}

	function scheduleReconnect() {
		if (reconnectTimer) return;
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			connect();
		}, 3000);
	}

	Spicetify.Player.addEventListener("songchange", sendState);
	Spicetify.Player.addEventListener("onplaypause", sendState);
	Spicetify.Player.addEventListener("onvolume", sendState);

	connect();

	window.addEventListener("beforeunload", () => {
		if (ws) {
			ws.close();
		}
	});
})();

