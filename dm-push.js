const payload = process.argv[2];

if (!payload) {
  console.error('Usage: node dm-push.js id tag story question [advanceRoom] [correct]');
  console.error('   or: node dm-push.js "{\"id\":\"...\",\"tag\":\"...\",\"story\":\"...\",\"question\":\"...\"}"');
  process.exit(1);
}

let parsed;
if (process.argv.length >= 6) {
  parsed = {
    id: process.argv[2],
    tag: process.argv[3],
    story: expandNewlines(process.argv[4]),
    question: expandNewlines(process.argv[5])
  };
  if (process.argv[6] !== undefined) parsed.advanceRoom = parseFlag(process.argv[6]);
  if (process.argv[7] !== undefined) parsed.correct = parseFlag(process.argv[7]);
} else {
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    console.error(`Invalid JSON: ${error.message}`);
    process.exit(1);
  }
}

if (!parsed.id) parsed.id = `feed-${Date.now()}`;
if (parsed.story) parsed.story = expandNewlines(parsed.story);
if (parsed.question) parsed.question = expandNewlines(parsed.question);

function expandNewlines(value) {
  return String(value).replaceAll("\\n", "\n").replaceAll("`n", "\n");
}

function parseFlag(value) {
  return /^(1|true|yes|y)$/i.test(String(value));
}

fetch("http://localhost:4174/api/feed", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(parsed)
})
  .then(async (response) => {
    const body = await response.text();
    if (!response.ok) throw new Error(body);
    console.log(body);
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
