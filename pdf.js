// PDF conversions: pages -> images (zipped), DOCX (editable text or exact look), PPTX (one slide per page).
// Uses pdf.js for reading/rendering; docx, PptxGenJS and JSZip are loaded as globals from index.html.
import * as pdfjs from './vendor/pdfjs/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.mjs';

export const PDF_FORMATS = ['png', 'jpg', 'webp', 'docx (editable text)', 'docx (exact look)', 'pptx'];
export const PDF_DPI = ['150', '300', '72'];

export async function pdfInfo(file) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const n = doc.numPages; doc.destroy();
  return { pages: n };
}

// "1-3, 5, 8-" -> [1,2,3,5,8,...]; empty/"all" -> every page
export function parsePages(spec, total) {
  spec = (spec || '').trim().toLowerCase();
  if (!spec || spec === 'all') return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set();
  for (const part of spec.split(',')) {
    const m = part.trim().match(/^(\d*)\s*(?:-\s*(\d*))?$/);
    if (!m || (!m[1] && !m[2])) throw new Error(`can't read page range "${part.trim()}"`);
    const a = m[1] ? +m[1] : 1, b = part.includes('-') ? (m[2] ? +m[2] : total) : a;
    for (let p = Math.max(1, a); p <= Math.min(total, b); p++) set.add(p);
  }
  if (!set.size) throw new Error('no pages in that range');
  return [...set].sort((x, y) => x - y);
}

async function renderPage(page, dpi, mime, quality) {
  const vp = page.getViewport({ scale: dpi / 72 });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  if (c.width * c.height > 16e7) throw new Error('page too large at this DPI; pick a lower one');
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); // PDFs assume a white page
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const blob = await new Promise((r) => c.toBlob(r, mime, quality));
  c.width = c.height = 0; // free memory early
  return blob;
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

/**
 * Convert a PDF. onProgress(0..1, label). Returns { blob, name }.
 */
export async function convertPdf(file, { fmt, dpi, pages: spec }, onProgress) {
  const base = file.name.replace(/\.[^.]+$/, '') || 'document';
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  try {
    const pages = parsePages(spec, doc.numPages);
    const step = (i, what) => onProgress(i / pages.length, `${what} ${i + 1}/${pages.length}`);
    dpi = +dpi;

    if (MIME[fmt]) {
      const files = [];
      for (const [i, p] of pages.entries()) {
        step(i, 'page');
        const page = await doc.getPage(p);
        files.push({ name: `${base}-p${String(p).padStart(3, '0')}.${fmt}`, blob: await renderPage(page, dpi, MIME[fmt], 0.92) });
        page.cleanup();
      }
      if (files.length === 1) return files[0];
      const zip = new JSZip();
      files.forEach((f) => zip.file(f.name, f.blob));
      onProgress(0.99, 'zipping');
      return { name: `${base}-pages.zip`, blob: await zip.generateAsync({ type: 'blob' }) };
    }

    if (fmt === 'pptx') {
      const first = (await doc.getPage(pages[0])).getViewport({ scale: 1 });
      const pptx = new PptxGenJS();
      pptx.defineLayout({ name: 'PDF', width: first.width / 72, height: first.height / 72 });
      pptx.layout = 'PDF';
      for (const [i, p] of pages.entries()) {
        step(i, 'slide');
        const page = await doc.getPage(p);
        const vp = page.getViewport({ scale: 1 });
        const data = await blobToDataURL(await renderPage(page, dpi, 'image/jpeg', 0.9));
        // fit the page into the slide (pages can differ in size)
        const sw = first.width / 72, sh = first.height / 72, pw = vp.width / 72, ph = vp.height / 72;
        const f = Math.min(sw / pw, sh / ph);
        pptx.addSlide().addImage({ data, x: (sw - pw * f) / 2, y: (sh - ph * f) / 2, w: pw * f, h: ph * f });
        page.cleanup();
      }
      onProgress(0.99, 'building pptx');
      return { name: `${base}.pptx`, blob: await pptx.write({ outputType: 'blob' }) };
    }

    if (fmt === 'docx (exact look)') {
      const sections = [];
      for (const [i, p] of pages.entries()) {
        step(i, 'page');
        const page = await doc.getPage(p);
        const vp = page.getViewport({ scale: 1 }); // points
        const png = await renderPage(page, dpi, 'image/png');
        sections.push({
          properties: { page: { size: { width: Math.round(vp.width * 20), height: Math.round(vp.height * 20) }, margin: { top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0 } } },
          children: [new docx.Paragraph({ spacing: { before: 0, after: 0, line: 240 }, children: [new docx.ImageRun({
            type: 'png', data: await png.arrayBuffer(),
            // docx sizes images in px at 96 dpi; shave a hair so Word doesn't push it to a new page
            transformation: { width: Math.floor(vp.width / 72 * 96) - 1, height: Math.floor(vp.height / 72 * 96) - 2 },
          })] })],
        });
        page.cleanup();
      }
      onProgress(0.99, 'building docx');
      return { name: `${base}.docx`, blob: await docx.Packer.toBlob(new docx.Document({ sections })) };
    }

    if (fmt === 'docx (editable text)') {
      const children = [];
      let anyText = false;
      for (const [i, p] of pages.entries()) {
        step(i, 'page');
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        const paras = textToParagraphs(tc);
        if (paras.length) anyText = true;
        if (i > 0) children.push(new docx.Paragraph({ children: [new docx.PageBreak()] }));
        for (const para of paras) {
          children.push(new docx.Paragraph({
            heading: para.heading,
            spacing: { after: 120 },
            children: [new docx.TextRun({ text: para.text, size: Math.round(para.size * 2), bold: para.bold || undefined, italics: para.italic || undefined })],
          }));
        }
        page.cleanup();
      }
      if (!anyText) throw new Error('no text found (scanned PDF?) — try "exact look"');
      onProgress(0.99, 'building docx');
      return { name: `${base}.docx`, blob: await docx.Packer.toBlob(new docx.Document({ sections: [{ children }] })) };
    }

    throw new Error('unknown format ' + fmt);
  } finally {
    doc.destroy();
  }
}

// Group pdf.js text items into lines, then lines into paragraphs; guess headings from font size.
function textToParagraphs(tc) {
  const items = tc.items.filter((it) => 'str' in it && it.str.length);
  if (!items.length) return [];
  const font = (it) => (tc.styles[it.fontName]?.fontFamily || '') + ' ' + it.fontName;
  // lines: items sharing a baseline (within 2pt), in reading order
  const lines = [];
  for (const it of items) {
    const [, , , d, x, y] = it.transform;
    const size = Math.abs(d) || Math.hypot(it.transform[2], it.transform[3]) || 10;
    let line = lines.find((l) => Math.abs(l.y - y) < Math.max(2, size * 0.3));
    if (!line) lines.push(line = { y, size: 0, parts: [] });
    line.parts.push({ x, str: it.str, w: it.width, size, font: font(it) });
    line.size = Math.max(line.size, size);
  }
  lines.sort((a, b) => b.y - a.y);
  for (const l of lines) {
    l.parts.sort((a, b) => a.x - b.x);
    let text = '', end = null;
    for (const p of l.parts) {
      if (end !== null && p.x - end > p.size * 0.15 && !text.endsWith(' ') && !p.str.startsWith(' ')) text += ' ';
      text += p.str; end = p.x + p.w;
    }
    l.text = text.replace(/\s+/g, ' ').trim();
    l.x = l.parts[0].x;
    l.bold = l.parts.every((p) => /bold|black|heavy|semibold/i.test(p.font));
    l.italic = l.parts.every((p) => /italic|oblique/i.test(p.font));
  }
  const real = lines.filter((l) => l.text);
  if (!real.length) return [];
  // body size = most common line size
  const counts = {};
  real.forEach((l) => { const k = Math.round(l.size); counts[k] = (counts[k] || 0) + l.text.length; });
  const body = +Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];

  const paras = [];
  let cur = null, prev = null;
  for (const l of real) {
    const gap = prev ? prev.y - l.y : 0;
    const newPara = !cur || Math.abs(l.size - cur.size) > 0.5 || gap > l.size * 1.7 || l.bold !== cur.bold
      || /[.!?:]$/.test(prev.text) && l.x > prev.x + l.size; // indented first line after sentence end
    if (newPara) {
      cur = { text: l.text, size: l.size, bold: l.bold, italic: l.italic };
      paras.push(cur);
    } else {
      cur.text = cur.text.endsWith('-') ? cur.text.slice(0, -1) + l.text : cur.text + ' ' + l.text;
    }
    prev = l;
  }
  for (const p of paras) {
    const r = p.size / body;
    p.heading = r > 1.6 ? docx.HeadingLevel.HEADING_1 : r > 1.3 ? docx.HeadingLevel.HEADING_2 : r > 1.12 ? docx.HeadingLevel.HEADING_3 : undefined;
  }
  return paras;
}

const blobToDataURL = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
