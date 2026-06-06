function releaseYearFromDate(value) {
  const year = Number.parseInt(String(value || "").slice(0, 4), 10);
  return Number.isInteger(year) ? year : null;
}

function releaseYearFromRawJson(rawJson) {
  try {
    const raw = JSON.parse(rawJson || "{}");
    return releaseYearFromDate(raw.album?.release_date || raw.release_date || "");
  } catch (err) {
    return null;
  }
}

function eraForYear(year) {
  if (!year) return null;
  if (year <= 1969) return "vintage";
  if (year <= 1989) return "classic";
  if (year <= 2009) return "retro";
  return "modern";
}

function effectiveReleaseYearForRow(row) {
  const manualYear = Number.parseInt(row?.effective_release_year, 10);
  if (Number.isInteger(manualYear)) {
    return manualYear;
  }

  const spotifyYear = Number.parseInt(row?.spotify_release_year, 10);
  if (Number.isInteger(spotifyYear)) {
    return spotifyYear;
  }

  return releaseYearFromRawJson(row?.raw_json);
}

module.exports = {
  effectiveReleaseYearForRow,
  eraForYear,
  releaseYearFromDate,
  releaseYearFromRawJson,
};
