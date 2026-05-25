(() => {
  const drop = document.getElementById("drop");
  const fileInput = document.getElementById("file");
  const pickBtn = document.getElementById("pick");
  const convertBtn = document.getElementById("convert");
  const statusEl = document.getElementById("status");
  const resultEl = document.getElementById("result");
  const stageEl = document.getElementById("stage");
  const metaEl = document.getElementById("meta");
  const downloadEl = document.getElementById("download");
  const againBtn = document.getElementById("again");
  const cropX = document.getElementById("cropX");
  const cropY = document.getElementById("cropY");
  const cropXv = document.getElementById("cropXv");
  const cropYv = document.getElementById("cropYv");
  const urlInput = document.getElementById("url");
  const urlClear = document.getElementById("urlClear");

  const progressSection = document.getElementById("progress-section");
  const progressBar = document.getElementById("progress-bar");
  const progressPhase = document.getElementById("progress-phase");
  const progressDetail = document.getElementById("progress-detail");

  let currentFile = null;
  let previewObjectUrl = null;

  // ── yt-dlp availability check ─────────────────────────────────────────────
  fetch("/api/ytdlp-check")
    .then(r => r.json())
    .then(data => {
      if (data.installed) {
        const badge = document.getElementById("ytdlp-badge");
        const disclaimer = document.getElementById("ytdlp-disclaimer");
        const installed = document.getElementById("ytdlp-installed");
        const version = document.getElementById("ytdlp-version");
        if (badge) badge.classList.add("installed");
        if (badge) badge.textContent = "yt-dlp installed";
        if (disclaimer) disclaimer.hidden = true;
        if (installed) installed.hidden = false;
        if (version && data.version) version.textContent = `v${data.version}`;
      }
    })
    .catch(() => { /* silently ignore — server may not expose endpoint */ });

  const fitCssMap = { cover: "cover", contain: "contain", stretch: "fill" };

  const refreshDimming = () => {
    const fit = document.querySelector('input[name="fit"]:checked')?.value || "cover";
    const bgLabel = document.getElementById("bg-label");
    if (bgLabel) bgLabel.classList.toggle("option-dimmed", fit !== "contain");
  };

  const refreshPreview = () => {
    const stage = document.getElementById("preview-stage");
    const el = stage && stage.querySelector("img, video");
    refreshDimming();
    if (!el) return;
    const fit = document.querySelector('input[name="fit"]:checked')?.value || "cover";
    el.style.objectFit = fitCssMap[fit] || "cover";
    el.style.objectPosition = `${(cropX.value * 100).toFixed(1)}% ${(cropY.value * 100).toFixed(1)}%`;
  };

  const updatePreview = (file) => {
    const section = document.getElementById("preview-compare");
    const stage = document.getElementById("preview-stage");
    if (!file) { section.hidden = true; return; }
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = URL.createObjectURL(file);
    const isVideo = file.type.startsWith("video/");
    stage.innerHTML = "";
    const el = document.createElement(isVideo ? "video" : "img");
    el.src = previewObjectUrl;
    if (isVideo) { el.autoplay = true; el.muted = true; el.loop = true; el.playsInline = true; }
    stage.appendChild(el);
    stage.appendChild(window.KBD.createOverlay());
    section.hidden = false;
    refreshPreview();
  };

  const updateUrlPreview = (url) => {
    const section = document.getElementById("preview-compare");
    const stage = document.getElementById("preview-stage");
    if (previewObjectUrl) { URL.revokeObjectURL(previewObjectUrl); previewObjectUrl = null; }
    if (!url) { section.hidden = true; stage.innerHTML = ""; return; }
    stage.innerHTML = "";
    const vid = document.createElement("video");
    vid.src = "/api/stream-url?url=" + encodeURIComponent(url);
    vid.autoplay = true; vid.muted = true; vid.loop = true; vid.playsInline = true;
    stage.appendChild(vid);
    stage.appendChild(window.KBD.createOverlay());
    section.hidden = false;
    refreshPreview();
  };

  // ── Keyboard overlay toggles ──────────────────────────────────────────────
  const compareSection = document.getElementById("preview-compare");
  const resultSection  = document.getElementById("result");

  document.getElementById("compare-keys-btn").addEventListener("click", function () {
    const on = this.classList.toggle("active");
    compareSection.classList.toggle("kbd-show-keys", on);
  });
  document.getElementById("compare-legends-btn").addEventListener("click", function () {
    const on = this.classList.toggle("active");
    compareSection.classList.toggle("kbd-show-legends", on);
  });
  document.getElementById("result-keys-btn").addEventListener("click", function () {
    const on = this.classList.toggle("active");
    resultSection.classList.toggle("kbd-show-keys", on);
  });
  document.getElementById("result-legends-btn").addEventListener("click", function () {
    const on = this.classList.toggle("active");
    resultSection.classList.toggle("kbd-show-legends", on);
  });

  const setProgress = (phase, pct, detail = "") => {
    progressSection.hidden = false;
    progressPhase.textContent = phase;
    progressBar.style.width = Math.max(0, Math.min(100, pct)).toFixed(1) + "%";
    progressDetail.textContent = detail;
  };

  const hideProgress = () => {
    progressSection.hidden = true;
    progressBar.style.width = "0%";
  };

  const setStatus = (text, cls = "") => {
    statusEl.textContent = text;
    statusEl.className = "status" + (cls ? " " + cls : "");
  };

  const refreshConvertEnabled = () => {
    convertBtn.disabled = !currentFile && !urlInput.value.trim();
  };

  const setFile = (f) => {
    currentFile = f;
    if (f) urlInput.value = "";
    refreshConvertEnabled();
    setStatus(f ? `Ready: ${f.name} (${formatBytes(f.size)})` : "");
    updatePreview(f);
  };

  let urlProbeTimer = null;
  urlInput.addEventListener("input", () => {
    if (urlInput.value.trim() && currentFile) {
      currentFile = null;
      fileInput.value = "";
      updatePreview(null); // clear file preview immediately
    }
    const val = urlInput.value.trim();
    if (val) setStatus(`URL ready: ${val}`);
    else setStatus("");
    refreshConvertEnabled();

    clearTimeout(urlProbeTimer);
    if (!val) {
      updateUrlPreview(null);
      return;
    }

    // Debounce: load live video preview + probe duration for trim timeline
    urlProbeTimer = setTimeout(async () => {
      // Load the actual video so the trim timeline has live scrub support
      updateUrlPreview(val);
      // Probe for a quick duration in case the video is slow to load metadata
      try {
        const res = await fetch("/api/probe-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: val }),
        });
        const data = await res.json();
        if (data.ok && data.duration) {
          document.dispatchEvent(
            new CustomEvent("cpro:urlDuration", { detail: { duration: data.duration } })
          );
        }
      } catch { /* probe is best-effort */ }
    }, 700);
  });
  urlClear.addEventListener("click", () => {
    urlInput.value = "";
    setStatus("");
    refreshConvertEnabled();
    clearTimeout(urlProbeTimer);
    updateUrlPreview(null);
  });

  pickBtn.addEventListener("click", () => fileInput.click());
  drop.addEventListener("click", (e) => {
    if (e.target === pickBtn) return;
    fileInput.click();
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files?.[0]) setFile(fileInput.files[0]);
  });

  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("drag");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("drag");
    const f = e.dataTransfer?.files?.[0];
    if (f) setFile(f);
  });

  cropX.addEventListener("input", () => { cropXv.textContent = Number(cropX.value).toFixed(2); refreshPreview(); });
  cropY.addEventListener("input", () => { cropYv.textContent = Number(cropY.value).toFixed(2); refreshPreview(); });
  document.querySelectorAll('input[name="fit"]').forEach(r => r.addEventListener("change", refreshPreview));
  refreshDimming(); // set initial dimmed state on load

  const parseTimeSec = (val) => {
    const s = String(val).trim();
    if (!s) return 0;
    const parts = s.split(":");
    let secs = 0;
    for (const part of parts) {
      const n = Number(part);
      if (!Number.isFinite(n) || n < 0) return 0;
      secs = secs * 60 + n;
    }
    return secs;
  };

  const seekPreviewToStart = () => {
    const stage = document.getElementById("preview-stage");
    const vid = stage && stage.querySelector("video");
    if (!vid) return;
    const t = parseTimeSec(document.getElementById("start").value);
    if (t >= 0) vid.currentTime = t;
  };

  document.getElementById("start").addEventListener("change", seekPreviewToStart);
  document.getElementById("start").addEventListener("blur", seekPreviewToStart);

  convertBtn.addEventListener("click", async () => {
    const url = urlInput.value.trim();
    if (!currentFile && !url) return;
    convertBtn.disabled = true;

    const opts = {
      fit: getRadio("fit"),
      background: document.getElementById("bg").value,
      fps: document.getElementById("fps").value,
      bitrate: document.getElementById("bitrate").value,
      cropX: cropX.value,
      cropY: cropY.value,
      start: document.getElementById("start").value.trim(),
      duration: document.getElementById("duration").value.trim(),
    };

    try {
      let json;
      if (url) {
        const jobId = crypto.randomUUID();
        const es = new EventSource(`/api/progress/${jobId}`);
        es.addEventListener("download", (e) => {
          const d = JSON.parse(e.data);
          const detail = [d.speed ? `${d.speed}` : "", d.eta ? `ETA ${d.eta}` : ""].filter(Boolean).join(" · ");
          setProgress("Downloading…", d.percent, detail);
        });
        es.addEventListener("encode", (e) => {
          const d = JSON.parse(e.data);
          setProgress("Encoding…", d.percent);
        });

        setStatus("Downloading & converting… (this can take a while for long videos)");
        setProgress("Downloading…", 0);
        let res;
        try {
          res = await fetch("/api/convert-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url, jobId, ...opts }),
          });
          json = await res.json();
        } finally {
          es.close();
          hideProgress();
        }
        if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      } else {
        setStatus("Converting… (this may take a minute for videos)");
        const fd = new FormData();
        fd.append("file", currentFile);
        Object.entries(opts).forEach(([k, v]) => fd.append(k === "bitrate" ? "bitrate" : k, v));
        const res = await fetch("/api/convert", { method: "POST", body: fd });
        json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      }
      renderResult(json);
      setStatus("✓ Done — tweak settings and Convert again, or download below.", "ok");
      convertBtn.disabled = false;
      loadCachedFiles();
    } catch (err) {
      setStatus("✗ " + (err.message || err), "err");
      convertBtn.disabled = false;
    }
  });

  againBtn.addEventListener("click", () => {
    resultEl.hidden = true;
    stageEl.innerHTML = "";
    setFile(null);
    fileInput.value = "";
    urlInput.value = "";
    refreshConvertEnabled();
    updatePreview(null);
    hideProgress();
  });

  const renderResult = (r) => {
    resultEl.hidden = false;
    stageEl.innerHTML = "";
    if (r.kind === "image") {
      const img = document.createElement("img");
      img.src = `/api/output/${r.id}?t=${Date.now()}`;
      stageEl.appendChild(img);
    } else {
      const v = document.createElement("video");
      v.src = `/api/output/${r.id}?t=${Date.now()}`;
      v.autoplay = true;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      stageEl.appendChild(v);
    }
    stageEl.appendChild(window.KBD.createOverlay());
    const parts = [
      `${r.width}×${r.height}`,
      formatBytes(r.bytes),
    ];
    if (r.kind === "video") {
      parts.push(`${r.fps}fps`, `${r.bitrateMbps}Mbps`, `${Number(r.durationSec).toFixed(1)}s`);
    }
    metaEl.textContent = parts.join(" · ");
    downloadEl.href = `/api/download/${r.id}`;
    downloadEl.setAttribute("download", r.filename);
    downloadEl.textContent = `Download ${r.filename}`;
    resultEl.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const getRadio = (name) => {
    const el = document.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : "";
  };

  const formatBytes = (n) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  // ── Cached files ──────────────────────────────────────────────────────────
  const cachedSection = document.getElementById("cached-files");
  const cachedList = document.getElementById("cached-files-list");
  const deleteAllBtn = document.getElementById("delete-all-btn");

  const formatAge = (isoDate) => {
    const diffMs = Date.now() - new Date(isoDate).getTime();
    const s = Math.floor(diffMs / 1000);
    if (s < 60) return `${s}s old`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min${m !== 1 ? "s" : ""} old`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} hr${h !== 1 ? "s" : ""} old`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d} day${d !== 1 ? "s" : ""} old`;
    const w = Math.floor(d / 7);
    return `${w} week${w !== 1 ? "s" : ""} old`;
  };

  const loadCachedFiles = async () => {
    try {
      const files = await fetch("/api/files").then(r => r.json());
      cachedSection.hidden = files.length === 0;
      cachedList.innerHTML = "";
      for (const f of files) {
        const row = document.createElement("div");
        row.className = "cached-file-row";
        row.dataset.id = f.id;

        const kind = document.createElement("span");
        kind.className = `cached-file-kind ${f.kind}`;
        kind.textContent = f.kind === "video" ? "VIDEO" : "IMAGE";

        const name = document.createElement("span");
        name.className = "cached-file-name";
        name.title = f.filename;
        name.textContent = f.filename;

        const meta = document.createElement("span");
        meta.className = "cached-file-meta";
        meta.textContent = formatBytes(f.bytes);

        const age = document.createElement("span");
        age.className = "cached-file-age";
        age.textContent = formatAge(f.createdAt);

        const del = document.createElement("button");
        del.className = "cached-file-del";
        del.textContent = "Delete";
        del.addEventListener("click", () => deleteFile(f.id, row));

        row.append(kind, name, meta, age, del);
        cachedList.appendChild(row);
      }
    } catch { /* ignore */ }
  };

  const deleteFile = async (id, rowEl) => {
    rowEl.style.opacity = "0.4";
    rowEl.style.pointerEvents = "none";
    try {
      await fetch(`/api/files/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadCachedFiles();
    } catch {
      rowEl.style.opacity = "";
      rowEl.style.pointerEvents = "";
    }
  };

  deleteAllBtn.addEventListener("click", async () => {
    if (!confirm("Delete all cached input and output files?")) return;
    deleteAllBtn.disabled = true;
    try {
      await fetch("/api/files", { method: "DELETE" });
      await loadCachedFiles();
    } finally {
      deleteAllBtn.disabled = false;
    }
  });

  loadCachedFiles();
})();

// ── yt-dlp update ─────────────────────────────────────────────────────────
(() => {
  const updateBtn = document.getElementById("ytdlp-update-btn");
  const updateStatus = document.getElementById("ytdlp-update-status");
  if (!updateBtn) return;

  updateBtn.addEventListener("click", async () => {
    updateBtn.disabled = true;
    updateStatus.hidden = false;
    updateStatus.className = "ytdlp-update-status";
    updateStatus.textContent = "Updating…";
    try {
      const res = await fetch("/api/ytdlp/update", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        updateStatus.classList.add("ok");
        updateStatus.textContent = "✓ " + (data.output || "Up to date");
        // Refresh version badge
        fetch("/api/ytdlp-check").then(r => r.json()).then(d => {
          if (d.version) {
            const vEl = document.getElementById("ytdlp-version");
            if (vEl) vEl.textContent = `v${d.version}`;
          }
        }).catch(() => {});
      } else {
        updateStatus.classList.add("err");
        updateStatus.textContent = "✗ " + (data.error || "Update failed");
      }
    } catch (e) {
      updateStatus.classList.add("err");
      updateStatus.textContent = "✗ " + (e.message || "Network error");
    } finally {
      updateBtn.disabled = false;
    }
  });
})();

// ── Visual trim timeline ──────────────────────────────────────────────────
(() => {
  const timelineWrap = document.getElementById("trim-timeline-wrap");
  const track = document.getElementById("trim-timeline")?.querySelector(".trim-track");
  const selected = document.getElementById("trim-selected");
  const handleStart = document.getElementById("trim-handle-start");
  const handleEnd = document.getElementById("trim-handle-end");
  const labelStart = document.getElementById("trim-label-start");
  const labelEnd = document.getElementById("trim-label-end");
  const labelTotal = document.getElementById("trim-label-total");
  const startInput = document.getElementById("start");
  const durationInput = document.getElementById("duration");
  if (!timelineWrap || !track || !selected || !handleStart || !handleEnd) return;

  let videoDuration = 0;
  let startFrac = 0;
  let endFrac = 1;

  const fmtTime = (s) => {
    s = Math.max(0, s);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = (s % 60).toFixed(1);
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(4, "0")}`;
    if (m > 0) return `${m}:${sec.padStart(4, "0")}`;
    return `${sec}s`;
  };

  const parseTimeSec = (val) => {
    const s = String(val ?? "").trim();
    if (!s) return 0;
    const parts = s.split(":");
    let secs = 0;
    for (const p of parts) {
      const n = Number(p);
      if (!Number.isFinite(n) || n < 0) return 0;
      secs = secs * 60 + n;
    }
    return secs;
  };

  const updateUI = () => {
    const s = startFrac * 100;
    const e = endFrac * 100;
    selected.style.left = s + "%";
    selected.style.width = (e - s) + "%";
    handleStart.style.left = s + "%";
    handleEnd.style.left = e + "%";
    if (videoDuration > 0) {
      const startSec = startFrac * videoDuration;
      const endSec = endFrac * videoDuration;
      labelStart.textContent = fmtTime(startSec);
      labelEnd.textContent = fmtTime(endSec);
      startInput.value = startSec <= 0 ? "" : startSec.toFixed(1);
      durationInput.value = endFrac >= 1 && startFrac <= 0 ? "" : (endSec - startSec).toFixed(1);
    }
  };

  const syncFromInputs = () => {
    if (videoDuration <= 0) return;
    const startSec = parseTimeSec(startInput.value);
    const durSec = parseTimeSec(durationInput.value);
    startFrac = Math.max(0, Math.min(1, startSec / videoDuration));
    const endSec = durSec > 0 ? startSec + durSec : videoDuration;
    endFrac = Math.max(startFrac, Math.min(1, endSec / videoDuration));
    updateUI();
  };

  // Drag logic
  let dragging = null;
  const onMouseMove = (e) => {
    if (!dragging || videoDuration <= 0) return;
    const rect = track.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (dragging === "start") {
      startFrac = Math.min(frac, endFrac - 0.01);
    } else {
      endFrac = Math.max(frac, startFrac + 0.01);
    }
    updateUI();
    // Live-seek the preview video to start position
    const previewStage = document.getElementById("preview-stage");
    const vid = previewStage?.querySelector("video");
    if (vid && dragging === "start") vid.currentTime = startFrac * videoDuration;
  };
  const onMouseUp = () => { dragging = null; };

  handleStart.addEventListener("mousedown", (e) => { e.preventDefault(); dragging = "start"; });
  handleEnd.addEventListener("mousedown", (e) => { e.preventDefault(); dragging = "end"; });
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);

  // Touch support
  const onTouchMove = (e) => {
    if (!dragging) return;
    e.preventDefault();
    onMouseMove(e.touches[0]);
  };
  handleStart.addEventListener("touchstart", (e) => { e.preventDefault(); dragging = "start"; }, { passive: false });
  handleEnd.addEventListener("touchstart", (e) => { e.preventDefault(); dragging = "end"; }, { passive: false });
  document.addEventListener("touchmove", onTouchMove, { passive: false });
  document.addEventListener("touchend", onMouseUp);

  startInput.addEventListener("change", syncFromInputs);
  durationInput.addEventListener("change", syncFromInputs);

  // Listen for when a video is loaded in the preview stage
  // We need to observe when the preview stage gets a video element
  const observer = new MutationObserver(() => {
    const previewStage = document.getElementById("preview-stage");
    const vid = previewStage?.querySelector("video");
    if (vid && !vid._trimListener) {
      vid._trimListener = true;
      const onMeta = () => {
        if (!vid.duration || !Number.isFinite(vid.duration)) return;
        videoDuration = vid.duration;
        startFrac = 0; endFrac = 1;
        timelineWrap.hidden = false;
        labelTotal.textContent = fmtTime(videoDuration);
        updateUI();
        // Sync from existing text input values (user may have typed something)
        syncFromInputs();
      };
      if (vid.readyState >= 1 && vid.duration) {
        onMeta();
      } else {
        vid.addEventListener("loadedmetadata", onMeta, { once: true });
      }
    }
    // Hide timeline when video removed (image loaded or reset)
    if (!previewStage?.querySelector("video")) {
      timelineWrap.hidden = true;
      videoDuration = 0;
    }
  });
  const previewCompare = document.getElementById("preview-compare");
  if (previewCompare) observer.observe(previewCompare, { childList: true, subtree: true });

  // Also activate timeline when a URL duration is probed
  document.addEventListener("cpro:urlDuration", (e) => {
    const dur = e.detail?.duration ?? 0;
    if (dur > 0) {
      videoDuration = dur;
      startFrac = 0; endFrac = 1;
      timelineWrap.hidden = false;
      labelTotal.textContent = fmtTime(dur);
      updateUI();
    } else {
      timelineWrap.hidden = true;
      videoDuration = 0;
    }
  });
})();

// ── Device / HID slot panel ───────────────────────────────────────────────
(() => {
  const dot = document.getElementById("device-dot");
  const statusText = document.getElementById("device-status-text");
  const refreshBtn = document.getElementById("device-refresh-btn");
  const hintEl = document.getElementById("device-hint");
  const slotGrid = document.getElementById("slot-grid");
  const deviceActions = document.getElementById("device-actions");
  const loadAllBtn = document.getElementById("load-all-previews-btn");
  if (!dot || !slotGrid) return;

  const SLOT_COUNT = 5;
  const slotState = Array.from({ length: SLOT_COUNT }, (_, i) => ({
    slot: i + 1,
    previewDataUrl: null,
    sha256: null,
    loading: false,
    verifying: false,
  }));

  // Build initial slot tiles
  for (const s of slotState) {
    const tile = document.createElement("div");
    tile.className = "slot-tile";
    tile.id = `slot-tile-${s.slot}`;
    tile.innerHTML = `
      <div class="slot-tile-header">
        <span class="slot-tile-label">Slot ${s.slot}</span>
        <span class="slot-active-badge" id="slot-active-${s.slot}" hidden>Active</span>
      </div>
      <div class="slot-preview-wrap">
        <img id="slot-img-${s.slot}" src="" alt="" hidden />
        <div class="slot-preview-placeholder" id="slot-placeholder-${s.slot}">—</div>
      </div>
      <div class="slot-tile-actions">
        <button class="btn-slot-select" id="slot-select-${s.slot}" disabled>Set Active</button>
        <button class="btn-slot-preview" id="slot-pull-${s.slot}" disabled title="Pull preview from keyboard">⟳</button>
        <button class="btn-slot-verify" id="slot-verify-${s.slot}" disabled title="Poll hash until stable (verify upload)">✓?</button>
      </div>
      <div class="slot-tile-status" id="slot-status-${s.slot}"></div>
    `;
    slotGrid.appendChild(tile);

    tile.querySelector(`#slot-select-${s.slot}`).addEventListener("click", () => activateSlot(s.slot));
    tile.querySelector(`#slot-pull-${s.slot}`).addEventListener("click", () => pullPreview(s.slot));
    tile.querySelector(`#slot-verify-${s.slot}`).addEventListener("click", () => verifySlot(s.slot));
  }

  const setTileStatus = (slot, text) => {
    const el = document.getElementById(`slot-status-${slot}`);
    if (el) el.textContent = text;
  };
  const setTileEnabled = (connected) => {
    for (let i = 1; i <= SLOT_COUNT; i++) {
      const sel = document.getElementById(`slot-select-${i}`);
      const pull = document.getElementById(`slot-pull-${i}`);
      const ver = document.getElementById(`slot-verify-${i}`);
      if (sel) sel.disabled = !connected;
      if (pull) pull.disabled = !connected;
      if (ver) ver.disabled = !connected;
    }
  };

  const checkStatus = async () => {
    refreshBtn.classList.add("spinning");
    try {
      const res = await fetch("/api/hid/status");
      const data = await res.json();
      if (data.connected) {
        dot.className = "device-status-dot connected";
        statusText.textContent = `Connected (${data.vid}:${data.pid})`;
        hintEl.hidden = true;
        deviceActions.hidden = false;
        setTileEnabled(true);
      } else {
        dot.className = "device-status-dot disconnected";
        statusText.textContent = "Not detected via USB HID";
        hintEl.hidden = false;
        deviceActions.hidden = true;
        setTileEnabled(false);
      }
    } catch {
      dot.className = "device-status-dot";
      statusText.textContent = "Unable to check";
    } finally {
      refreshBtn.classList.remove("spinning");
    }
  };

  const pullPreview = async (slot) => {
    const pullBtn = document.getElementById(`slot-pull-${slot}`);
    const img = document.getElementById(`slot-img-${slot}`);
    const placeholder = document.getElementById(`slot-placeholder-${slot}`);
    if (!pullBtn) return;

    pullBtn.disabled = true;
    setTileStatus(slot, "Pulling preview…");
    try {
      const res = await fetch(`/api/hid/slot/${slot}/preview`);
      const data = await res.json();
      if (data.ok && data.dataUrl) {
        slotState[slot - 1].previewDataUrl = data.dataUrl;
        slotState[slot - 1].sha256 = data.sha256;
        img.src = data.dataUrl;
        img.hidden = false;
        placeholder.hidden = true;
        setTileStatus(slot, data.sha256 ? data.sha256.slice(0, 12) + "…" : "");
      } else {
        setTileStatus(slot, "✗ " + (data.error || "No preview"));
      }
    } catch (e) {
      setTileStatus(slot, "✗ " + (e.message || "Error"));
    } finally {
      pullBtn.disabled = false;
    }
  };

  const activateSlot = async (slot) => {
    const selectBtn = document.getElementById(`slot-select-${slot}`);
    if (!selectBtn) return;
    selectBtn.disabled = true;
    setTileStatus(slot, "Switching…");
    try {
      const res = await fetch(`/api/hid/slot/${slot}/select`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        // Update active badge
        for (let i = 1; i <= SLOT_COUNT; i++) {
          const badge = document.getElementById(`slot-active-${i}`);
          const tile = document.getElementById(`slot-tile-${i}`);
          if (badge) badge.hidden = (i !== slot);
          if (tile) tile.classList.toggle("active-slot", i === slot);
        }
        setTileStatus(slot, "✓ Active");
      } else {
        setTileStatus(slot, "✗ " + (data.error || "Failed"));
      }
    } catch (e) {
      setTileStatus(slot, "✗ " + (e.message || "Error"));
    } finally {
      selectBtn.disabled = false;
    }
  };

  const verifySlot = (slot) => {
    const verifyBtn = document.getElementById(`slot-verify-${slot}`);
    if (!verifyBtn) return;
    verifyBtn.disabled = true;
    setTileStatus(slot, "Verifying…");

    const es = new EventSource(`/api/hid/slot/${slot}/verify`);
    es.addEventListener("poll", (e) => {
      const d = JSON.parse(e.data);
      setTileStatus(slot, `Poll ${d.attempt}: ${d.sha ? d.sha.slice(0, 10) + "…" : "…"}`);
    });
    es.addEventListener("done", (e) => {
      es.close();
      const d = JSON.parse(e.data);
      if (d.ok) {
        setTileStatus(slot, `✓ Verified (${d.attempts} polls)`);
        // Refresh preview to show new skin
        pullPreview(slot);
      } else {
        setTileStatus(slot, "⚠ " + (d.error || "Timed out"));
      }
      verifyBtn.disabled = false;
    });
    es.onerror = () => {
      es.close();
      setTileStatus(slot, "✗ Verify stream error");
      verifyBtn.disabled = false;
    };
  };

  if (loadAllBtn) {
    loadAllBtn.addEventListener("click", async () => {
      loadAllBtn.disabled = true;
      for (let i = 1; i <= SLOT_COUNT; i++) await pullPreview(i);
      loadAllBtn.disabled = false;
    });
  }

  refreshBtn.addEventListener("click", checkStatus);
  checkStatus();
})();
