// Fails when an npm Tauri package and its Rust crate are on different major.minor versions, which `tauri build`
// refuses (and would otherwise only show up when building installers on a release tag). Reads the lockfiles only.
//   @tauri-apps/api          <-> tauri
//   @tauri-apps/plugin-<x>   <-> tauri-plugin-<x>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')).packages ?? {};
const cargo = fs.readFileSync(path.join(root, 'src-tauri/Cargo.lock'), 'utf8');

const crates = new Map();
for (const block of cargo.split('[[package]]')) {
  const name = block.match(/^name = "([^"]+)"/m)?.[1];
  const version = block.match(/^version = "([^"]+)"/m)?.[1];
  if (name && version) crates.set(name, [...(crates.get(name) ?? []), version]);
}

const minor = (v) => v.split('.').slice(0, 2).join('.');
const problems = [];
let checked = 0;
for (const [key, info] of Object.entries(npm)) {
  const m = key.match(/^node_modules\/@tauri-apps\/(api|plugin-[\w-]+)$/);
  if (!m) continue;
  const crate = m[1] === 'api' ? 'tauri' : `tauri-${m[1]}`;
  const versions = crates.get(crate);
  if (!versions) {
    problems.push(`@tauri-apps/${m[1]} ${info.version} is installed but the ${crate} crate isn't in Cargo.lock`);
    continue;
  }
  checked++;
  if (!versions.some((v) => minor(v) === minor(info.version)))
    problems.push(`@tauri-apps/${m[1]} ${info.version} (npm) vs ${crate} ${versions.join(', ')} (Rust): use the same major.minor`);
}

if (problems.length) {
  console.error('Tauri npm packages and Rust crates are out of step:\n  ' + problems.join('\n  '));
  console.error('Pin the npm side with ~ to the crate\'s version (or update the crate), then npm install / cargo update.');
  process.exit(1);
}
console.log(`tauri versions: ${checked} npm packages match their crates`);
