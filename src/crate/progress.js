const progressByUserId = new Map();

function nowIso() {
  return new Date().toISOString();
}

function baseProgress(userId, values = {}) {
  return {
    status: "running",
    user_id: userId,
    flow: "scan_sort",
    stage: values.stage || "starting",
    title: values.title || "Starting Crate",
    body: values.body || "Preparing your music dashboard.",
    detail: values.detail || "",
    songs_processed: Number(values.songs_processed || 0),
    songs_total: Number(values.songs_total || 0),
    inserted: Number(values.inserted || 0),
    updated: Number(values.updated || 0),
    skipped: Number(values.skipped || 0),
    artists_found: Number(values.artists_found || 0),
    genres_found: Number(values.genres_found || 0),
    sorted_processed: Number(values.sorted_processed || 0),
    sorted_total: Number(values.sorted_total || 0),
    matched: Number(values.matched || 0),
    unmatched: Number(values.unmatched || 0),
    started_at: values.started_at || nowIso(),
    updated_at: nowIso(),
  };
}

function startProgress(userId, values = {}) {
  const progress = baseProgress(userId, values);
  progressByUserId.set(Number(userId), progress);
  return progress;
}

function updateProgress(userId, values = {}) {
  const key = Number(userId);
  const current = progressByUserId.get(key) || baseProgress(userId);
  const next = {
    ...current,
    ...values,
    user_id: key,
    updated_at: nowIso(),
  };
  progressByUserId.set(key, next);
  return next;
}

function finishProgress(userId, values = {}) {
  return updateProgress(userId, {
    status: "success",
    stage: "complete",
    title: "Your Crate Is Ready",
    body: "Your dashboard is ready to review.",
    ...values,
  });
}

function failProgress(userId, values = {}) {
  return updateProgress(userId, {
    status: "failed",
    title: "Crate Hit a Snag",
    body: "No playlists were sent.",
    ...values,
  });
}

function getProgress(userId) {
  const progress = progressByUserId.get(Number(userId));
  if (!progress) {
    return {
      status: "idle",
      user_id: Number(userId),
      flow: "scan_sort",
      stage: "idle",
      title: "Idle",
      body: "",
      detail: "",
      updated_at: nowIso(),
    };
  }
  return progress;
}

module.exports = {
  failProgress,
  finishProgress,
  getProgress,
  startProgress,
  updateProgress,
};
