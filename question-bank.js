(function exposeStudyAdventureQuestions(root, factory) {
  const questions = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = questions;
  }
  if (root) {
    root.StudyAdventureQuestions = questions;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function buildStudyAdventureQuestions() {
  const sampleQuestions = `1. What device converts DC power into AC power?
A. Rectifier
B. Inverter
C. Transformer
D. Breaker
Answer: B

2. Which component stores electrical charge?
A) Capacitor
B) Fuse
C) Relay
D) Switch
Answer: A

3. In a diode, which electrode is usually the positive side?
A. Cathode
B. Anode
C. Gate
D. Drain
Answer: B

4. What type of battery can be recharged?
A. Primary cell
B. Secondary cell
C. Dry contact
D. Isolation cell
Answer: B

5. What backup system switches load between utility and generator power?
A. Automatic Transfer Switch
B. Ground Fault Relay
C. Patch Panel
D. Surge Arrestor
Answer: A

6. Radar detects target speed using what concept?
A. Magnetic flux
B. Relative motion
C. Harmonic balance
D. Static pressure
Answer: B

7. What is the primary purpose of a heat sink in a transistor circuit?
A. To increase voltage gain
B. To provide a path for DC current
C. To dissipate heat and lower operating temperature
D. To act as a voltage regulator
Correct Answer: C

8. If voltage stays the same and resistance increases, what happens to current?
A. Current increases
B. Current decreases
C. Current stays the same
D. Current becomes AC
Correct Answer: B

9. What does a fuse do when excess current flows?
A. Opens the circuit
B. Stores electrical charge
C. Raises the signal frequency
D. Converts AC power to DC power
Correct Answer: A

10. Which component allows current to flow in only one direction?
A. Diode
B. Capacitor
C. Inductor
D. Transformer
Correct Answer: A`;

  const localQuestionBank = [
    q("Which component stores electrical charge?", "Resistor", "Capacitor", "Fuse", "Relay", "B", "Capacitor Bank"),
    q("What device converts DC power into AC power?", "Rectifier", "Inverter", "Transformer", "Breaker", "B", "Generator Inverter Bay"),
    q("In a diode, which electrode is usually the positive side?", "Cathode", "Anode", "Gate", "Drain", "B", "Polarity Switchgear"),
    q("What type of battery can be recharged?", "Primary cell", "Secondary cell", "Dry contact", "Isolation cell", "B", "Battery Backup Corridor"),
    q("Which backup system switches load between utility and generator power?", "Automatic Transfer Switch", "Ground Fault Relay", "Patch Panel", "Surge Arrestor", "A", "Transfer Switch Cabinet"),
    q("Radar detects target speed using what concept?", "Magnetic flux", "Relative motion", "Harmonic balance", "Static pressure", "B", "Radar-Link Chamber"),
    q("What is the primary purpose of a heat sink in a transistor circuit?", "To increase voltage gain", "To provide a path for DC current", "To dissipate heat and lower operating temperature", "To act as a voltage regulator", "C", "Thermal Test Bay"),
    q("If voltage stays the same and resistance increases, what happens to current?", "Current increases", "Current decreases", "Current stays the same", "Current becomes AC", "B", "Load-Bank Gallery"),
    q("What does a fuse do when excess current flows?", "Opens the circuit", "Stores electrical charge", "Raises the signal frequency", "Converts AC power to DC power", "A", "Overcurrent Protection Alcove"),
    q("Which component allows current to flow in only one direction?", "Diode", "Capacitor", "Inductor", "Transformer", "A", "Rectifier Gate"),
    q("What is the purpose of grounding in an electrical system?", "To provide a safe path for fault current", "To increase circuit resistance", "To store backup energy", "To convert DC to AC", "A", "Grounding Trench"),
    q("What device changes AC voltage from one level to another?", "Transformer", "Fuse", "Battery", "Resistor", "A", "Transformer Gallery"),
    q("What device converts AC power into DC power?", "Inverter", "Rectifier", "Transformer", "Capacitor", "B", "Rectifier Bay"),
    q("Which material is used to resist the flow of electrical current?", "Conductor", "Insulator", "Semiconductor", "Solenoid", "B", "Insulator Passage"),
    q("What is the unit of electrical resistance?", "Volt", "Ampere", "Ohm", "Watt", "C", "Metering Alcoves"),
    q("What is unwanted AC variation remaining on a DC power supply output called?", "Ripple", "Gain", "Saturation", "Impedance", "A", "Resonance Core Antechamber"),
    q("What is the unit of electrical power?", "Volt", "Watt", "Ohm", "Ampere", "B", "Power Meter Vault"),
    q("Which device protects a circuit from overvoltage spikes?", "Surge protector", "Capacitor", "Relay", "Oscillator", "A", "Surge Arrestor Hall"),
    q("What network device forwards traffic based on MAC addresses?", "Router", "Switch", "Modem", "Repeater", "B", "Network Switch Room"),
    q("What network device forwards packets between different networks?", "Router", "Hub", "Patch panel", "Antenna", "A", "Routing Core"),
    q("What does RF stand for?", "Radio Frequency", "Rectified Field", "Relay Function", "Resonant Flux", "A", "RF Shielding Tunnel"),
    q("Which antenna property describes directional concentration of radiated energy?", "Gain", "Ripple", "Resistance", "Latency", "A", "Antenna Alignment Deck"),
    q("What does an oscilloscope primarily display?", "Waveforms", "Resistance only", "Battery age", "Cable length only", "A", "Oscilloscope Lab"),
    q("What component stores energy in a magnetic field?", "Capacitor", "Inductor", "Diode", "Fuse", "B", "Inductor Coil Room"),
    q("What is the common unit of frequency?", "Hertz", "Ohm", "Watt", "Farad", "A", "Frequency Counter Station"),
    q("What is the positive terminal of a diode called?", "Anode", "Cathode", "Source", "Drain", "A", "Diode Polarity Gate"),
    q("Which device opens or closes a circuit using an electromagnet?", "Relay", "Capacitor", "Transformer", "Heat sink", "A", "Relay Rack"),
    q("What does a UPS provide when utility power fails?", "Backup power", "Lower resistance", "RF gain", "Ground isolation only", "A", "UPS Battery Room"),
    q("What instrument measures electrical current?", "Ammeter", "Voltmeter", "Ohmmeter", "Spectrum analyzer", "A", "Current Measurement Bay"),
    q("Which connector is commonly used for Ethernet networking?", "RJ45", "BNC", "SMA", "N-type", "A", "Ethernet Patch Vault")
  ];

  function q(question, a, b, c, d, answerKey, area) {
    const choices = [
      { key: "A", text: a },
      { key: "B", text: b },
      { key: "C", text: c },
      { key: "D", text: d }
    ];
    return {
      question,
      choices,
      answerKey,
      answerText: choices.find((choice) => choice.key === answerKey)?.text || "",
      area,
      mode: "multiple"
    };
  }

  function parseQuestions(text) {
    return parseQuestionReport(text).questions;
  }

  function parseQuestionReport(text) {
    const blocks = splitQuestionBlocks(text);
    const questions = [];
    const rejected = [];
    for (const block of blocks) {
      const question = parseQuestionBlock(block);
      if (question) questions.push(question);
      else if (block.trim()) rejected.push(block);
    }
    return { questions, rejected };
  }

  function splitQuestionBlocks(text) {
    const clean = String(text || "")
      .replace(/\r/g, "")
      .trim();
    if (!clean) return [];

    const lines = clean
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const answerLineCount = lines.filter((line) => /\b(?:correct\s+answer|correct|answer|ans)\s*[:\-]/i.test(line)).length;
    if (answerLineCount > 0) {
      const blocks = [];
      let current = [];
      for (const line of lines) {
        current.push(line);
        if (/\b(?:correct\s+answer|correct|answer|ans)\s*[:\-]/i.test(line)) {
          blocks.push(current.join("\n").trim());
          current = [];
        }
      }
      if (current.length) blocks.push(current.join("\n").trim());
      return blocks.filter(Boolean);
    }

    if (lines.length > 1 && lines.every((line) => /\b(?:correct\s+answer|correct|answer|ans)\s*[:\-]/i.test(line))) {
      return lines;
    }

    const starts = [...clean.matchAll(/^\s*(?:[-*]\s*)?(?:\*{1,2}|_{1,2})?\d+[\).]\s+/gm)];
    if (starts.length > 1) {
      return starts
        .map((match, index) => clean.slice(match.index, starts[index + 1]?.index ?? clean.length))
        .map((block) => block.trim())
        .filter(Boolean);
    }

    return clean
      .split(/\n\s*\n|\n(?=(?:[-*]\s*)?(?:\*{1,2}|_{1,2})?\d+[\).]\s+)|\n(?=[^\n]+\?\s+(?:[-*]\s*)?(?:\*{1,2}|_{1,2})?[A-H][\).\:\-]\s+)/g)
      .map((block) => block.trim())
      .filter(Boolean);
  }

  function parseQuestionBlock(block) {
    const compact = cleanQuestionMarkup(block).replace(/\s+/g, " ").trim();
    const answerMatch = compact.match(/\b(?:correct\s+answer|correct|answer|ans)\s*[:\-]\s*([A-H])(?:[\).:\-]|\b)/i)
      || compact.match(/\b(?:correct\s+answer|correct|answer|ans)\s*[:\-]\s*(.+?)\s*$/i);
    if (!answerMatch) return null;

    const answerRaw = cleanQuestionMarkup(answerMatch[1]).trim().replace(/[.;,]\s*$/, "");
    const body = compact.slice(0, answerMatch.index).trim();
    const choicePattern = /\b([A-H])[\).\:\-]\s+/gi;
    const labels = [...body.matchAll(choicePattern)];
    if (labels.length < 2) return parseTrueFalseQuestion(body, answerRaw) || parseFillQuestion(body, answerRaw);

    const question = stripQuestionStem(body.slice(0, labels[0].index));
    const choices = labels.map((label, index) => {
      const start = label.index + label[0].length;
      const end = index + 1 < labels.length ? labels[index + 1].index : body.length;
      return {
        key: label[1].toUpperCase(),
        text: body.slice(start, end).trim()
      };
    }).filter((choice) => choice.text);

    if (!question || choices.length < 2) return null;

    const answerKey = answerRaw.match(/^[A-H]$/i) ? answerRaw.toUpperCase() : null;
    const answerChoice = answerKey
      ? choices.find((choice) => choice.key === answerKey)
      : choices.find((choice) => normalize(choice.text) === normalize(answerRaw));

    if (!answerChoice) return null;

    const trueFalseType = isTrueFalseChoiceSet(choices);
    return {
      question,
      choices,
      answerKey: answerChoice.key,
      answerText: answerChoice.text,
      area: inferQuestionArea(question),
      type: trueFalseType ? "true-false" : undefined
    };
  }

  function parseTrueFalseQuestion(body, answerRaw) {
    const question = stripQuestionStem(body)
      .replace(/\b(?:true|false)\s*[\/\\]\s*(?:true|false)\b/ig, "")
      .replace(/\btrue\s+or\s+false\b/ig, "")
      .trim();
    const normalized = normalize(answerRaw);
    const answerKey = normalized === "true" || normalized === "t"
      ? "A"
      : normalized === "false" || normalized === "f"
      ? "B"
      : null;
    if (!question || !answerKey) return null;
    return {
      question,
      choices: [
        { key: "A", text: "True" },
        { key: "B", text: "False" }
      ],
      answerKey,
      answerText: answerKey === "A" ? "True" : "False",
      area: inferQuestionArea(question),
      type: "true-false"
    };
  }

  function parseFillQuestion(body, answerRaw) {
    const normalized = normalize(answerRaw);
    if (!answerRaw || normalized === "true" || normalized === "false") return null;
    const question = stripQuestionStem(body)
      .replace(/\bfill\s*[- ]?in\s*[- ]?the\s*[- ]?blank\s*[:\-]?/ig, "")
      .replace(/\bfill\s+the\s+blank\s*[:\-]?/ig, "")
      .trim();
    const answerText = cleanQuestionMarkup(answerRaw).replace(/[.;,]\s*$/, "").trim();
    if (!question || !answerText || answerText.length > 80) return null;
    return {
      question,
      choices: [],
      answerKey: "",
      answerText,
      area: inferQuestionArea(question),
      type: "fill",
      mode: "fill"
    };
  }

  function stripQuestionStem(value) {
    return cleanQuestionMarkup(value)
      .replace(/^(?:type|format|question\s+type)\s*:\s*(?:multiple\s+choice|fill\s*[- ]?in\s*[- ]?the\s*[- ]?blank|fill\s+the\s+blank|true\s*(?:\/|or)?\s*false|true\s+false)\s*/i, "")
      .replace(/^(?:multiple\s+choice|fill\s*[- ]?in\s*[- ]?the\s*[- ]?blank|fill\s+the\s+blank|true\s*(?:\/|or)?\s*false|true\s+false)\s*[:\-]\s*/i, "")
      .replace(/^(?:[-*]\s*)?\d+[\).\s]+/, "")
      .replace(/^question\s*[:\-]\s*/i, "")
      .trim();
  }

  function isTrueFalseChoiceSet(choices) {
    if (!Array.isArray(choices) || choices.length !== 2) return false;
    const values = choices.map((choice) => normalize(choice.text)).sort();
    return values[0] === "false" && values[1] === "true";
  }

  function cleanQuestionMarkup(value) {
    return String(value || "")
      .replace(/[*_`]/g, "")
      .replace(/^\s*[-+]\s+/gm, "")
      .replace(/\[(?:\d+|source[^\]]*)\]/gi, "")
      .trim();
  }

  function inferQuestionArea(question) {
    const text = String(question || "").toLowerCase();
    if (/radar|antenna|rf|frequency/.test(text)) return "Sensor Alignment Deck";
    if (/network|router|switch|ethernet|packet|traffic/.test(text)) return "Network Routing Core";
    if (/battery|ups|backup|transfer switch/.test(text)) return "Emergency Power Annex";
    if (/diode|rectifier|anode|cathode/.test(text)) return "Polarity Control Bay";
    if (/ground|fuse|surge|current|voltage|resistance|power/.test(text)) return "Switchgear Access Hall";
    if (/capacitor|inductor|oscilloscope|waveform/.test(text)) return "Electronics Diagnostic Lab";
    return "Infrastructure Control Point";
  }

  function normalize(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
  }

  return {
    sampleQuestions,
    localQuestionBank,
    parseQuestions,
    parseQuestionReport,
    splitQuestionBlocks,
    parseQuestionBlock,
    cleanQuestionMarkup,
    inferQuestionArea
  };
});
