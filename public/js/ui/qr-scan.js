// Multi-farm hosted mode: read a farm link from a QR code (the "Keep your farm safe" card draws it). Two ways, both on
// the device, nothing sent anywhere: the camera (a full-screen view, a frame read about five times a second) and a
// photo or screenshot of the code (the phone's picker; a screenshot synced from another device works too). The reader
// (ui/qr-read.js) loads only when one of them is used. Framework-free: the landing page uses it too.
//
//   cameraAvailable(nav?) -> boolean
//   readPhoto(file) -> Promise<string | null>      the text of the QR code in a picture file
//   scanCamera({ onText, onFail }) -> { close() }   the camera view; onText(text) once, onFail(message) if it cannot start
import { t } from '../i18n/keep.js';

const MAX_SIDE = 1400;
const FRAME_MS = 200;

export const cameraAvailable = (nav = globalThis.navigator) => typeof nav?.mediaDevices?.getUserMedia === 'function'
  && globalThis.isSecureContext !== false;

/** The pixels of a drawable (an <img>, a bitmap, a <video>), at most MAX_SIDE on its long side. */
function pixels(src, w, h, doc = globalThis.document) {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * k));
  const ch = Math.max(1, Math.round(h * k));
  const c = doc.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, cw, ch);
  return g.getImageData(0, 0, cw, ch);
}

async function bitmapOf(file) {
  if (typeof globalThis.createImageBitmap === 'function') {
    try { return await createImageBitmap(file); } catch { /* an older Safari: the <img> way below */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function readPhoto(file) {
  try {
    const { readQr } = await import('./qr-read.js');
    const bmp = await bitmapOf(file);
    const w = bmp.width || bmp.naturalWidth;
    const h = bmp.height || bmp.naturalHeight;
    return readQr(pixels(bmp, w, h));
  } catch {
    return null;
  }
}

/** The camera view (see the header). */
export function scanCamera({ onText, onFail, doc = globalThis.document, nav = globalThis.navigator } = {}) {
  let stream = null;
  let timer = 0;
  let done = false;
  const el = doc.createElement('div');
  el.className = 'qr-scan';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', t('keep.scan.title'));
  const video = doc.createElement('video');
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  video.muted = true;
  const frame = doc.createElement('div');
  frame.className = 'qr-scan-frame';
  const help = doc.createElement('p');
  help.className = 'qr-scan-help';
  help.setAttribute('role', 'status');
  help.textContent = t('keep.scan.help');
  const cancel = doc.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn--paper qr-scan-cancel';
  cancel.textContent = t('keep.scan.cancel');
  el.append(video, frame, help, cancel);
  const close = () => {
    done = true;
    clearTimeout(timer);
    for (const track of stream?.getTracks?.() ?? []) track.stop();
    el.remove();
  };
  cancel.addEventListener('click', close);
  // Esc closes the camera only (not a sheet it was opened from)
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault?.(); close(); } });
  // opened from a modal <dialog> (the landing page's "Already have a farm?" sheet), the view must live inside it: the
  // rest of the page is inert under a modal dialog
  let host = doc.body;
  try { host = doc.querySelector?.('dialog:modal') ?? host; } catch { host = doc.querySelector?.('dialog[open]') ?? host; }
  host.append(el);
  cancel.focus?.();

  (async () => {
    let readQr;
    try {
      ({ readQr } = await import('./qr-read.js'));
      stream = await nav.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      if (done) { close(); return; }
      video.srcObject = stream;
      await video.play();
    } catch {
      close();
      onFail?.(t('keep.scan.nocam'));
      return;
    }
    help.textContent = t('keep.scan.looking');
    const tick = () => {
      if (done) return;
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w && h) {
        const text = readQr(pixels(video, w, h));
        if (text) { close(); onText?.(text); return; }
      }
      timer = setTimeout(tick, FRAME_MS);
    };
    tick();
  })();
  return { close };
}
