import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const bridgeDirectory = resolve(scriptDirectory, "..");
const assetsDirectory = join(bridgeDirectory, "desktop", "assets");
const pngOutput = join(assetsDirectory, "icon.png");
const icnsOutput = join(assetsDirectory, "icon.icns");

const icnsEntries = [
  ["icp4", 16],
  ["icp5", 32],
  ["icp6", 64],
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
  ["ic10", 1024],
];

await mkdir(assetsDirectory, { recursive: true });
await writeFile(pngOutput, createPng(256));
await writeFile(icnsOutput, createIcns());

function createPng(width) {
  const height = width;
  const scale = width / 32;
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1);
    pixels[rowOffset] = 0; // PNG filter: none
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * 4;
      const logicalX = (x + 0.5) / scale;
      const logicalY = (y + 0.5) / scale;
      const cornerDistance = Math.hypot(
        Math.max(0, 6 - logicalX, logicalX - 25),
        Math.max(0, 6 - logicalY, logicalY - 25),
      );
      const isBackground = cornerDistance <= 6;
      const isPrinterBody =
        logicalX >= 6 && logicalX <= 25 && logicalY >= 11 && logicalY <= 21;
      const isPaper =
        logicalX >= 10 && logicalX <= 21 && logicalY >= 6 && logicalY <= 15;
      const isPaperCut =
        logicalX >= 10 && logicalX <= 21 && logicalY >= 18 && logicalY <= 23;

      if (isPrinterBody || isPaper || isPaperCut) {
        pixels[offset] = 255;
        pixels[offset + 1] = 255;
        pixels[offset + 2] = 255;
        pixels[offset + 3] = 255;
      } else if (isBackground) {
        pixels[offset] = 216;
        pixels[offset + 1] = 71;
        pixels[offset + 2] = 39;
        pixels[offset + 3] = 255;
      }
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6; // RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function createIcns() {
  const entries = icnsEntries.map(([type, size]) => {
    const image = createPng(size);
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, "ascii");
    header.writeUInt32BE(image.length + header.length, 4);
    return Buffer.concat([header, image]);
  });
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(
    header.length + entries.reduce((total, entry) => total + entry.length, 0),
    4,
  );
  return Buffer.concat([header, ...entries]);
}

function chunk(type, data) {
  const kind = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([kind, data])));
  return Buffer.concat([length, kind, data, checksum]);
}

function crc32(value) {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
