#!/usr/bin/env node
// Unpacks the "Cozy Isometric Exterior" zip into the handful of PNGs the viewer
// uses, with plain names, plus a manifest.json the viewer loads at start-up.
//
//   Drop the zip into client/public/pack/ and run:  npm run pack -w client
//   (npm run build runs it too, so the deploy installer picks the pack up.)
//
// The pack's licence forbids sharing its files, so client/public/pack/ is
// gitignored: the zip and the PNGs live only on your machines. Without a zip
// the script does nothing and the viewer draws everything in code as before.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "..", "public", "pack");

/** Which files in the zip we want, and what to call them. Order matters only for the manifest. */
const WANT = [
  ["grass", /autotiles\/bottom grassland\/bottom grassland\.png$/i],
  ["path", /autotiles\/grass path simple\/grass path simple\.png$/i],
  ["singles", /single tiles\/single tiles\(atlas\)\.png$/i],
  ["treeGreen5", /trees\/green trees\/tree 5\.png$/i],
  ["treeGreen6", /trees\/green trees\/tree 6\.png$/i],
  ["treeDry5", /trees\/dry trees\/tree 5\.png$/i],
  ["treeDry6", /trees\/dry trees\/tree 6\.png$/i],
  ["house5", /houses\/house 5\.png$/i],
  ["house6", /houses\/house 6\.png$/i],
];

/** Minimal zip reader: central directory -> entries (stored or deflated). Enough for an asset pack. */
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    entries.push({
      name,
      read: () => {
        const raw = buf.subarray(start, start + compSize);
        if (method === 0) return Buffer.from(raw);
        if (method === 8) return inflateRawSync(raw);
        throw new Error(`unsupported compression ${method} for ${name}`);
      },
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function main() {
  mkdirSync(dir, { recursive: true });
  const zip = process.argv[2] ?? readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".zip")).map((f) => path.join(dir, f))[0];
  if (!zip) {
    if (existsSync(path.join(dir, "manifest.json"))) console.log("[pack] already unpacked");
    else console.log("[pack] no pack zip in client/public/pack: the viewer will draw everything in code");
    return;
  }
  const entries = readZip(readFileSync(zip));
  const files = {};
  for (const [key, re] of WANT) {
    const e = entries.find((x) => re.test(x.name.replace(/\\/g, "/")));
    if (!e) {
      console.warn(`[pack] missing in zip: ${key}`);
      continue;
    }
    const out = `${key}.png`;
    writeFileSync(path.join(dir, out), e.read());
    files[key] = out;
  }
  const manifest = {
    name: "Cozy Isometric Exterior (Free Version)",
    credit: "Choco Ted",
    url: "https://choco-ted.itch.io/cozy-isometric-pixel-art-asset-pack-32x32-exterior-game-assets-for-godot-unity",
    files,
  };
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`[pack] unpacked ${Object.keys(files).length} files from ${path.basename(zip)}`);
}

main();
