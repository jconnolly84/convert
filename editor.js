// Image editor: visual crop, resize (px / mm / in), DPI, and DVD cover template split.

const DVD = { wrap: 273, height: 183, panel: 129.5, spine: 14 }; // standard DVD case insert, mm
const ASPECTS = [
  ['free', 'Free', null],
  ['orig', 'Original', 'orig'],
  ['1:1', 'Square 1:1', 1],
  ['4:5', 'Portrait 4:5', 4 / 5],
  ['2:3', 'Portrait 2:3', 2 / 3],
  ['3:2', 'Landscape 3:2', 3 / 2],
  ['4:3', 'Landscape 4:3', 4 / 3],
  ['16:9', 'Wide 16:9', 16 / 9],
  ['dvdf', 'DVD front cover', DVD.panel / DVD.height],
  ['dvdw', 'DVD full wrap (back · spine · front)', DVD.wrap / DVD.height],
];
const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

let open = null; // the active editor instance

export async function openEditor(file, { decode }) {
  if (open) open.close();
  const ui = buildUI(file);
  document.body.appendChild(ui.root);
  document.body.style.overflow = 'hidden';
  ui.status.textContent = 'Loading image…';
  let img;
  try { img = await decode(file); }
  catch (e) { ui.status.textContent = 'Could not open this image: ' + (e.message || e); return; }
  ui.status.textContent = '';
  open = new Editor(file, img, ui);
}

function el(tag, attrs = {}, html = '') {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  if (html) e.innerHTML = html;
  return e;
}

function buildUI(file) {
  const root = el('div', { class: 'ed-backdrop' });
  root.innerHTML = `
  <div class="ed" role="dialog" aria-label="Edit image">
    <div class="ed-head">
      <strong>Crop &amp; resize</strong><span class="ed-file"></span>
      <div class="ed-tools">
        <button data-act="rotl" title="Rotate left">⟲</button>
        <button data-act="rotr" title="Rotate right">⟳</button>
        <button data-act="close" title="Close (Esc)">✕</button>
      </div>
    </div>
    <div class="ed-body">
      <div class="ed-stage"><div class="ed-wrap">
        <canvas></canvas>
        <div class="ed-crop">
          <div class="ed-guides"></div>
          <div class="ed-labels"></div>
          ${['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((h) => `<i class="ed-h ${h}" data-h="${h}"></i>`).join('')}
        </div>
      </div><div class="ed-status"></div></div>
      <div class="ed-side">
        <section>
          <h3>Crop</h3>
          <label>Shape<select data-k="aspect">${ASPECTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
          <label class="ed-check ed-dvd-only"><input type="checkbox" data-k="split" checked> Export back, spine &amp; front as separate files</label>
          <div class="ed-grid4">
            <label>X<input type="number" data-k="cx" min="0"></label>
            <label>Y<input type="number" data-k="cy" min="0"></label>
            <label>W<input type="number" data-k="cw" min="1"></label>
            <label>H<input type="number" data-k="ch" min="1"></label>
          </div>
          <div class="ed-row"><button data-act="all">Select all</button><span class="ed-hint">Drag on the image to draw a new crop</span></div>
        </section>
        <section>
          <h3>Output size</h3>
          <div class="ed-grid3">
            <label>Width<input type="number" data-k="ow" min="1" step="any"></label>
            <label>Height<input type="number" data-k="oh" min="1" step="any"></label>
            <label>Unit<select data-k="unit"><option value="px">pixels</option><option value="mm">mm</option><option value="cm">cm</option><option value="in">inches</option></select></label>
          </div>
          <label class="ed-check"><input type="checkbox" data-k="lock" checked> Keep proportions</label>
          <label>Resolution (DPI)<input type="number" data-k="dpi" min="1" list="ed-dpis"></label>
          <datalist id="ed-dpis"><option value="72"><option value="96"><option value="150"><option value="300"><option value="600"></datalist>
          <div class="ed-row">
            <button data-pct="25">25%</button><button data-pct="50">50%</button><button data-pct="100">100%</button><button data-pct="200">200%</button>
            <button data-act="print" class="ed-dvd-only">DVD print size</button>
          </div>
          <div class="ed-readout"></div>
        </section>
        <section>
          <h3>Save as</h3>
          <div class="ed-grid2">
            <label>Format<select data-k="fmt"><option value="jpg">JPG</option><option value="png">PNG</option><option value="webp">WebP</option></select></label>
            <label class="ed-q">Quality <span></span><input type="range" data-k="q" min="40" max="100" value="92"></label>
          </div>
          <button class="primary ed-export" data-act="export">Export</button>
          <div class="ed-results"></div>
        </section>
      </div>
    </div>
  </div>`;
  root.querySelector('.ed-file').textContent = file.name;
  const q = (s) => root.querySelector(s);
  return {
    root, q,
    canvas: q('canvas'), wrap: q('.ed-wrap'), stage: q('.ed-stage'), crop: q('.ed-crop'),
    guides: q('.ed-guides'), labels: q('.ed-labels'), status: q('.ed-status'), readout: q('.ed-readout'),
    results: q('.ed-results'), k: (k) => root.querySelector(`[data-k="${k}"]`),
  };
}

class Editor {
  constructor(file, img, ui) {
    Object.assign(this, { file, img, ui });
    this.W = img.width; this.H = img.height;
    this.ratio = null; this.aspect = 'free';
    this.crop = { x: 0, y: 0, w: this.W, h: this.H };
    this.out = { w: this.W, h: this.H }; this.manual = false;
    this.unit = 'px'; this.dpi = 300; this.urls = [];
    const e = ext(file.name);
    ui.k('fmt').value = e === 'png' ? 'png' : e === 'webp' ? 'webp' : 'jpg';
    ui.k('dpi').value = this.dpi;
    this.bind();
    this.layout();
    this.sync();
  }

  // ----- events -----
  bind() {
    const { ui } = this;
    this.onKey = (e) => { if (e.key === 'Escape') this.close(); };
    this.onResize = () => { this.layout(); this.sync(); };
    addEventListener('keydown', this.onKey);
    addEventListener('resize', this.onResize);
    ui.root.addEventListener('click', (e) => {
      if (e.target === ui.root) return this.close();
      const b = e.target.closest('button'); if (!b) return;
      const act = b.dataset.act, pct = b.dataset.pct;
      if (act === 'close') this.close();
      if (act === 'rotl' || act === 'rotr') this.rotate(act === 'rotr' ? 1 : -1);
      if (act === 'all') { this.setAspect(this.aspect, true); }
      if (act === 'export') this.export();
      if (act === 'print') this.printSize();
      if (pct) { this.manual = true; this.out = { w: Math.max(1, Math.round(this.crop.w * pct / 100)), h: Math.max(1, Math.round(this.crop.h * pct / 100)) }; this.sync(); }
    });
    ui.k('aspect').onchange = (e) => this.setAspect(e.target.value);
    ui.k('split').onchange = () => this.sync();
    for (const k of ['cx', 'cy', 'cw', 'ch']) ui.k(k).onchange = () => this.cropFromInputs(k);
    ui.k('ow').oninput = () => this.sizeFromInputs('w');
    ui.k('oh').oninput = () => this.sizeFromInputs('h');
    ui.k('ow').onchange = ui.k('oh').onchange = () => this.sync();
    ui.k('unit').onchange = (e) => { this.unit = e.target.value; this.sync(); };
    ui.k('lock').onchange = (e) => { if (e.target.checked) { this.out.h = Math.max(1, Math.round(this.out.w * this.crop.h / this.crop.w)); } this.sync(); };
    ui.k('dpi').onchange = (e) => {
      const d = Math.max(1, +e.target.value || 300);
      if (this.unit !== 'px') { // keep physical size, change pixel count
        this.out = { w: Math.round(this.out.w / this.dpi * d), h: Math.round(this.out.h / this.dpi * d) };
        this.manual = true;
      }
      this.dpi = d; this.sync();
    };
    ui.k('fmt').onchange = () => this.sync();
    ui.k('q').oninput = () => this.sync();
    ui.wrap.addEventListener('pointerdown', (e) => this.pointerDown(e));
  }

  close() {
    removeEventListener('keydown', this.onKey);
    removeEventListener('resize', this.onResize);
    this.urls.forEach(URL.revokeObjectURL);
    this.ui.root.remove();
    document.body.style.overflow = '';
    open = null;
  }

  // ----- stage drawing -----
  layout() {
    const { stage, canvas, wrap } = this.ui;
    const aw = stage.clientWidth - 32, ah = stage.clientHeight - 32;
    this.scale = Math.min(aw / this.W, ah / this.H);
    const dw = Math.max(1, Math.round(this.W * this.scale)), dh = Math.max(1, Math.round(this.H * this.scale));
    const dpr = devicePixelRatio || 1;
    canvas.width = dw * dpr; canvas.height = dh * dpr;
    canvas.style.width = dw + 'px'; canvas.style.height = dh + 'px';
    wrap.style.width = dw + 'px'; wrap.style.height = dh + 'px';
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.img, 0, 0, canvas.width, canvas.height);
  }

  rotate(dir) {
    const c = document.createElement('canvas');
    c.width = this.H; c.height = this.W;
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(dir * Math.PI / 2);
    ctx.drawImage(this.img, -this.W / 2, -this.H / 2);
    this.img = c; this.W = c.width; this.H = c.height;
    this.manual = false;
    this.layout();
    this.setAspect(this.aspect, true);
  }

  // ----- crop logic (all in source pixels) -----
  ratioFor(a) {
    const r = ASPECTS.find(([v]) => v === a)[2];
    return r === 'orig' ? this.W / this.H : r;
  }

  setAspect(a, full = false) {
    this.aspect = a; this.ui.k('aspect').value = a;
    this.ratio = this.ratioFor(a);
    const { W, H } = this;
    if (!this.ratio) { if (full) this.crop = { x: 0, y: 0, w: W, h: H }; }
    else {
      // largest rect of this shape, centred on the current crop
      const w = Math.min(W, H * this.ratio), h = w / this.ratio;
      const cx = full ? W / 2 : this.crop.x + this.crop.w / 2, cy = full ? H / 2 : this.crop.y + this.crop.h / 2;
      this.crop = this.clampPos({ x: cx - w / 2, y: cy - h / 2, w, h });
    }
    this.afterCrop();
  }

  clampPos(r) {
    r.w = Math.min(r.w, this.W); r.h = Math.min(r.h, this.H);
    r.x = Math.min(Math.max(0, r.x), this.W - r.w);
    r.y = Math.min(Math.max(0, r.y), this.H - r.h);
    return r;
  }

  pointerDown(e) {
    e.preventDefault();
    const s = this.scale, rect = this.ui.wrap.getBoundingClientRect();
    const pt = (ev) => ({ x: Math.min(this.W, Math.max(0, (ev.clientX - rect.left) / s)), y: Math.min(this.H, Math.max(0, (ev.clientY - rect.top) / s)) });
    const p0 = pt(e), c0 = { ...this.crop };
    const h = e.target.dataset?.h;
    const inside = p0.x > c0.x && p0.x < c0.x + c0.w && p0.y > c0.y && p0.y < c0.y + c0.h;
    const mode = h ? 'resize' : inside && e.target.closest('.ed-crop') ? 'move' : 'draw';
    const minS = 12 / s;

    const move = (ev) => {
      const p = pt(ev);
      if (mode === 'move') {
        this.crop = this.clampPos({ ...c0, x: c0.x + p.x - p0.x, y: c0.y + p.y - p0.y });
      } else if (mode === 'draw') {
        this.crop = this.corner(p0.x, p0.y, p.x, p.y, null, null, minS);
      } else if (h.length === 2) {
        const ax = h.includes('w') ? c0.x + c0.w : c0.x, ay = h.includes('n') ? c0.y + c0.h : c0.y;
        this.crop = this.corner(ax, ay, p.x, p.y, h.includes('w') ? -1 : 1, h.includes('n') ? -1 : 1, minS);
      } else {
        this.crop = this.edge(h, c0, p, minS);
      }
      this.afterCrop();
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  corner(ax, ay, px, py, sx, sy, minS) {
    sx ??= px >= ax ? 1 : -1; sy ??= py >= ay ? 1 : -1;
    let w = Math.max(minS, (px - ax) * sx), h = Math.max(minS, (py - ay) * sy);
    const maxW = sx > 0 ? this.W - ax : ax, maxH = sy > 0 ? this.H - ay : ay;
    if (this.ratio) {
      if (w / h > this.ratio) h = w / this.ratio; else w = h * this.ratio;
      const f = Math.min(1, maxW / w, maxH / h); w *= f; h *= f;
    } else { w = Math.min(w, maxW); h = Math.min(h, maxH); }
    return { x: sx > 0 ? ax : ax - w, y: sy > 0 ? ay : ay - h, w, h };
  }

  edge(h, c0, p, minS) {
    const r = { ...c0 }, R = this.ratio;
    if (h === 'e' || h === 'w') {
      const ax = h === 'e' ? c0.x : c0.x + c0.w;
      r.w = h === 'e' ? Math.min(this.W - ax, Math.max(minS, p.x - ax)) : Math.min(ax, Math.max(minS, ax - p.x));
      if (R) {
        const cy = c0.y + c0.h / 2, maxH = 2 * Math.min(cy, this.H - cy);
        r.h = r.w / R; if (r.h > maxH) { r.h = maxH; r.w = r.h * R; }
        r.y = cy - r.h / 2;
      }
      r.x = h === 'e' ? ax : ax - r.w;
    } else {
      const ay = h === 's' ? c0.y : c0.y + c0.h;
      r.h = h === 's' ? Math.min(this.H - ay, Math.max(minS, p.y - ay)) : Math.min(ay, Math.max(minS, ay - p.y));
      if (R) {
        const cx = c0.x + c0.w / 2, maxW = 2 * Math.min(cx, this.W - cx);
        r.w = r.h * R; if (r.w > maxW) { r.w = maxW; r.h = r.w / R; }
        r.x = cx - r.w / 2;
      }
      r.y = h === 's' ? ay : ay - r.h;
    }
    return r;
  }

  cropFromInputs(k) {
    const v = (x) => Math.max(0, +this.ui.k(x).value || 0);
    const r = { x: v('cx'), y: v('cy'), w: Math.max(1, v('cw')), h: Math.max(1, v('ch')) };
    if (this.ratio) { if (k === 'ch') r.w = r.h * this.ratio; else r.h = r.w / this.ratio; }
    if (r.w > this.W || r.h > this.H) { const f = Math.min(this.W / r.w, this.H / r.h); r.w *= f; r.h *= f; }
    this.crop = this.clampPos(r);
    this.afterCrop();
  }

  afterCrop() {
    if (!this.manual) this.out = { w: Math.max(1, Math.round(this.crop.w)), h: Math.max(1, Math.round(this.crop.h)) };
    else if (this.ui.k('lock').checked) this.out.h = Math.max(1, Math.round(this.out.w * this.crop.h / this.crop.w));
    this.sync();
  }

  // ----- output size -----
  // how many of this unit make an inch (px handled separately)
  perInch() { return { mm: 25.4, cm: 2.54, in: 1 }[this.unit]; }
  toUnit(px) { return this.unit === 'px' ? px : px / this.dpi * this.perInch(); }
  fromUnit(v) { return this.unit === 'px' ? v : v / this.perInch() * this.dpi; }

  sizeFromInputs(which) {
    const val = +this.ui.k(which === 'w' ? 'ow' : 'oh').value;
    if (!(val > 0)) return;
    this.manual = true;
    const px = Math.max(1, Math.round(this.fromUnit(val)));
    const lock = this.ui.k('lock').checked, r = this.crop.w / this.crop.h;
    if (which === 'w') { this.out.w = px; if (lock) this.out.h = Math.max(1, Math.round(px / r)); }
    else { this.out.h = px; if (lock) this.out.w = Math.max(1, Math.round(px * r)); }
    this.sync(which);
  }

  printSize() {
    const wmm = this.aspect === 'dvdw' ? DVD.wrap : DVD.panel;
    this.manual = true; this.unit = 'mm';
    this.out = { w: Math.round(wmm / 25.4 * this.dpi), h: Math.round(DVD.height / 25.4 * this.dpi) };
    this.sync();
  }

  // ----- render UI from state -----
  sync(editing) {
    const { ui, crop: c, scale: s, out } = this;
    Object.assign(ui.crop.style, { left: c.x * s + 'px', top: c.y * s + 'px', width: c.w * s + 'px', height: c.h * s + 'px' });
    const dvd = this.aspect === 'dvdw' || this.aspect === 'dvdf';
    ui.root.classList.toggle('dvd', dvd);
    ui.root.querySelector('label.ed-dvd-only').style.display = this.aspect === 'dvdw' ? '' : 'none';
    const split = this.aspect === 'dvdw';
    ui.guides.innerHTML = split
      ? [DVD.panel, DVD.panel + DVD.spine].map((mm) => `<b style="left:${mm / DVD.wrap * 100}%"></b>`).join('')
      : '<b class="t" style="left:33.33%"></b><b class="t" style="left:66.66%"></b><b class="t h" style="top:33.33%"></b><b class="t h" style="top:66.66%"></b>';
    ui.labels.innerHTML = split
      ? `<span style="left:0;width:${DVD.panel / DVD.wrap * 100}%">BACK</span><span style="left:${(DVD.panel + DVD.spine) / DVD.wrap * 100}%;width:${DVD.panel / DVD.wrap * 100}%">FRONT</span>`
      : '';

    for (const [k, v] of [['cx', c.x], ['cy', c.y], ['cw', c.w], ['ch', c.h]]) if (document.activeElement !== ui.k(k)) ui.k(k).value = Math.round(v);
    ui.k('unit').value = this.unit;
    const dec = { px: 0, mm: 1, cm: 2, in: 2 }[this.unit];
    const fmtU = (px) => +this.toUnit(px).toFixed(dec);
    if (editing !== 'w') ui.k('ow').value = fmtU(out.w);
    if (editing !== 'h') ui.k('oh').value = fmtU(out.h);
    ui.k('dpi').value = this.dpi;

    const fmt = ui.k('fmt').value;
    const qLabel = ui.root.querySelector('.ed-q');
    qLabel.style.visibility = fmt === 'png' ? 'hidden' : '';
    qLabel.querySelector('span').textContent = ui.k('q').value;

    const cm = (px) => (px / this.dpi * 2.54).toFixed(2), inch = (px) => (px / this.dpi).toFixed(2);
    const up = out.w > c.w * 1.01 || out.h > c.h * 1.01;
    ui.readout.innerHTML =
      `<div><b>${out.w} × ${out.h} px</b> from a ${Math.round(c.w)} × ${Math.round(c.h)} px crop</div>` +
      `<div>Prints at ${cm(out.w)} × ${cm(out.h)} cm (${inch(out.w)} × ${inch(out.h)} in) at ${this.dpi} dpi</div>` +
      (up ? `<div class="warn">Enlarging past the original pixels; the result may look soft.</div>` : '') +
      (fmt === 'webp' ? `<div class="note">WebP files don't store DPI. Use JPG or PNG for print.</div>` : '');
  }

  // ----- export -----
  async export() {
    const { ui, crop: c, out } = this;
    const btn = ui.root.querySelector('.ed-export');
    btn.disabled = true; btn.textContent = 'Exporting…';
    const fmt = ui.k('fmt').value, quality = +ui.k('q').value / 100;
    const base = this.file.name.replace(/\.[^.]+$/, '') || 'image';
    const parts = this.aspect === 'dvdw' && ui.k('split').checked
      ? [['back', 0, DVD.panel], ['spine', DVD.panel, DVD.spine], ['front', DVD.panel + DVD.spine, DVD.panel]].map(([n, a, w]) => ({ name: `${base}-${n}`, f0: a / DVD.wrap, f1: (a + w) / DVD.wrap }))
      : [{ name: `${base}-${out.w}x${out.h}`, f0: 0, f1: 1 }];
    this.urls.forEach(URL.revokeObjectURL); this.urls = [];
    ui.results.innerHTML = '';
    try {
      for (const p of parts) {
        const sx = c.x + c.w * p.f0, sw = c.w * (p.f1 - p.f0);
        const ox0 = Math.round(out.w * p.f0), ow = Math.max(1, Math.round(out.w * p.f1) - ox0);
        let blob = await render(this.img, sx, c.y, sw, c.h, ow, out.h, fmt, quality);
        blob = await setDpi(blob, fmt, this.dpi);
        const url = URL.createObjectURL(blob); this.urls.push(url);
        const row = el('div', { class: 'ed-res' });
        row.innerHTML = `<span class="n"></span><span class="m">${ow}×${out.h} · ${fmtBytes(blob.size)}</span><a download href="${url}">Download</a>`;
        row.querySelector('.n').textContent = `${p.name}.${fmt}`;
        row.querySelector('a').download = `${p.name}.${fmt}`;
        ui.results.append(row);
      }
    } catch (e) {
      ui.results.innerHTML = `<div class="warn">Export failed: ${e.message || e}</div>`;
    }
    btn.disabled = false; btn.textContent = 'Export';
  }
}

// High-quality resample: halve repeatedly when shrinking a lot, then a final pass.
async function render(img, sx, sy, sw, sh, ow, oh, fmt, quality) {
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; return [c, x]; };
  let src = img;
  while (sw / 2 >= ow && sh / 2 >= oh) {
    const [c, x] = mk(Math.max(1, Math.round(sw / 2)), Math.max(1, Math.round(sh / 2)));
    x.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    src = c; sx = 0; sy = 0; sw = c.width; sh = c.height;
  }
  const [c, x] = mk(ow, oh);
  if (fmt === 'jpg') { x.fillStyle = '#fff'; x.fillRect(0, 0, ow, oh); }
  x.drawImage(src, sx, sy, sw, sh, 0, 0, ow, oh);
  const blob = await new Promise((res) => c.toBlob(res, MIME[fmt], quality));
  if (!blob) throw new Error('image too large for this browser');
  return blob;
}

// ----- DPI metadata -----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

async function setDpi(blob, fmt, dpi) {
  const b = new Uint8Array(await blob.arrayBuffer());
  if (fmt === 'png') {
    const ppm = Math.round(dpi / 0.0254);
    const chunk = new Uint8Array(21), v = new DataView(chunk.buffer);
    v.setUint32(0, 9); chunk.set([112, 72, 89, 115], 4); // "pHYs"
    v.setUint32(8, ppm); v.setUint32(12, ppm); chunk[16] = 1;
    v.setUint32(17, crc32(chunk.subarray(4, 17)));
    const at = 33; // after signature (8) + IHDR chunk (25)
    return new Blob([b.subarray(0, at), chunk, b.subarray(at)], { type: blob.type });
  }
  if (fmt === 'jpg') {
    const isJfif = b[2] === 0xff && b[3] === 0xe0 && String.fromCharCode(...b.subarray(6, 10)) === 'JFIF';
    if (isJfif) { b[13] = 1; b[14] = dpi >> 8; b[15] = dpi & 255; b[16] = dpi >> 8; b[17] = dpi & 255; return new Blob([b], { type: blob.type }); }
    const app0 = new Uint8Array([0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 1, dpi >> 8, dpi & 255, dpi >> 8, dpi & 255, 0, 0]);
    return new Blob([b.subarray(0, 2), app0, b.subarray(2)], { type: blob.type });
  }
  return blob;
}

const ext = (n) => (n.split('.').pop() || '').toLowerCase();
const fmtBytes = (x) => x < 1048576 ? (x / 1024).toFixed(0) + ' KB' : (x / 1048576).toFixed(1) + ' MB';
