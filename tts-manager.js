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

    function init() {
      if (!els.missionAudioPanel) return;

      state.ttsAutoLog = window.localStorage.getItem("studyAdventureTtsAutoLog") === "true";
      state.ttsAutoQuestion = window.localStorage.getItem("studyAdventureTtsAutoQuestion") === "true";
      state.ttsProvider = window.localStorage.getItem("studyAdventureTtsProvider") || "browser";
      state.ttsVoiceURI = window.localStorage.getItem("studyAdventureTtsVoiceURI") || "";
      state.ttsRate = Number(window.localStorage.getItem("studyAdventureTtsRate")) || 1;
      state.ttsTextDelayMs = Number(window.localStorage.getItem("studyAdventureTtsTextDelayMs")) || 1000;

      if (els.ttsAutoLog) els.ttsAutoLog.checked = state.ttsAutoLog;
      if (els.ttsAutoQuestion) els.ttsAutoQuestion.checked = state.ttsAutoQuestion;
      if (els.ttsProvider) els.ttsProvider.value = state.ttsProvider;
      if (els.ttsRate) els.ttsRate.value = String(state.ttsRate);
      if (els.ttsTextDelay) els.ttsTextDelay.value = String(state.ttsTextDelayMs);

      els.ttsPlayBtn?.addEventListener("click", () => speakText(getCurrentLogText(), { label: "Reading log" }));
      els.ttsReplayBtn?.addEventListener("click", () => speakText(state.ttsLastText || getCurrentLogText(), { label: "Replay" }));
      els.ttsStopBtn?.addEventListener("click", stop);
      els.ttsPauseBtn?.addEventListener("click", togglePause);
      els.ttsProvider?.addEventListener("change", () => {
        state.ttsProvider = els.ttsProvider.value;
        window.localStorage.setItem("studyAdventureTtsProvider", state.ttsProvider);
        stop();
        updateControls();
      });
      els.ttsVoiceSelect?.addEventListener("change", () => {
        state.ttsVoiceURI = els.ttsVoiceSelect.value;
        window.localStorage.setItem("studyAdventureTtsVoiceURI", state.ttsVoiceURI);
      });
      els.ttsRate?.addEventListener("input", () => {
        state.ttsRate = Number(els.ttsRate.value) || 1;
        window.localStorage.setItem("studyAdventureTtsRate", String(state.ttsRate));
      });
      els.ttsTextDelay?.addEventListener("change", () => {
        state.ttsTextDelayMs = Number(els.ttsTextDelay.value) || 0;
        window.localStorage.setItem("studyAdventureTtsTextDelayMs", String(state.ttsTextDelayMs));
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
      checkPiperStatus();
      updateControls();
    }

    function supported() {
      return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
    }

    function populateVoices() {
      if (!supported() || !els.ttsVoiceSelect) return;
      const voices = window.speechSynthesis.getVoices();
      state.ttsVoices = voices;
      if (!voices.length) {
        els.ttsVoiceSelect.innerHTML = `<option value="">Loading voices...</option>`;
        return;
      }
      const selected = state.ttsVoiceURI && voices.some((voice) => voice.voiceURI === state.ttsVoiceURI)
        ? state.ttsVoiceURI
        : preferredVoice(voices)?.voiceURI || voices[0].voiceURI;
      state.ttsVoiceURI = selected;
      els.ttsVoiceSelect.innerHTML = voices
        .map((voice) => `<option value="${escapeAttribute(voice.voiceURI)}">${escapeHtml(voice.name)}${voice.lang ? ` (${escapeHtml(voice.lang)})` : ""}</option>`)
        .join("");
      els.ttsVoiceSelect.value = selected;
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
      return state.ttsVoices.find((voice) => voice.voiceURI === state.ttsVoiceURI)
        || preferredVoice(state.ttsVoices);
    }

    function canSpeak() {
      return state.ttsProvider === "piper" ? state.ttsPiperAvailable : supported();
    }

    function updateControls() {
      const usingPiper = state.ttsProvider === "piper";
      const available = canSpeak();
      els.missionAudioPanel?.classList.toggle("tts-disabled", !available);
      if (els.ttsVoiceSelect) {
        els.ttsVoiceSelect.disabled = usingPiper || !supported();
        if (usingPiper) {
          els.ttsVoiceSelect.innerHTML = `<option value="piper-northern-english-male">${escapeHtml(state.ttsPiperVoiceName || "Piper: Northern English Male")}</option>`;
        } else if (!supported()) {
          els.ttsVoiceSelect.innerHTML = `<option value="">Browser voices unavailable</option>`;
        } else if (!state.ttsVoices.length) {
          populateVoices();
        }
      }
      [els.ttsPlayBtn, els.ttsPauseBtn, els.ttsStopBtn, els.ttsReplayBtn, els.ttsRate, els.ttsTextDelay, els.ttsAutoLog, els.ttsAutoQuestion]
        .filter(Boolean)
        .forEach((control) => { control.disabled = !available; });
      if (els.ttsStatus && !active()) {
        if (usingPiper) {
          els.ttsStatus.textContent = state.ttsPiperAvailable ? (state.ttsPiperVoiceName || "Piper ready") : (state.ttsPiperError || "Piper not ready");
        } else {
          els.ttsStatus.textContent = supported() ? "Browser voice ready" : "Browser TTS unavailable";
        }
      }
    }

    function active() {
      return Boolean(state.ttsAudio && !state.ttsAudio.paused) || Boolean(supported() && window.speechSynthesis.speaking);
    }

    function checkPiperStatus() {
      fetch("/api/tts/status", { cache: "no-store" })
        .then((response) => {
          if (!response.ok) {
            return { available: false, error: response.status === 404 ? "Restart server for Piper" : "Piper status unavailable" };
          }
          return response.json();
        })
        .then((status) => {
          state.ttsPiperAvailable = Boolean(status?.available);
          state.ttsPiperVoiceName = status?.voiceName || "Piper: Northern English Male";
          state.ttsPiperError = status?.error || "";
          updateControls();
        })
        .catch(() => {
          state.ttsPiperAvailable = false;
          state.ttsPiperError = "Restart server for Piper";
          updateControls();
        });
    }

    function rememberPlayback(promise) {
      state.ttsLastPlaybackPromise = Promise.resolve(promise).catch(() => {});
      return state.ttsLastPlaybackPromise;
    }

    function resolveActivePlayback() {
      if (!state.ttsPlaybackResolve) return;
      const resolve = state.ttsPlaybackResolve;
      state.ttsPlaybackResolve = null;
      resolve();
    }

    function waitForPlayback(playback) {
      return Promise.resolve(playback || state.ttsLastPlaybackPromise || Promise.resolve()).catch(() => {});
    }

    function noRead() {
      return { visualDelay: 0, playback: Promise.resolve() };
    }

    function speakPiperText(text, options = {}) {
      if (!state.ttsPiperAvailable) {
        if (els.ttsStatus) els.ttsStatus.textContent = "Piper not ready";
        return Promise.resolve();
      }
      stop();
      const playbackToken = ++state.ttsPlaybackToken;
      if (els.ttsStatus) els.ttsStatus.textContent = options.label || "Generating voice";
      return rememberPlayback(new Promise((resolve) => {
        const finish = () => {
          if (state.ttsPlaybackResolve === finish) state.ttsPlaybackResolve = null;
          notifyPlaybackEnd();
          resolve();
        };
        state.ttsPlaybackResolve = finish;
        fetch("/api/tts/speak", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, rate: state.ttsRate })
        })
          .then((response) => {
            if (!response.ok) return response.json().then((body) => { throw new Error(body.error || "Piper speech failed"); });
            return response.blob();
          })
          .then((blob) => {
            if (playbackToken !== state.ttsPlaybackToken) {
              finish();
              return null;
            }
            const audioUrl = URL.createObjectURL(blob);
            const audio = new Audio(audioUrl);
            state.ttsAudioUrl = audioUrl;
            state.ttsAudio = audio;
            audio.onplay = () => {
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
            if (els.ttsStatus) els.ttsStatus.textContent = error.message || "Piper speech failed";
            finish();
          });
      }));
    }

    function speakText(text, options = {}) {
      const clean = cleanText(text);
      if (!clean) return Promise.resolve();
      state.ttsLastText = clean;
      if (state.ttsProvider === "piper") {
        return speakPiperText(clean, options);
      }
      if (!supported()) {
        if (els.ttsStatus) els.ttsStatus.textContent = "Browser TTS unavailable";
        return Promise.resolve();
      }
      notifyPlaybackEnd();
      resolveActivePlayback();
      const playbackToken = ++state.ttsPlaybackToken;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(clean);
      const voice = selectedVoice();
      if (voice) utterance.voice = voice;
      utterance.rate = Math.max(0.75, Math.min(1.25, Number(state.ttsRate) || 1));
      utterance.pitch = 1;
      utterance.volume = 1;
      utterance.onstart = () => {
        notifyPlaybackStart();
        if (els.ttsStatus) els.ttsStatus.textContent = options.label || "Reading";
        if (els.ttsPauseBtn) els.ttsPauseBtn.textContent = "Pause";
      };
      return rememberPlayback(new Promise((resolve) => {
        const finish = () => {
          if (state.ttsPlaybackResolve === finish) state.ttsPlaybackResolve = null;
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
      }));
    }

    function stop() {
      state.ttsPlaybackToken += 1;
      resolveActivePlayback();
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
      if (state.ttsProvider === "piper" && state.ttsAudio) {
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
      if (state.ttsProvider !== "piper") return 0;
      return Math.max(0, Math.min(3000, Number(state.ttsTextDelayMs) || 0));
    }

    return {
      init,
      canSpeak,
      noRead,
      speakText,
      stop,
      togglePause,
      visualDelayMs,
      waitForPlayback
    };
  }

  return { create };
});
