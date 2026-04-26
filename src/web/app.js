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

  const updatePreviewCompare = (file) => {
    const section = document.getElementById("preview-compare");
    if (!file) { section.hidden = true; return; }
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = URL.createObjectURL(file);
    const isVideo = file.type.startsWith("video/");
    [["cover", "cover"], ["contain", "contain"], ["stretch", "fill"]].forEach(([id, fit]) => {
      const stage = document.getElementById(`prev-${id}`);
      stage.innerHTML = "";
      const el = document.createElement(isVideo ? "video" : "img");
      el.src = previewObjectUrl;
      if (isVideo) { el.autoplay = true; el.muted = true; el.loop = true; el.playsInline = true; }
      el.style.objectFit = fit;
      stage.appendChild(el);
    });
    section.hidden = false;
  };

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
    updatePreviewCompare(f);
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

  cropX.addEventListener("input", () => (cropXv.textContent = Number(cropX.value).toFixed(2)));
  cropY.addEventListener("input", () => (cropYv.textContent = Number(cropY.value).toFixed(2)));

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
      setStatus("✓ Done", "ok");
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
    updatePreviewCompare(null);
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
})();
