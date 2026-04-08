const CreditFooter = react.memo(({ provider, copyright }) => {
	if (provider === "local") return null;
	const credit = [Spicetify.Locale.get("web-player.lyrics.providedBy", provider)];
	if (copyright) {
		credit.push(...copyright.split("\n"));
	}

	return (
		provider &&
		react.createElement(
			"p",
			{
				className: "lyrics-lyricsContainer-Provider main-type-mesto",
				dir: "auto",
			},
			credit.join(" • ")
		)
	);
});

const IdlingIndicator = ({ isActive, progress, delay, className = "", style = {} }) => {
	return react.createElement(
		"div",
		{
			className: `lyrics-idling-indicator ${isActive === false ? "lyrics-idling-indicator-hidden" : ""} ${className}`.trim(),
			style: {
				"--indicator-delay": `${delay}ms`,
				...style,
			},
		},
		react.createElement("div", { className: `lyrics-idling-indicator__circle ${progress >= 0.05 ? "active" : ""}` }),
		react.createElement("div", { className: `lyrics-idling-indicator__circle ${progress >= 0.33 ? "active" : ""}` }),
		react.createElement("div", { className: `lyrics-idling-indicator__circle ${progress >= 0.66 ? "active" : ""}` })
	);
};

const emptyLine = {
	startTime: 0,
	endTime: 0,
	text: [],
};

const isPauseLine = (line) => {
	const text = line?.text;
	if (line?.background && line.background.length > 0) return false;
	if (!text) return true;
	if (Array.isArray(text)) {
		const joined = text
			.map((w) => (typeof w === "object" ? w.word : w))
			.join("")
			.trim();
		return joined === "♪" || joined === "";
	}
	const str = typeof text === "object" ? text?.props?.children?.[0] : text;
	return !str || str.trim() === "♪" || str.trim() === "";
};

const findNextLineStartTime = (lines, fromIndex) => {
	for (let j = fromIndex + 1; j < lines.length; j++) {
		if (!isPauseLine(lines[j]) && lines[j].startTime != null) {
			return lines[j].startTime;
		}
	}
	return null;
};

const LONG_PAUSE_THRESHOLD = 8000; // 8 seconds
const KARA_DELAY = 500; // 0.5 seconds

const processPauseLines = (lyrics, isKara) => {
	if (!lyrics || !lyrics.length) return lyrics;
	const result = [];
	for (let i = 0; i < lyrics.length; i++) {
		const line = lyrics[i];
		const nextLine = lyrics[i + 1];

		if (isPauseLine(line)) {
			// Skip consecutive pause lines to consolidate them into one idling indicator
			const lastLine = result[result.length - 1];
			if (lastLine && isPauseLine(lastLine)) {
				continue;
			}

			const nextStart = findNextLineStartTime(lyrics, i);
			const pauseStart = line.startTime || 0;
			if (nextStart != null) {
				const pauseDuration = nextStart - pauseStart;
				if (pauseDuration >= LONG_PAUSE_THRESHOLD) {
					result.push({
						...line,
						startTime: line.startTime + (isKara ? KARA_DELAY : 0),
					});
				}
			}
		} else {
			const effectiveEnd = line.endTime != null ? line.endTime : nextLine?.startTime;
			result.push({ ...line, endTime: effectiveEnd });

			if (effectiveEnd != null && nextLine && nextLine.startTime != null) {
				const gap = nextLine.startTime - effectiveEnd;
				if (gap >= LONG_PAUSE_THRESHOLD && !isPauseLine(nextLine)) {
					result.push({
						text: "♪",
						startTime: effectiveEnd + (isKara ? KARA_DELAY : 0),
						endTime: nextLine.startTime,
					});
				}
			}
		}
	}
	return result;
};

const isRTLText = (str) => /[\u0591-\u07FF\u200F\u202B\u202E\uFB1D-\uFDFD\uFE70-\uFEFC]/.test(str);

const renderPerformer = (performer, previousPerformer, compact) => {
	if (!CONFIG.visual["show-performers"] || !performer) return null;
	if (!compact) {
		if (previousPerformer === performer) return null;
	}
	return react.createElement("span", { className: "lyrics-lyricsContainer-Performer" }, performer);
};

const useTrackPosition = (callback) => {
	const callbackRef = useRef();
	callbackRef.current = callback;

	useEffect(() => {
		const interval = setInterval(() => {
			if (callbackRef.current) {
				callbackRef.current();
			}
		}, 50);

		return () => {
			clearInterval(interval);
		};
	}, []);
};

const KaraokeLine = ({ text, isActive, position, startTime, endTime }) => {
	if ((endTime != null && position > endTime + KARA_DELAY) || (!isActive && position > startTime)) {
		return text.map(({ word }, i) => (typeof word === "string" ? word : react.cloneElement(word, { key: i })));
	}

	let accumulatedTime = startTime;
	return text.map(({ word, time }, i) => {
		const isRTL = isRTLText(typeof word === "string" ? word : "");
		const isWordActive = position >= startTime;
		startTime += time;
		const isWordComplete = isWordActive && position >= startTime;
		return react.createElement(
			"span",
			{
				key: i,
				className: `lyrics-lyricsContainer-Karaoke-Word${isWordActive ? " lyrics-lyricsContainer-Karaoke-WordActive" : ""}${isRTL ? " lyrics-lyricsContainer-Karaoke-WordRTL" : ""}`,
				style: {
					"--word-duration": `${time}ms`,
					// don't animate unless we have to
					transition: !isWordActive || isWordComplete ? "all 0s linear" : "",
				},
			},
			word
		);
	});
};

const SyncedLyricsPage = react.memo(({ lyrics = [], provider, copyright, isKara }) => {
	const [position, setPosition] = useState(() => Spicetify.Player.getProgress() + CONFIG.visual["global-delay"] + CONFIG.visual.delay);
	const [offset, setOffset] = useState(0);
	const activeLineEle = useRef();
	const lyricContainerEle = useRef();

	useTrackPosition(() => {
		const newPos = Spicetify.Player.getProgress();
		const delay = CONFIG.visual["global-delay"] + CONFIG.visual.delay;
		if (Math.abs(newPos + delay - position) > 20) {
			setPosition(newPos + delay);
		}
	});

	const lyricWithEmptyLines = useMemo(() => {
		const rawProcessed = [emptyLine, emptyLine, ...processPauseLines(lyrics, isKara)];

		// 1. Initial pass for basic info and isPause status
		const processed = rawProcessed.map((line, i) => ({
			...line,
			lineNumber: i,
			isPause: isPauseLine(line),
		}));

		// 2. Backward pass for nextStartTime in O(N)
		let nextNonPauseStart = null;
		for (let i = processed.length - 1; i >= 0; i--) {
			processed[i].nextStartTime = nextNonPauseStart;
			if (!processed[i].isPause && processed[i].startTime != null) {
				nextNonPauseStart = processed[i].startTime;
			}
		}

		// Pre-calculate overlapping clusters (transitive groups) in O(N)
		const groupIds = new Array(processed.length).fill(-1);
		const groups = [];
		let currentGroup = [];
		let maxEnd = -1;

		for (let i = 0; i < processed.length; i++) {
			const line = processed[i];
			const start = line.startTime ?? 0;
			const end = line.endTime ?? Infinity;

			if (currentGroup.length > 0 && start <= maxEnd - 1000) {
				currentGroup.push(i);
				maxEnd = Math.max(maxEnd, end);
			} else {
				if (currentGroup.length > 0) groups.push(currentGroup);
				currentGroup = [i];
				maxEnd = end;
			}
			groupIds[i] = groups.length;
		}
		if (currentGroup.length > 0) groups.push(currentGroup);

		return processed.map((line, i) => ({
			...line,
			cluster: groups[groupIds[i]],
		}));
	}, [lyrics, isKara]);

	const lyricsId = lyrics && lyrics.length > 0 ? lyrics[0].text : "";
	// Find the latest line that has started
	let lastStartedIndex = 0;
	for (let i = lyricWithEmptyLines.length - 1; i >= 0; i--) {
		const line = lyricWithEmptyLines[i];
		if (position >= line.startTime) {
			// Prefer text line over pause line if they start at the same time
			if (line.isPause && lyricWithEmptyLines[i + 1] && position >= lyricWithEmptyLines[i + 1].startTime && !lyricWithEmptyLines[i + 1].isPause) {
				continue;
			}
			lastStartedIndex = i;
			break;
		}
	}

	let activeLineIndex = lastStartedIndex;
	const currentCluster = lyricWithEmptyLines[lastStartedIndex]?.cluster || [lastStartedIndex];

	// Count how many lines in this cluster have started (ignoring if they finished)
	const startedInCluster = [];
	for (const idx of currentCluster) {
		if (position >= lyricWithEmptyLines[idx].startTime) {
			startedInCluster.push(idx);
		}
	}

	const playingInCluster = startedInCluster.filter((idx) => position <= lyricWithEmptyLines[idx].endTime);

	if (startedInCluster.length > 3) {
		// Smooth Dynamic Focus: Stay exactly 2 lines behind the head to show progress but keep context.
		activeLineIndex = startedInCluster[startedInCluster.length - 3];
	} else {
		// Shifting Anchor Focus: Focus on the first line that is STILL playing.
		// Fallback to lastStartedIndex (the "bottom" of the group) when all finish to prevent jumping.
		activeLineIndex = playingInCluster.length > 0 ? playingInCluster[0] : lastStartedIndex;
	}

	const latestStartedInCluster = startedInCluster[startedInCluster.length - 1];

	const anyLinePlaying = lyricWithEmptyLines.some((line) => {
		return line.startTime != null && line.endTime != null && position >= line.startTime && position <= line.endTime;
	});

	const { activeLines, startLineIndex, activeElementIndex } = useMemo(() => {
		// Keep a bounded window of lines around the active line.
		// A spacer element at the top of the list compensates for the height of
		// lines removed from the front, keeping the active line's offsetTop stable
		// so --offset does not jump mid-CSS-transition.
		const windowBefore = CONFIG.visual["lines-before"] + 2;
		const startIndex = Math.max(0, activeLineIndex - windowBefore);

		let endIndex = activeLineIndex;
		let visibleAfter = 0;
		const targetAfter = CONFIG.visual["lines-after"] + 1;
		while (endIndex < lyricWithEmptyLines.length - 1 && visibleAfter < targetAfter) {
			endIndex++;
			if (!lyricWithEmptyLines[endIndex].isPause) {
				visibleAfter++;
			}
		}

		return {
			activeLines: lyricWithEmptyLines.slice(startIndex, endIndex + 1),
			startLineIndex: startIndex,
			activeElementIndex: activeLineIndex - startIndex,
		};
	}, [activeLineIndex, lyricWithEmptyLines, CONFIG.visual["lines-after"], CONFIG.visual["lines-before"]]);

	const spacerRef = useRef();

	const computeOffsetRef = useRef();
	computeOffsetRef.current = () => {
		if (activeLineEle.current && lyricContainerEle.current) {
			const linesBefore = CONFIG.visual["lines-before"];
			const linesAfter = CONFIG.visual["lines-after"];
			const lineHeight = parseFloat(getComputedStyle(lyricContainerEle.current).getPropertyValue("--lyrics-line-height")) || 50;
			const focalPoint = lyricContainerEle.current.clientHeight / 2 + (linesBefore - linesAfter) * (lineHeight / 2);
			setOffset(focalPoint - (activeLineEle.current.offsetTop + activeLineEle.current.clientHeight / 2));
		}
	};

	// Always reflects the latest startLineIndex via closure (updated every render).
	const updateSpacerRef = useRef();
	updateSpacerRef.current = () => {
		if (!spacerRef.current || !lyricContainerEle.current) return;
		const lyricsLineHeight = parseFloat(getComputedStyle(lyricContainerEle.current).getPropertyValue("--lyrics-line-height"));
		spacerRef.current.style.height = startLineIndex > 0 && lyricsLineHeight > 0 ? `${startLineIndex * lyricsLineHeight}px` : "0px";
	};

	react.useLayoutEffect(() => {
		const onResize = () => {
			updateSpacerRef.current();
			computeOffsetRef.current();
		};
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	react.useLayoutEffect(() => {
		// Update the spacer first so that offsetTop of the active line is stable
		// before we read it for the --offset calculation.
		updateSpacerRef.current();
		computeOffsetRef.current();
	}, [activeLineIndex, lyricsId]);

	const adjustedAnimationIndices = [];
	let currentIndex = 0;
	for (let j = activeElementIndex; j < activeLines.length; j++) {
		adjustedAnimationIndices[j] = currentIndex;
		if (!activeLines[j].isPause || j === activeElementIndex) {
			currentIndex++;
		}
	}
	currentIndex = -1;
	for (let j = activeElementIndex - 1; j >= 0; j--) {
		adjustedAnimationIndices[j] = currentIndex;
		if (!activeLines[j].isPause) {
			currentIndex--;
		}
	}

	return react.createElement(
		"div",
		{
			className: "lyrics-lyricsContainer-SyncedLyricsPage",
			ref: lyricContainerEle,
		},
		react.createElement(
			"div",
			{
				className: "lyrics-lyricsContainer-SyncedLyrics",
				style: {
					"--offset": `${offset}px`,
				},
				key: lyricsId,
			},
			react.createElement("div", { ref: spacerRef, style: { height: "0px" }, "aria-hidden": "true" }),
			activeLines.map(({ text, lineNumber, startTime, endTime, originalText, performer, background, isPause, nextStartTime }, i) => {
				const isFocusedLine = activeElementIndex === i;

				// Calculate indicator state for pause lines
				let indicatorEl = null;

				if (isPause) {
					const pauseStart = startTime || 0;
					const pauseDuration = nextStartTime ? nextStartTime - pauseStart : 0;
					const progress = pauseDuration > 0 ? (position - pauseStart) / pauseDuration : 0;
					indicatorEl = react.createElement(IdlingIndicator, {
						isActive: isFocusedLine,
						progress,
						delay: pauseDuration / 3,
						style: { transition: "none" },
					});
				}

				let className = "lyrics-lyricsContainer-LyricsLine";
				let ref;

				const isPlaying = startTime != null && endTime != null && position >= startTime && position <= endTime;
				const isActive = isPlaying || (lineNumber === latestStartedInCluster && !anyLinePlaying);

				if (isFocusedLine) {
					ref = activeLineEle;
				}
				if (isPause) {
					className += " lyrics-lyricsContainer-LyricsLine-pause";
				}
				if (isActive) {
					className += " lyrics-lyricsContainer-LyricsLine-active";
				} else if (isPause) {
					className += " lyrics-lyricsContainer-LyricsLine-pause-inactive";
				}

				let animationIndex = adjustedAnimationIndices[i];

				const paddingLine = (animationIndex < 0 && -animationIndex > CONFIG.visual["lines-before"]) || animationIndex > CONFIG.visual["lines-after"];
				if (paddingLine) {
					className += " lyrics-lyricsContainer-LyricsLine-paddingLine";
				}
				const showTranslatedBelow = isKara || CONFIG.visual["translate:display-mode"] === "below";
				// If we have original text and we are showing translated below, we should show the original text
				// Otherwise we should show the translated text
				const lineText = originalText && showTranslatedBelow ? originalText : text;

				// Convert lyrics to text for comparison
				const belowOrigin = (typeof originalText === "object" ? originalText?.props?.children?.[0] : originalText)?.replace(/\s+/g, "");
				const belowTxt = (typeof text === "object" ? text?.props?.children?.[0] : text)?.replace(/\s+/g, "");

				const belowMode = showTranslatedBelow && originalText && belowOrigin !== belowTxt;

				return react.createElement(
					"div",
					{
						className,
						style: {
							cursor: "pointer",
							"--position-index": animationIndex,
							"--animation-index": (animationIndex < 0 ? 0 : animationIndex) + 1,
							"--blur-index": Math.abs(animationIndex),
							...(isPause ? { transition: "none" } : {}),
						},
						dir: "auto",
						ref,
						key: lineNumber,
						onClick: (event) => {
							if (startTime) {
								Spicetify.Player.seek(startTime);
							}
						},
					},
					isPause
						? indicatorEl
						: react.createElement(
								"div",
								{
									onContextMenu: (event) => {
										event.preventDefault();
										Spicetify.Platform.ClipboardAPI.copy(Utils.convertParsedToLRC(lyrics, belowMode).original)
											.then(() => Spicetify.showNotification("Lyrics copied to clipboard"))
											.catch(() => Spicetify.showNotification("Failed to copy lyrics to clipboard"));
									},
								},
								renderPerformer(performer, lyricWithEmptyLines[lineNumber - 1]?.performer, CONFIG.visual["synced-compact"]),
								!isKara ? lineText : react.createElement(KaraokeLine, { text: originalText ?? text, startTime, endTime, position, isActive }),
								background &&
									background.length > 0 &&
									react.createElement(
										"div",
										{
											className: "lyrics-lyricsContainer-Karaoke-BackgroundLine",
										},
										!isKara
											? background.map((w, bgIndex) => (typeof w.word === "string" ? w.word : react.cloneElement(w.word, { key: bgIndex })))
											: react.createElement(KaraokeLine, {
													text: background,
													startTime,
													endTime,
													position,
													isActive,
												})
									)
							),
					belowMode &&
						react.createElement(
							"p",
							{
								style: {
									opacity: 0.5,
									fontSize: "0.9em",
								},
								onContextMenu: (event) => {
									event.preventDefault();
									Spicetify.Platform.ClipboardAPI.copy(Utils.convertParsedToLRC(lyrics, belowMode).conver)
										.then(() => Spicetify.showNotification("Translated lyrics copied to clipboard"))
										.catch(() => Spicetify.showNotification("Failed to copy translated lyrics to clipboard"));
								},
							},
							text
						)
				);
			})
		),
		react.createElement(CreditFooter, {
			provider,
			copyright,
		})
	);
});

class SearchBar extends react.Component {
	constructor() {
		super();
		this.state = {
			hidden: true,
			atNode: 0,
			foundNodes: [],
		};
		this.container = null;
	}

	componentDidMount() {
		this.viewPort = document.querySelector(".main-view-container .os-viewport");
		this.mainViewOffsetTop = document.querySelector(".Root__main-view").offsetTop;
		this.toggleCallback = () => {
			if (!(Spicetify.Platform.History.location.pathname === "/lyrics-plus" && this.container)) return;

			if (this.state.hidden) {
				this.setState({ hidden: false });
				this.container.focus();
			} else {
				this.setState({ hidden: true });
				this.container.blur();
			}
		};
		this.unFocusCallback = () => {
			this.container.blur();
			this.setState({ hidden: true });
		};
		this.loopThroughCallback = (event) => {
			if (!this.state.foundNodes.length) {
				return;
			}

			if (event.key === "Enter") {
				const dir = event.shiftKey ? -1 : 1;
				let atNode = this.state.atNode + dir;
				if (atNode < 0) {
					atNode = this.state.foundNodes.length - 1;
				}
				atNode %= this.state.foundNodes.length;
				const rects = this.state.foundNodes[atNode].getBoundingClientRect();
				this.viewPort.scrollBy(0, rects.y - 100);
				this.setState({ atNode });
			}
		};

		Spicetify.Mousetrap().bind("mod+shift+f", this.toggleCallback);
		Spicetify.Mousetrap(this.container).bind("mod+shift+f", this.toggleCallback);
		Spicetify.Mousetrap(this.container).bind("enter", this.loopThroughCallback);
		Spicetify.Mousetrap(this.container).bind("shift+enter", this.loopThroughCallback);
		Spicetify.Mousetrap(this.container).bind("esc", this.unFocusCallback);
	}

	componentWillUnmount() {
		Spicetify.Mousetrap().unbind("mod+shift+f", this.toggleCallback);
		Spicetify.Mousetrap(this.container).unbind("mod+shift+f", this.toggleCallback);
		Spicetify.Mousetrap(this.container).unbind("enter", this.loopThroughCallback);
		Spicetify.Mousetrap(this.container).unbind("shift+enter", this.loopThroughCallback);
		Spicetify.Mousetrap(this.container).unbind("esc", this.unFocusCallback);
	}

	getNodeFromInput(event) {
		const value = event.target.value.toLowerCase();
		if (!value) {
			this.setState({ foundNodes: [] });
			this.viewPort.scrollTo(0, 0);
			return;
		}

		const lyricsPage = document.querySelector(".lyrics-lyricsContainer-UnsyncedLyricsPage");
		const walker = document.createTreeWalker(
			lyricsPage,
			NodeFilter.SHOW_TEXT,
			(node) => {
				if (node.textContent.toLowerCase().includes(value)) {
					return NodeFilter.FILTER_ACCEPT;
				}
				return NodeFilter.FILTER_REJECT;
			},
			false
		);

		const foundNodes = [];
		while (walker.nextNode()) {
			const range = document.createRange();
			range.selectNodeContents(walker.currentNode);
			foundNodes.push(range);
		}

		if (!foundNodes.length) {
			this.viewPort.scrollBy(0, 0);
		} else {
			const rects = foundNodes[0].getBoundingClientRect();
			this.viewPort.scrollBy(0, rects.y - 100);
		}

		this.setState({ foundNodes, atNode: 0 });
	}

	render() {
		let y = 0;
		let height = 0;
		if (this.state.foundNodes.length) {
			const node = this.state.foundNodes[this.state.atNode];
			const rects = node.getBoundingClientRect();
			y = rects.y + this.viewPort.scrollTop - this.mainViewOffsetTop;
			height = rects.height;
		}
		return react.createElement(
			"div",
			{
				className: `lyrics-Searchbar${this.state.hidden ? " hidden" : ""}`,
			},
			react.createElement("input", {
				ref: (c) => {
					this.container = c;
				},
				onChange: this.getNodeFromInput.bind(this),
			}),
			react.createElement("svg", {
				width: 16,
				height: 16,
				viewBox: "0 0 16 16",
				fill: "currentColor",
				dangerouslySetInnerHTML: {
					__html: Spicetify.SVGIcons.search,
				},
			}),
			react.createElement(
				"span",
				{
					hidden: this.state.foundNodes.length === 0,
				},
				`${this.state.atNode + 1}/${this.state.foundNodes.length}`
			),
			react.createElement("div", {
				className: "lyrics-Searchbar-highlight",
				style: {
					"--search-highlight-top": `${y}px`,
					"--search-highlight-height": `${height}px`,
				},
			})
		);
	}
}

function isInViewport(element) {
	const rect = element.getBoundingClientRect();
	return (
		rect.top >= 0 &&
		rect.left >= 0 &&
		rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
		rect.right <= (window.innerWidth || document.documentElement.clientWidth)
	);
}

const SyncedExpandedLyricsPage = react.memo(({ lyrics, provider, copyright, isKara }) => {
	const [position, setPosition] = useState(() => Spicetify.Player.getProgress() + CONFIG.visual["global-delay"] + CONFIG.visual.delay);
	const activeLineRef = useRef(null);
	const pageRef = useRef(null);

	useTrackPosition(() => {
		const newPos = Spicetify.Player.getProgress();
		const delay = CONFIG.visual["global-delay"] + CONFIG.visual.delay;
		if (Math.abs(newPos + delay - position) > 20) {
			setPosition(newPos + delay);
		}
	});

	const padded = useMemo(() => {
		const rawProcessed = [emptyLine, ...processPauseLines(lyrics, isKara)];

		// 1. Initial pass for basic info and isPause status
		const processed = rawProcessed.map((line, i) => ({
			...line,
			lineNumber: i,
			isPause: isPauseLine(line),
		}));

		// 2. Backward pass for nextStartTime in O(N)
		let nextNonPauseStart = null;
		for (let i = processed.length - 1; i >= 0; i--) {
			processed[i].nextStartTime = nextNonPauseStart;
			if (!processed[i].isPause && processed[i].startTime != null) {
				nextNonPauseStart = processed[i].startTime;
			}
		}

		// Pre-calculate overlapping clusters (transitive groups) in O(N)
		const groupIds = new Array(processed.length).fill(-1);
		const groups = [];
		let currentGroup = [];
		let maxEnd = -1;

		for (let i = 0; i < processed.length; i++) {
			const line = processed[i];
			const start = line.startTime ?? 0;
			const end = line.endTime ?? Infinity;

			if (currentGroup.length > 0 && start <= maxEnd - 1000) {
				currentGroup.push(i);
				maxEnd = Math.max(maxEnd, end);
			} else {
				if (currentGroup.length > 0) groups.push(currentGroup);
				currentGroup = [i];
				maxEnd = end;
			}
			groupIds[i] = groups.length;
		}
		if (currentGroup.length > 0) groups.push(currentGroup);

		return processed.map((line, i) => ({
			...line,
			cluster: groups[groupIds[i]],
		}));
	}, [lyrics, isKara]);

	const initialScroll = useRef(false);

	// Reset scroll state when lyrics change
	useEffect(() => {
		initialScroll.current = false;
	}, [lyrics]);

	const lyricsId = lyrics && lyrics.length > 0 ? lyrics[0].text : "";

	// Find the latest line that has started
	let lastStartedIndex = 0;
	for (let i = padded.length - 1; i >= 0; i--) {
		const line = padded[i];
		if (position >= line.startTime) {
			// Prefer text line over pause line if they start at the same time
			if (line.isPause && padded[i + 1] && position >= padded[i + 1].startTime && !padded[i + 1].isPause) {
				continue;
			}
			lastStartedIndex = i;
			break;
		}
	}

	let activeLineIndex = lastStartedIndex;
	const currentCluster = padded[lastStartedIndex]?.cluster || [lastStartedIndex];

	// Count how many lines in this cluster have started (ignoring if they finished)
	const startedInCluster = [];
	for (const idx of currentCluster) {
		if (position >= padded[idx].startTime) {
			startedInCluster.push(idx);
		}
	}

	const playingInCluster = startedInCluster.filter((idx) => position <= padded[idx].endTime);

	if (startedInCluster.length > 3) {
		// Smooth Dynamic Focus: Stay exactly 2 lines behind the head to show progress but keep context.
		activeLineIndex = startedInCluster[startedInCluster.length - 3];
	} else {
		// Shifting Anchor Focus: Focus on the first line that is STILL playing.
		// Fallback to lastStartedIndex (the "bottom" of the group) when all finish to prevent jumping.
		activeLineIndex = playingInCluster.length > 0 ? playingInCluster[0] : lastStartedIndex;
	}

	const latestStartedInCluster = startedInCluster[startedInCluster.length - 1];

	react.useEffect(() => {
		if (activeLineRef.current && pageRef.current) {
			const linesBefore = CONFIG.visual["lines-before"];
			const linesAfter = CONFIG.visual["lines-after"];
			const lineHeight = parseFloat(getComputedStyle(pageRef.current).getPropertyValue("--lyrics-line-height")) || 50;
			const focalPoint = pageRef.current.clientHeight / 2 + (linesBefore - linesAfter) * (lineHeight / 2);

			pageRef.current.scrollTo({
				top: activeLineRef.current.offsetTop - focalPoint + activeLineRef.current.clientHeight / 2,
				behavior: initialScroll.current ? "smooth" : "auto",
				inline: "nearest",
			});
			initialScroll.current = true;
		}
	}, [activeLineIndex]);

	const anyLinePlaying = padded.some((line) => {
		return line.startTime != null && line.endTime != null && position >= line.startTime && position <= line.endTime;
	});

	return react.createElement(
		"div",
		{
			className: "lyrics-lyricsContainer-UnsyncedLyricsPage",
			key: lyricsId,
			ref: pageRef,
		},
		react.createElement("p", {
			className: "lyrics-lyricsContainer-LyricsUnsyncedPadding",
		}),
		padded.map(({ text, startTime, endTime, originalText, performer, background }, i) => {
			const { isPause, nextStartTime } = padded[i];
			const isFocused = i === activeLineIndex;

			// Show idling indicator for the initial empty line
			if (i === 0) {
				const isInitialActive = activeLineIndex === 0;
				const pauseDuration = nextStartTime ? nextStartTime : 0;
				return react.createElement(IdlingIndicator, {
					key: i,
					isActive: isInitialActive,
					progress: pauseDuration > 0 ? position / pauseDuration : 0,
					delay: pauseDuration > 0 ? pauseDuration / 3 : 0,
					className: `lyrics-lyricsContainer-LyricsLine lyrics-lyricsContainer-LyricsLine-pause ${
						isInitialActive ? "lyrics-lyricsContainer-LyricsLine-active" : "lyrics-lyricsContainer-LyricsLine-pause-inactive"
					}`,
					style: { "--position-index": 0, "--animation-index": 1 },
				});
			}

			// Calculate indicator state for pause lines
			let indicatorEl = null;
			if (isPause) {
				const pauseStart = startTime || 0;
				const pauseDuration = nextStartTime ? nextStartTime - pauseStart : 0;
				const progress = pauseDuration > 0 ? (position - pauseStart) / pauseDuration : 0;
				indicatorEl = react.createElement(IdlingIndicator, {
					isActive: isFocused,
					progress,
					delay: pauseDuration / 3,
				});
			}

			const isPlaying = startTime != null && endTime != null && position >= startTime && position <= endTime;
			const isPast = (endTime != null && position > endTime) || (!isFocused && startTime != null && position > startTime);
			const isActive = isPlaying || (i === latestStartedInCluster && !anyLinePlaying);

			let className = `lyrics-lyricsContainer-LyricsLine${isActive ? " lyrics-lyricsContainer-LyricsLine-active" : ""}${isPast ? " lyrics-lyricsContainer-LyricsLine-past" : ""}`;
			if (isPause) {
				className += " lyrics-lyricsContainer-LyricsLine-pause";
			}
			if (isPause && !isActive) {
				className += " lyrics-lyricsContainer-LyricsLine-pause-inactive";
			}

			const showTranslatedBelow = isKara || CONFIG.visual["translate:display-mode"] === "below";
			// If we have original text and we are showing translated below, we should show the original text
			// Otherwise we should show the translated text
			const lineText = originalText && showTranslatedBelow ? originalText : text;

			// Convert lyrics to text for comparison
			const belowOrigin = (typeof originalText === "object" ? originalText?.props?.children?.[0] : originalText)?.replace(/\s+/g, "");
			const belowTxt = (typeof text === "object" ? text?.props?.children?.[0] : text)?.replace(/\s+/g, "");

			const belowMode = showTranslatedBelow && originalText && belowOrigin !== belowTxt;

			return react.createElement(
				"div",
				{
					className,
					key: i,
					style: {
						cursor: "pointer",
					},
					dir: "auto",
					ref: isFocused ? activeLineRef : null,
					onClick: (event) => {
						if (startTime) {
							Spicetify.Player.seek(startTime);
						}
					},
				},
				isPause
					? indicatorEl
					: react.createElement(
							react.Fragment,
							null,
							react.createElement(
								"p",
								{
									onContextMenu: (event) => {
										event.preventDefault();
										Spicetify.Platform.ClipboardAPI.copy(Utils.convertParsedToLRC(lyrics, belowMode).original)
											.then(() => Spicetify.showNotification("Lyrics copied to clipboard"))
											.catch(() => Spicetify.showNotification("Failed to copy lyrics to clipboard"));
									},
								},
								renderPerformer(performer, padded[i - 1]?.performer, CONFIG.visual["synced-compact"]),
								!isKara ? lineText : react.createElement(KaraokeLine, { text: originalText ?? text, startTime, endTime, position, isActive })
							),
							background &&
								background.length > 0 &&
								react.createElement(
									"div",
									{
										className: "lyrics-lyricsContainer-Karaoke-BackgroundLine",
									},
									!isKara
										? background.map((w, bgIndex) => (typeof w.word === "string" ? w.word : react.cloneElement(w.word, { key: bgIndex })))
										: react.createElement(KaraokeLine, {
												text: background,
												startTime,
												endTime,
												position,
												isActive,
											})
								)
						),
				belowMode &&
					react.createElement(
						"p",
						{
							style: { opacity: 0.5 },
							onContextMenu: (event) => {
								event.preventDefault();
								Spicetify.Platform.ClipboardAPI.copy(Utils.convertParsedToLRC(lyrics, belowMode).conver)
									.then(() => Spicetify.showNotification("Translated lyrics copied to clipboard"))
									.catch(() => Spicetify.showNotification("Failed to copy translated lyrics to clipboard"));
							},
						},
						text
					)
			);
		}),
		react.createElement("p", {
			className: "lyrics-lyricsContainer-LyricsUnsyncedPadding",
		}),
		react.createElement(CreditFooter, {
			provider,
			copyright,
		}),
		react.createElement(SearchBar, null)
	);
});

const UnsyncedLyricsPage = react.memo(({ lyrics, provider, copyright }) => {
	return react.createElement(
		"div",
		{
			className: "lyrics-lyricsContainer-UnsyncedLyricsPage",
		},
		react.createElement("p", {
			className: "lyrics-lyricsContainer-LyricsUnsyncedPadding",
		}),
		lyrics.map(({ text, originalText, performer }, index) => {
			const showTranslatedBelow = CONFIG.visual["translate:display-mode"] === "below";
			// If we have original text and we are showing translated below, we should show the original text
			// Otherwise we should show the translated text
			const lineText = originalText && showTranslatedBelow ? originalText : text;

			// Convert lyrics to text for comparison
			const belowOrigin = (typeof originalText === "object" ? originalText?.props?.children?.[0] : originalText)?.replace(/\s+/g, "");
			const belowTxt = (typeof text === "object" ? text?.props?.children?.[0] : text)?.replace(/\s+/g, "");

			const belowMode = showTranslatedBelow && originalText && belowOrigin !== belowTxt;

			return react.createElement(
				"div",
				{
					className: "lyrics-lyricsContainer-LyricsLine lyrics-lyricsContainer-LyricsLine-active",
					key: index,
					dir: "auto",
				},
				react.createElement(
					"p",
					{
						onContextMenu: (event) => {
							event.preventDefault();
							Spicetify.Platform.ClipboardAPI.copy(Utils.convertParsedToUnsynced(lyrics, belowMode).original)
								.then(() => Spicetify.showNotification("Lyrics copied to clipboard"))
								.catch(() => Spicetify.showNotification("Failed to copy lyrics to clipboard"));
						},
					},
					renderPerformer(performer, lyrics[index - 1]?.performer, false),
					lineText
				),
				belowMode &&
					react.createElement(
						"p",
						{
							style: { opacity: 0.5 },
							onContextMenu: (event) => {
								event.preventDefault();
								Spicetify.Platform.ClipboardAPI.copy(Utils.convertParsedToUnsynced(lyrics, belowMode).conver)
									.then(() => Spicetify.showNotification("Translated lyrics copied to clipboard"))
									.catch(() => Spicetify.showNotification("Failed to copy translated lyrics to clipboard"));
							},
						},
						text
					)
			);
		}),
		react.createElement("p", {
			className: "lyrics-lyricsContainer-LyricsUnsyncedPadding",
		}),
		react.createElement(CreditFooter, {
			provider,
			copyright,
		}),
		react.createElement(SearchBar, null)
	);
});

const noteContainer = document.createElement("div");
noteContainer.classList.add("lyrics-Genius-noteContainer");
const noteDivider = document.createElement("div");
noteDivider.classList.add("lyrics-Genius-divider");
noteDivider.innerHTML = `<svg width="32" height="32" viewBox="0 0 13 4" fill="currentColor"><path d="M13 10L8 4.206 3 10z"/></svg>`;
noteDivider.style.setProperty("--link-left", 0);
const noteTextContainer = document.createElement("div");
noteTextContainer.classList.add("lyrics-Genius-noteTextContainer");
noteTextContainer.onclick = (event) => {
	event.preventDefault();
	event.stopPropagation();
};
noteContainer.append(noteDivider, noteTextContainer);

function showNote(parent, note) {
	if (noteContainer.parentElement === parent) {
		noteContainer.remove();
		return;
	}
	noteTextContainer.innerText = note;
	parent.append(noteContainer);
	const arrowPos = parent.offsetLeft - noteContainer.offsetLeft;
	noteDivider.style.setProperty("--link-left", `${arrowPos}px`);
	const box = noteTextContainer.getBoundingClientRect();
	if (box.y + box.height > window.innerHeight) {
		// Wait for noteContainer is mounted
		setTimeout(() => {
			noteContainer.scrollIntoView({
				behavior: "smooth",
				block: "center",
				inline: "nearest",
			});
		}, 50);
	}
}

const GeniusPage = react.memo(
	({ lyrics, provider, copyright, versions, versionIndex, onVersionChange, isSplitted, lyrics2, versionIndex2, onVersionChange2 }) => {
		let notes = {};
		let container = null;
		let container2 = null;

		// Fetch notes
		useEffect(() => {
			if (!container) return;
			notes = {};
			let links = container.querySelectorAll("a");
			if (isSplitted && container2) {
				links = [...links, ...container2.querySelectorAll("a")];
			}
			for (const link of links) {
				let id = link.pathname.match(/\/(\d+)\//);
				if (!id) {
					id = link.dataset.id;
				} else {
					id = id[1];
				}
				ProviderGenius.getNote(id).then((note) => {
					notes[id] = note;
					link.classList.add("fetched");
				});
				link.onclick = (event) => {
					event.preventDefault();
					if (!notes[id]) return;
					showNote(link, notes[id]);
				};
			}
		}, [lyrics, lyrics2]);

		const lyricsEl1 = react.createElement(
			"div",
			null,
			react.createElement(VersionSelector, { items: versions, index: versionIndex, callback: onVersionChange }),
			react.createElement("div", {
				className: "lyrics-lyricsContainer-LyricsLine lyrics-lyricsContainer-LyricsLine-active",
				ref: (c) => {
					container = c;
				},
				dangerouslySetInnerHTML: {
					__html: lyrics,
				},
				onContextMenu: (event) => {
					event.preventDefault();
					const copylyrics = lyrics.replace(/<br>/g, "\n").replace(/<[^>]*>/g, "");
					Spicetify.Platform.ClipboardAPI.copy(copylyrics)
						.then(() => Spicetify.showNotification("Lyrics copied to clipboard"))
						.catch(() => Spicetify.showNotification("Failed to copy lyrics to clipboard"));
				},
			})
		);

		const mainContainer = [lyricsEl1];
		const shouldSplit = versions.length > 1 && isSplitted;

		if (shouldSplit) {
			const lyricsEl2 = react.createElement(
				"div",
				null,
				react.createElement(VersionSelector, { items: versions, index: versionIndex2, callback: onVersionChange2 }),
				react.createElement("div", {
					className: "lyrics-lyricsContainer-LyricsLine lyrics-lyricsContainer-LyricsLine-active",
					ref: (c) => {
						container2 = c;
					},
					dangerouslySetInnerHTML: {
						__html: lyrics2,
					},
					onContextMenu: (event) => {
						event.preventDefault();
						const copylyrics = lyrics.replace(/<br>/g, "\n").replace(/<[^>]*>/g, "");
						Spicetify.Platform.ClipboardAPI.copy(copylyrics)
							.then(() => Spicetify.showNotification("Lyrics copied to clipboard"))
							.catch(() => Spicetify.showNotification("Failed to copy lyrics to clipboard"));
					},
				})
			);
			mainContainer.push(lyricsEl2);
		}

		return react.createElement(
			"div",
			{
				className: "lyrics-lyricsContainer-UnsyncedLyricsPage",
			},
			react.createElement("p", {
				className: "lyrics-lyricsContainer-LyricsUnsyncedPadding main-type-ballad",
			}),
			react.createElement("div", { className: shouldSplit ? "split" : "" }, mainContainer),
			react.createElement(CreditFooter, {
				provider,
				copyright,
			}),
			react.createElement(SearchBar, null)
		);
	}
);

const LoadingIcon = react.createElement(
	"svg",
	{
		width: "200px",
		height: "200px",
		viewBox: "0 0 100 100",
		preserveAspectRatio: "xMidYMid",
	},
	react.createElement(
		"circle",
		{
			cx: "50",
			cy: "50",
			r: "0",
			fill: "none",
			stroke: "currentColor",
			"stroke-width": "2",
		},
		react.createElement("animate", {
			attributeName: "r",
			repeatCount: "indefinite",
			dur: "1s",
			values: "0;40",
			keyTimes: "0;1",
			keySplines: "0 0.2 0.8 1",
			calcMode: "spline",
			begin: "0s",
		}),
		react.createElement("animate", {
			attributeName: "opacity",
			repeatCount: "indefinite",
			dur: "1s",
			values: "1;0",
			keyTimes: "0;1",
			keySplines: "0.2 0 0.8 1",
			calcMode: "spline",
			begin: "0s",
		})
	),
	react.createElement(
		"circle",
		{
			cx: "50",
			cy: "50",
			r: "0",
			fill: "none",
			stroke: "currentColor",
			"stroke-width": "2",
		},
		react.createElement("animate", {
			attributeName: "r",
			repeatCount: "indefinite",
			dur: "1s",
			values: "0;40",
			keyTimes: "0;1",
			keySplines: "0 0.2 0.8 1",
			calcMode: "spline",
			begin: "-0.5s",
		}),
		react.createElement("animate", {
			attributeName: "opacity",
			repeatCount: "indefinite",
			dur: "1s",
			values: "1;0",
			keyTimes: "0;1",
			keySplines: "0.2 0 0.8 1",
			calcMode: "spline",
			begin: "-0.5s",
		})
	)
);

const VersionSelector = react.memo(({ items, index, callback }) => {
	if (items.length < 2) {
		return null;
	}
	return react.createElement(
		"div",
		{
			className: "lyrics-versionSelector",
		},
		react.createElement(
			"select",
			{
				onChange: (event) => {
					callback(items, event.target.value);
				},
				value: index,
			},
			items.map((a, i) => {
				return react.createElement("option", { value: i }, a.title);
			})
		),
		react.createElement(
			"svg",
			{
				height: "16",
				width: "16",
				fill: "currentColor",
				viewBox: "0 0 16 16",
			},
			react.createElement("path", {
				d: "M3 6l5 5.794L13 6z",
			})
		)
	);
});
