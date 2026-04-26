(() => {
  const canvas = document.getElementById("bg-canvas");
  const ctx = canvas.getContext("2d");

  // Centerpiece-inspired palette: deep blacks, electric blues, purples, golds, cyans
  const COLORS = [
    "#6aa6ff", // electric blue
    "#a78bfa", // violet
    "#f59e0b", // amber gold
    "#22d3ee", // cyan
    "#818cf8", // indigo
    "#34d399", // teal
    "#f472b6", // pink accent
  ];

  let W, H;
  let particles = [];
  let raf;

  // ── Resize ────────────────────────────────────────────────────────────────
  const resize = () => {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  };

  // ── Particles ─────────────────────────────────────────────────────────────
  const PARTICLE_COUNT = 90;

  const makeParticle = (initial) => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.15 + Math.random() * 0.35;
    return {
      x: initial ? Math.random() * (W || window.innerWidth) : Math.random() * (W || window.innerWidth),
      y: initial ? Math.random() * (H || window.innerHeight) : (Math.random() < 0.5 ? -4 : (H || window.innerHeight) + 4),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: 1 + Math.random() * 2.2,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      alpha: 0.4 + Math.random() * 0.5,
      life: 0,
      maxLife: 600 + Math.random() * 800,
    };
  };

  const initParticles = () => {
    particles = Array.from({ length: PARTICLE_COUNT }, () => makeParticle(true));
  };

  // ── Draw connections between nearby particles ──────────────────────────────
  const CONNECT_DIST = 120;

  const drawConnections = () => {
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i], b = particles[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > CONNECT_DIST) continue;
        const t = 1 - d / CONNECT_DIST;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        // blend between the two particle colors
        const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        grad.addColorStop(0, hexAlpha(a.color, t * 0.18 * a.alpha));
        grad.addColorStop(1, hexAlpha(b.color, t * 0.18 * b.alpha));
        ctx.strokeStyle = grad;
        ctx.lineWidth = t * 0.8;
        ctx.stroke();
      }
    }
  };

  // ── Scanline overlay ───────────────────────────────────────────────────────
  let scanY = 0;
  const drawScanline = () => {
    const grad = ctx.createLinearGradient(0, scanY - 60, 0, scanY + 60);
    grad.addColorStop(0, "rgba(108,170,255,0)");
    grad.addColorStop(0.5, "rgba(108,170,255,0.025)");
    grad.addColorStop(1, "rgba(108,170,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, scanY - 60, W, 120);
    scanY = (scanY + 0.4) % (H + 120);
  };

  // ── Main loop ─────────────────────────────────────────────────────────────
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    const t = now / 1000;

    // Clear with semi-transparent fill to create motion trails
    ctx.fillStyle = "rgba(11,11,13,0.30)";
    ctx.fillRect(0, 0, W, H);

    drawScanline();

    // Update + draw particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life++;

      // fade in / fade out
      const lifeFrac = p.life / p.maxLife;
      const fade = lifeFrac < 0.1 ? lifeFrac / 0.1 : lifeFrac > 0.85 ? 1 - (lifeFrac - 0.85) / 0.15 : 1;
      const a = p.alpha * fade;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = hexAlpha(p.color, a);
      ctx.fill();

      // soft glow halo
      const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 5);
      halo.addColorStop(0, hexAlpha(p.color, a * 0.35));
      halo.addColorStop(1, hexAlpha(p.color, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 5, 0, Math.PI * 2);
      ctx.fill();

      if (p.life >= p.maxLife || p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) {
        particles[i] = makeParticle(false);
      }
    }

    drawConnections();
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const hexAlpha = (() => {
    const cache = new Map();
    return (hex, alpha) => {
      const a = Math.max(0, Math.min(1, alpha));
      const key = hex + "|" + a.toFixed(3);
      if (cache.has(key)) return cache.get(key);
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      const v = `rgba(${r},${g},${b},${a.toFixed(3)})`;
      if (cache.size > 2000) cache.clear();
      cache.set(key, v);
      return v;
    };
  })();

  // ── Init ──────────────────────────────────────────────────────────────────
  resize();
  initParticles();
  window.addEventListener("resize", resize);
  requestAnimationFrame(loop);
})();
