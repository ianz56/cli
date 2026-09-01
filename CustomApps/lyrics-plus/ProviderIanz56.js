const ProviderIanz56 = (() => {
	const DEFAULT_BASE_URL = "http://192.168.1.11:4000/api/v1";

	/**
	 * Get Syl-DB Base URL (supports localStorage override if configured)
	 * @returns {string}
	 */
	function getBaseUrl() {
		try {
			const customUrl = localStorage.getItem("lyrics-plus:provider:ianz56:server");
			if (customUrl && customUrl.trim()) {
				return customUrl.trim().replace(/\/+$/, "");
			}
		} catch {
			// localStorage unavailable in non-browser env
		}
		return DEFAULT_BASE_URL;
	}

	/**
	 * Fetch lyrics JSON directly from Syl-DB via /search endpoint
	 * @param {string} artist
	 * @param {string} title
	 * @returns {Promise<Object>}
	 */
	async function fetchLyricsFromDB(artist, title) {
		const baseUrl = getBaseUrl();

		// Strategy 1: Search using title & artist parameters with format=json
		const params = new URLSearchParams();
		if (title) params.append("title", title);
		if (artist) params.append("artist", artist);
		params.append("format", "json");

		let url = `${baseUrl}/search?${params.toString()}`;
		let response = await fetch(url);

		if (response.ok) {
			return response.json();
		}

		// Strategy 2: Fallback to unified query 'q' with format=json
		const query = `${artist || ""} ${title || ""}`.trim();
		if (query) {
			const fallbackParams = new URLSearchParams({
				q: query,
				format: "json",
			});
			url = `${baseUrl}/search?${fallbackParams.toString()}`;
			response = await fetch(url);
			if (response.ok) {
				return response.json();
			}
		}

		throw new Error(`Lyrics not found in Syl-DB (${response.status})`);
	}

	/**
	 * Convert Syl-DB JSON / Canonical AST format to karaoke format for lyrics-plus
	 * Supports start/begin, bgVocal/backgroundVocal, translation/romanization
	 * @param {Object} lyricsJson
	 * @returns {{ karaoke: Array, synced: Array, unsynced: Array, ianz56Translation: Array|null }}
	 */
	function convertToKaraokeFormat(lyricsJson) {
		const lines = lyricsJson.lines || [];
		const karaoke = [];
		const synced = [];
		const unsynced = [];
		const ianz56Translation = [];
		let hasTranslation = false;

		/**
		 * Fill time gaps between words with empty "spacer" words
		 * to ensure the renderer's sequential "startTime += duration" logic works correctly.
		 * @param {Array} words
		 * @param {number} lineStartTime (seconds)
		 * @param {boolean} isBackground
		 */
		function processWords(words, lineStartTime, isBackground) {
			if (!words || words.length === 0) return [];
			const processed = [];
			let currentTime = lineStartTime;

			words.forEach((word, i) => {
				const begin = word.start ?? word.begin ?? currentTime;
				const end = word.end ?? begin;

				// Gap before word (10ms tolerance)
				if (begin > currentTime + 0.01) {
					processed.push({
						word: "",
						time: Math.round((begin - currentTime) * 1000),
						isBackground: isBackground,
					});
				}

				// The word itself
				let wordText = word.text || "";
				// Sanitize background vocal parens
				if (isBackground) {
					wordText = wordText.replace(/^[(]+|[)]+$/g, "");
				}

				if (word.hasSpaceAfter && i < words.length - 1) {
					wordText += " ";
				}

				processed.push({
					word: wordText,
					time: Math.round(Math.max(0, end - begin) * 1000),
					isBackground: isBackground,
				});

				currentTime = end;
			});

			return processed;
		}

		lines.forEach((line) => {
			const lineStartRaw = line.start ?? line.begin ?? 0;
			const lineEndRaw = line.end ?? lineStartRaw;

			const bgVocalObj = line.bgVocal || line.backgroundVocal;
			const bgWordsList = bgVocalObj?.words || [];

			let bgStart = lineStartRaw;
			if (bgWordsList.length > 0) {
				const firstBgStart = bgWordsList[0].start ?? bgWordsList[0].begin;
				if (typeof firstBgStart === "number") {
					bgStart = firstBgStart;
				}
			}

			// The line should start at the earliest timestamp
			const lineStartTime = Math.min(lineStartRaw, bgStart);

			// Process main vocals
			const mainWords = processWords(line.words || [], lineStartTime, false);

			// Process background vocals
			let backgroundWords = [];
			let backgroundStartTime = 0;
			let backgroundEndTime = 0;
			if (bgWordsList.length > 0) {
				const firstBg = bgWordsList[0].start ?? bgWordsList[0].begin ?? lineStartTime;
				const lastBg = bgWordsList[bgWordsList.length - 1].end ?? firstBg;
				backgroundStartTime = firstBg * 1000; // in ms
				backgroundEndTime = lastBg * 1000;
				backgroundWords = processWords(bgWordsList, lineStartTime, true);
			}

			const isMainBackground = (line.words || []).length > 0 && (line.words || []).every((w) => w.isBackground);

			// Calculate the effective end time (max of main line end and background vocal end)
			let lineEndTime = lineEndRaw;
			if (bgWordsList.length > 0) {
				const lastBgEnd = bgWordsList[bgWordsList.length - 1].end ?? lineEndRaw;
				lineEndTime = Math.max(lineEndTime, lastBgEnd);
			}

			karaoke.push({
				startTime: Math.round(lineStartTime * 1000),
				endTime: Math.round(lineEndTime * 1000),
				backgroundStartTime: backgroundWords.length > 0 ? backgroundStartTime : undefined,
				backgroundEndTime: backgroundWords.length > 0 ? backgroundEndTime : undefined,
				text: mainWords,
				isBackground: isMainBackground,
				// Separate background vocal track
				background: backgroundWords.length > 0 ? backgroundWords : undefined,
			});

			const mainTextStr = (line.text || "").trim();
			const bgTextStr =
				typeof bgVocalObj?.text === "string" && bgVocalObj.text.trim()
					? bgVocalObj.text.replace(/^[(]+|[)]+$/g, "").trim()
					: backgroundWords
							.map((w) => w.word)
							.join("")
							.replace(/\s+/g, " ")
							.trim();

			let combinedText = mainTextStr;
			if (bgTextStr) {
				if (bgStart < lineStartRaw) {
					combinedText = `(${bgTextStr}) ${combinedText}`.trim();
				} else {
					combinedText = `${combinedText} (${bgTextStr})`.trim();
				}
			}

			const isInline = typeof CONFIG !== "undefined" ? (CONFIG?.visual?.["synced-background-inline"] ?? true) : true;

			synced.push({
				startTime: Math.round(lineStartTime * 1000),
				endTime: Math.round(lineEndTime * 1000),
				text: isInline ? combinedText : mainTextStr || "",
				background: !isInline && backgroundWords.length ? backgroundWords : undefined,
			});

			if (isInline) {
				if (combinedText) unsynced.push({ startTime: Math.round(lineStartTime * 1000), text: combinedText });
			} else {
				let valText = mainTextStr;
				if (bgTextStr) valText += ` (${bgTextStr})`;
				if (valText) unsynced.push({ startTime: Math.round(lineStartTime * 1000), text: valText });
			}

			const translatedText = (line.translation || line.romanization || "").trim();
			if (translatedText) hasTranslation = true;

			ianz56Translation.push({
				startTime: Math.round(lineStartTime * 1000),
				endTime: Math.round(lineEndTime * 1000),
				text: translatedText || combinedText,
				originalText: combinedText,
			});
		});

		// Sort by start time
		karaoke.sort((a, b) => a.startTime - b.startTime);
		synced.sort((a, b) => a.startTime - b.startTime);
		unsynced.sort((a, b) => a.startTime - b.startTime);
		ianz56Translation.sort((a, b) => a.startTime - b.startTime);

		return { karaoke, synced, unsynced, ianz56Translation: hasTranslation ? ianz56Translation : null };
	}

	/**
	 * Main function to find and fetch lyrics
	 * @param {Object} info - Track info with artist, title, duration
	 * @returns {Promise<Object>}
	 */
	async function findLyrics(info) {
		const result = {
			uri: info.uri,
			provider: "ianz56",
			karaoke: null,
			synced: null,
			unsynced: null,
			ianz56Translation: null,
			copyright: null,
			error: null,
		};

		try {
			const lyricsJson = await fetchLyricsFromDB(info.artist, info.title);
			const { karaoke, synced, unsynced, ianz56Translation } = convertToKaraokeFormat(lyricsJson);

			result.karaoke = karaoke.length > 0 ? karaoke : null;
			result.synced = synced.length > 0 ? synced : null;
			result.unsynced = unsynced.length > 0 ? unsynced : null;
			result.ianz56Translation = ianz56Translation;

			return result;
		} catch (e) {
			result.error = e.message || "Request error or lyrics not found";
			return result;
		}
	}

	return {
		findLyrics,
		fetchLyricsFromDB,
		convertToKaraokeFormat,
	};
})();
