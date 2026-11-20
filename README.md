# convert.

A free media converter that runs entirely in your browser. Files are never uploaded.

**Live site:** https://jconnolly84.github.io/convert/

## What it does

- **Images**: convert between PNG, JPG, WebP, GIF, BMP and TIFF. The **Crop & resize** editor lets you:
  - crop visually, using preset shapes or a DVD cover template that splits into back, spine and front
  - resize in pixels, mm, cm or inches
  - set the DPI saved in JPG and PNG files
- **Audio**: MP3, WAV, OGG, FLAC, M4A and Opus.
- **Video**: MP4, WebM, MOV, animated GIF, or just the sound track as MP3, with optional downscaling.
- **PDF**: convert pages to PNG, JPG or WebP (with page ranges and DPI), to DOCX (editable text, or an exact-look version of each page), or to PPTX (one slide per page).

## How it works

Plain HTML and JavaScript, with no build step. Conversion uses [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm), [pdf.js](https://github.com/mozilla/pdf.js), [docx](https://github.com/dolanmiu/docx), [PptxGenJS](https://github.com/gitbrent/PptxGenJS) and [JSZip](https://github.com/Stuk/jszip), all bundled in `vendor/`. See [vendor/README.md](vendor/README.md) for their licences.

## Run locally

Any static file server works. For example:

```
npx http-server -p 8080
```

Then open http://localhost:8080. It must be served over http, not opened as a file, because of the web workers.
