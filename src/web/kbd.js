// Finalmouse Centerpiece keyboard overlay — 65% exploded layout (67 keys)
// Coordinate system: 1920×550 viewBox units, 1U = 102px, 0.5U gap between main and nav column
(() => {
  const U = 102;  // viewBox units per key-unit
  const G = 6;    // inter-key gap in viewBox units
  const L = Math.round((1920 - 16.5 * U) / 2); // left margin = 119
  const T = Math.round((550  -  5   * U) / 2); // top  margin =  20

  // [x, y, w, label] — x/y/w in key-units (U). Empty label = no text (Space bar).
  const KEYS = [
    // ── Row 1 — number row ──────────────────────────────────────────────────
    [0,     0, 1,    'Esc'],
    [1,     0, 1,    '1'],  [2,  0, 1, '2'], [3,  0, 1, '3'], [4,  0, 1, '4'],
    [5,     0, 1,    '5'],  [6,  0, 1, '6'], [7,  0, 1, '7'], [8,  0, 1, '8'],
    [9,     0, 1,    '9'],  [10, 0, 1, '0'], [11, 0, 1, '-'], [12, 0, 1, '='],
    [13,    0, 2,    'Bksp'],
    [15.5,  0, 1,    'Del'],
    // ── Row 2 — QWERTY ──────────────────────────────────────────────────────
    [0,     1, 1.5,  'Tab'],
    [1.5,   1, 1,    'Q'],  [2.5,  1, 1, 'W'], [3.5,  1, 1, 'E'], [4.5,  1, 1, 'R'],
    [5.5,   1, 1,    'T'],  [6.5,  1, 1, 'Y'], [7.5,  1, 1, 'U'], [8.5,  1, 1, 'I'],
    [9.5,   1, 1,    'O'],  [10.5, 1, 1, 'P'], [11.5, 1, 1, '['], [12.5, 1, 1, ']'],
    [13.5,  1, 1.5,  '\\'],
    [15.5,  1, 1,    'PgUp'],
    // ── Row 3 — home row ────────────────────────────────────────────────────
    [0,     2, 1.75, 'Caps'],
    [1.75,  2, 1,    'A'],  [2.75,  2, 1, 'S'], [3.75,  2, 1, 'D'], [4.75,  2, 1, 'F'],
    [5.75,  2, 1,    'G'],  [6.75,  2, 1, 'H'], [7.75,  2, 1, 'J'], [8.75,  2, 1, 'K'],
    [9.75,  2, 1,    'L'],  [10.75, 2, 1, ';'], [11.75, 2, 1, "'"],
    [12.75, 2, 2.25, 'Enter'],
    [15.5,  2, 1,    'PgDn'],
    // ── Row 4 — shift row ───────────────────────────────────────────────────
    [0,     3, 2.25, 'Shift'],
    [2.25,  3, 1,    'Z'],  [3.25,  3, 1, 'X'], [4.25, 3, 1, 'C'], [5.25, 3, 1, 'V'],
    [6.25,  3, 1,    'B'],  [7.25,  3, 1, 'N'], [8.25, 3, 1, 'M'], [9.25, 3, 1, ','],
    [10.25, 3, 1,    '.'],  [11.25, 3, 1, '/'],
    [12.25, 3, 1.75, 'Shift'],
    [15.5,  3, 1,    '\u2191'], // ↑
    // ── Row 5 — bottom row ──────────────────────────────────────────────────
    [0,     4, 1.25, 'Ctrl'],
    [1.25,  4, 1.25, 'Win'],
    [2.5,   4, 1.25, 'Alt'],
    [3.75,  4, 6.25, ''],        // Space bar — no label
    [10,    4, 1,    'Alt'],
    [11,    4, 1,    'Fn'],
    [12,    4, 1,    'Ctrl'],
    [13.5,  4, 1,    '\u2190'], // ←
    [14.5,  4, 1,    '\u2193'], // ↓
    [15.5,  4, 1,    '\u2192'], // →
  ];

  function xmlEsc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function buildSvg() {
    let rects = '';
    let texts = '';
    for (const [xu, yu, wu, label] of KEYS) {
      const kx = (L + xu * U + G * 0.5).toFixed(1);
      const ky = (T + yu * U + G * 0.5).toFixed(1);
      const kw = (wu * U - G).toFixed(1);
      const kh = (U - G).toFixed(1);
      rects += `<rect x="${kx}" y="${ky}" width="${kw}" height="${kh}" rx="8"/>`;
      if (label) {
        const cx = (L + xu * U + G * 0.5 + (wu * U - G) * 0.5).toFixed(1);
        const cy = (T + yu * U + G * 0.5 + (U - G) * 0.5).toFixed(1);
        const n = label.length;
        const fs = n === 1 ? 32 : n <= 3 ? 22 : n <= 4 ? 18 : 14;
        texts += `<text x="${cx}" y="${cy}" font-size="${fs}">${xmlEsc(label)}</text>`;
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
