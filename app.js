import { FFmpeg } from './vendor/ffmpeg/index.js';
import { openEditor } from './editor.js';
import { PDF_FORMATS, PDF_DPI, pdfInfo, convertPdf } from './pdf.js';

// Decode any image to something drawable; fall back to FFmpeg for formats the browser can't read (e.g. TIFF).
async function decodeImage(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {}
  const f = await getFFmpeg();
  const inName = 'dec.' + (ext(file.name) || 'bin');
  await f.writeFile(inName, new Uint8Array(await file.arrayBuffer()));
  const code = await f.exec(['-hide_banner', '-y', '-i', inName, '-frames:v', '1', 'dec.png']);
  if (code !== 0) throw new Error('unsupported image format');
  const data = await f.readFile('dec.png');
  await f.deleteFile(inName).catch(() => {}); await f.deleteFile('dec.png').catch(() => {});
  return createImageBitmap(new Blob([data.buffer], { type: 'image/png' }));
}

// ---------- Format definitions ----------
const FORMATS = {
  image: ['png', 'jpg', 'webp', 'gif', 'bmp', 'tiff'],
  audio: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'opus'],
  video: ['mp4', 'webm', 'mov', 'gif', 'mp3 (audio only)'],
  pdf: PDF_FORMATS,
};
const QUALITY = ['high', 'medium', 'small'];
const SIZES = {
  image: ['original', '2048', '1280', '800', '400'],  // max width/height
  video: ['original', '1080', '720', '480', '360'],   // height
};
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', tiff: 'image/tiff',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4', opus: 'audio/ogg',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
};
const EXT_KIND = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'ico', 'avif', 'heic'],
  audio: ['mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'opus', 'wma', 'aiff', 'aif'],
  video: ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'wmv', 'flv', '3gp', 'mpg', 'mpeg', 'ts'],
};

const ext = (name) => (name.split('.').pop() || '').toLowerCase();
function kindOf(file) {
  if (file.type === 'application/pdf' || ext(file.name) === 'pdf') return 'pdf';
  const t = (file.type || '').split('/')[0];
  if (['image', 'audio', 'video'].includes(t)) return t;
  const e = ext(file.name);
  return Object.keys(EXT_KIND).find((k) => EXT_KIND[k].includes(e)) || null;
}
const fmtBytes = (b) => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB';

// ---------- FFmpeg engine ----------
let ffmpeg = null, loading = null, current = null;
const dot = document.getElementById('engineDot'), etext = document.getElementById('engineText');
function engineState(s, t) { dot.className = 'dot ' + s; etext.textContent = t; }

async function getFFmpeg() {
  if (ffmpeg) return ffmpeg;
  if (loading) return loading;
  engineState('loading', 'loading engine…');
  loading = (async () => {
    const f = new FFmpeg();
    f.on('progress', ({ progress }) => current?.onProgress(progress));
    f.on('log', ({ message }) => current?.onLog(message));
    const base = new URL('./vendor/ffmpeg-core/', location.href).href;
    await f.load({ coreURL: base + 'ffmpeg-core.js', wasmURL: base + 'ffmpeg-core.wasm' });
    ffmpeg = f; loading = null;
    engineState('ready', 'engine ready');
    return f;
  })().catch((e) => { loading = null; engineState('', 'engine failed to load'); throw e; });
  return loading;
}

// ---------- Argument builders ----------
function imageArgs(fmt, q, size) {
  const vf = size !== 'original' ? ['-vf', `scale='min(${size},iw)':'min(${size},ih)':force_original_aspect_ratio=decrease`] : [];
  const qv = { high: 2, medium: 5, small: 10 }[q];
  const wq = { high: 90, medium: 75, small: 50 }[q];
  const map = {
    png: ['-frames:v', '1'],
    jpg: ['-frames:v', '1', '-q:v', String(qv), '-pix_fmt', 'yuvj420p'],
    webp: ['-c:v', 'libwebp', '-quality', String(wq), '-loop', '0'],
    gif: ['-loop', '0'],
    bmp: ['-frames:v', '1'],
    tiff: ['-frames:v', '1'],
  };
  return [...vf, ...map[fmt]];
}

function audioArgs(fmt, q) {
  const br = { high: '256k', medium: '160k', small: '96k' }[q];
  const map = {
    mp3: ['-c:a', 'libmp3lame', '-b:a', br],
    wav: ['-c:a', 'pcm_s16le'],
    ogg: ['-c:a', 'libvorbis', '-q:a', { high: '7', medium: '5', small: '2' }[q]],
    flac: ['-c:a', 'flac'],
    m4a: ['-c:a', 'aac', '-b:a', br],
    opus: ['-c:a', 'libopus', '-b:a', { high: '160k', medium: '96k', small: '48k' }[q]],
  };
  return ['-vn', ...map[fmt]];
}

function videoArgs(fmt, q, size) {
  const scale = size !== 'original' ? `scale=-2:'min(${size},ih)'` : null;
  const crf = { high: 20, medium: 26, small: 32 }[q];
  const h264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k'];
  const vf = scale ? ['-vf', scale] : [];
  switch (fmt) {
    case 'mp4': return [...vf, ...h264, '-movflags', '+faststart'];
    case 'mov': return [...vf, ...h264];
    case 'webm': return [...vf, '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8',
      '-b:v', { high: '3M', medium: '1500k', small: '600k' }[q], '-c:a', 'libvorbis', '-q:a', '4'];
    case 'gif': {
      const fps = { high: 15, medium: 12, small: 8 }[q];
      const w = size !== 'original' ? `scale=-2:'min(${size},ih)':flags=lanczos` : 'scale=\'min(640,iw)\':-2:flags=lanczos';
      return ['-vf', `fps=${fps},${w},split[a][b];[a]palettegen[p];[b][p]paletteuse`, '-loop', '0'];
    }
    case 'mp3 (audio only)': return audioArgs('mp3', q);
  }
}

// ---------- Fast path: images via canvas ----------
async function canvasConvert(file, fmt, q, size) {
  if (!['png', 'jpg', 'webp'].includes(fmt) || ext(file.name) === 'gif') return null;
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { return null; }
  let { width: w, height: h } = bmp;
  if (size !== 'original') { const s = Math.min(1, +size / Math.max(w, h)); w = Math.round(w * s); h = Math.round(h * s); }
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (fmt === 'jpg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(bmp, 0, 0, w, h);
  const quality = { high: 0.92, medium: 0.8, small: 0.6 }[q];
  return new Promise((res) => c.toBlob((b) => res(b), MIME[fmt], quality));
}

// ---------- Queue ----------
const items = [];
const list = document.getElementById('list');
const countEl = document.getElementById('count');
const convertAllBtn = document.getElementById('convertAll');
const cancelBtn = document.getElementById('cancelBtn');
const clearBtn = document.getElementById('clearBtn');
let busy = false, cancelled = false;

function defaultFormat(kind, file) {
  const e = ext(file.name);
  return { image: e === 'png' ? 'jpg' : 'png', audio: e === 'mp3' ? 'wav' : 'mp3', video: e === 'mp4' ? 'webm' : 'mp4', pdf: 'png' }[kind];
}

function select(options, value, label) {
  const s = document.createElement('select');
  s.title = label;
  options.forEach((o) => { const op = new Option(label === 'size' && o !== 'original' ? (s.dataset.kind === 'video' ? o + 'p' : '≤' + o + 'px') : o, o); s.add(op); });
  s.value = value;
  return s;
}

function addFiles(files) {
  for (const file of files) {
    const kind = kindOf(file);
    if (!kind) continue;
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `
      <div class="meta"><div class="name"></div>
        <div class="sub"><span class="chip ${kind}">${kind}</span><span>${ext(file.name) || '?'}</span><span>${fmtBytes(file.size)}</span></div></div>
      <div class="opts"></div>
      <div class="status"><div class="track"><div class="fill"></div></div><div class="msg">ready</div><div class="actions"></div></div>`;
    el.querySelector('.name').textContent = file.name;
    const opts = el.querySelector('.opts');
    const fmtSel = select(FORMATS[kind], defaultFormat(kind, file), 'format');
    let qSel, pagesIn = null;
    if (kind === 'pdf') {
      qSel = document.createElement('select'); qSel.title = 'resolution of page images';
      PDF_DPI.forEach((d) => qSel.add(new Option(d + ' dpi', d)));
      pagesIn = document.createElement('input'); pagesIn.className = 'pages';
      pagesIn.placeholder = 'all pages'; pagesIn.title = 'Pages, e.g. 1-3, 5';
      opts.append(fmtSel, pagesIn, qSel);
      pdfInfo(file).then(({ pages }) => {
        const s = document.createElement('span'); s.textContent = `${pages} page${pages > 1 ? 's' : ''}`;
        el.querySelector('.sub').append(s);
      }).catch(() => setStatus(item, 100, "can't read this PDF", 'err'));
      // DPI matters for images / exact look / pptx, not for editable text
      const sync = () => { qSel.style.visibility = fmtSel.value === 'docx (editable text)' ? 'hidden' : ''; };
      fmtSel.addEventListener('change', sync);
      pagesIn.addEventListener('change', () => reset(item));
    } else {
      qSel = select(QUALITY, 'high', 'quality');
      opts.append(fmtSel, qSel);
    }
    let sizeSel = null;
    if (SIZES[kind]) {
      sizeSel = document.createElement('select'); sizeSel.title = 'size';
      SIZES[kind].forEach((o) => sizeSel.add(new Option(o === 'original' ? 'original size' : kind === 'video' ? o + 'p' : 'max ' + o + 'px', o)));
      opts.append(sizeSel);
    }
    if (kind === 'image') {
      const ed = document.createElement('button'); ed.className = 'edit'; ed.textContent = 'Crop & resize';
      ed.onclick = () => openEditor(file, { decode: decodeImage });
      opts.prepend(ed);
    }
    const rm = document.createElement('button'); rm.className = 'x'; rm.textContent = '✕'; rm.title = 'Remove';
    opts.append(rm);
    const item = {
      file, kind, el, done: false, url: null,
      fmt: () => fmtSel.value, q: () => qSel.value, size: () => sizeSel?.value || 'original', pages: () => pagesIn?.value || '',
      fill: el.querySelector('.fill'), msg: el.querySelector('.msg'), actions: el.querySelector('.actions'),
      setOpts(disabled) { [fmtSel, qSel, sizeSel, pagesIn, rm].forEach((x) => x && (x.disabled = disabled)); },
    };
    [fmtSel, qSel, sizeSel].forEach((s) => s?.addEventListener('change', () => reset(item)));
    rm.onclick = () => { if (item.url) URL.revokeObjectURL(item.url); items.splice(items.indexOf(item), 1); el.remove(); render(); };
    items.push(item);
  }
  render();
}

function reset(item) {
  if (item.url) URL.revokeObjectURL(item.url);
  item.done = false; item.url = null; item.actions.innerHTML = '';
  setStatus(item, 0, 'ready');
  render();
}

function setStatus(item, pct, text, cls = '') {
  item.fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
  item.fill.style.background = cls === 'err' ? 'var(--err)' : cls === 'ok' ? 'var(--ok)' : 'var(--accent)';
  item.msg.textContent = text; item.msg.className = 'msg ' + cls;
}

function render() {
  if (!items.length) list.innerHTML = '<div class="empty">Your queue is empty.</div>';
  else list.querySelector('.empty')?.remove();
  items.forEach((i) => list.appendChild(i.el));
  const pending = items.filter((i) => !i.done).length;
  countEl.textContent = items.length ? `${items.length} file${items.length > 1 ? 's' : ''} · ${pending} to convert` : 'No files yet';
  convertAllBtn.disabled = busy || !pending;
  clearBtn.disabled = busy || !items.length;
  cancelBtn.disabled = !busy;
}

async function convert(item) {
  const fmt = item.fmt(), q = item.q(), size = item.size();
  const outExt = fmt.startsWith('mp3') ? 'mp3' : fmt;
  const base = item.file.name.replace(/\.[^.]+$/, '') || 'file';
  let outName = `${base}.${outExt}`;
  item.setOpts(true);
  setStatus(item, 3, 'starting…');
  let blob = null;
  const t0 = performance.now();
  try {
    if (item.kind === 'pdf') {
      const r = await convertPdf(item.file, { fmt, dpi: q, pages: item.pages() }, (p, label) => setStatus(item, 5 + p * 95, label));
      blob = r.blob; outName = r.name;
    }
    if (item.kind === 'image') blob = await canvasConvert(item.file, fmt, q, size);
    if (!blob) {
      setStatus(item, 5, ffmpeg ? 'converting…' : 'loading engine…');
      const f = await getFFmpeg();
      const inName = 'in.' + (ext(item.file.name) || 'bin');
      const out = 'out.' + outExt;
      await f.writeFile(inName, new Uint8Array(await item.file.arrayBuffer()));
      const args = item.kind === 'image' ? imageArgs(fmt, q, size) : item.kind === 'audio' ? audioArgs(fmt, q) : videoArgs(fmt, q, size);
      let lastErr = '';
      current = {
        onProgress: (p) => { if (p > 0 && p <= 1) setStatus(item, 5 + p * 95, Math.round(p * 100) + '%'); },
        onLog: (m) => {
          if (/matches no streams|does not contain any stream/i.test(m)) lastErr = item.kind === 'video' && fmt.startsWith('mp3') ? 'no audio track' : 'no usable stream';
          else if (!lastErr && /error|invalid|not found|unsupported/i.test(m)) lastErr = m;
        },
      };
      setStatus(item, 5, 'converting…');
      const code = await f.exec(['-hide_banner', '-y', '-i', inName, ...args, out]);
      current = null;
      if (cancelled) throw new Error('cancelled');
      if (code !== 0) throw new Error(lastErr || 'conversion failed');
      const data = await f.readFile(out);
      await f.deleteFile(inName).catch(() => {});
      await f.deleteFile(out).catch(() => {});
      blob = new Blob([data.buffer], { type: MIME[outExt] || 'application/octet-stream' });
    }
    item.url = URL.createObjectURL(blob);
    item.done = true;
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    setStatus(item, 100, `${fmtBytes(blob.size)} · ${secs}s`, 'ok');
    item.actions.innerHTML = '';
    const a = document.createElement('a'); a.href = item.url; a.download = outName; a.textContent = 'Download';
    item.actions.append(a);
  } catch (e) {
    current = null;
    const reason = String(e.message || e);
    setStatus(item, 100, cancelled ? 'cancelled' : reason.length < 30 ? 'failed: ' + reason : 'failed', 'err');
    item.msg.title = reason;
    // FFmpeg's virtual FS may hold leftovers after a failure; clear them
    if (ffmpeg) for (const n of ['out.' + outExt, 'in.' + (ext(item.file.name) || 'bin')]) await ffmpeg.deleteFile(n).catch(() => {});
    console.error(item.file.name, e);
  } finally {
    item.setOpts(false);
  }
}

convertAllBtn.onclick = async () => {
  busy = true; cancelled = false; render();
  for (const item of items.filter((i) => !i.done)) {
    if (cancelled) break;
    await convert(item);
    render();
  }
  busy = false; render();
};

cancelBtn.onclick = () => {
  cancelled = true;
  if (ffmpeg) { ffmpeg.terminate(); ffmpeg = null; engineState('', 'engine stopped'); }
};

clearBtn.onclick = () => {
  items.forEach((i) => i.url && URL.revokeObjectURL(i.url));
  items.length = 0; list.innerHTML = ''; render();
};

// ---------- Drop / pick ----------
const drop = document.getElementById('drop');
const picker = document.getElementById('picker');
picker.onchange = () => { addFiles(picker.files); picker.value = ''; };
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());
