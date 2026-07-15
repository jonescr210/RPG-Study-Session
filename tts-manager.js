(function exposeStudyAdventureTts(root, factory) {
  const tts = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = tts;
  }
  if (root) {
    root.StudyAdventureTts = tts;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function buildStudyAdventureTts() {
  function create(options = {}) {
    const state = options.state || {};
    const els = options.els || {};
    const escapeHtml = options.escapeHtml || ((value) => String(value || ""));
    const escapeAttribute = options.escapeAttribute || escapeHtml;
    const cleanText = options.cleanText || ((value) => String(value || "").trim());
    const getCurrentLogText = options.getCurrentLogText || (() => "");
    const onPlaybackStart = typeof options.onPlaybackStart === "function" ? options.onPlaybackStart : () => {};
    const onPlaybackEnd = typeof options.onPlaybackEnd === "function" ? options.onPlaybackEnd : () => {};
    state.ttsPlaybackToken = Number(state.ttsPlaybackToken) || 0;
    let playbackActive = false;
    let synthesisQueue = Promise.resolve();
    const preparedClips = new Map();
    const maxPreparedClips = 10;
    const TTS_NETWORK_TIMEOUT_MS = 30_000;
    const TTS_PLAYBACK_TIMEOUT_MS = 45_000;

    function fetchWithTimeout(resource, requestOptions = {}, timeoutMs = TTS_NETWORK_TIMEOUT_MS) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || TTS_NETWORK_TIMEOUT_MS));
      return fetch(resource, { ...requestOptions, signal: controller.signal })
        .finally(() => window.clearTimeout(timer));
    }

    function notifyPlaybackStart() {
      if (playbackActive) return;
      playbackActive = true;
      onPlaybackStart();
    }

    function notifyPlaybackEnd() {
      if (!playbackActive) return;
      playbackActive = false;
      onPlaybackEnd();
    }

    function updateAutoDelayLabel() {
      const option = els.ttsTextDelay?.querySelector('option[value="auto"]');
      if (!option) return;
      const measured = Math.max(0, Number(state.ttsMeasuredStartupMs) || 0);
      option.textContent = measured
        ? `Auto sync (last ${(measured / 1000).toFixed(1)} sec)`
        : "Auto sync (measured)";
    }

    function createPlaybackStartSignal(leadMs = 0) {
      const requestedAt = Date.now();
      let settled = false;
      let resolveStart;
      const promise = new Promise((resolve) => { resolveStart = resolve; });
      const signal = {
        promise,
        settle(played) {
          if (settled) return;
          settled = true;
          const rawDelayMs = Math.max(0, Date.now() - requestedAt);
          const info = {
            played: Boolean(played),
            delayMs: rawDelayMs,
            leadMs: played ? Math.max(0, Number(leadMs) || 0) : 0
          };
          if (info.played) {
            state.ttsMeasuredStartupMs = rawDelayMs + info.leadMs;
            updateAutoDelayLabel();
          }
          if (state.ttsActiveStartSignal === signal) state.ttsActiveStartSignal = null;
          resolveStart(info);
        }
      };
      state.ttsActiveStartSignal = signal;
      return signal;
    }

    function providerSelects() {
      return [els.setupTtsProvider, els.ttsProvider].filter(Boolean);
    }

    function voiceSelects() {
      return [els.setupTtsVoiceSelect, els.ttsVoiceSelect].filter(Boolean);
    }

    function storedVoice(provider) {
      const fallback = provider === "kokoro" ? "kokoro:10" : "";
      return window.localStorage.getItem(`studyAdventureTtsVoiceURI:${provider}`)
        || (provider === "browser" ? window.localStorage.getItem("studyAdventureTtsVoiceURI") : "")
        || fallback;
    }

    function setProvider(value) {
      state.ttsProvider = value || "browser";
      window.localStorage.setItem("studyAdventureTtsProvider", state.ttsProvider);
      state.ttsVoiceURI = storedVoice(state.ttsProvider);
      providerSelects().forEach((select) => { select.value = state.ttsProvider; });
      stop();
      clearPreparedClips();
      updateControls();
    }

    function setVoice(value) {
      state.ttsVoiceURI = value || "";
      window.localStorage.setItem("studyAdventureTtsVoiceURI", state.ttsVoiceURI);
      window.localStorage.setItem(`studyAdventureTtsVoiceURI:${state.ttsProvider}`, state.ttsVoiceURI);
      voiceSelects().forEach((select) => { select.value = state.ttsVoiceURI; });
      clearPreparedClips();
      updateControls();
    }

    function init() {
      if (!els.missionAudioPanel) return;

      state.ttsAutoLog = window.localStorage.getItem("studyAdventureTtsAutoLog") === "true";
      state.ttsAutoQuestion = window.localStorage.getItem("studyAdventureTtsAutoQuestion") === "true";
      state.ttsProvider = window.localStorage.getItem("studyAdventureTtsProvider") || "browser";
      state.ttsVoiceURI = storedVoice(state.ttsProvider);
      state.ttsRate = Number(window.localStorage.getItem("studyAdventureTtsRate")) || 1;
      const savedDelayMode = window.localStorage.getItem("studyAdventureTtsTextDelayMode");
      state.ttsTextDelayMode = savedDelayMode === "auto" || /^\d+$/.test(savedDelayMode || "") ? savedDelayMode : "auto";
      state.ttsTextDelayMs = state.ttsTextDelayMode === "auto" ? 0 : Number(state.ttsTextDelayMode) || 0;

      if (els.ttsAutoLog) els.ttsAutoLog.checked = state.ttsAutoLog;
      if (els.ttsAutoQuestion) els.ttsAutoQuestion.checked = state.ttsAutoQuestion;
      providerSelects().forEach((select) => { select.value = state.ttsProvider; });
      if (els.ttsRate) els.ttsRate.value = String(state.ttsRate);
      if (els.ttsTextDelay) els.ttsTextDelay.value = state.ttsTextDelayMode;
      updateAutoDelayLabel();

      els.ttsPlayBtn?.addEventListener("click", () => speakText(getCurrentLogText(), { label: "Reading log" }));
      els.ttsReplayBtn?.addEventListener("click", () => speakText(state.ttsLastText || getCurrentLogText(), { label: "Replay" }));
      els.ttsStopBtn?.addEventListener("click", stop);
      els.ttsPauseBtn?.addEventListener("click", togglePause);
      providerSelects().forEach((select) => {
        select.addEventListener("change", () => setProvider(select.value));
      });
      voiceSelects().forEach((select) => {
        select.addEventListener("change", () => setVoice(select.value));
      });
      els.ttsRate?.addEventListener("input", () => {
        state.ttsRate = Number(els.ttsRate.value) || 1;
        window.localStorage.setItem("studyAdventureTtsRate", String(state.ttsRate));
        clearPreparedClips();
      });
      els.ttsTextDelay?.addEventListener("change", () => {
        state.ttsTextDelayMode = els.ttsTextDelay.value === "auto" ? "auto" : String(Number(els.ttsTextDelay.value) || 0);
        state.ttsTextDelayMs = state.ttsTextDelayMode === "auto" ? 0 : Number(state.ttsTextDelayMode) || 0;
        window.localStorage.setItem("studyAdventureTtsTextDelayMode", state.ttsTextDelayMode);
        window.localStorage.setItem("studyAdventureTtsTextDelayMs", String(state.ttsTextDelayMs));
        updateAutoDelayLabel();
      });
      els.ttsAutoLog?.addEventListener("change", () => {
        state.ttsAutoLog = Boolean(els.ttsAutoLog.checked);
        window.localStorage.setItem("studyAdventureTtsAutoLog", String(state.ttsAutoLog));
      });
      els.ttsAutoQuestion?.addEventListener("change", () => {
        state.ttsAutoQuestion = Boolean(els.ttsAutoQuestion.checked);
        window.localStorage.setItem("studyAdventureTtsAutoQuestion", String(state.ttsAutoQuestion));
      });

      if (supported()) {
        populateVoices();
        window.speechSynthesis.onvoiceschanged = populateVoices;
      }
      checkLocalTtsStatus();
      updateControls();
    }

    function supported() {
      return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
    }

    function populateVoices() {
      if (!supported() || !voiceSelects().length) return;
      const voices = window.speechSynthesis.getVoices();
      state.ttsVoices = voices;
      if (!voices.length) {
        voiceSelects().forEach((select) => {
          select.innerHTML = `<option value="">Loading voices...</option>`;
        });
        return;
      }
      const selected = state.ttsVoiceURI && voices.some((voice) => voice.voiceURI === state.ttsVoiceURI)
        ? state.ttsVoiceURI
        : preferredVoice(voices)?.voiceURI || voices[0].voiceURI;
      state.ttsVoiceURI = selected;
      const options = voices
        .map((voice) => `<option value="${escapeAttribute(voice.voiceURI)}">${escapeHtml(voice.name)}${voice.lang ? ` (${escapeHtml(voice.lang)})` : ""}</option>`)
        .join("");
      voiceSelects().forEach((select) => {
        select.innerHTML = options;
        select.value = selected;
      });
      if (state.ttsProvider === "browser" && els.ttsStatus && !window.speechSynthesis.speaking) {
        els.ttsStatus.textContent = voices.find((voice) => voice.voiceURI === selected)?.name || "Ready";
      }
      updateControls();
    }

    function preferredVoice(voices) {
      const preferredPatterns = [
        /natural/i,
        /neural/i,
        /online/i,
        /jenny/i,
        /aria/i,
        /guy/i,
        /ava/i,
        /andrew/i,
        /brian/i,
        /emma/i
      ];
      return preferredPatterns
        .map((pattern) => voices.find((voice) => pattern.test(voice.name) && /^en[-_]/i.test(voice.lang || "")))
        .find(Boolean)
        || voices.find((voice) => /^en[-_]/i.test(voice.lang || ""))
        || voices[0];
    }

    function selectedVoice() {
      return (state.ttsVoices || []).find((voice) => voice.voiceURI === state.ttsVoiceURI)
        || preferredVoice(state.ttsVoices);
    }

    function canSpeak() {
      if (state.ttsProvider === "piper") return Boolean(state.ttsPiperAvailable);
      if (state.ttsProvider === "kokoro") return Boolean(state.ttsKokoroAvailable);
      return supported();
    }

    function selectedKokoroVoiceId() {
      const selected = String(state.ttsVoiceURI || "").match(/^kokoro:(\d+)$/);
      return selected ? Number(selected[1]) : 10;
    }

    function renderBrowserVoices(select) {
      if (!supported()) {
        select.innerHTML = `<option value="">Browser voices unavailable</option>`;
        return;
      }
      if (!(state.ttsVoices || []).length) {
        populateVoices();
        return;
      }
      const selected = (state.ttsVoices || []).some((voice) => voice.voiceURI === state.ttsVoiceURI)
        ? state.ttsVoiceURI
        : preferredVoice(state.ttsVoices)?.voiceURI || "";
      state.ttsVoiceURI = selected;
      select.innerHTML = state.ttsVoices
        .map((voice) => `<option value="${escapeAttribute(voice.voiceURI)}">${escapeHtml(voice.name)}${voice.lang ? ` (${escapeHtml(voice.lang)})` : ""}</option>`)
        .join("");
      select.value = selected;
    }

    function renderKokoroVoices(select) {
      const voices = Array.isArray(state.ttsKokoroVoices) ? state.ttsKokoroVoices : [];
      if (!voices.length) {
        select.innerHTML = `<option value="kokoro:10">Kokoro voices loading...</option>`;
        return;
      }
      const requestedId = selectedKokoroVoiceId();
      const selectedId = voices.some((voice) => Number(voice.id) === requestedId) ? requestedId : 10;
      state.ttsVoiceURI = `kokoro:${selectedId}`;
      select.innerHTML = voices
        .map((voice) => `<option value="kokoro:${Number(voice.id)}">${escapeHtml(voice.label || voice.name || `Voice ${voice.id}`)}</option>`)
        .join("");
      select.value = state.ttsVoiceURI;
    }

    function updateControls() {
      const usingPiper = state.ttsProvider === "piper";
      const usingKokoro = state.ttsProvider === "kokoro";
      const available = canSpeak();
      els.missionAudioPanel?.classList.toggle("tts-disabled", !available);
      voiceSelects().forEach((select) => {
        select.disabled = usingPiper || (state.ttsProvider === "browser" && !supported()) || (usingKokoro && !state.ttsKokoroAvailable);
        if (usingPiper) {
          select.innerHTML = `<option value="piper-northern-english-male">${escapeHtml(state.ttsPiperVoiceName || "Piper: Northern English Male")}</option>`;
        } else if (usingKokoro) {
          renderKokoroVoices(select);
        } else {
          renderBrowserVoices(select);
        }
      });
      [els.ttsPlayBtn, els.ttsPauseBtn, els.ttsStopBtn, els.ttsReplayBtn, els.ttsRate, els.ttsTextDelay, els.ttsAutoLog, els.ttsAutoQuestion]
        .filter(Boolean)
        .forEach((control) => { control.disabled = !available; });
      if (els.ttsStatus && !active()) {
        if (usingPiper) {
          els.ttsStatus.textContent = state.ttsPiperAvailable ? (state.ttsPiperVoiceName || "Piper ready") : (state.ttsPiperError || "Piper not ready");
        } else if (usingKokoro) {
          els.ttsStatus.textContent = state.ttsKokoroAvailable ? (state.ttsKokoroVoiceName || "Kokoro ready") : (state.ttsKokoroError || "Kokoro not ready");
        } else {
          els.ttsStatus.textContent = supported() ? "Browser voice ready" : "Browser TTS unavailable";
        }
      }
    }

    function active() {
      return Boolean(state.ttsAudio && !state.ttsAudio.paused) || Boolean(supported() && window.speechSynthesis.speaking);
    }

    function fetchLocalTtsStatus(provider) {
      return fetchWithTimeout(`/api/tts/status?provider=${encodeURIComponent(provider)}`, { cache: "no-store" }, 8_000)
        .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)));
    }

    function checkLocalTtsStatus() {
      Promise.allSettled([fetchLocalTtsStatus("piper"), fetchLocalTtsStatus("kokoro")])
        .then(([piperResult, kokoroResult]) => {
          if (piperResult.status === "fulfilled") {
            state.ttsPiperAvailable = Boolean(piperResult.value?.available);
            state.ttsPiperVoiceName = piperResult.value?.voiceName || "Piper: Northern English Male";
            state.ttsPiperError = piperResult.value?.error || "";
          } else {
            state.ttsPiperAvailable = false;
            state.ttsPiperError = "Restart server for Piper";
          }
          if (kokoroResult.status === "fulfilled") {
            state.ttsKokoroAvailable = Boolean(kokoroResult.value?.available);
            state.ttsKokoroVoiceName = kokoroResult.value?.voiceName || "Kokoro ready";
            state.ttsKokoroVoices = Array.isArray(kokoroResult.value?.voices) ? kokoroResult.value.voices : [];
            state.ttsKokoroError = kokoroResult.value?.error || "";
          } else {
            state.ttsKokoroAvailable = false;
            state.ttsKokoroError = "Restart server for Kokoro";
          }
          updateControls();
        });
    }

    function rememberPlayback(promise, startPromise = Promise.resolve({ played: false, delayMs: 0, leadMs: 0 })) {
      const tracked = Promise.resolve(promise).catch(() => {});
      tracked.started = startPromise;
      state.ttsLastPlaybackPromise = tracked;
      state.ttsLastPlaybackStartPromise = startPromise;
      return state.ttsLastPlaybackPromise;
    }

    function resolveActivePlayback() {
      if (!state.ttsPlaybackResolve) return;
      const resolve = state.ttsPlaybackResolve;
      state.ttsPlaybackResolve = null;
      resolve();
    }

    function waitForPlayback(playback) {
      const active = Promise.resolve(playback || state.ttsLastPlaybackPromise || Promise.resolve()).catch(() => {});
      return new Promise((resolve) => {
        let settled = false;
        const complete = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          resolve();
        };
        const timeout = window.setTimeout(() => {
          stop();
          complete();
        }, TTS_PLAYBACK_TIMEOUT_MS);
        active.then(complete, complete);
      });
    }

    function waitForPresentationStart(playback) {
      if (state.ttsTextDelayMode !== "auto") return Promise.resolve({ played: false, manual: true });
      const started = playback?.started;
      if (!started) return Promise.resolve({ played: false, unavailable: true });
      return new Promise((resolve) => {
        let finished = false;
        const complete = (info) => {
          if (finished) return;
          finished = true;
          window.clearTimeout(timeout);
          resolve(info);
        };
        const timeout = window.setTimeout(() => {
          complete({ played: false, timedOut: true });
        }, 15_000);
        Promise.resolve(started).then((info) => {
          if (!info?.played || !info.leadMs) {
            complete(info || { played: false });
            return;
          }
          window.setTimeout(() => complete(info), info.leadMs);
        }).catch(() => complete({ played: false }));
      });
    }

    function noRead() {
      return { visualDelay: 0, playback: Promise.resolve() };
    }

    function localSpeechConfig() {
      const provider = state.ttsProvider === "kokoro" ? "kokoro" : "piper";
      return {
        provider,
        providerName: provider === "kokoro" ? "Kokoro" : "Piper",
        rate: Math.max(0.75, Math.min(1.25, Number(state.ttsRate) || 1)),
        voiceId: provider === "kokoro" ? selectedKokoroVoiceId() : null,
        leadMs: provider === "piper" ? 320 : 240
      };
    }

    function localSpeechAvailable(config = localSpeechConfig()) {
      return config.provider === "kokoro" ? Boolean(state.ttsKokoroAvailable) : Boolean(state.ttsPiperAvailable);
    }

    function preparedClipKey(text, config = localSpeechConfig()) {
      return [config.provider, config.voiceId ?? "default", config.rate.toFixed(2), text].join("|");
    }

    function clearPreparedClips() {
      preparedClips.clear();
      state.ttsPreparedClipCount = 0;
    }

    function trimPreparedClips() {
      if (preparedClips.size <= maxPreparedClips) return;
      const removable = [...preparedClips.values()]
        .filter((entry) => entry.ready)
        .sort((a, b) => Number(a.lastUsedAt || a.createdAt) - Number(b.lastUsedAt || b.createdAt));
      while (preparedClips.size > maxPreparedClips && removable.length) {
        preparedClips.delete(removable.shift().key);
      }
      state.ttsPreparedClipCount = preparedClips.size;
    }

    function requestLocalSpeech(text, config) {
      return fetchWithTimeout("/api/tts/speak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: config.provider,
          text,
          rate: config.rate,
          voiceId: config.voiceId ?? undefined
        })
      }).then((response) => {
        if (!response.ok) {
          return response.json().then((body) => {
            throw new Error(body.error || `${config.providerName} speech failed`);
          });
        }
        return response.blob();
      });
    }

    function prepareLocalText(text, options = {}) {
      const clean = cleanText(text);
      const config = options.config || localSpeechConfig();
      if (!clean || !["piper", "kokoro"].includes(state.ttsProvider) || !localSpeechAvailable(config)) {
        return Promise.resolve(null);
      }
      const key = preparedClipKey(clean, config);
      const existing = preparedClips.get(key);
      if (existing) {
        existing.lastUsedAt = Date.now();
        return existing.promise;
      }

      const entry = {
        key,
        text: clean,
        config,
        blob: null,
        ready: false,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        purpose: options.purpose || "narration"
      };
      const task = synthesisQueue
        .catch(() => {})
        .then(() => requestLocalSpeech(clean, config))
        .then((blob) => {
          entry.blob = blob;
          entry.ready = true;
          entry.lastUsedAt = Date.now();
          trimPreparedClips();
          return entry;
        })
        .catch((error) => {
          if (preparedClips.get(key) === entry) preparedClips.delete(key);
          state.ttsPreparedClipCount = preparedClips.size;
          throw error;
        });
      entry.promise = task;
      preparedClips.set(key, entry);
      state.ttsPreparedClipCount = preparedClips.size;
      synthesisQueue = task.then(() => undefined, () => undefined);
      return task;
    }

    function prefetchText(text, options = {}) {
      if (state.ttsProvider !== "piper" && state.ttsProvider !== "kokoro") return Promise.resolve(null);
      return prepareLocalText(text, options).catch(() => null);
    }

    function prefetchTexts(items = []) {
      const unique = [];
      const seen = new Set();
      for (const item of items) {
        const text = cleanText(typeof item === "string" ? item : item?.text);
        if (!text || seen.has(text)) continue;
        seen.add(text);
        unique.push({ text, purpose: typeof item === "string" ? "narration" : item?.purpose });
      }
      return Promise.allSettled(unique.map((item) => prefetchText(item.text, item)));
    }

    function speakLocalText(text, options = {}) {
      const config = localSpeechConfig();
      if (!localSpeechAvailable(config)) {
        if (els.ttsStatus) els.ttsStatus.textContent = `${config.providerName} not ready`;
        return Promise.resolve();
      }
      stop();
      const playbackToken = ++state.ttsPlaybackToken;
      const startSignal = createPlaybackStartSignal(config.leadMs);
      const prepared = prepareLocalText(text, { config, purpose: options.purpose || "active" });
      if (els.ttsStatus) els.ttsStatus.textContent = options.label || "Preparing voice";
      const playback = new Promise((resolve) => {
        const finish = () => {
          if (state.ttsPlaybackResolve === finish) state.ttsPlaybackResolve = null;
          startSignal.settle(false);
          notifyPlaybackEnd();
          resolve();
        };
        state.ttsPlaybackResolve = finish;
        prepared
          .then((entry) => {
            if (!entry?.blob) throw new Error(`${config.providerName} speech was not prepared`);
            if (playbackToken !== state.ttsPlaybackToken) {
              finish();
              return null;
            }
            entry.lastUsedAt = Date.now();
            const audioUrl = URL.createObjectURL(entry.blob);
            const audio = new Audio(audioUrl);
            audio.preload = "auto";
            state.ttsAudioUrl = audioUrl;
            state.ttsAudio = audio;
            audio.onplay = () => {
              startSignal.settle(true);
              notifyPlaybackStart();
              if (els.ttsStatus) els.ttsStatus.textContent = options.label || "Reading";
              if (els.ttsPauseBtn) els.ttsPauseBtn.textContent = "Pause";
            };
            audio.onended = () => {
              if (state.ttsAudioUrl === audioUrl) {
                URL.revokeObjectURL(audioUrl);
                state.ttsAudioUrl = "";
                state.ttsAudio = null;
              }
              if (els.ttsStatus) els.ttsStatus.textContent = "Ready";
              if (els.ttsPauseBtn) els.ttsPauseBtn.textContent = "Pause";
              finish();
            };
            audio.onerror = () => {
              if (els.ttsStatus) els.ttsStatus.textContent = "Audio playback failed";
              finish();
            };
            return audio.play().catch(() => {
              if (els.ttsStatus) els.ttsStatus.textContent = "Audio playback blocked";
              finish();
            });
          })
          .catch((error) => {
            if (els.ttsStatus) els.ttsStatus.textContent = error.message || `${config.providerName} speech failed`;
            finish();
          });
      });
      return rememberPlayback(playback, startSignal.promise);
    }

    function speakText(text, options = {}) {
      const clean = cleanText(text);
      if (!clean) return Promise.resolve();
      state.ttsLastText = clean;
      if (state.ttsProvider === "piper" || state.ttsProvider === "kokoro") {
        return speakLocalText(clean, options);
      }
      if (!supported()) {
        if (els.ttsStatus) els.ttsStatus.textContent = "Browser TTS unavailable";
        return Promise.resolve();
      }
      notifyPlaybackEnd();
      resolveActivePlayback();
      state.ttsActiveStartSignal?.settle(false);
      const playbackToken = ++state.ttsPlaybackToken;
      const startSignal = createPlaybackStartSignal(0);
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(clean);
      const voice = selectedVoice();
      if (voice) utterance.voice = voice;
      utterance.rate = Math.max(0.75, Math.min(1.25, Number(state.ttsRate) || 1));
      utterance.pitch = 1;
      utterance.volume = 1;
      utterance.onstart = () => {
        startSignal.settle(true);
        notifyPlaybackStart();
        if (els.ttsStatus) els.ttsStatus.textContent = options.label || "Reading";
        if (els.ttsPauseBtn) els.ttsPauseBtn.textContent = "Pause";
      };
      const playback = new Promise((resolve) => {
        const finish = () => {
          if (state.ttsPlaybackResolve === finish) state.ttsPlaybackResolve = null;
          startSignal.settle(false);
          if (playbackToken !== state.ttsPlaybackToken) {
            resolve();
            return;
          }
          notifyPlaybackEnd();
          if (els.ttsStatus) els.ttsStatus.textContent = "Ready";
          if (els.ttsPauseBtn) els.ttsPauseBtn.textContent = "Pause";
          resolve();
        };
        state.ttsPlaybackResolve = finish;
        utterance.onend = finish;
        utterance.onerror = () => {
          if (els.ttsStatus) els.ttsStatus.textContent = "Audio blocked";
          finish();
        };
        window.speechSynthesis.speak(utterance);
      });
      return rememberPlayback(playback, startSignal.promise);
    }

    function stop() {
      state.ttsPlaybackToken += 1;
      resolveActivePlayback();
      state.ttsActiveStartSignal?.settle(false);
      if (supported()) window.speechSynthesis.cancel();
      if (state.ttsAudio) {
        state.ttsAudio.pause();
        state.ttsAudio.currentTime = 0;
        state.ttsAudio = null;
      }
      if (state.ttsAudioUrl) {
        URL.revokeObjectURL(state.ttsAudioUrl);
        state.ttsAudioUrl = "";
      }
      notifyPlaybackEnd();
      if (els.ttsStatus) els.ttsStatus.textContent = "Stopped";
      if (els.ttsPauseBtn) els.ttsPauseBtn.textContent = "Pause";
    }

    function togglePause() {
      if ((state.ttsProvider === "piper" || state.ttsProvider === "kokoro") && state.ttsAudio) {
        if (state.ttsAudio.paused) {
          state.ttsAudio.play();
          if (els.ttsPauseBtn) els.ttsPauseBtn.textContent = "Pause";
          if (els.ttsStatus) els.ttsStatus.textContent = "Reading";
        } else {
          state.ttsAudio.pause();
          notifyPlaybackEnd();
          if (els.ttsPauseBtn) els.ttsPauseBtn.textContent = "Resume";
          if (els.ttsStatus) els.ttsStatus.textContent = "Paused";
        }
        return;
      }
      if (!supported()) return;
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
        notifyPlaybackStart();
        if (els.ttsPauseBtn) els.ttsPauseBtn.textContent = "Pause";
        if (els.ttsStatus) els.ttsStatus.textContent = "Reading";
      } else if (window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
        notifyPlaybackEnd();
        if (els.ttsPauseBtn) els.ttsPauseBtn.textContent = "Resume";
        if (els.ttsStatus) els.ttsStatus.textContent = "Paused";
      }
    }

    function visualDelayMs() {
      if (state.ttsTextDelayMode === "auto") return 0;
      if (state.ttsProvider !== "piper" && state.ttsProvider !== "kokoro") return 0;
      return Math.max(0, Math.min(3000, Number(state.ttsTextDelayMs) || 0));
    }

    return {
      init,
      canSpeak,
      noRead,
      prefetchText,
      prefetchTexts,
      speakText,
      stop,
      togglePause,
      visualDelayMs,
      waitForPresentationStart,
      waitForPlayback
    };
  }

  return { create };
});
