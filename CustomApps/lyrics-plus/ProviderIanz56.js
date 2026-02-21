const ProviderIanz56 = (() => {
	const BASE_URL = "https://raw.githubusercontent.com/ianz56/lyrics-ttml/main/";
	const INDEX_URL = BASE_URL + "index.json?t=" + Date.now();

	let indexCache = null;
	let lastIndexFetch = 0;
	const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

	/**
	 * Normalize string for comparison (lowercase, remove special chars, trim)
	 * @param {string} s
	 * @returns {string}
	 */
	function normalize(s) {
		if (!s) return "";
		return s
			.toLowerCase()
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "") // Remove diacritics
			.replace(/[^\w\s]/g, "") // Remove special characters
			.replace(/\s+/g, " ") // Normalize whitespace
			.trim();
	}

	/**
	 * Fetch the index.json from GitHub
	 * @returns {Promise<Array>}
	 */
	async function fetchIndex() {
		const now = Date.now();
		if (indexCache && now - lastIndexFetch < CACHE_DURATION) {
			return indexCache;
		}

		try {
			// Try using Spicetify's CosmosAsync for CORS handling
			const response = await Spicetify.CosmosAsync.get(INDEX_URL);
			if (response) {
				indexCache = response;
				lastIndexFetch = now;
				return indexCache;
			}
		} catch (e) {
			console.log("[ianz56] CosmosAsync failed, trying fetch:", e);
		}

		// Fallback to regular fetch
		const response = await fetch(INDEX_URL);
		if (!response.ok) {
			throw new Error(`Failed to fetch index: ${response.status}`);
		}

		indexCache = await response.json();
		lastIndexFetch = now;
		return indexCache;
	}

	/**
	 * Find matching entry in index by artist and title
	 * @param {string} artist
	 * @param {string} title
	 * @param {Array} index
	 * @returns {Object|null}
	 */
	function findMatch(artist, title, index) {
		const normalizedArtist = normalize(artist);
		const normalizedTitle = normalize(title);

		// First try exact match
		let match = index.find((entry) => {
			const entryArtist = normalize(entry.artist);
			const entryTitle = normalize(entry.title);
			return entryArtist === normalizedArtist && entryTitle === normalizedTitle;
		});

		if (match) return match;

		// Try partial match (artist contains or title contains)
		match = index.find((entry) => {
			const entryArtist = normalize(entry.artist);
			const entryTitle = normalize(entry.title);
			return (
				entryArtist &&
				(entryArtist.includes(normalizedArtist) || normalizedArtist.includes(entryArtist)) &&
				(entryTitle.includes(normalizedTitle) || normalizedTitle.includes(entryTitle))
			);
		});

		if (match) return match;

		// Try title-only match (for cases where artist field is empty in index)
		match = index.find((entry) => {
			const entryArtist = normalize(entry.artist);
			const entryTitle = normalize(entry.title);

			// If artist is empty, allow partial title match (legacy behavior)
			if (!entryArtist) {
				return entryTitle === normalizedTitle || entryTitle.includes(normalizedTitle) || normalizedTitle.includes(entryTitle);
			}

			// If artist is NOT empty, require EXACT title match
			// This allows matching "Tanpa Cinta" (exact) even if artist is "Yovie" vs "Tiara"
			// But prevents matching "Cinta" (partial) for "Tanpa Cinta"
			return entryTitle === normalizedTitle;
		});

		return match;
	}

	/**
	 * Fetch and parse the JSON lyrics file
	 * @param {string} jsonPath
	 * @returns {Promise<Object>}
	 */
	async function fetchLyricsJson(jsonPath) {
		// jsonPath is like "./JSON/IND/Artist - Title.json"
		// Remove leading "./" and construct full URL
		const path = jsonPath.replace(/^\.\//, "");
		const url = BASE_URL + encodeURI(path);

		console.log("[ianz56] Fetching JSON lyrics from:", url);

		try {
			// Try using Spicetify's CosmosAsync for CORS handling
			const response = await Spicetify.CosmosAsync.get(url);
			if (response) {
				return response;
			}
		} catch (e) {
			console.log("[ianz56] CosmosAsync failed, trying fetch:", e);
		}

		// Fallback to regular fetch
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Failed to fetch lyrics: ${response.status}`);
		}

		return response.json();
	}

	/**
	 * Convert JSON lyrics format to karaoke format for lyrics-plus
	 * Input format: { lines: [{ begin, end, text, words: [{ text, begin, end }] }] }
	 * Output format for karaoke: [{ startTime (ms), endTime (ms), text: [{ word, time (duration in ms) }] }]
	 * Output format for synced: [{ startTime (ms), text (string) }]
	 * @param {Object} lyricsJson
	 * @returns {{ karaoke: Array, synced: Array }}
	 */
	function convertToKaraokeFormat(lyricsJson) {
		const lines = lyricsJson.lines || [];
		const karaoke = [];
		const synced = [];

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
				const begin = word.begin;
				const end = word.end;

				// Gap before word
				if (begin > currentTime + 0.01) {
					// 10ms tolerance
					processed.push({
						word: "",
						time: Math.round((begin - currentTime) * 1000),
						isBackground: isBackground,
					});
				}

				// The word itself
				let wordText = word.text;
				// Sanitize background vocal parens
				if (isBackground) {
					wordText = wordText.replace(/^[(]+|[)]+$/g, "");
				}

				if (word.hasSpaceAfter && i < words.length - 1) {
					wordText += " ";
				}

				processed.push({
					word: wordText,
					time: Math.round((end - begin) * 1000),
					isBackground: isBackground,
				});

				currentTime = end;
			});

			return processed;
		}

		lines.forEach((line) => {
			const mainStart = line.begin;
			let bgStart = mainStart;

			if (line.backgroundVocal && line.backgroundVocal.words && line.backgroundVocal.words.length > 0) {
				bgStart = line.backgroundVocal.words[0].begin;
			}

			// The line should start at the earliest timestamp
			const lineStartTime = Math.min(mainStart, bgStart);

			// Process main vocals
			const mainWords = processWords(line.words || [], lineStartTime, false);

			// Process background vocals
			let backgroundWords = [];
			let backgroundStartTime = 0;
			if (line.backgroundVocal?.words) {
				const bgWords = line.backgroundVocal.words;
				if (bgWords.length > 0) {
					backgroundStartTime = bgWords[0].begin * 1000; // in ms
					backgroundWords = processWords(bgWords, lineStartTime, true);
				}
			}

			const isMainBackground = (line.words || []).length > 0 && (line.words || []).every((w) => w.isBackground);

			// Calculate the effective end time (max of main line end and background vocal end)
			let lineEndTime = line.end;
			if (line.backgroundVocal?.words && line.backgroundVocal.words.length > 0) {
				const bgWords = line.backgroundVocal.words;
				const bgEndTime = bgWords[bgWords.length - 1].end;
				lineEndTime = Math.max(lineEndTime, bgEndTime);
			}

			karaoke.push({
				startTime: Math.round(lineStartTime * 1000),
				endTime: Math.round(lineEndTime * 1000),
				text: mainWords,
				isBackground: isMainBackground,
				// Separate background vocal track
				background: backgroundWords.length > 0 ? backgroundWords : undefined,
				originalText: line.translation || "",
			});

			synced.push({
				startTime: Math.round(lineStartTime * 1000),
				endTime: Math.round(lineEndTime * 1000),
				text: line.translation || line.text || "",
				originalText: line.translation ? line.text || "" : "",
				background: backgroundWords,
			});
		});

		// Sort by start time
		karaoke.sort((a, b) => a.startTime - b.startTime);
		synced.sort((a, b) => a.startTime - b.startTime);

		return { karaoke, synced };
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
			copyright: null,
			error: null,
		};

		try {
			const index = await fetchIndex();
			const match = findMatch(info.artist, info.title, index);

			if (!match) {
				console.log("[ianz56] No match found");
				throw new Error("No matching lyrics found");
			}

			if (!match.jsonPath) {
				throw new Error("No JSON path in matched entry");
			}

			const lyricsJson = await fetchLyricsJson(match.jsonPath);
			const { karaoke, synced } = convertToKaraokeFormat(lyricsJson);

			result.karaoke = karaoke.length > 0 ? karaoke : null;
			result.synced = synced.length > 0 ? synced : null;
			result.unsynced = result.synced; // Unsynced fallback to synced as no raw unsynced provided usually by format

			return result;
		} catch (e) {
			console.error("[ianz56] Error:", e);
			result.error = "Request error or lyrics not found";
			return result;
		}
	}

	return {
		findLyrics,
		fetchIndex,
		normalize,
		findMatch,
		convertToKaraokeFormat,
	};
})();
