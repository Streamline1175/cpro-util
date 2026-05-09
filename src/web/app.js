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

  urlInput.addEventListener("input", () => {
    if (urlInput.value.trim() && currentFile) {
      currentFile = null;
      fileInput.value = "";
    }
    if (urlInput.value.trim()) setStatus(`URL ready: ${urlInput.value.trim()}`);
    else setStatus("");
    refreshConvertEnabled();
  });
  urlClear.addEventListener("click", () => {
    urlInput.value = "";
    setStatus("");
    refreshConvertEnabled();
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
