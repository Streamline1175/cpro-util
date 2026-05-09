// Finalmouse Centerpiece keyboard overlay — exact geometry mirrored from interactive.html
// Single source of truth: U=103, KH=88, MARGIN=14, NAV_C=[1654,1761,1868]
(() => {
  const U      = 103;  // key unit width (px in 1920×550 space)
  const KH     =  88;  // key height
  const GAP    =   4;  // inter-key gap
  const MARGIN =  14;  // left margin

  // Row Y-centres
  const Y = [75, 175, 275, 375, 475];

  // Nav cluster column x-centres: [left, middle, right]
  const NAV_C = [1654, 1761, 1868];

  function key(label, cx, cy, w) {
    return { label, cx, cy, x: cx - w / 2, y: cy - KH / 2, w, h: KH };
  }

  // Build a row of keys with given widths, starting from MARGIN
  function buildRow(yRow, labels, widths) {
    let cx = MARGIN;
    return labels.map((lbl, i) => {
      const w = Array.isArray(widths) ? widths[i] : widths;
      cx += w / 2;
      const k = key(lbl, cx, yRow, w);
      cx += w / 2 + GAP;
      return k;
    });
  }

  // ── Row 0: Esc 1-0 - = Bksp ────────────────────────────────────────────
  const R0 = buildRow(Y[0],
    ['Esc','1','2','3','4','5','6','7','8','9','0','-','=','⌫'],
    [U*1.1,U,U,U,U,U,U,U,U,U,U,U,U,U*2]
  );

  // ── Row 1: Tab Q-P [ ] \ ────────────────────────────────────────────────
  const R1 = buildRow(Y[1],
    ['Tab','Q','W','E','R','T','Y','U','I','O','P','[',']','\\'],
    [U*1.5,U,U,U,U,U,U,U,U,U,U,U,U,U*1.5]
  );

  // ── Row 2: Caps A-L ; ' Enter ───────────────────────────────────────────
  const R2 = buildRow(Y[2],
    ['Caps','A','S','D','F','G','H','J','K','L',';',"'",'↵'],
    [U*1.75,U,U,U,U,U,U,U,U,U,U,U,U*2.25]
  );

  // ── Row 3: LShift Z-/ RShift ────────────────────────────────────────────
  const R3 = buildRow(Y[3],
    ['⇧','Z','X','C','V','B','N','M',',','.','/', '⇧'],
    [U*2.25,U,U,U,U,U,U,U,U,U,U,U*1.75]
  );

  // ── Row 4: Modifiers + Space (Space unindexed / visual only) ────────────
  const R4 = [];
  (function () {
    const u4 = 101;
    let cx = MARGIN;
    const specs = [
      ['Ctrl', u4 * 1.25],
      ['⊞',   u4 * 1.25],
      ['Alt',  u4 * 1.5 ],
      // i=3: skip over 6.25U spacebar
      ['Alt',  u4 * 1.5 ],
      ['Fn',   u4 * 1.25],
      ['Ctrl', u4 * 1.25],
    ];
    specs.forEach(([lbl, w], i) => {
      if (i === 3) cx += u4 * 6.25 + GAP;
      cx += w / 2;
      R4.push(key(lbl, cx, Y[4], w));
      cx += w / 2 + GAP;
    });
  })();

  // Spacebar — visual indicator only (unindexed)
  const lalt = R4[2], ralt = R4[3];
  const spaceX = lalt.x + lalt.w + GAP;
  const spaceW = ralt.x - spaceX - GAP;
  const SPACE = [key('', spaceX + spaceW / 2, Y[4], spaceW)];

  // ── Nav cluster ─────────────────────────────────────────────────────────
  //   Row 0: Ins (mid), PgUp (right)
  //   Row 1: Del (mid), PgDn (right)
  //   Row 3: ↑  (mid)
  //   Row 4: ← (left), ↓ (mid), → (right)
  const NAV = [
    key('Ins',  NAV_C[1], Y[0], U),
    key('PgUp', NAV_C[2], Y[0], U),
    key('Del',  NAV_C[1], Y[1], U),
    key('PgDn', NAV_C[2], Y[1], U),
    key('↑',    NAV_C[1], Y[3], U),
    key('←',    NAV_C[0], Y[4], U),
    key('↓',    NAV_C[1], Y[4], U),
    key('→',    NAV_C[2], Y[4], U),
  ];

  const ALL_KEYS = [...R0, ...R1, ...R2, ...R3, ...R4, ...SPACE, ...NAV];

  function xmlEsc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function buildSvg() {
    let rects = '';
    let texts = '';
    for (const k of ALL_KEYS) {
      const isSpace = !k.label;
      const rx = k.x.toFixed(1), ry = k.y.toFixed(1);
      const rw = k.w.toFixed(1), rh = k.h.toFixed(1);
      if (isSpace) {
        // Spacebar: dimmer, no text
        rects += `<rect class="kbd-space" x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="8"/>`;
      } else {
        rects += `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="8"/>`;
        const n = k.label.length;
        const fs = n === 1 ? 32 : n <= 3 ? 22 : n <= 4 ? 18 : 14;
        texts += `<text x="${k.cx.toFixed(1)}" y="${k.cy.toFixed(1)}" font-size="${fs}">${xmlEsc(k.label)}</text>`;
      }
    }
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 550" width="100%" height="100%">' +
      '<g class="kbd-keys">' + rects + '</g>' +
      '<g class="kbd-legends" text-anchor="middle" dominant-baseline="middle"' +
      ' font-family="ui-monospace,monospace" font-weight="700">' + texts + '</g>' +
      '</svg>'
    );
  }

  function createOverlay() {
    const el = document.createElement('div');
    el.className = 'kbd-overlay';
    el.innerHTML = buildSvg();
    return el;
  }

  window.KBD = { buildSvg, createOverlay };
})();
