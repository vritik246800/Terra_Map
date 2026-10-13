// One-off: generate src-tauri/icons/icon.ico + icon.png (PNG-in-ICO, 256x256 rounded square, accent blue).
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const S = 256;
const R = 56; // corner radius
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  const row = y * (S * 4 + 1);
  raw[row] = 0; // filter: none
  for (let x = 0; x < S; x++) {
    // rounded-rect coverage test
    const cx = Math.min(Math.max(x, R), S - R);
    const cy = Math.min(Math.max(y, R), S - R);
    const inside = (x - cx) ** 2 + (y - cy) ** 2 <= R * R;
    const o = row + 1 + x * 4;
    raw[o] = 0x00; // R
    raw[o + 1] = 0x71; // G
    raw[o + 2] = 0xe3; // B
    raw[o + 3] = inside ? 0xff : 0x00; // A
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);

// ICO wrapper: header + 1 directory entry + PNG payload
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // count
const entry = Buffer.alloc(16);
entry[0] = 0; // width 256
entry[1] = 0; // height 256
entry.writeUInt16LE(1, 4); // planes
entry.writeUInt16LE(32, 6); // bpp
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12); // offset

mkdirSync("src-tauri/icons", { recursive: true });
writeFileSync("src-tauri/icons/icon.ico", Buffer.concat([header, entry, png]));
// macOS/Linux: generate_context! loads icon.png as the default window icon.
writeFileSync("src-tauri/icons/icon.png", png);
console.log("icon.ico + icon.png written,", png.length, "bytes PNG");
