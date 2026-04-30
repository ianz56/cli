const ProviderIanz56 = (() => {
	const BASE_URL = "https://raw.githubusercontent.com/ianz56/lyrics-ttml/main/";

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
	 * Split artist string into normalized parts
	 * @param {string} s
	 * @returns {string[]}
	 */
	function getArtistParts(s) {
		if (!s) return [];
		return s
			.split(/\s*[,/&]\s*|\s+(?:feat\.?|ft\.?|and|with)\s+/i)
			.map(normalize)
			.filter((p) => p.length > 0);
	}

	/**
	 * Fetch the index.json from GitHub
	 * @returns {Promise<Array>}
	 */
	async function fetchIndex() {
		const now = Date.now();
		const indexUrl = BASE_URL + "index.json?t=" + now;
		if (indexCache && now - lastIndexFetch < CACHE_DURATION) {
			return indexCache;
		}

		// Fallback to regular fetch
		const response = await fetch(indexUrl);
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
		const artistParts = getArtistParts(artist);
		const normalizedTitle = normalize(title);

		// First try exact match
		const match = index.find((entry) => {
			const entryArtist = normalize(entry.artist);
			const entryTitle = normalize(entry.title);
			return entryArtist === normalizedArtist && entryTitle === normalizedTitle;
		});

		if (match) return match;

		// Try canonical artist match (same parts, any order)
		if (artistParts.length > 1) {
			const sortedArtist = [...artistParts].sort().join("|");
			const canonicalMatch = index.find((entry) => {
				const entryParts = getArtistParts(entry.artist);
				if (entryParts.length !== artistParts.length) return false;
				const sortedEntry = entryParts.sort().join("|");
				return sortedArtist === sortedEntry && normalize(entry.title) === normalizedTitle;
			});

			if (canonicalMatch) return canonicalMatch;
		}

		// Try partial match (artist contains or title contains)
		const partialMatches = index.filter((entry) => {
			if (!normalizedArtist) return false;
			const entryArtist = normalize(entry.artist);
			const entryTitle = normalize(entry.title);

			const entryParts = getArtistParts(entry.artist);
			const artistOverlap = artistParts.some((p) => entryParts.includes(p)) || entryParts.some((p) => artistParts.includes(p));

			return (
				(artistOverlap || entryArtist.includes(normalizedArtist) || normalizedArtist.includes(entryArtist)) &&
				(entryTitle.includes(normalizedTitle) || normalizedTitle.includes(entryTitle))
			);
		});

		if (partialMatches.length > 0) {
			const scoredMatches = partialMatches.map((entry) => {
				const entryArtist = normalize(entry.artist);
				const entryTitle = normalize(entry.title);
				const entryParts = getArtistParts(entry.artist);
				let score = 0;

				// Artist score
				if (entryArtist === normalizedArtist) {
					score += 100;
				} else {
					const intersection = artistParts.filter((p) => entryParts.includes(p));
					if (intersection.length > 0) {
						score += 50 + (intersection.length / Math.max(artistParts.length, entryParts.length)) * 40;
					} else if (entryArtist.includes(normalizedArtist) || normalizedArtist.includes(entryArtist)) {
						score += 30;
					}
				}

				// Title score
				if (entryTitle === normalizedTitle) score += 200;
				else if (entryTitle.startsWith(normalizedTitle)) score += 150;
				else if (normalizedTitle.startsWith(entryTitle)) {
					score += 120;
					score -= Math.abs(normalizedTitle.length - entryTitle.length);
				} else if (entryTitle.includes(normalizedTitle)) score += 100;
				else if (normalizedTitle.includes(entryTitle)) {
					score += 80;
					score -= Math.abs(normalizedTitle.length - entryTitle.length);
				}

				return { entry, score };
			});

			scoredMatches.sort((a, b) => b.score - a.score);
			return scoredMatches[0].entry;
		}

		// Try title-only match (for cases where artist field is empty in index)
		const titleOnlyMatches = index.filter((entry) => {
			const entryArtist = normalize(entry.artist);
			const entryTitle = normalize(entry.title);

			// If artist is empty, allow partial title match (legacy behavior)
			if (!entryArtist) {
				return entryTitle === normalizedTitle || entryTitle.includes(normalizedTitle) || normalizedTitle.includes(entryTitle);
			}

			// Require exact title match AND some artist overlap
			const entryParts = getArtistParts(entry.artist);
			const artistOverlap = artistParts.some((p) => entryParts.includes(p)) || entryParts.some((p) => artistParts.includes(p));
			return entryTitle === normalizedTitle && (artistOverlap || entryArtist.includes(normalizedArtist) || normalizedArtist.includes(entryArtist));
		});

		if (titleOnlyMatches.length > 0) {
			const scoredMatches = titleOnlyMatches.map((entry) => {
				const entryTitle = normalize(entry.title);
				let score = 0;

				// Title score
				if (entryTitle === normalizedTitle) score += 200;
				else if (entryTitle.startsWith(normalizedTitle)) score += 150;
				else if (normalizedTitle.startsWith(entryTitle)) {
					score += 120;
					score -= Math.abs(normalizedTitle.length - entryTitle.length);
				} else if (entryTitle.includes(normalizedTitle)) score += 100;
				else if (normalizedTitle.includes(entryTitle)) {
					score += 80;
					score -= Math.abs(normalizedTitle.length - entryTitle.length);
				}

				return { entry, score };
			});

			scoredMatches.sort((a, b) => b.score - a.score);
			return scoredMatches[0].entry;
		}

		return null;
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
		const encodedPath = path.split("/").map(encodeURIComponent).join("/");
		const url = BASE_URL + encodedPath;

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

			if (line.backgroundVocal?.words?.length > 0) {
				bgStart = line.backgroundVocal.words[0].begin;
			}

			// The line should start at the earliest timestamp
			const lineStartTime = Math.min(mainStart, bgStart);

			// Process main vocals
			const mainWords = processWords(line.words || [], lineStartTime, false);

			// Process background vocals
			let backgroundWords = [];
			let backgroundStartTime = 0;
			let backgroundEndTime = 0;
			if (line.backgroundVocal?.words) {
				const bgWords = line.backgroundVocal.words;
				if (bgWords.length > 0) {
					backgroundStartTime = bgWords[0].begin * 1000; // in ms
					backgroundEndTime = bgWords[bgWords.length - 1].end * 1000;
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
				backgroundStartTime: backgroundWords.length > 0 ? backgroundStartTime : undefined,
				backgroundEndTime: backgroundWords.length > 0 ? backgroundEndTime : undefined,
				text: mainWords,
				isBackground: isMainBackground,
				// Separate background vocal track
				background: backgroundWords.length > 0 ? backgroundWords : undefined,
			});

			const mainTextStr = (line.text || "").trim();
			const bgTextStr = backgroundWords
				.map((w) => w.word)
				.join("")
				.replace(/\s+/g, " ")
				.trim();

			let combinedText = mainTextStr;
			if (bgTextStr) {
				if (bgStart < mainStart) {
					combinedText = `(${bgTextStr}) ${combinedText}`.trim();
				} else {
					combinedText = `${combinedText} (${bgTextStr})`.trim();
				}
			}

			const isInline = CONFIG?.visual?.["synced-background-inline"] ?? true;

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

			const translatedText = (line.translation || "").trim();
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
			const index = await fetchIndex();
			const match = findMatch(info.artist, info.title, index);

			if (!match) {
				throw new Error("No matching lyrics found");
			}

			if (!match.jsonPath) {
				throw new Error("No JSON path in matched entry");
			}

			const lyricsJson = await fetchLyricsJson(match.jsonPath);
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
		fetchIndex,
		normalize,
		findMatch,
		convertToKaraokeFormat,
	};
})();
