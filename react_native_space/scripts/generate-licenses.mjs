#!/usr/bin/env node
/**
 * Generate constants/licenses.json: every open-source component that ships in
 * the app, with its license text, for the About screen.
 *
 * - npm: walks the production dependency graph from package.json (not dev
 *   dependencies) through node_modules.
 * - native: C/C++ code that llama.rn compiles into the app (llama.cpp and the
 *   libraries it vendors), which npm metadata doesn't cover.
 * - fonts: the bundled Inter and JetBrains Mono fonts (SIL OFL).
 *
 * Run after changing dependencies:  yarn licenses
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = path.join(root, 'node_modules');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$|^licen[cs]e[-_.]/i;

function findLicenseText(dir) {
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return null; }
  const hits = files.filter((f) => LICENSE_FILE.test(f)).sort();
  if (hits.length === 0) return null;
  return hits.map((f) => fs.readFileSync(path.join(dir, f), 'utf8').trim()).join('\n\n');
}

function licenseName(pkg) {
  const l = pkg.license ?? pkg.licenses;
  if (typeof l === 'string') return l;
  if (Array.isArray(l)) return l.map((x) => x.type ?? x).join(' OR ');
  if (l && typeof l === 'object') return l.type ?? 'UNKNOWN';
  return 'UNKNOWN';
}

/** Resolve a dependency the way Node does: nested node_modules first, then up. */
function resolvePkgDir(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir || !dir.startsWith(root)) return null;
    dir = parent;
  }
}

// ── npm packages ──
const appPkg = readJson(path.join(root, 'package.json'));
const seen = new Map(); // name@version → entry
const queue = Object.keys(appPkg.dependencies ?? {}).map((n) => [n, root]);
while (queue.length) {
  const [name, from] = queue.shift();
  const dir = resolvePkgDir(name, from);
  if (!dir) continue; // optional / platform-specific dependency not installed
  const pkg = readJson(path.join(dir, 'package.json'));
  const id = `${pkg.name}@${pkg.version}`;
  if (seen.has(id)) continue;
  seen.set(id, {
    name: pkg.name,
    version: pkg.version,
    license: licenseName(pkg),
    url: typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? pkg.homepage ?? null,
    text: findLicenseText(dir),
  });
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
    queue.push([dep, dir]);
  }
}

// ── native code compiled in by llama.rn ──
const vendor = path.join(nm, 'llama.rn', 'vendor');
const llamaVendor = path.join(vendor, 'llama.cpp', 'vendor');
const fromFile = (p) => fs.readFileSync(p, 'utf8').trim();
const between = (p, start, end) => {
  const s = fs.readFileSync(p, 'utf8');
  const i = s.indexOf(start);
  if (i < 0) throw new Error(`license marker not found in ${p}`);
  const j = end ? s.indexOf(end, i) : -1;
  return s.slice(i, j < 0 ? undefined : j).trim();
};
const nlohmannHeader = fs.readFileSync(path.join(llamaVendor, 'nlohmann', 'json.hpp'), 'utf8');
const nlohmannCopyright = nlohmannHeader.match(/SPDX-FileCopyrightText: (.*)/)?.[1] ?? 'Niels Lohmann';
const MIT = (holder) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const llamaRnVersion = readJson(path.join(nm, 'llama.rn', 'package.json')).version;
const versions = (() => { try { return fromFile(path.join(vendor, 'VERSIONS')); } catch { return ''; } })();
const refOf = (prefix) => versions.match(new RegExp(`^${prefix}_REF=(.+)$`, 'm'))?.[1]?.trim() ?? `via llama.rn ${llamaRnVersion}`;

const native = [
  { name: 'llama.cpp', version: refOf('LLAMA_CPP'), license: 'MIT', url: 'https://github.com/ggml-org/llama.cpp', text: fromFile(path.join(vendor, 'llama.cpp', 'LICENSE')) },
  { name: 'codec.cpp', version: refOf('CODEC_CPP'), license: 'MIT', url: 'https://github.com/mybigday/codec.cpp', text: fromFile(path.join(vendor, 'codec.cpp', 'LICENSE')) },
  { name: 'OpenCL-Headers', version: refOf('OPENCL_HEADERS'), license: 'Apache-2.0', url: 'https://github.com/KhronosGroup/OpenCL-Headers', text: fromFile(path.join(vendor, 'OpenCL-Headers', 'LICENSE')) },
  { name: 'JSON for Modern C++ (nlohmann/json)', version: nlohmannHeader.match(/version (\d+\.\d+\.\d+)/)?.[1] ?? '', license: 'MIT', url: 'https://github.com/nlohmann/json', text: MIT(nlohmannCopyright) },
  { name: 'stb_image', version: '', license: 'MIT OR Unlicense', url: 'https://github.com/nothings/stb', text: between(path.join(llamaVendor, 'stb', 'stb_image.h'), 'This software is available under 2 licenses') },
  { name: 'miniaudio', version: '', license: 'Unlicense OR MIT-0', url: 'https://github.com/mackron/miniaudio', text: between(path.join(llamaVendor, 'miniaudio', 'miniaudio.h'), 'This software is available as a choice', '*/') },
  { name: 'xxHash', version: '', license: 'BSD-2-Clause', url: 'https://github.com/Cyan4973/xxHash', text: fromFile(path.join(llamaVendor, 'hash', 'xxhash', 'LICENSE')) },
  { name: 'rotate-bits', version: '', license: 'MIT', url: 'https://github.com/jb55/rotate-bits.h', text: fromFile(path.join(llamaVendor, 'hash', 'rotate-bits', 'LICENSE.md')) },
  { name: 'SHA-1 (Steve Reid)', version: '', license: 'Public domain', url: null, text: 'SHA-1 in C, by Steve Reid. 100% Public Domain.' },
  { name: 'SHA-256 (Igor Pavlov)', version: '', license: 'Public domain', url: null, text: fromFile(path.join(llamaVendor, 'hash', 'sha256', 'LICENSE')) },
];

// ── fonts ──
const fonts = [
  { name: 'Inter (font)', version: '', license: 'OFL-1.1', url: 'https://github.com/rsms/inter', text: fromFile(path.join(nm, '@expo-google-fonts', 'inter', 'LICENSE_FONT')) },
  { name: 'JetBrains Mono (font)', version: '', license: 'OFL-1.1', url: 'https://github.com/JetBrains/JetBrainsMono', text: fromFile(path.join(nm, '@expo-google-fonts', 'jetbrains-mono', 'LICENSE_FONT')) },
];

// Deduplicate identical texts (most MIT files differ only by copyright line,
// but many packages from one org share a file).
const texts = [];
const textIndex = new Map();
const withTextRef = (e) => {
  if (!e.text) return { ...e, text: undefined, textId: null };
  let id = textIndex.get(e.text);
  if (id === undefined) { id = texts.length; texts.push(e.text); textIndex.set(e.text, id); }
  const { text, ...rest } = e;
  return { ...rest, textId: id };
};

const npm = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
const out = {
  generatedAt: new Date().toISOString().slice(0, 10),
  sections: [
    { title: 'On-device inference (native code)', items: native.map(withTextRef) },
    { title: 'Fonts', items: fonts.map(withTextRef) },
    { title: 'JavaScript packages', items: npm.map(withTextRef) },
  ],
  texts,
};

const dest = path.join(root, 'constants', 'licenses.json');
fs.writeFileSync(dest, JSON.stringify(out) + '\n');
const missing = npm.filter((e) => !e.text);
console.log(`Wrote ${path.relative(root, dest)}: ${native.length} native, ${fonts.length} fonts, ${npm.length} npm packages, ${texts.length} unique texts, ${(fs.statSync(dest).size / 1024).toFixed(0)} KB`);
if (missing.length) {
  console.log(`${missing.length} npm packages ship no license file (license field shown instead):`);
  console.log('  ' + missing.map((e) => `${e.name}@${e.version} (${e.license})`).join(', '));
}
