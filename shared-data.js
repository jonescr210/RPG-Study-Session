(function exposeStudyAdventureShared(root, factory) {
  const shared = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = shared;
  }
  if (root) {
    root.StudyAdventureShared = shared;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function buildStudyAdventureShared() {
  const simulatorNamePool = [
    "Bo",
    "Lux",
    "Iris",
    "Riven",
    "Marlow",
    "Cassian",
    "Valkyrie",
    "Northstar",
    "Nightshade",
    "BlackSignal",
    "RelayWalker",
    "StaticRanger",
    "VoltageMarshal",
    "CipherSentinel",
    "SignalPathfinder",
    "ContainmentLeader",
    "EmergencySwitchman",
    "OvercurrentSentinel",
    "ConstantineRookfords"
  ];

  const profanitySubstitutions = [
    [/\bf+[\W_]*u+[\W_]*c+[\W_]*k+(?:[\W_]*i+[\W_]*n+[\W_]*g+)?\b/gi, "frak"],
    [/\bs+[\W_]*h+[\W_]*i+[\W_]*t+\b/gi, "static"],
    [/\ba+[\W_]*s+[\W_]*s+[\W_]*h+[\W_]*o+[\W_]*l+[\W_]*e+\b/gi, "jerk"],
    [/\bb+[\W_]*i+[\W_]*t+[\W_]*c+[\W_]*h+\b/gi, "blast"],
    [/\bb+[\W_]*a+[\W_]*s+[\W_]*t+[\W_]*a+[\W_]*r+[\W_]*d+\b/gi, "brute"],
    [/\bc+[\W_]*u+[\W_]*n+[\W_]*t+\b/gi, "static"],
    [/\bd+[\W_]*i+[\W_]*c+[\W_]*k+\b/gi, "static"],
    [/\bc+[\W_]*o+[\W_]*c+[\W_]*k+\b/gi, "static"],
    [/\bp+[\W_]*u+[\W_]*s+[\W_]*s+[\W_]*y+\b/gi, "static"],
    [/\bd+[\W_]*a+[\W_]*m+[\W_]*n+\b/gi, "dang"],
    [/\bc+[\W_]*r+[\W_]*a+[\W_]*p+\b/gi, "scrap"]
  ];

  const playerActionCategories = ["brilliant", "helpful", "risky", "flavor", "weak", "reckless", "harmful"];

  const playerActionVerbs = {
    brilliant: ["coordinates a careful sweep of", "sets a smart trap around", "uses cover to approach", "finds a clean weakness in", "builds a safe lane through", "stabilizes the team around", "turns the room layout against", "times a precise move on", "maps a route around", "anchors a controlled approach to"],
    helpful: ["searches", "inspects", "secures", "repairs", "maps", "grounds", "reinforces", "covers", "checks", "stabilizes"],
    risky: ["pushes closer to", "tries a fast bypass on", "takes a guarded chance with", "moves under pressure toward", "tests the edge of", "leans into", "rushes a repair on", "draws attention away from", "forces a narrow opening through", "uses a risky angle on"],
    flavor: ["calls out a steadying joke near", "marks a harmless symbol beside", "taps a rhythm on", "gives a dramatic nod toward", "straightens gear while watching", "whispers a warning at", "makes a quick morale check beside", "names the worst-looking part of", "pauses to listen near", "signals confidence toward"],
    weak: ["looks vaguely around", "waves at", "pokes around near", "waits beside", "checks something by", "points at", "asks if anyone understands", "hovers near", "half-searches", "tries something unclear with"],
    reckless: ["rips open", "charges straight into", "kicks", "grabs with bare hands", "yanks hard on", "shouts at", "fires blindly toward", "smashes", "runs alone past", "forces open"],
    harmful: ["breaks the team's cover beside", "throws loose debris at", "sabotages the safe path through", "pulls apart the team's brace on", "blocks retreat from", "opens a danger behind the team at", "knocks gear away from", "cuts off the fallback near", "shoves through teammates toward", "ignores a downed operator beside"]
  };

  const playerActionTargets = [
    "medical shelves", "sealed cache", "field bag", "supply crate", "trip panel", "locker row", "trauma case", "tool cabinet", "salvage pile", "storage rack",
    "damaged relay", "control panel", "junction box", "live conduit", "steam leak", "safe crossing", "hostile contact", "cover line", "jammed exit", "route marker",
    "distressed contact", "message console", "logic mechanism", "etched clue marks", "sensor lane", "shadow route", "weak barricade", "beacon frame", "final exit", "signal beacon"
  ];

  const playerActionMethods = [
    "while keeping one hand free", "after checking the floor", "with a light sweep first", "while calling the move out loud",
    "using a slow count", "from behind cover", "with another operator in sight", "without touching exposed metal",
    "while marking the route", "using only the safest reachable edge"
  ];

  const generalActionBank = {
    positive: {
      verbs: ["Search for", "Look for", "Inspect", "Secure", "Repair", "Stabilize", "Map", "Guard", "Signal for", "Help with"],
      targets: ["weapons", "supplies", "medical supplies", "an exit", "safe cover", "a weak point", "a route forward", "a control point", "useful tools", "a clue"]
    },
    negative: {
      verbs: ["Run blindly toward", "Kick", "Shoot randomly at", "Grab", "Pull hard on", "Ignore", "Shove past", "Break", "Open without checking", "Charge into"],
      targets: ["the danger", "unknown equipment", "a sealed door", "loose wiring", "the hazard", "a warning sign", "unstable machinery", "the enemy", "a blocked path", "the darkest corner"]
    },
    silly: {
      verbs: ["Do a backflip near", "Pose dramatically at", "Yell compliments at", "Dance beside", "Challenge", "Make finger guns at", "Tell a joke to", "Salute", "Pretend to interview", "Try to impress"],
      targets: ["the enemy", "the door", "the warning lights", "the control panel", "the darkness", "the floor", "the supplies", "the exit", "the room", "the static"]
    }
  };

  function cleanSharedText(value, options = {}) {
    const fallback = options.fallback || "";
    const maxLength = options.maxLength || 240;
    let text = String(value || "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    for (const [pattern, replacement] of profanitySubstitutions) {
      text = text.replace(pattern, replacement);
    }

    if (Number.isFinite(maxLength) && maxLength > 0 && text.length > maxLength) {
      text = text.slice(0, maxLength).trim();
      const lastSpace = text.lastIndexOf(" ");
      if (lastSpace >= Math.floor(maxLength * 0.6)) {
        text = text.slice(0, lastSpace).trim();
      }
    }

    return text || fallback;
  }

  function generatedPlayerActionPool(category, context = {}) {
    const cleanCategory = playerActionCategories.includes(category) ? category : "helpful";
    const name = cleanSharedText(context.name || "Operator", { maxLength: 32, fallback: "Operator" });
    const area = cleanSharedText(context.areaName || context.challengeLabel || "the room", { maxLength: 60, fallback: "the room" });
    const verbs = playerActionVerbs[cleanCategory] || playerActionVerbs.helpful;
    const actions = [];
    for (let index = 0; actions.length < 100; index++) {
      const verb = verbs[index % verbs.length];
      const target = playerActionTargets[Math.floor(index / verbs.length) % playerActionTargets.length];
      const method = playerActionMethods[(index * 5 + cleanCategory.length) % playerActionMethods.length];
      actions.push(`${name} ${verb} the ${target} in ${area} ${method}`);
    }
    return actions;
  }

  function randomPlayerGeneratedAction(category, context = {}) {
    const pool = generatedPlayerActionPool(category, context);
    const rng = typeof context.rng === "function" ? context.rng : Math.random;
    return pool[Math.floor(rng() * pool.length)] || `${context.name || "Operator"} searches the room carefully`;
  }

  function generatedGeneralActionPool(category) {
    const cleanCategory = generalActionBank[category] ? category : "positive";
    const { verbs, targets } = generalActionBank[cleanCategory] || { verbs: ["Search"], targets: ["the room"] };
    const actions = [];
    for (let index = 0; actions.length < 100; index++) {
      const verb = verbs[index % verbs.length];
      const target = targets[Math.floor(index / verbs.length) % targets.length];
      actions.push(`${verb} ${target}`);
    }
    return actions;
  }

  function randomGeneralAction(category, context = {}) {
    const pool = generatedGeneralActionPool(category);
    const rng = typeof context.rng === "function" ? context.rng : Math.random;
    return pool[Math.floor(rng() * pool.length)] || `${context.name || "Sim"} searches the room carefully`;
  }

  return {
    simulatorNamePool,
    profanitySubstitutions,
    playerActionCategories,
    playerActionVerbs,
    playerActionTargets,
    playerActionMethods,
    generalActionBank,
    generatedPlayerActionPool,
    randomPlayerGeneratedAction,
    generatedGeneralActionPool,
    randomGeneralAction
  };
});
