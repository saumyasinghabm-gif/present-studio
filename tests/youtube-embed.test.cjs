const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = { URL, location: { origin: "https://studio.snapkey.in" }, window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../frontend/js/youtube-embed.js"), "utf8"), context);
const youtube = context.window.SnapKeyYouTube;

test("supported YouTube links resolve to one safe video ID", () => {
  const id = "dQw4w9WgXcQ";
  for (const link of [
    `https://www.youtube.com/watch?v=${id}&t=12`,
    `https://youtu.be/${id}?si=test`,
    `https://youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`
  ]) assert.equal(youtube.parse(link), id);
  assert.equal(youtube.idFor({ youtubeId: id }), id);
  const embed = new URL(youtube.embedUrl(id, true));
  assert.equal(embed.origin, "https://www.youtube.com");
  assert.equal(embed.searchParams.get("origin"), "https://studio.snapkey.in");
});

test("lookalike hosts and malformed IDs never create an embed", () => {
  for (const link of [
    "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)",
    "https://youtube.com/watch?v=invalid",
    "https://youtu.be/dQw4w9WgXcQ/extra?foo=bar",
    "https://example.com/embed/dQw4w9WgXcQ"
  ]) assert.equal(youtube.parse(link), "");
  assert.equal(youtube.embedUrl("invalid"), "");
});
