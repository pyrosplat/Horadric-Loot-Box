// Prints one version's section of CHANGELOG.md, for the GitHub release and the in-app updater (latest.json).
//   node scripts/release-notes.mjs v2.4.0     (no version: the one in package.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The lines under "## <version>" up to the next "## ", or undefined when the changelog has no such section. */
export function releaseNotes(changelog, version) {
  const want = String(version).replace(/^v/i, '');
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((l) => /^## /.test(l) && l.replace(/^##\s*\[?v?/i, '').split(/[\]\s]/)[0] === want);
  if (start < 0) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim() || undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = process.argv[2];
  const version = arg && /^v?\d+\.\d+\.\d+/.test(arg) ? arg : JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const notes = releaseNotes(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), version);
  if (!notes) console.error(`CHANGELOG.md has no "## ${String(version).replace(/^v/i, '')}" section.`);
  console.log(notes ?? "See CHANGELOG.md for what's new.");
}
