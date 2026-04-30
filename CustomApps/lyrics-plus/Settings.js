const ButtonSVG = ({ icon, active = true, onClick }) => {
	return react.createElement(
		"button",
		{
			className: `switch${active ? "" : " disabled"}`,
			onClick,
		},
		react.createElement("svg", {
			width: 16,
			height: 16,
			viewBox: "0 0 16 16",
			fill: "currentColor",
			dangerouslySetInnerHTML: {
				__html: icon,
			},
		})
	);
};

const SwapButton = ({ icon, disabled, onClick }) => {
	return react.createElement(
		"button",
		{
			className: "switch small",
			onClick,
			disabled,
		},
		react.createElement("svg", {
			width: 10,
			height: 10,
			viewBox: "0 0 16 16",
			fill: "currentColor",
			dangerouslySetInnerHTML: {
				__html: icon,
			},
		})
	);
};

const CacheButton = () => {
	let lyrics = {};

	try {
		const localLyrics = JSON.parse(localStorage.getItem("lyrics-plus:local-lyrics"));
		if (!localLyrics || typeof localLyrics !== "object") {
			throw "";
		}
		lyrics = localLyrics;
	} catch {
		lyrics = {};
	}

	const [count, setCount] = useState(Object.keys(lyrics).length);
	const text = count ? "Clear all cached lyrics" : "No cached lyrics";

	return react.createElement(
		"button",
		{
			className: "btn",
			onClick: () => {
				localStorage.removeItem("lyrics-plus:local-lyrics");
				setCount(0);
			},
			disabled: !count,
		},
		text
	);
};

const RefreshTokenButton = ({ setTokenCallback }) => {
	const [buttonText, setButtonText] = useState("Refresh token");

	useEffect(() => {
		if (buttonText === "Refreshing token...") {
			Spicetify.CosmosAsync.get("https://apic-appmobile.musixmatch.com/ws/1.1/token.get?app_id=mac-ios-v2.0", null, {
				authority: "apic-appmobile.musixmatch.com",
				"x-mxm-app-version": "10.1.1",
				"User-Agent": "Musixmatch/2025120901 CFNetwork/3860.300.31 Darwin/25.2.0",
				"Accept-Language": "en-US,en;q=0.9",
				Connection: "keep-alive",
				Accept: "application/json",
			})
				.then(({ message: response }) => {
					if (response.header.status_code === 200 && response.body.user_token) {
						setTokenCallback(response.body.user_token);
						setButtonText("Token refreshed");
					} else if (response.header.status_code === 401) {
						setButtonText("Too many attempts");
					} else {
						setButtonText("Failed to refresh token");
						console.error("Failed to refresh token", response);
					}
				})
				.catch((error) => {
					setButtonText("Failed to refresh token");
					console.error("Failed to refresh token", error);
				});
		}
	}, [buttonText]);

	return react.createElement(
		"button",
		{
			className: "btn",
			onClick: () => {
				setButtonText("Refreshing token...");
			},
			disabled: buttonText !== "Refresh token",
		},
		buttonText
	);
};

const ConfigButton = ({ name, text, onChange = () => {} }) => {
	return react.createElement(
		"div",
		{
			className: "setting-row",
		},
		react.createElement(
			"label",
			{
				className: "col description",
			},
			name
		),
		react.createElement(
			"div",
			{
				className: "col action",
			},
			react.createElement(
				"button",
				{
					className: "btn",
					onClick: onChange,
				},
				text
			)
		)
	);
};

const ConfigSlider = ({ name, defaultValue, onChange = () => {} }) => {
	const [active, setActive] = useState(defaultValue);

	useEffect(() => {
		setActive(defaultValue);
	}, [defaultValue]);

	const toggleState = useCallback(() => {
		const state = !active;
		setActive(state);
		onChange(state);
	}, [active]);

	return react.createElement(
		"div",
		{
			className: "setting-row",
		},
		react.createElement(
			"label",
			{
				className: "col description",
			},
			name
		),
		react.createElement(
			"div",
			{
				className: "col action",
			},
			react.createElement(ButtonSVG, {
				icon: Spicetify.SVGIcons.check,
				active,
				onClick: toggleState,
			})
		)
	);
};

const ConfigSelection = ({ name, defaultValue, options, onChange = () => {} }) => {
	const [value, setValue] = useState(defaultValue);

	const setValueCallback = useCallback(
		(event) => {
			let value = event.target.value;
			if (!Number.isNaN(Number(value))) {
				value = Number.parseInt(value);
			}
			setValue(value);
			onChange(value);
		},
		[value, options]
	);

	useEffect(() => {
		setValue(defaultValue);
	}, [defaultValue]);

	if (!Object.keys(options).length) return null;

	return react.createElement(
		"div",
		{
			className: "setting-row",
		},
		react.createElement(
			"label",
			{
				className: "col description",
			},
			name
		),
		react.createElement(
			"div",
			{
				className: "col action",
			},
			react.createElement(
				"select",
				{
					className: "main-dropDown-dropDown",
					value,
					onChange: setValueCallback,
				},
				Object.keys(options).map((item) =>
					react.createElement(
						"option",
						{
							value: item,
						},
						options[item]
					)
				)
			)
		)
	);
};

const ConfigInput = ({ name, defaultValue, onChange = () => {} }) => {
	const [value, setValue] = useState(defaultValue);

	const setValueCallback = useCallback(
		(event) => {
			const value = event.target.value;
			setValue(value);
			onChange(value);
		},
		[value]
	);

	return react.createElement(
		"div",
		{
			className: "setting-row",
		},
		react.createElement(
			"label",
			{
				className: "col description",
			},
			name
		),
		react.createElement(
			"div",
			{
				className: "col action",
			},
			react.createElement("input", {
				value,
				onChange: setValueCallback,
			})
		)
	);
};

const ConfigAdjust = ({ name, defaultValue, step, min, max, onChange = () => {} }) => {
	const [value, setValue] = useState(defaultValue);

	function adjust(dir) {
		let temp = value + dir * step;
		if (temp < min) {
			temp = min;
		} else if (temp > max) {
			temp = max;
		}
		setValue(temp);
		onChange(temp);
	}
	return react.createElement(
		"div",
		{
			className: "setting-row",
		},
		react.createElement(
			"label",
			{
				className: "col description",
			},
			name
		),
		react.createElement(
			"div",
			{
				className: "col action",
			},
			react.createElement(SwapButton, {
				icon: `<path d="M2 7h12v2H0z"/>`,
				onClick: () => adjust(-1),
				disabled: value === min,
			}),
			react.createElement(
				"p",
				{
					className: "adjust-value",
				},
				value
			),
			react.createElement(SwapButton, {
				icon: Spicetify.SVGIcons.plus2px,
				onClick: () => adjust(1),
				disabled: value === max,
			})
		)
	);
};

const ConfigHotkey = ({ name, defaultValue, onChange = () => {} }) => {
	const [value, setValue] = useState(defaultValue);
	const [trap] = useState(new Spicetify.Mousetrap());

	function record() {
		trap.handleKey = (character, modifiers, e) => {
			if (e.type === "keydown") {
				const sequence = [...new Set([...modifiers, character])];
				if (sequence.length === 1 && sequence[0] === "esc") {
					onChange("");
					setValue("");
					return;
				}
				setValue(sequence.join("+"));
			}
		};
	}

	function finishRecord() {
		trap.handleKey = () => {};
		onChange(value);
	}

	return react.createElement(
		"div",
		{
			className: "setting-row",
		},
		react.createElement(
			"label",
			{
				className: "col description",
			},
			name
		),
		react.createElement(
			"div",
			{
				className: "col action",
			},
			react.createElement("input", {
				value,
				onFocus: record,
				onBlur: finishRecord,
			})
		)
	);
};

const ServiceAction = ({ item, setTokenCallback }) => {
	switch (item.name) {
		case "local":
			return react.createElement(CacheButton);
		case "musixmatch":
			return react.createElement(RefreshTokenButton, { setTokenCallback });
		default:
			return null;
	}
};

const ServiceOption = ({ item, onToggle, onSwap, isFirst = false, isLast = false, onTokenChange = null, onModeToggle = null }) => {
	const [token, setToken] = useState(item.token);
	const [active, setActive] = useState(item.on);
	const [modesOn, setModesOn] = useState(item.modesOn || {});

	const setTokenCallback = useCallback(
		(token) => {
			setToken(token);
			onTokenChange(item.name, token);
		},
		[item.token]
	);

	const toggleMode = useCallback(
		(mode) => {
			setModesOn((prev) => {
				const newState = !prev[mode];
				if (onModeToggle) onModeToggle(item.name, mode, newState);
				return { ...prev, [mode]: newState };
			});
		},
		[item.name, onModeToggle]
	);

	const toggleActive = useCallback(() => {
		if (item.name === "genius" && spotifyVersion >= "1.2.31") return;
		const state = !active;
		setActive(state);
		onToggle(item.name, state);
	}, [active]);

	return react.createElement(
		"div",
		{ style: { paddingBottom: "16px" } },
		react.createElement(
			"div",
			{
				className: "setting-row",
			},
			react.createElement(
				"h3",
				{
					className: "col description",
				},
				item.name
			),
			react.createElement(
				"div",
				{
					className: "col action",
				},
				react.createElement(ServiceAction, {
					item,
					setTokenCallback,
				}),
				react.createElement(SwapButton, {
					icon: Spicetify.SVGIcons["chart-up"],
					onClick: () => onSwap(item.name, -1),
					disabled: isFirst,
				}),
				react.createElement(SwapButton, {
					icon: Spicetify.SVGIcons["chart-down"],
					onClick: () => onSwap(item.name, 1),
					disabled: isLast,
				}),
				react.createElement(ButtonSVG, {
					icon: Spicetify.SVGIcons.check,
					active,
					onClick: toggleActive,
				})
			)
		),
		react.createElement("span", {
			dangerouslySetInnerHTML: {
				__html: item.desc,
			},
		}),
		item.token !== undefined &&
			react.createElement("input", {
				placeholder: `Place your ${item.name} token here`,
				value: token,
				onChange: (event) => setTokenCallback(event.target.value),
			}),
		Object.keys(modesOn).length > 0 &&
			react.createElement(
				"div",
				{ style: { display: "flex", justifyContent: "flex-start", gap: "16px", marginTop: "12px", alignItems: "center" } },
				Object.keys(modesOn).map((mode) => {
					const labelMap = {
						karaoke: "Kara",
						synced: "Sync",
						unsynced: "Unsync",
					};
					const label = labelMap[mode] || mode.charAt(0).toUpperCase() + mode.slice(1);
					return react.createElement(
						"div",
						{ style: { display: "flex", alignItems: "center", gap: "8px" }, key: mode },
						react.createElement(
							"label",
							{
								style: { fontSize: "13px", opacity: 0.8, cursor: "pointer", userSelect: "none" },
								onClick: () => toggleMode(mode),
							},
							label
						),
						react.createElement(ButtonSVG, {
							icon: Spicetify.SVGIcons.check,
							active: modesOn[mode],
							onClick: () => toggleMode(mode),
						})
					);
				})
			)
	);
};

const ServiceList = ({ itemsList, onListChange = () => {}, onToggle = () => {}, onTokenChange = () => {}, onModeToggle = () => {} }) => {
	const [items, setItems] = useState(itemsList);
	const maxIndex = items.length - 1;

	const onSwap = useCallback(
		(name, direction) => {
			const curPos = items.findIndex((val) => val === name);
			const newPos = curPos + direction;
			[items[curPos], items[newPos]] = [items[newPos], items[curPos]];
			onListChange(items);
			setItems([...items]);
		},
		[items]
	);

	return items.map((key, index) => {
		const item = CONFIG.providers[key];
		item.name = key;
		return react.createElement(ServiceOption, {
			item,
			key,
			isFirst: index === 0,
			isLast: index === maxIndex,
			onSwap,
			onTokenChange,
			onToggle,
			onModeToggle,
		});
	});
};

const corsProxyTemplate = () => {
	const [proxyValue, setProxyValue] = react.useState(localStorage.getItem("spicetify:corsProxyTemplate") || "https://cors-proxy.spicetify.app/{url}");

	return react.createElement("input", {
		placeholder: "CORS Proxy Template",
		value: proxyValue,
		onChange: (event) => {
			const value = event.target.value;
			setProxyValue(value);

			if (value === "" || !value) return localStorage.removeItem("spicetify:corsProxyTemplate");
			localStorage.setItem("spicetify:corsProxyTemplate", value);
		},
	});
};

const OptionList = ({ type, items, onChange }) => {
	const [itemList, setItemList] = useState(items);
	const [, forceUpdate] = useState();

	useEffect(() => {
		if (!type) return;

		const eventListener = (event) => {
			if (event.detail?.type !== type) return;
			setItemList(event.detail.items);
		};
		document.addEventListener("lyrics-plus", eventListener);

		return () => document.removeEventListener("lyrics-plus", eventListener);
	}, []);

	return itemList.map((item) => {
		if (!item || (item.when && !item.when())) {
			return;
		}

		const onChangeItem = item.onChange || onChange;

		return react.createElement(
			"div",
			null,
			react.createElement(item.type, {
				...item,
				name: item.desc,
				defaultValue: CONFIG.visual[item.key],
				onChange: (value) => {
					onChangeItem(item.key, value);
					forceUpdate({});
				},
			}),
			item.info &&
				react.createElement("span", {
					dangerouslySetInnerHTML: {
						__html: item.info,
					},
				})
		);
	});
};

function openConfigOverlay(configContainer) {
	const existingOverlay = document.getElementById("lyrics-plus-settings-overlay");
	if (existingOverlay) {
		// Properly cleanup existing overlay
		const existingContentHost = existingOverlay.querySelector("div[style*='overflow: auto']");

		if (existingOverlay._keydownHandler) {
			document.removeEventListener("keydown", existingOverlay._keydownHandler);
		}
		if (existingOverlay._focusTrapHandler) {
			document.removeEventListener("keydown", existingOverlay._focusTrapHandler);
		}
		if (existingOverlay._focusInHandler) {
			document.removeEventListener("focusin", existingOverlay._focusInHandler);
		}

		try {
			if (existingContentHost && typeof Spicetify?.ReactDOM?.unmountComponentAtNode === "function") {
				Spicetify.ReactDOM.unmountComponentAtNode(existingContentHost);
			}
		} catch (error) {
			console.error("Lyrics Plus: failed to unmount existing settings overlay", error);
		} finally {
			existingOverlay.remove();
		}
	}

	const overlay = document.createElement("div");
	overlay.id = "lyrics-plus-settings-overlay";
	Object.assign(overlay.style, {
		position: "fixed",
		inset: "0",
		background: "rgba(0, 0, 0, 0.72)",
		zIndex: "2147483647",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		padding: "24px",
		pointerEvents: "auto",
		WebkitAppRegion: "no-drag",
	});

	const panel = document.createElement("div");
	panel.setAttribute("role", "dialog");
	panel.setAttribute("aria-modal", "true");
	panel.setAttribute("aria-labelledby", "lyrics-plus-settings-title");
	panel.setAttribute("tabindex", "-1");
	Object.assign(panel.style, {
		width: "min(1200px, 96vw)",
		height: "min(86vh, 920px)",
		background: "var(--spice-main)",
		color: "var(--spice-text)",
		borderRadius: "12px",
		boxShadow: "0 20px 60px rgba(0, 0, 0, 0.45)",
		display: "grid",
		gridTemplateRows: "auto 1fr",
		position: "relative",
		overflow: "hidden",
		WebkitAppRegion: "no-drag",
	});

	const header = document.createElement("div");
	Object.assign(header.style, {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		padding: "14px 16px",
		borderBottom: "1px solid var(--spice-sidebar)",
		WebkitAppRegion: "no-drag",
	});

	const title = document.createElement("h2");
	title.id = "lyrics-plus-settings-title";
	title.textContent = "Lyrics Plus";
	Object.assign(title.style, {
		margin: "0",
		fontSize: "18px",
		fontWeight: "700",
	});

	const closeButton = document.createElement("button");
	closeButton.type = "button";
	closeButton.innerHTML = "&times;";
	closeButton.setAttribute("aria-label", "Close settings");
	Object.assign(closeButton.style, {
		width: "30px",
		height: "30px",
		border: "none",
		borderRadius: "50%",
		cursor: "pointer",
		background: "rgba(255, 255, 255, 0.08)",
		color: "var(--spice-text)",
		fontSize: "16px",
		lineHeight: "1",
		WebkitAppRegion: "no-drag",
	});

	const contentHost = document.createElement("div");
	Object.assign(contentHost.style, {
		overflow: "auto",
		padding: "16px",
		WebkitAppRegion: "no-drag",
	});

	let prevFocus = document.activeElement;
	let reactRoot = null;
	let isClosing = false;

	const closeOverlay = () => {
		if (isClosing) return;
		isClosing = true;

		document.removeEventListener("keydown", handleEscape);
		document.removeEventListener("keydown", handleFocusTrap);
		document.removeEventListener("focusin", handleFocusIn);

		try {
			if (reactRoot && typeof reactRoot.unmount === "function") {
				reactRoot.unmount();
			} else if (typeof Spicetify?.ReactDOM?.unmountComponentAtNode === "function") {
				Spicetify.ReactDOM.unmountComponentAtNode(contentHost);
			}
		} catch (error) {
			console.error("Lyrics Plus: failed to unmount settings overlay", error);
		} finally {
			overlay.remove();
			if (prevFocus && typeof prevFocus.focus === "function") {
				try {
					prevFocus.focus();
				} catch (e) {
					// Ignore if element is no longer focusable
				}
			}
		}
	};

	const handleEscape = (event) => {
		if (event.key === "Escape") {
			closeOverlay();
		}
	};

	const getFocusableElements = () => {
		const focusableSelectors = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
		return Array.from(panel.querySelectorAll(focusableSelectors)).filter((el) => {
			return !el.disabled && el.offsetParent !== null;
		});
	};

	const handleFocusTrap = (event) => {
		if (event.key !== "Tab") return;

		const focusableElements = getFocusableElements();
		if (focusableElements.length === 0) return;

		const firstFocusable = focusableElements[0];
		const lastFocusable = focusableElements[focusableElements.length - 1];

		if (event.shiftKey) {
			if (document.activeElement === firstFocusable) {
				event.preventDefault();
				lastFocusable.focus();
			}
		} else {
			if (document.activeElement === lastFocusable) {
				event.preventDefault();
				firstFocusable.focus();
			}
		}
	};

	const handleFocusIn = (event) => {
		if (!panel.contains(event.target) && event.target !== panel) {
			event.preventDefault();
			const focusableElements = getFocusableElements();
			if (focusableElements.length > 0) {
				focusableElements[0].focus();
			} else {
				panel.focus();
			}
		}
	};

	overlay.addEventListener("click", (event) => {
		if (event.target === overlay) {
			closeOverlay();
		}
	});

	overlay.addEventListener("dblclick", (event) => {
		event.preventDefault();
		event.stopPropagation();
	});

	panel.addEventListener("dblclick", (event) => {
		event.preventDefault();
		event.stopPropagation();
	});

	closeButton.addEventListener("click", closeOverlay);
	document.addEventListener("keydown", handleEscape);
	document.addEventListener("keydown", handleFocusTrap);
	document.addEventListener("focusin", handleFocusIn);

	overlay._keydownHandler = handleEscape;
	overlay._focusTrapHandler = handleFocusTrap;
	overlay._focusInHandler = handleFocusIn;

	header.append(title, closeButton);
	panel.append(header, contentHost);
	overlay.append(panel);
	document.body.append(overlay);

	// React 19 compatibility: Use createRoot if available, fallback to render
	if (typeof Spicetify?.ReactDOM?.createRoot === "function") {
		reactRoot = Spicetify.ReactDOM.createRoot(contentHost);
		reactRoot.render(configContainer);
	} else if (typeof Spicetify?.ReactDOM?.render === "function") {
		Spicetify.ReactDOM.render(configContainer, contentHost);
	} else {
		console.warn("Lyrics Plus: Spicetify.ReactDOM provides neither createRoot nor render. configContainer was not rendered into contentHost.");
		if (Spicetify.showNotification) Spicetify.showNotification("Failed to render settings", true);
	}

	// Set initial focus
	setTimeout(() => {
		if (isClosing || !panel.isConnected) return;
		const focusableElements = getFocusableElements();
		if (focusableElements.length > 0) {
			focusableElements[0].focus();
		} else if (closeButton) {
			closeButton.focus();
		} else {
			panel.focus();
		}
	}, 0);
}

function openConfig() {
	const configContainer = react.createElement(
		"div",
		{
			id: `${APP_NAME}-config-container`,
		},
		react.createElement("h2", null, "Options"),
		react.createElement(OptionList, {
			items: [
				{
					desc: "Playbar button",
					key: "playbar-button",
					info: "Replace Spotify's lyrics button with Lyrics Plus.",
					type: ConfigSlider,
				},
				{
					desc: "Global delay",
					info: "Offset (in ms) across all tracks.",
					key: "global-delay",
					type: ConfigAdjust,
					min: -10000,
					max: 10000,
					step: 250,
				},
				{
					desc: "Font size",
					info: "(or Ctrl + Mouse scroll in main app)",
					key: "font-size",
					type: ConfigAdjust,
					min: fontSizeLimit.min,
					max: fontSizeLimit.max,
					step: fontSizeLimit.step,
				},
				{
					desc: "Alignment",
					key: "alignment",
					type: ConfigSelection,
					options: {
						left: "Left",
						center: "Center",
						right: "Right",
					},
				},
				{
					desc: "Fullscreen hotkey",
					key: "fullscreen-key",
					type: ConfigHotkey,
				},
				{
					desc: "Compact synced: Lines to show before",
					key: "lines-before",
					type: ConfigSelection,
					options: [0, 1, 2, 3, 4],
				},
				{
					desc: "Compact synced: Lines to show after",
					key: "lines-after",
					type: ConfigSelection,
					options: [0, 1, 2, 3, 4],
				},
				{
					desc: "Compact synced: Fade-out blur",
					key: "fade-blur",
					type: ConfigSlider,
				},
				{
					desc: "Synced: Inline background vocals",
					// info: "Show background vocals inline with parentheses instead of on a separate line.",
					key: "synced-background-inline",
					type: ConfigSlider,
				},
				{
					desc: "Noise overlay",
					key: "noise",
					type: ConfigSlider,
				},
				{
					desc: "Colorful background",
					key: "colorful",
					type: ConfigSlider,
				},
				{
					desc: "Background color",
					key: "background-color",
					type: ConfigInput,
					when: () => !CONFIG.visual.colorful,
				},
				{
					desc: "Active text color",
					key: "active-color",
					type: ConfigInput,
					when: () => !CONFIG.visual.colorful,
				},
				{
					desc: "Inactive text color",
					key: "inactive-color",
					type: ConfigInput,
					when: () => !CONFIG.visual.colorful,
				},
				{
					desc: "Highlight text background",
					key: "highlight-color",
					type: ConfigInput,
					when: () => !CONFIG.visual.colorful,
				},
				{
					desc: "Text convertion: Japanese Detection threshold (Advanced)",
					info: "Checks if whenever Kana is dominant in lyrics. If the result passes the threshold, it's most likely Japanese, and vice versa. This setting is in percentage.",
					key: "ja-detect-threshold",
					type: ConfigAdjust,
					min: thresholdSizeLimit.min,
					max: thresholdSizeLimit.max,
					step: thresholdSizeLimit.step,
				},
				{
					desc: "Text convertion: Traditional-Simplified Detection threshold (Advanced)",
					info: "Checks if whenever Traditional or Simplified is dominant in lyrics. If the result passes the threshold, it's most likely Simplified, and vice versa. This setting is in percentage.",
					key: "hans-detect-threshold",
					type: ConfigAdjust,
					min: thresholdSizeLimit.min,
					max: thresholdSizeLimit.max,
					step: thresholdSizeLimit.step,
				},
				{
					desc: "Clear Memory Cache",
					info: "Loaded lyrics are cached in memory for faster reloading. Press this button to clear the cached lyrics from memory without restarting Spotify.",
					key: "clear-memore-cache",
					text: "Clear memory cache",
					type: ConfigButton,
					onChange: () => {
						reloadLyrics?.();
					},
				},
			],
			onChange: (name, value) => {
				CONFIG.visual[name] = value;
				localStorage.setItem(`${APP_NAME}:visual:${name}`, value);
				lyricContainerUpdate?.();

				if (name === "synced-background-inline") {
					reloadLyrics?.();
				}

				const configChange = new CustomEvent("lyrics-plus", {
					detail: {
						type: "config",
						name: name,
						value: value,
					},
				});
				window.dispatchEvent(configChange);
			},
		}),
		react.createElement("h2", null, "Providers"),
		react.createElement(ServiceList, {
			itemsList: CONFIG.providersOrder,
			onListChange: (list) => {
				CONFIG.providersOrder = list;
				localStorage.setItem(`${APP_NAME}:services-order`, JSON.stringify(list));
				reloadLyrics?.();
			},
			onToggle: (name, value) => {
				CONFIG.providers[name].on = value;
				localStorage.setItem(`${APP_NAME}:provider:${name}:on`, value);
				reloadLyrics?.();
			},
			onTokenChange: (name, value) => {
				CONFIG.providers[name].token = value;
				localStorage.setItem(`${APP_NAME}:provider:${name}:token`, value);
				reloadLyrics?.();
			},
			onModeToggle: (name, mode, value) => {
				if (!CONFIG.providers[name].modesOn) return;
				CONFIG.providers[name].modesOn[mode] = value;
				localStorage.setItem(`${APP_NAME}:provider:${name}:on:${mode}`, value);
				reloadLyrics?.();
			},
		}),
		react.createElement("h2", null, "CORS Proxy Template"),
		react.createElement("span", {
			dangerouslySetInnerHTML: {
				__html:
					"Use this to bypass CORS restrictions. Replace the URL with your cors proxy server of your choice. <code>{url}</code> will be replaced with the request URL.",
			},
		}),
		react.createElement(corsProxyTemplate),
		react.createElement("span", {
			dangerouslySetInnerHTML: {
				__html: "Spotify will reload its webview after applying. Leave empty to restore default: <code>https://cors-proxy.spicetify.app/{url}</code>",
			},
		})
	);

	openConfigOverlay(configContainer);
}

if (typeof window !== "undefined") {
	window.__lyricsPlusOpenConfig = openConfig;
}
