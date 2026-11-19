'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const imageIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function imageMime(bytes) {
  if (bytes.subarray(0, 8).equals(pngSignature)) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  const prefix = bytes.toString('ascii', 0, 12);
  if (prefix.startsWith('GIF87a') || prefix.startsWith('GIF89a')) return 'image/gif';
  if (prefix.startsWith('RIFF') && prefix.endsWith('WEBP')) return 'image/webp';
  if (prefix.startsWith('BM')) return 'image/bmp';
  return null;
}

function registerNoteImages(ipcMain, fromMain, directory) {
  function filePath(id) {
    return path.join(directory(), id);
  }

  ipcMain.handle('notes:image-save', async (event, data) => {
    if (!fromMain(event)) return { ok: false, code: 'forbidden' };
    if (!(data instanceof ArrayBuffer) || data.byteLength === 0) return { ok: false, code: 'format' };
    if (data.byteLength > MAX_IMAGE_BYTES) return { ok: false, code: 'size' };
    const bytes = Buffer.from(data);
    if (!imageMime(bytes)) return { ok: false, code: 'format' };

    const id = randomUUID();
    const file = filePath(id);
    let handle;
    try {
      await fs.mkdir(directory(), { recursive: true });
      handle = await fs.open(file, 'wx');
      await handle.writeFile(bytes);
      await handle.close();
      return { ok: true, id };
    } catch {
      if (handle) {
        await handle.close().catch(() => {});
        await fs.unlink(file).catch(() => {});
      }
      return { ok: false, code: 'storage' };
    }
  });

  ipcMain.handle('notes:image-read', async (event, id) => {
    if (!fromMain(event) || typeof id !== 'string' || !imageIdPattern.test(id)) return { ok: false };
    let handle;
    try {
      handle = await fs.open(filePath(id), 'r');
      const { size } = await handle.stat();
      if (size === 0 || size > MAX_IMAGE_BYTES) return { ok: false };
      const bytes = await handle.readFile();
      const mime = bytes.length === size && imageMime(bytes);
      if (!mime) return { ok: false };
      return { ok: true, src: 'data:' + mime + ';base64,' + bytes.toString('base64') };
    } catch {
      return { ok: false };
    } finally {
      await handle?.close().catch(() => {});
    }
  });
}

module.exports = { registerNoteImages };

