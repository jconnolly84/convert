# Third-party libraries

These files are copied from npm (unmodified unless noted) so the site runs on static hosting (GitHub Pages) with no build step.

| Folder | Package | Version | License | Source |
|---|---|---|---|---|
| `ffmpeg/` | @ffmpeg/ffmpeg | 0.12.15 | MIT | https://github.com/ffmpegwasm/ffmpeg.wasm |
| `ffmpeg-core/` | @ffmpeg/core | 0.12.10 | GPL-2.0-or-later | https://github.com/ffmpegwasm/ffmpeg.wasm (core build of FFmpeg — https://ffmpeg.org — with x264, libvpx, LAME, Vorbis, Opus, libwebp and others) |
| `pdfjs/` | pdfjs-dist | 4.10.38 | Apache-2.0 | https://github.com/mozilla/pdf.js |
| `docx/` | docx | 9.5.1 | MIT | https://github.com/dolanmiu/docx |
| `pptxgenjs/` | pptxgenjs | 3.12.0 | MIT | https://github.com/gitbrent/PptxGenJS |
| `jszip/` | jszip | 3.10.1 | MIT or GPL-3.0-or-later | https://github.com/Stuk/jszip |
| `docx-preview/` | docx-preview | 0.4.1 | Apache-2.0 | https://github.com/VolodymyrBaydalka/docxjs (one change: the `jszip` import is replaced with the global `JSZip` so it runs without a bundler) |
| `html2canvas/` | html2canvas-pro | 2.6.4 | MIT | https://github.com/yorickshan/html2canvas-pro |
| `jspdf/` | jspdf | 4.2.1 | MIT | https://github.com/parallax/jsPDF |

The complete corresponding source code for the GPL-licensed FFmpeg core is available from the ffmpeg.wasm repository at the tag `v0.12.10` of `@ffmpeg/core`.

Not bundled: `pptx-preview` 1.0.7 (ISC-licensed npm package, closed source) is loaded at runtime from https://cdn.jsdelivr.net/npm/pptx-preview@1.0.7/.
