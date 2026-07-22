/*
 * ACTION-ROOM DOMAIN MODULE
 * =========================
 * Defines non-quiz room archetypes and their fallback entities. These records
 * give AI-judged free-form actions a bounded world model—objects, hazards,
 * enemies, routes, and NPCs with explicit state—so results can be validated and
 * applied without allowing generated prose to become authoritative game state.
 */
(function exposeStudyAdventureActionRooms(root, factory) {
  const actionRooms = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = actionRooms;
  }
  if (root) {
    root.StudyAdventureActionRooms = actionRooms;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function buildStudyAdventureActionRooms() {
  const typePool = [
    { kind: "normal", label: "Exploration Room", scoring: "team", objective: "advance by scouting, searching, securing routes, and interpreting the environment" },
    { kind: "hazard", label: "Hazard Room", scoring: "individual", objective: "cross, contain, or shut down an environmental danger without letting it spread" },
    { kind: "repair", label: "Repair Room", scoring: "team", objective: "restore a damaged system through practical field work and technical improvisation" },
    { kind: "enemy", label: "Enemy Contact", scoring: "individual", objective: "fight, evade, distract, defend, or trap an active hostile presence" },
    { kind: "escape", label: "Escape Room", scoring: "team", objective: "escape before the room worsens across a limited number of turns" },
    { kind: "dialogue", label: "Dialogue Room", scoring: "best", objective: "question, calm, negotiate with, or read an NPC or intelligent presence" },
    { kind: "resource", label: "Resource Room", scoring: "team", objective: "search or salvage useful supplies without triggering a hidden cost" },
    { kind: "puzzle", label: "Puzzle Mechanism", scoring: "team", objective: "interpret and manipulate an environmental mechanism with logical actions" },
    { kind: "stealth", label: "Stealth Room", scoring: "worst", objective: "move quietly, hide, distract, or avoid detection" },
    { kind: "defense", label: "Defense Room", scoring: "team", objective: "hold a position, protect a system, or keep a route open under pressure" },
    { kind: "question", label: "Riddle Room", scoring: "best", objective: "answer, interpret, or investigate a strange prompt, clue, or field riddle" }
  ];

  function fallbackEntities(room, index, options = {}) {
    const threat = options.threat || "hostile presence";
    const base = [
      makeEntity("route_exit", "Route access point", "route", ["exit", "route", "secure"], { state: "blocked", progress: 0, threshold: 2 }),
      makeEntity("ambient_hazard", "unstable room hazard", "hazard", ["hazard", "dangerous", "contact-danger"], { state: "active", pressure: 2, mitigation: 0, threshold: 3 })
    ];
    const byKind = {
      normal: [
        makeEntity("debris_field", "debris-strewn search area", "object", ["searchable", "inspectable", "clue"], { usesRemaining: 2, state: "unsearched" }),
        makeEntity("route_markers", "faded route markers", "route", ["route", "mapped", "inspectable"], { progress: 0, threshold: 2, state: "unclear" })
      ],
      hazard: [
        makeEntity("live_conduits", "exposed live conduits", "hazard", ["hazard", "powered", "repairable", "contact-danger", "electrical-contact"], { pressure: 3, mitigation: 0, threshold: 3, state: "arcing" }),
        makeEntity("safe_crossing", "unsafe crossing lane", "route", ["route", "secured", "mapped"], { progress: 0, threshold: 2, state: "unsafe" })
      ],
      repair: [
        makeEntity("damaged_panel", "damaged control panel", "object", ["repairable", "powered", "inspectable"], { usesRemaining: 3, state: "unstable" }),
        makeEntity("parts_bin", "scattered maintenance parts", "object", ["searchable", "salvage", "supply"], { usesRemaining: 2, state: "partly stocked" })
      ],
      enemy: [
        makeEntity("primary_hostile", threat, "enemy", ["enemy", "attackable", "distractable", "mobile"], { role: "persistent_threat_avatar", hp: 8, maxHp: 8, armor: 1, pressure: 2, state: "advancing", vulnerabilities: ["light", "restraint", "isolation"] }),
        makeEntity("cover_line", "broken cover line", "object", ["cover", "secure", "protect"], { usesRemaining: 3, state: "fragile" })
      ],
      escape: [
        makeEntity("jammed_exit", "jammed emergency exit", "route", ["exit", "route", "repairable", "bypass"], { progress: 0, threshold: 3, state: "jammed" }),
        makeEntity("collapsing_ceiling", "collapsing overhead structure", "hazard", ["hazard", "secured", "unstable-structure", "motion-triggered"], { pressure: 3, mitigation: 0, threshold: 3, state: "shearing" })
      ],
      dialogue: [
        makeEntity("distressed_contact", "distressed contact", "npc", ["npc", "communicate", "medical"], { trust: 0, threshold: 2, state: "panicked" }),
        makeEntity("message_console", "message console", "object", ["inspectable", "communicate", "clue"], { usesRemaining: 2, state: "active" })
      ],
      resource: [
        makeEntity("medical_shelves", "medical supply shelves", "object", ["searchable", "medical", "supply"], { usesRemaining: 2, state: "partly stocked" }),
        makeEntity("sealed_cache", "sealed supply cache", "object", ["searchable", "salvage", "bypass", "supply"], { usesRemaining: 1, state: "closed" }),
        makeEntity("trip_panel", "hidden trip panel", "hazard", ["hazard", "inspectable", "motion-triggered", "pressure-danger"], { pressure: 2, mitigation: 0, threshold: 2, state: "armed" })
      ],
      puzzle: [
        makeEntity("logic_mechanism", "logic mechanism", "object", ["inspectable", "decoded", "repairable"], { usesRemaining: 3, state: "unsolved" }),
        makeEntity("clue_marks", "etched clue marks", "object", ["inspectable", "clue", "decoded"], { usesRemaining: 2, state: "unread" })
      ],
      stealth: [
        makeEntity("sensor_lane", "active sensor lane", "hazard", ["hazard", "stealth", "bypass", "motion-triggered", "signal-sensitive"], { pressure: 3, mitigation: 0, threshold: 2, state: "watching" }),
        makeEntity("shadow_route", "shadowed side route", "route", ["route", "stealth", "mapped"], { progress: 0, threshold: 2, state: "unconfirmed" })
      ],
      defense: [
        makeEntity("weak_barricade", "weak barricade", "object", ["cover", "secure", "repairable"], { usesRemaining: 3, state: "weak" }),
        makeEntity("enemy_pressure", "pressing hostile line", "enemy", ["enemy", "attackable", "distractable"], { role: "persistent_threat_minion", hp: 6, maxHp: 6, armor: 0, pressure: 3, state: "probing", vulnerabilities: ["cover", "distraction"] })
      ],
      question: [
        makeEntity("strange_prompt", "strange field prompt", "object", ["inspectable", "decoded", "clue"], { usesRemaining: 3, state: "uninterpreted" }),
        makeEntity("archive_lock", "archive lock", "route", ["route", "bypass", "decoded"], { progress: 0, threshold: 2, state: "locked" })
      ],
      extraction: [
        makeEntity("final_exit", "final extraction hatch", "route", ["exit", "route", "secure"], { progress: 0, threshold: 3, state: "sealed" }),
        makeEntity("last_pursuit", threat, "enemy", ["enemy", "attackable", "distractable"], { role: "final_boss", hp: 10, maxHp: 10, armor: 1, pressure: 3, state: "closing", vulnerabilities: ["teamwork", "restraint"] })
      ]
    };
    return (byKind[room?.kind] || byKind.normal).concat(base).map((entity, entityIndex) => ({
      ...entity,
      id: `${index}_${entity.id}_${entityIndex}`
    }));
  }

  function makeEntity(id, label, type, tags = [], extra = {}) {
    const role = normalizeEnemyRole(extra.role, type, tags);
    const cleanTags = [...new Set([...asArray(tags), role].filter((tag) => tag && tag !== "none"))];
    return {
      id,
      label,
      type,
      role,
      tags: cleanTags,
      state: extra.state || "available",
      usesRemaining: Number.isFinite(Number(extra.usesRemaining)) ? Number(extra.usesRemaining) : type === "object" ? 1 : null,
      hp: Number.isFinite(Number(extra.hp)) ? Number(extra.hp) : null,
      maxHp: Number.isFinite(Number(extra.maxHp)) ? Number(extra.maxHp) : null,
      armor: Number.isFinite(Number(extra.armor)) ? Number(extra.armor) : 0,
      pressure: Number.isFinite(Number(extra.pressure)) ? Number(extra.pressure) : type === "enemy" || type === "hazard" ? 2 : 0,
      mitigation: Number.isFinite(Number(extra.mitigation)) ? Number(extra.mitigation) : 0,
      progress: Number.isFinite(Number(extra.progress)) ? Number(extra.progress) : 0,
      threshold: Number.isFinite(Number(extra.threshold)) ? Number(extra.threshold) : 0,
      vulnerabilities: asArray(extra.vulnerabilities),
      exhausted: Boolean(extra.exhausted),
      neutralized: Boolean(extra.neutralized),
      earlyBossBoosted: Boolean(extra.earlyBossBoosted),
      engagedWith: extra.engagedWith || ""
    };
  }

  function normalizeEnemyRole(value, type = "", tags = []) {
    if (type !== "enemy") return "none";
    const text = normalize(`${value || ""} ${asArray(tags).join(" ")}`).replace(/\s+/g, "_");
    if (/\bfinal_boss\b/.test(text)) return "final_boss";
    if (/\bpersistent_threat_avatar\b/.test(text)) return "persistent_threat_avatar";
    if (/\bpersistent_threat_minion\b/.test(text)) return "persistent_threat_minion";
    if (/\broom_threat\b/.test(text)) return "room_threat";
    return "room_threat";
  }

  function destructiveActionViolation(entry, target, options = {}) {
    if (!target || !["object", "route", "npc"].includes(target.type)) return null;
    const text = normalize(`${entry?.action || ""} ${entry?.act || ""} ${entry?.targetText || ""}`);
    if (!/\b(attack|shoot|fire|smash|break|destroy|kick|hit|strike|punch|stab|slash|blast|grenade)\b/.test(text)) return null;
    const tags = new Set(asArray(target.tags).map((tag) => normalize(tag)));
    const label = normalize(target.label);
    const explicitlyViolentTarget = [
      "attackable",
      "destructible",
      "destroyable",
      "hostile",
      "enemy",
      "threat-controlled",
      "corrupted",
      "weak-point",
      "bypass-by-force",
      "damageable"
    ].some((tag) => tags.has(tag));
    const forceBypass = tags.has("bypass") && /\b(force|break|smash|breach)\b/.test(text);
    const obviouslyHostileLabel = /\b(hostile|enemy|creature|drone|turret|warden|attacker|threat)\b/.test(label);
    if (explicitlyViolentTarget || forceBypass || obviouslyHostileLabel || options.roomKind === "enemy" && tags.has("cover")) return null;
    return {
      tag: "destructive-mismatch",
      reason: `destructive force against ${target.type} that is not marked attackable or destructible`,
      pressureDelta: target.type === "npc" ? 2 : 1,
      scoreCap: 0,
      minScore: target.type === "npc" ? -3 : -2
    };
  }

  function asArray(value) {
    return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  }

  function normalize(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
  }

  return {
    typePool,
    fallbackEntities,
    makeEntity,
    normalizeEnemyRole,
    destructiveActionViolation
  };
});
