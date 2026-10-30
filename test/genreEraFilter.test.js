const test = require("node:test");
const assert = require("node:assert/strict");

const eraConfig = require("../public/genre-era-config");

test("genre era definitions classify the requested boundary years", () => {
  const boundaries = [
    [1964, "vintage"],
    [1965, "classic"],
    [1979, "classic"],
    [1980, "retro"],
    [1999, "retro"],
    [2000, "2000s"],
    [2009, "2000s"],
    [2010, "modern"],
    [new Date().getFullYear(), "modern"],
  ];

  for (const [year, era] of boundaries) {
    assert.equal(eraConfig.eraForYear(year), era, `${year} should be ${era}`);
  }
});

test("All keeps missing or invalid years while era filters require valid release years", () => {
  assert.equal(eraConfig.matchesYear(null, "all"), true);
  assert.equal(eraConfig.matchesYear("unknown", "all"), true);
  assert.equal(eraConfig.matchesYear(null, "modern"), false);
  assert.equal(eraConfig.matchesYear("unknown", "modern"), false);
});

test("track matcher filters only valid years and keeps unknown years in All", () => {
  const currentYear = new Date().getFullYear();
  assert.equal(eraConfig.matchesTrackYear({ effective_release_year: 1965 }, "classic"), true);
  assert.equal(eraConfig.matchesTrackYear({ effective_release_year: 1979 }, "classic"), true);
  assert.equal(eraConfig.matchesTrackYear({ effective_release_year: 1964 }, "classic"), false);
  assert.equal(eraConfig.matchesTrackYear({ effective_release_year: null, spotify_release_year: 2010 }, "modern"), true);
  assert.equal(eraConfig.matchesTrackYear({ effective_release_year: "unknown" }, "modern"), false);
  assert.equal(eraConfig.matchesTrackYear({ effective_release_year: currentYear + 1 }, "modern"), false);
  assert.equal(eraConfig.matchesTrackYear({ effective_release_year: "unknown" }, "all"), true);
});
