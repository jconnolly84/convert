// Word (.docx) and PowerPoint (.pptx) → PDF, entirely in the browser.
// The document is laid out as HTML (docx-preview / pptx-preview), each page is
// captured to an image (html2canvas-pro) and the images become PDF pages (jsPDF).
// Text in the PDF is therefore not selectable — it's a faithful picture of each page.

export const OFFICE_FORMATS = ['pdf'];
export const OFFICE_QUALITY = ['high', 'medium', 'small'];
const SCALE = { high: 2.5, medium: 2, small: 1.25 };      // 1 = 96 dpi
const JPEG_Q = { high: 0.92, medium: 0.85, small: 0.75 };

export const officeKind = (name) => {
  const e = (name.split('.').pop() || '').toLowerCase();
  return e === 'docx' || e === 'docm' ? 'docx' : e === 'pptx' || e === 'pptm' ? 'pptx' : null;
};

const loadScript = (src) => new Promise((ok, fail) => {
  const s = document.createElement('script');
  s.src = src; s.onload = ok; s.onerror = () => fail(new Error('could not load ' + src.split('/').pop()));
  document.head.append(s);
});
let libs = null;
function loadLibs() {
  return libs ||= Promise.all([
    window.html2canvas || loadScript('./vendor/html2canvas/html2canvas-pro.min.js'),
    window.jspdf || loadScript('./vendor/jspdf/jspdf.umd.min.js'),
  ]).catch((e) => { libs = null; throw e; });
}

// Office's default fonts often aren't installed for the browser (e.g. Aptos), which would fall back to
// a serif. Map them to the real font if present, else the closest metric/visual match.
const FONT_ALIASES = {
  'Aptos': ['Aptos', 'Calibri', 'Carlito', 'Segoe UI', 'Helvetica Neue', 'Arial'],
  'Aptos Display': ['Aptos Display', 'Calibri Light', 'Calibri', 'Segoe UI Light', 'Helvetica Neue', 'Arial'],
  'Aptos Narrow': ['Aptos Narrow', 'Arial Narrow', 'Calibri', 'Arial'],
  'Calibri': ['Calibri', 'Carlito', 'Segoe UI', 'Helvetica Neue', 'Arial'],
  'Calibri Light': ['Calibri Light', 'Calibri', 'Carlito', 'Segoe UI Light', 'Helvetica Neue', 'Arial'],
  'Cambria': ['Cambria', 'Caladea', 'Georgia', 'Times New Roman'],
  'Segoe UI': ['Segoe UI', 'Helvetica Neue', 'Arial'],
};
let fontsAdded = false;
function addFontAliases() {
  if (fontsAdded) return; fontsAdded = true;
  const css = Object.entries(FONT_ALIASES).flatMap(([name, list]) => [400, 700].map((wt) =>
    `@font-face{font-family:"${name}";font-weight:${wt};src:${list.map((f) => `local("${f}${wt === 700 ? ' Bold' : ''}"),local("${f}")`).join(',')};}`)).join('\n');
  const s = document.createElement('style'); s.textContent = css; document.head.append(s);
}

// Off-screen stage the document is laid out in. It must be rendered (not display:none) to be measured.
function makeStage() {
  addFontAliases();
  const stage = document.createElement('div');
  // all:initial stops the site's own font and colours leaking into the document
  stage.style.cssText = 'all:initial;display:block;position:fixed;left:-30000px;top:0;background:#fff;color:#000;pointer-events:none;';
  document.body.append(stage);
  return stage;
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
async function waitForAssets(root) {
  await document.fonts?.ready;
  await Promise.all([...root.querySelectorAll('img')].map((img) => img.complete ? 0 : new Promise((r) => { img.onload = img.onerror = r; })));
  await nextFrame();
}

const capture = (el, scale) => window.html2canvas(el, {
  scale, backgroundColor: '#ffffff', logging: false, useCORS: true,
  width: el.offsetWidth, height: el.scrollHeight, windowWidth: el.offsetWidth + 100,
});

// Find a row near `target` (searching upward) that is blank, so a page cut doesn't slice through a line of text.
function quietRow(ctx, w, target, minY) {
  const step = Math.max(1, Math.round(w / 400));
  for (let y = target; y > minY; y--) {
    const row = ctx.getImageData(0, y, w, 1).data;
    let ink = 0;
    for (let x = 0; x < w; x += step) { const i = x * 4; if (row[i] + row[i + 1] + row[i + 2] < 720) ink++; }
    if (ink === 0) return y;
  }
  return target;
}

// Split one tall canvas into pages (used when a Word section runs over several pages and the file
// carries no page-break hints). Each page keeps the document's top and bottom margins.
function slicePages(canvas, pageH, top, bottom) {
  if (canvas.height <= pageH * 1.02) return [canvas];
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const body = pageH - top - bottom;                         // printable height per page
  const out = [];
  // the first page's slice includes its top margin (and any header) from the source
  for (let y = 0, first = true; y < canvas.height - bottom - 2; first = false) {
    const dest = first ? 0 : top;
    let end = Math.min(canvas.height, y + pageH - dest - bottom);
    if (end < canvas.height - bottom) end = quietRow(ctx, canvas.width, end, y + (pageH - dest - bottom) * 0.75);
    else end = canvas.height;
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = pageH;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(canvas, 0, y, canvas.width, end - y, 0, dest, canvas.width, end - y);
    out.push(c); y = end;
    if (body <= 0) break;
  }
  return out;
}

function addPage(pdf, canvas, wPt, hPt, q, first) {
  if (!first) pdf.addPage([wPt, hPt], wPt > hPt ? 'l' : 'p');
  pdf.addImage(canvas.toDataURL('image/jpeg', JPEG_Q[q]), 'JPEG', 0, 0, wPt, hPt, undefined, 'FAST');
}

// ---------- Word ----------
async function docxPages(buf, stage, onProgress) {
  const { renderAsync } = await import('./vendor/docx-preview/docx-preview.min.mjs');
  const style = document.createElement('div'); stage.append(style);
  const body = document.createElement('div'); stage.append(body);
  await renderAsync(buf, body, style, {
    inWrapper: false, breakPages: true, ignoreLastRenderedPageBreak: false,
    ignoreWidth: false, ignoreHeight: false, renderHeaders: true, renderFooters: true,
    renderFootnotes: true, renderEndnotes: true, useBase64URL: true, experimental: true,
  });
  onProgress(0.15, 'laying out…');
  await waitForAssets(stage);
  const pages = [...body.querySelectorAll('section.docx')];
  if (!pages.length) throw new Error('no pages found');
  return pages.map((el) => {
    const w = el.offsetWidth;
    // docx-preview sets min-height to the page height; content can grow beyond it
    const cs = getComputedStyle(el);
    const h = parseFloat(cs.minHeight) || w * 297 / 210;
    return { el, w, h, top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
  });
}

// ---------- PowerPoint ----------
// pptx-preview is free to use but not open source, so it is loaded from the npm CDN rather than copied into this repo.
const PPTX_PREVIEW = 'https://cdn.jsdelivr.net/npm/pptx-preview@1.0.7/dist/pptx-preview.umd.js';

// The renderer ignores the slide master's <p:bodyStyle> and layout list styles, so body text loses
// its bullets, indents, spacing and sizes. Work out what each paragraph inherits (master body
// style, overridden by the layout placeholder) and write it onto the slide's own paragraphs.
const relTarget = (rels, type) => rels && new RegExp(`Type="[^"]*/${type}"[^>]*Target="\.\./([^"]+)"|Target="\.\./([^"]+)"[^>]*Type="[^"]*/${type}"`).exec(rels)?.slice(1).find(Boolean);
const SHAPES = /<p:sp>[\s\S]*?<\/p:sp>/g;
const BULLET = /<a:bu(?:None\/>|Char\b[^>]*\/>|AutoNum\b[^>]*\/>|Blip>[\s\S]*?<\/a:buBlip>)/;
const PARA_KIDS = ['lnSpc', 'spcBef', 'spcAft'];

// Per-level settings from a list style (<p:bodyStyle> or <a:lstStyle>): attributes, spacing, bullet, size.
function listLevels(xml) {
  const lv = [];
  for (const m of (xml || '').matchAll(/<a:lvl(\d)pPr\b([^>]*?)(\/>|>([\s\S]*?)<\/a:lvl\1pPr>)/g)) {
    const inner = m[4] || '';
    const L = { attrs: {}, kids: {} };
    for (const a of m[2].matchAll(/\b(marL|indent|algn)="([^"]*)"/g)) L.attrs[a[1]] = a[2];
    for (const k of PARA_KIDS) { const e = new RegExp(`<a:${k}>[\s\S]*?</a:${k}>`).exec(inner); if (e) L.kids[k] = e[0]; }
    const bu = BULLET.exec(inner); if (bu) L.bullet = bu[0];
    const bf = /<a:buFont\b[^>]*\/>/.exec(inner); if (bf) L.buFont = bf[0];
    const sz = /<a:defRPr\b[^>]*\bsz="(\d+)"/.exec(inner); if (sz) L.sz = +sz[1];
    lv[+m[1] - 1] = L;
  }
  return lv;
}
function mergeLevels(base, over) {
  return base.map((b, i) => {
    const o = over[i]; if (!o) return b;
    return { attrs: { ...b.attrs, ...o.attrs }, kids: { ...b.kids, ...o.kids },
      bullet: o.bullet || b.bullet, buFont: o.bullet ? o.buFont : (b.buFont || o.buFont), sz: o.sz || b.sz };
  });
}
function placeholderOf(xml, idx, type) {
  for (const sp of (xml || '').match(SHAPES) || []) {
    const ph = /<p:ph\b([^>]*)\/?>/.exec(sp);
    if (!ph) continue;
    const pIdx = /idx="(\d+)"/.exec(ph[1])?.[1], pType = /type="(\w+)"/.exec(ph[1])?.[1];
    if ((idx != null && pIdx === idx) || (idx == null && pType === type)) return sp;
  }
}

async function fixBodyText(zip) {
  const read = (p) => zip.file(p)?.async('string');
  const cache = {};
  const load = async (p) => (cache[p] ??= await read(p) || '');
  for (const f of zip.file(/^ppt\/slides\/slide\d+\.xml$/)) {
    const layout = relTarget(await read(f.name.replace('slides/', 'slides/_rels/') + '.rels'), 'slideLayout');
    const master = layout && relTarget(await read('ppt/' + layout.replace('slideLayouts/', 'slideLayouts/_rels/') + '.rels'), 'slideMaster');
    if (!master) continue;
    const layoutXml = await load('ppt/' + layout), masterXml = await load('ppt/' + master);
    const masterBody = listLevels(/<p:bodyStyle>([\s\S]*?)<\/p:bodyStyle>/.exec(masterXml)?.[1]);
    const masterBodySp = placeholderOf(masterXml, null, 'body') || '';
    const x = await f.async('string');
    const out = x.replace(SHAPES, (sp) => {
      const ph = /<p:ph\b([^>]*)\/?>/.exec(sp);
      const type = ph && /type="(\w+)"/.exec(ph[1])?.[1];
      if (!ph || (type && type !== 'body' && type !== 'obj')) return sp;
      const idx = /idx="(\d+)"/.exec(ph[1])?.[1];
      const layoutSp = placeholderOf(layoutXml, idx, type || 'body') || '';
      const levels = mergeLevels(masterBody, listLevels(/<a:lstStyle>([\s\S]*?)<\/a:lstStyle>/.exec(layoutSp)?.[1]));
      // vertical anchor: the slide's own, else the layout's, else the master's, else top
      if (!/<a:bodyPr\b[^>]*\banchor=/.test(sp)) {
        const anchor = [layoutSp, masterBodySp].map((s) => /<a:bodyPr\b[^>]*\banchor="(\w+)"/.exec(s)?.[1]).find(Boolean) || 't';
        sp = sp.replace(/<a:bodyPr\b/, `<a:bodyPr anchor="${anchor}"`);
      }
      return sp.replace(/<a:p>[\s\S]*?<\/a:p>/g, (p) => {
        const lvl = +(/<a:pPr[^>]*\blvl="(\d)"/.exec(p)?.[1] || 0);
        const L = levels[lvl] || levels[0];
        if (!L) return p;
        // paragraph properties: add what the slide doesn't set itself
        const m = /<a:pPr\b([^>]*?)(\/>|>([\s\S]*?)<\/a:pPr>)/.exec(p);
        let attrs = m ? m[1] : '', inner = m ? (m[3] || '') : '';
        for (const [k, v] of Object.entries(L.attrs)) if (!new RegExp(`\b${k}=`).test(attrs)) attrs += ` ${k}="${v}"`;
        let add = PARA_KIDS.filter((k) => L.kids[k] && !inner.includes(`<a:${k}>`)).map((k) => L.kids[k]).join('');
        if (!BULLET.test(inner) && L.bullet) add += (L.buFont && !inner.includes('<a:buFont') ? L.buFont : '') + L.bullet;
        const pPr = `<a:pPr${attrs}>${add}${inner}</a:pPr>`;
        p = m ? p.replace(m[0], pPr) : p.replace('<a:p>', '<a:p>' + pPr);
        if (!L.sz) return p;
        // run size (the renderer applies any autofit shrink itself)
        return p.replace(/<a:(rPr|endParaRPr)\b(?![^>]*\bsz=)/g, `<a:$1 sz="${L.sz}"`)
          .replace(/<a:r>\s*<a:t>/g, `<a:r><a:rPr sz="${L.sz}"/><a:t>`);
      });
    });
    if (out !== x) zip.file(f.name, out);
  }
}

// Read the slide size, and tidy the package index so the renderer doesn't give up on files
// PowerPoint itself tolerates (e.g. entries for parts that don't exist, stray whitespace).
async function preparePptx(buf) {
  const zip = await window.JSZip.loadAsync(buf);
  const ctName = '[Content_Types].xml';
  const ct = await zip.file(ctName)?.async('string');
  if (!ct) throw new Error('not a valid .pptx file');
  const clean = ct.replace(/>\s+</g, '><').replace(/<Override\b[^>]*PartName="\/([^"]+)"[^>]*\/>/g, (tag, part) => zip.file(part) ? tag : '');
  zip.file(ctName, clean);
  await fixBodyText(zip);
  // Theme fonts: the renderer leaves text unstyled, so use the theme's body font as the default.
  const theme = await zip.file(/^ppt\/theme\/theme\d+\.xml$/)[0]?.async('string');
  const font = theme && /<a:minorFont>\s*<a:latin typeface="([^"]+)"/.exec(theme)?.[1];
  const xml = await zip.file('ppt/presentation.xml')?.async('string');
  const m = xml && /<p:sldSz[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/.exec(xml);
  const EMU_PX = 9525;                                   // 914400 EMU per inch / 96 px
  const size = m ? { w: Math.round(+m[1] / EMU_PX), h: Math.round(+m[2] / EMU_PX) } : { w: 960, h: 540 };
  return { ...size, font, buf: await zip.generateAsync({ type: 'arraybuffer' }) };
}

const fontStack = (name) => [...new Set([...(name ? FONT_ALIASES[name] || [name] : []), 'Calibri', 'Carlito', 'Helvetica Neue', 'Arial'])]
  .map((f) => `"${f}"`).join(',') + ',sans-serif';

async function pptxPages(raw, stage, onProgress) {
  const { w, h, buf, font } = await preparePptx(raw);
  if (!window.pptxPreview) {
    try { await loadScript(PPTX_PREVIEW); } catch { throw new Error('PowerPoint engine needs internet'); }
  }
  const host = document.createElement('div'); host.style.width = w + 'px'; host.style.fontFamily = fontStack(font);
  stage.append(host);
  const viewer = window.pptxPreview.init(host, { width: w, height: h, mode: 'list' });
  await viewer.preview(buf);
  onProgress(0.15, 'laying out…');
  await waitForAssets(stage);
  const slides = [...host.querySelectorAll('.pptx-preview-slide-wrapper')];
  if (!slides.length) throw new Error('no slides found');
  slides.forEach((s) => { s.style.margin = '0'; s.style.boxShadow = 'none'; });
  return slides.map((el) => ({ el, w, h, fixed: true }));
}

// ---------- Entry point ----------
export async function convertOffice(file, { q = 'high' }, onProgress = () => {}) {
  const kind = officeKind(file.name);
  if (!kind) throw new Error('unsupported Office file');
  onProgress(0.02, 'loading…');
  await loadLibs();
  const buf = await file.arrayBuffer();
  const stage = makeStage();
  try {
    const pages = kind === 'docx' ? await docxPages(buf, stage, onProgress) : await pptxPages(buf, stage, onProgress);
    const scale = SCALE[q] || 2;
    const { jsPDF } = window.jspdf;
    let pdf = null, n = 0;
    for (let i = 0; i < pages.length; i++) {
      const { el, w, h, fixed, top = 0, bottom = 0 } = pages[i];
      onProgress(0.15 + 0.8 * i / pages.length, `page ${i + 1} of ${pages.length}`);
      const canvas = await capture(el, scale);
      const parts = fixed ? [canvas] : slicePages(canvas, Math.round(h * scale), Math.round(top * scale), Math.round(bottom * scale));
      const wPt = w * 0.75, hPt = h * 0.75;                     // CSS px → PDF points
      for (const part of parts) {
        if (!pdf) pdf = new jsPDF({ unit: 'pt', format: [wPt, hPt], orientation: wPt > hPt ? 'l' : 'p', compress: true });
        addPage(pdf, part, wPt, hPt, q, n++ === 0);
      }
    }
    onProgress(0.97, 'saving…');
    const base = file.name.replace(/\.[^.]+$/, '') || 'document';
    return { blob: pdf.output('blob'), name: base + '.pdf', pages: n };
  } finally {
    stage.remove();
  }
}
