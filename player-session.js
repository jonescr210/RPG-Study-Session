(function exposeStudyAdventurePlayerSession(root, factory) {
  const playerSession = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = playerSession;
  }
  if (root) {
    root.StudyAdventurePlayerSession = playerSession;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function buildStudyAdventurePlayerSession() {
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
    return fetch("/api/host-info", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null);
  }

  function publishSession(payload) {
    return fetch("/api/player-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).catch(() => null);
  }

  function fetchSession() {
    return fetch(`/api/player-session?ts=${Date.now()}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null);
  }

  function fetchAnswers(roomCode, promptId) {
    return fetch(`/api/player-answers?roomCode=${encodeURIComponent(roomCode)}&promptId=${encodeURIComponent(promptId || "")}&ts=${Date.now()}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null);
  }

  function joinPlayer(roomCode, name, options = {}) {
    return fetch("/api/player-join", {
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
    return fetch("/api/player-answer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then((response) => response.json()).catch(() => null);
  }

  function submitAction(payload) {
    return fetch("/api/player-action", {
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
    joinPlayer,
    submitAnswer,
    submitAction
  };
});
