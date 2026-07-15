(function exposeStudyAdventurePlayerSession(root, factory) {
  const playerSession = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = playerSession;
  }
  if (root) {
    root.StudyAdventurePlayerSession = playerSession;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function buildStudyAdventurePlayerSession() {
  const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;

  function fetchWithTimeout(resource, options = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS));
    return fetch(resource, { ...options, signal: controller.signal })
      .finally(() => clearTimeout(timer));
  }

  function safeJoinProtocol(location = window.location) {
    return location.protocol === "https:" ? "https:" : "http:";
  }

  function safeJoinPort(location = window.location, fallback = 4174) {
    return location.port || fallback;
  }

  function isPublicJoinOrigin(location = window.location) {
    if (!/^https?:$/i.test(location.protocol)) return false;
    const host = String(location.hostname || "").toLowerCase();
    return Boolean(host)
      && host !== "localhost"
      && host !== "127.0.0.1"
      && host !== "::1"
      && !/^10\./.test(host)
      && !/^192\.168\./.test(host)
      && !/^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
  }

  function defaultPlayerJoinUrl(location = window.location) {
    if (isPublicJoinOrigin(location)) return `${location.origin}/player.html`;
    const protocol = safeJoinProtocol(location);
    const host = location.hostname && location.hostname !== "localhost"
      ? location.hostname
      : "localhost";
    return `${protocol}//${host}:${safeJoinPort(location)}/player.html`;
  }

  function preferredJoinAddress(addresses) {
    const clean = [...new Set((addresses || []).map((address) => String(address || "").trim()).filter(Boolean))];
    if (!clean.length) return "";
    return clean.find((address) => address.startsWith("192.168.137."))
      || clean.find((address) => /^192\.168\./.test(address))
      || clean.find((address) => /^10\./.test(address))
      || clean.find((address) => /^172\.(1[6-9]|2\d|3[0-1])\./.test(address))
      || clean[0];
  }

  function playerJoinUrlForRoom(baseJoinUrl, roomCode, options = {}, location = window.location) {
    const roomQuery = `room=${encodeURIComponent(roomCode || "")}`;
    if (options.compact) {
      try {
        const url = new URL(baseJoinUrl, location.href);
        return `${url.origin}/j?${roomQuery}`;
      } catch {}
    }
    return `${baseJoinUrl}?${roomQuery}`;
  }

  function fetchHostInfo() {
    return fetchWithTimeout("/api/host-info", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null);
  }

  function publishSession(payload) {
    return fetchWithTimeout("/api/player-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then((response) => response.json().catch(() => null)).catch(() => null);
  }

  function fetchSession() {
    return fetchWithTimeout(`/api/player-session?ts=${Date.now()}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null);
  }

  function fetchAnswers(roomCode, promptId) {
    return fetchWithTimeout(`/api/player-answers?roomCode=${encodeURIComponent(roomCode)}&promptId=${encodeURIComponent(promptId || "")}&ts=${Date.now()}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null);
  }

  function fetchSync(roomCode, promptId) {
    return fetchWithTimeout(`/api/player-sync?roomCode=${encodeURIComponent(roomCode || "")}&promptId=${encodeURIComponent(promptId || "")}&ts=${Date.now()}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null);
  }

  function joinPlayer(roomCode, name, options = {}) {
    return fetchWithTimeout("/api/player-join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        roomCode,
        name,
        simulated: Boolean(options.simulated)
      })
    }).then((response) => response.json()).catch(() => null);
  }

  function submitAnswer(payload) {
    return fetchWithTimeout("/api/player-answer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then((response) => response.json()).catch(() => null);
  }

  function submitAction(payload) {
    return fetchWithTimeout("/api/player-action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then((response) => response.json()).catch(() => null);
  }

  return {
    safeJoinProtocol,
    safeJoinPort,
    isPublicJoinOrigin,
    defaultPlayerJoinUrl,
    preferredJoinAddress,
    playerJoinUrlForRoom,
    fetchHostInfo,
    publishSession,
    fetchSession,
    fetchAnswers,
    fetchSync,
    joinPlayer,
    submitAnswer,
    submitAction
  };
});
