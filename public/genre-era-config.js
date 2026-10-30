(function attachGenreEraConfig(root, createConfig) {
  const config = createConfig();
  if (typeof module === "object" && module.exports) module.exports = config;
  if (root) root.CrateGenreEraConfig = config;
}(typeof globalThis !== "undefined" ? globalThis : this, function createGenreEraConfig() {
  const definitions = Object.freeze([
    Object.freeze({ value: "all", label: "All", min: null, max: null }),
    Object.freeze({ value: "vintage", label: "Vintage", min: 1900, max: 1964 }),
    Object.freeze({ value: "classic", label: "Classic", min: 1965, max: 1979 }),
    Object.freeze({ value: "retro", label: "Retro", min: 1980, max: 1999 }),
    Object.freeze({ value: "2000s", label: "2000s", min: 2000, max: 2009 }),
    Object.freeze({ value: "modern", label: "Modern", min: 2010, max: null }),
  ]);
  const byValue = new Map(definitions.map((definition) => [definition.value, definition]));

  function normalizeEra(value) {
    const normalized = String(value || "all").trim().toLowerCase();
    return byValue.has(normalized) ? normalized : "all";
  }

  function validYear(value, currentYear = new Date().getFullYear()) {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const text = String(value).trim();
    if (!/^\d{4}$/.test(text)) return null;
    const year = Number(text);
    return Number.isInteger(year) && year >= 1900 && year <= currentYear ? year : null;
  }

  function eraForYear(value, currentYear = new Date().getFullYear()) {
    const year = validYear(value, currentYear);
    if (year === null) return null;
    return definitions.slice(1).find((definition) => (
      year >= definition.min && (definition.max === null || year <= definition.max)
    ))?.value || null;
  }

  function matchesYear(value, era, currentYear = new Date().getFullYear()) {
    const normalizedEra = normalizeEra(era);
    if (normalizedEra === "all") return true;
    return eraForYear(value, currentYear) === normalizedEra;
  }

  function matchesTrackYear(track, era, currentYear = new Date().getFullYear()) {
    const rawYear = track?.effective_release_year ?? track?.spotify_release_year ?? null;
    const year = validYear(rawYear, currentYear);
    return matchesYear(year, era, currentYear);
  }

  function countYearCounts(yearCounts, era, currentYear = new Date().getFullYear()) {
    const normalizedEra = normalizeEra(era);
    return (Array.isArray(yearCounts) ? yearCounts : []).reduce((sum, row) => {
      const year = validYear(row?.year, currentYear);
      const count = Number(row?.count);
      if (year === null || !Number.isFinite(count) || count <= 0) return sum;
      return normalizedEra === "all" || eraForYear(year, currentYear) === normalizedEra
        ? sum + count
        : sum;
    }, 0);
  }

  function labelFor(era) {
    return byValue.get(normalizeEra(era)).label;
  }

  return Object.freeze({ definitions, normalizeEra, validYear, eraForYear, matchesYear, matchesTrackYear, countYearCounts, labelFor });
}));
