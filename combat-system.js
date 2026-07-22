/*
 * SHARED COMBAT DOMAIN MODULE
 * ===========================
 * Framework-free rules used by both teacher and player clients. This module
 * contains stable data and pure calculations: class definitions, XP/HP levels,
 * the one-slot item framework, enemy tiers, damage rolls, and group HP changes.
 * Browser code reads it from window.StudyAdventureCombat; Node can require it
 * for tooling/tests because the wrapper also exports CommonJS.
 *
 * app.js owns encounter sequencing and boss mechanics. Keeping foundational
 * math here prevents the dashboard and phone UI from inventing different rules.
 */
(function exposeStudyAdventureCombat(root, factory) {
  const combat = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = combat;
  if (root) root.StudyAdventureCombat = combat;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildStudyAdventureCombat() {
  // Balance tables are intentionally data-driven so class/item/UI text can all
  // read the same definitions instead of scattering values across render code.
  const MAX_LEVEL = 6;
  const ITEM_CAPACITY = 1;
  const CLASS_IDS = ["soldier", "medic", "scout", "enforcer", "engineer", "tactician"];
  const LEVELS = [
    { level: 1, xp: 0, maxHp: 10 },
    { level: 2, xp: 20, maxHp: 12 },
    { level: 3, xp: 45, maxHp: 14 },
    { level: 4, xp: 75, maxHp: 16 },
    { level: 5, xp: 110, maxHp: 18 },
    { level: 6, xp: 150, maxHp: 20 }
  ];

  const classes = {
    soldier: {
      id: "soldier", label: "Soldier", gear: "Overdrive Rifle", color: "#ff4d4d",
      summary: "+2 combat damage, plus up to +3 from a correct-answer streak. At level 6, Determined Aim guarantees an attack regardless of answer outcome."
    },
    medic: {
      id: "medic", label: "Medic", gear: "Surgical Carbine", color: "#63e38b",
      summary: "Heal 3–6 HP from streak strength; recharges after 2 questions. At level 6, Rebirth revives an operator at 75% HP with a full brace for the enemy phase in exchange for the Medic's attack."
    },
    scout: {
      id: "scout", label: "Scout", gear: "Spectrum Longrifle", color: "#f5d76e",
      summary: "Reveal a question hint every 5 questions; gains a speed bonus when unused. At level 6, Intel Sniper reveals the correct answer to all operators."
    },
    enforcer: {
      id: "enforcer", label: "Enforcer", gear: "Ballistic Bulwark", color: "#62b8ff",
      summary: "R&R reduces incoming damage and stores prevented damage; arm the shield to block one enemy phase and convert the reserve into healing. At level 6, Stand Tough draws single-target attacks, holds at 1 HP, and recovers 80% of damage taken."
    },
    engineer: {
      id: "engineer", label: "Engineer", gear: "Arc Driver", color: "#66e8e1",
      summary: "Improves obstacle work and can disrupt an enemy activation every 3 questions. At level 6, Kick Start Your Heart passively revives an incapacitated operator at 25% HP with a bubble."
    },
    tactician: {
      id: "tactician", label: "Tactician", gear: "Adaptive Repeater", color: "#c794ff",
      summary: "Choose Assault for coordinated damage, Guard for a team barrier, or Support to stabilize an injured operator. At level 6, Inspire the Masses grants damage, healing, and Guard together."
    }
  };

  const itemRarities = {
    common: { id: "common", label: "Common", color: "#d7e0e5", weight: 58 },
    uncommon: { id: "uncommon", label: "Uncommon", color: "#63e38b", weight: 27 },
    rare: { id: "rare", label: "Rare", color: "#62b8ff", weight: 11 },
    epic: { id: "epic", label: "Epic", color: "#c794ff", weight: 3 },
    legendary: { id: "legendary", label: "Legendary", color: "#ffcf63", weight: 1 }
  };

  // The former catalog has been retired. Keep an empty registry and the helper
  // API so a replacement item set can be introduced without another save/UI
  // migration. Unknown legacy IDs are discarded during player normalization.
  const items = Object.freeze([]);

  const enemyTiers = {
    light: { id: "light", label: "Light", hp: [8, 12], damage: [1, 5] },
    medium: { id: "medium", label: "Medium", hp: [14, 20], damage: [3, 7] },
    heavy: { id: "heavy", label: "Heavy", hp: [24, 34], damage: [5, 10] }
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value) || 0));
  }

  function classDefinition(classId) {
    return classes[String(classId || "").toLowerCase()] || null;
  }

  function levelForXp(xp) {
    const total = Math.max(0, Math.round(Number(xp) || 0));
    return [...LEVELS].reverse().find((entry) => total >= entry.xp) || LEVELS[0];
  }

  function normalizePlayer(player = {}, fallbackClassId = "soldier") {
    const classId = classDefinition(player.classId)?.id || classDefinition(fallbackClassId)?.id || "soldier";
    const levelInfo = levelForXp(player.xp);
    const maxHp = levelInfo.maxHp;
    const totalAnswers = Math.max(0, Math.round(Number(player.totalAnswers) || 0));
    const correctAnswers = clamp(Math.round(Number(player.correctAnswers) || 0), 0, totalAnswers);
    return {
      ...player,
      classId,
      classGear: classDefinition(classId).gear,
      classColor: classDefinition(classId).color,
      level: levelInfo.level,
      xp: Math.max(0, Math.round(Number(player.xp) || 0)),
      maxHp,
      hp: clamp(player.hp == null ? maxHp : player.hp, 0, maxHp),
      answerStreak: clamp(player.answerStreak, 0, 999),
      totalAnswers,
      correctAnswers,
      enforcerReserve: classId === "enforcer" ? clamp(player.enforcerReserve, 0, Math.floor(maxHp * 0.5)) : 0,
      equippedItem: null,
      items: Array.isArray(player.items)
        ? player.items.filter((itemId) => itemDefinition(itemId)).slice(0, ITEM_CAPACITY)
        : [],
      classCooldowns: { ...(player.classCooldowns || {}) },
      // Reserved for the replacement condition system. Legacy player
      // statuses are deliberately discarded whenever roster data is loaded.
      status: []
    };
  }

  function addXp(player, amount) {
    const before = levelForXp(player.xp);
    player.xp = Math.max(0, Math.round(Number(player.xp) || 0) + Math.max(0, Math.round(Number(amount) || 0)));
    const after = levelForXp(player.xp);
    player.level = after.level;
    player.maxHp = after.maxHp;
    const levelsGained = Math.max(0, after.level - before.level);
    if (levelsGained) player.hp = Math.min(player.maxHp, Math.max(0, Number(player.hp) || 0) + levelsGained * 2);
    return { amount: Math.max(0, Math.round(Number(amount) || 0)), leveledUp: after.level > before.level, before, after };
  }

  function itemDefinition(itemId) {
    return items.find((item) => item.id === itemId) || null;
  }

  function itemRarity(id) {
    return itemRarities[id] || itemRarities.common;
  }

  function rollItemChoices({ rng = Math.random, count = 3, rarity = "", excludeIds = [] } = {}) {
    const excluded = new Set(excludeIds);
    const pool = items.filter((item) => !excluded.has(item.id) && (!rarity || item.rarity === rarity));
    const source = pool.length ? pool : items.filter((item) => !excluded.has(item.id));
    const choices = [];
    while (choices.length < Math.max(1, count) && source.length) {
      const index = Math.floor(clamp(rng(), 0, 0.999999) * source.length);
      choices.push(source.splice(index, 1)[0]);
    }
    return choices;
  }

  function recordAnswer(player, correct) {
    player.totalAnswers = Math.max(0, Math.round(Number(player.totalAnswers) || 0)) + 1;
    player.correctAnswers = Math.max(0, Math.round(Number(player.correctAnswers) || 0)) + (correct ? 1 : 0);
    player.answerStreak = correct ? Math.max(0, Number(player.answerStreak) || 0) + 1 : 0;
    return player.answerStreak;
  }

  function answerDamage(elapsedMs, durationMs, difficulty = "medium") {
    const ratio = clamp((Number(elapsedMs) || 0) / Math.max(1000, Number(durationMs) || 60000), 0, 1);
    const base = ratio <= 0.25 ? 4 : ratio <= 0.5 ? 3 : ratio <= 0.75 ? 2 : 1;
    const difficultyBonus = String(difficulty).toLowerCase() === "hard" ? 2 : String(difficulty).toLowerCase() === "medium" ? 1 : 0;
    return base + difficultyBonus;
  }

  function classCombatDamage(player) {
    if (player?.classId !== "soldier") return 0;
    return 2 + Math.min(3, Math.max(0, Number(player.answerStreak) || 0));
  }

  function xpForCorrectAnswer({ fast = false, difficulty = "medium", streak = 0 } = {}) {
    return 5 + (fast ? 2 : 0) + (difficulty === "hard" ? 2 : difficulty === "medium" ? 1 : 0) + (streak > 1 ? 1 : 0);
  }

  function rollRange(range, rng = Math.random) {
    const low = Math.floor(Number(range?.[0]) || 0);
    const high = Math.max(low, Math.floor(Number(range?.[1]) || low));
    return low + Math.floor(clamp(rng(), 0, 0.999999) * (high - low + 1));
  }

  function createEnemyGroup(tiers = ["light"], rng = Math.random) {
    const enemies = tiers.map((tierId, index) => {
      const tier = enemyTiers[tierId] || enemyTiers.light;
      const hp = rollRange(tier.hp, rng);
      return { id: `enemy-${index + 1}`, tier: tier.id, label: `${tier.label} Hostile ${index + 1}`, hp, maxHp: hp, defeated: false };
    });
    return { enemies, hp: enemies.reduce((sum, enemy) => sum + enemy.hp, 0), maxHp: enemies.reduce((sum, enemy) => sum + enemy.maxHp, 0) };
  }

  function applyGroupDamage(group, amount) {
    let remaining = Math.max(0, Math.round(Number(amount) || 0));
    const defeated = [];
    for (const enemy of group.enemies) {
      if (enemy.defeated || remaining <= 0) continue;
      const dealt = Math.min(enemy.hp, remaining);
      enemy.hp -= dealt;
      remaining -= dealt;
      if (enemy.hp <= 0) {
        enemy.hp = 0;
        enemy.defeated = true;
        defeated.push(enemy);
      }
    }
    group.hp = group.enemies.reduce((sum, enemy) => sum + enemy.hp, 0);
    return { damage: Math.max(0, Math.round(Number(amount) || 0)) - remaining, defeated, cleared: group.hp <= 0 };
  }

  return {
    MAX_LEVEL, ITEM_CAPACITY, CLASS_IDS, LEVELS, classes, enemyTiers, itemRarities, items,
    classDefinition, levelForXp, normalizePlayer, addXp, recordAnswer,
    answerDamage, classCombatDamage, xpForCorrectAnswer, rollRange, itemDefinition, itemRarity, rollItemChoices,
    createEnemyGroup, applyGroupDamage
  };
});
