import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const WIDTH = 32;
const HEIGHT = 32;

const PALETTE = {
  '.': [0, 0, 0, 0],
  o: [24, 34, 30, 255],
  '1': [33, 98, 68, 255],
  '2': [56, 154, 100, 255],
  '3': [102, 201, 128, 255],
  '4': [166, 235, 160, 255],
  g: [247, 208, 96, 255],
  b: [156, 106, 71, 255],
  B: [120, 76, 48, 255],
  d: [84, 50, 30, 255],
  s: [74, 48, 38, 255],
  r: [229, 131, 100, 255],
  R: [198, 93, 63, 255],
  D: [148, 60, 40, 255],
};

// 32x32 pixel-art tree in a warm terracotta pot on transparent background.
const PIXEL_GRID = [
  '................................',
  '...........oooooooooo...........',
  '.........oo4443333222oo.........',
  '........o44433333222221o........',
  '.......o443334433222g211o.......',
  '.....ooo3333443322222211ooo.....',
  '....o4433333333322222211111o....',
  '...o44333g332233322221111111o...',
  '..o44333332222333322211112211o..',
  '..o43333222222233322211122211o..',
  '..o33322221122222222111111111o..',
  '..o33222211112222221111g11111o..',
  '...o222111111122221111111111o...',
  '...oo11111111obBBdo11111111oo...',
  '.....ooooooooobBBdooooooooo.....',
  '.............obBBdo.............',
  '.............obBBdo.............',
  '.............obBBdo.............',
  '............oobBBdoo............',
  '...........oobBBBBdoo...........',
  '........ooooossBBssooooo........',
  '.......orrrrrrrrrrrrrrrDo.......',
  '.......orRRRRRRRRRRRRRRDo.......',
  '.......oDRRRRRRRRRRRRRRDo.......',
  '........oDDDDDDDDDDDDDDo........',
  '.........orRRRRRRRRRRDo.........',
  '.........orRRRRRRRRRRDo.........',
  '..........orRRRRRRRRDo..........',
  '..........orRRRRRRRRDo..........',
  '...........orRRRRRRDo...........',
  '...........oooooooooo...........',
  '................................',
];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const lenBytes = Buffer.alloc(4);
  lenBytes.writeUInt32BE(data.length, 0);

  const crcInput = Buffer.concat([typeBytes, data]);
  const crcBytes = Buffer.alloc(4);
  crcBytes.writeUInt32BE(crc32(crcInput), 0);

  return Buffer.concat([lenBytes, typeBytes, data, crcBytes]);
}

function getSourceRgba(x, y) {
  const ch = PIXEL_GRID[y][x];
  const rgba = PALETTE[ch];
  if (!rgba) {
    throw new Error(`Unknown palette character "${ch}" at (${x}, ${y})`);
  }
  return rgba;
}

function sampleRgbaAtSize(targetSize, x, y) {
  if (targetSize >= WIDTH) {
    const scale = targetSize / WIDTH;
    const srcX = Math.min(WIDTH - 1, Math.floor(x / scale));
    const srcY = Math.min(HEIGHT - 1, Math.floor(y / scale));
    return getSourceRgba(srcX, srcY);
  }

  // Downscale cleanly (e.g. 32 -> 16) by inspecting the 2x2 block so outlines stay crisp.
  const startX = Math.floor((x * WIDTH) / targetSize);
  const endX = Math.max(startX + 1, Math.floor(((x + 1) * WIDTH) / targetSize));
  const startY = Math.floor((y * HEIGHT) / targetSize);
  const endY = Math.max(startY + 1, Math.floor(((y + 1) * HEIGHT) / targetSize));

  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let opaqueCount = 0;
  let outlineCount = 0;

  for (let sy = startY; sy < endY; sy++) {
    for (let sx = startX; sx < endX; sx++) {
      const rgba = getSourceRgba(sx, sy);
      if (rgba[3] > 0) {
        opaqueCount++;
        rSum += rgba[0];
        gSum += rgba[1];
        bSum += rgba[2];
        if (PIXEL_GRID[sy][sx] === 'o') {
          outlineCount++;
        }
      }
    }
  }

  if (opaqueCount === 0) {
    return [0, 0, 0, 0];
  }
  const totalSamples = (endX - startX) * (endY - startY);
  if (outlineCount > 0 && opaqueCount <= totalSamples / 2) {
    return PALETTE.o;
  }
  return [
    Math.round(rSum / opaqueCount),
    Math.round(gSum / opaqueCount),
    Math.round(bSum / opaqueCount),
    255,
  ];
}

function buildPngBuffer(size = WIDTH) {
  if (PIXEL_GRID.length !== HEIGHT) {
    throw new Error(`Expected ${HEIGHT} rows, got ${PIXEL_GRID.length}`);
  }
  for (let y = 0; y < HEIGHT; y++) {
    if (PIXEL_GRID[y].length !== WIDTH) {
      throw new Error(`Row ${y} has length ${PIXEL_GRID[y].length}, expected ${WIDTH}`);
    }
  }

  const stride = 1 + size * 4;
  const raw = Buffer.alloc(stride * size);

  for (let y = 0; y < size; y++) {
    const rowOffset = y * stride;
    raw[rowOffset] = 0; // PNG filter type 0 (None)

    for (let x = 0; x < size; x++) {
      const rgba = sampleRgbaAtSize(size, x, y);
      const pxOffset = rowOffset + 1 + x * 4;
      raw[pxOffset] = rgba[0];
      raw[pxOffset + 1] = rgba[1];
      raw[pxOffset + 2] = rgba[2];
      raw[pxOffset + 3] = rgba[3];
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function buildDibFrame(size) {
  const header = Buffer.alloc(40);
  const xorSize = size * size * 4;
  const andStride = Math.ceil(size / 32) * 4;
  const andSize = andStride * size;

  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(size, 4); // biWidth
  header.writeInt32LE(size * 2, 8); // biHeight (XOR + AND masks)
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount
  header.writeUInt32LE(0, 16); // biCompression = BI_RGB
  header.writeUInt32LE(xorSize + andSize, 20); // biSizeImage

  const xor = Buffer.alloc(xorSize);
  const and = Buffer.alloc(andSize);

  for (let y = 0; y < size; y++) {
    // DIB rows are stored bottom-up
    const srcY = size - 1 - y;
    const xorRowOffset = y * size * 4;
    const andRowOffset = y * andStride;

    for (let x = 0; x < size; x++) {
      const rgba = sampleRgbaAtSize(size, x, srcY);
      const pxOffset = xorRowOffset + x * 4;
      xor[pxOffset] = rgba[2]; // B
      xor[pxOffset + 1] = rgba[1]; // G
      xor[pxOffset + 2] = rgba[0]; // R
      xor[pxOffset + 3] = rgba[3]; // A

      if (rgba[3] === 0) {
        and[andRowOffset + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  return Buffer.concat([header, xor, and]);
}

function buildIcoBuffer() {
  const frames = [
    { size: 16, data: buildDibFrame(16) },
    { size: 32, data: buildDibFrame(32) },
    { size: 64, data: buildDibFrame(64) },
    { size: 256, data: buildPngBuffer(256) },
  ];

  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0); // reserved
  dir.writeUInt16LE(1, 2); // type 1 = ICO
  dir.writeUInt16LE(frames.length, 4);

  const entries = Buffer.alloc(frames.length * 16);
  let offset = dir.length + entries.length;

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const entryOffset = i * 16;
    entries[entryOffset] = frame.size >= 256 ? 0 : frame.size;
    entries[entryOffset + 1] = frame.size >= 256 ? 0 : frame.size;
    entries[entryOffset + 2] = 0; // palette count
    entries[entryOffset + 3] = 0; // reserved
    entries.writeUInt16LE(1, entryOffset + 4); // planes
    entries.writeUInt16LE(32, entryOffset + 6); // bit count
    entries.writeUInt32LE(frame.data.length, entryOffset + 8);
    entries.writeUInt32LE(offset, entryOffset + 12);
    offset += frame.data.length;
  }

  return Buffer.concat([dir, entries, ...frames.map((f) => f.data)]);
}

function main() {
  const pngOutPath = path.join(ROOT_DIR, 'assets', 'tray-icon.png');
  const icoOutPath = path.join(ROOT_DIR, 'assets', 'growtype.ico');
  fs.mkdirSync(path.dirname(pngOutPath), { recursive: true });

  const pngBuffer = buildPngBuffer(WIDTH);
  fs.writeFileSync(pngOutPath, pngBuffer);
  console.log(`[generate-icon] Generated ${path.relative(ROOT_DIR, pngOutPath)} (${pngBuffer.length} bytes).`);

  const icoBuffer = buildIcoBuffer();
  fs.writeFileSync(icoOutPath, icoBuffer);
  console.log(`[generate-icon] Generated ${path.relative(ROOT_DIR, icoOutPath)} (${icoBuffer.length} bytes).`);
}

main();
