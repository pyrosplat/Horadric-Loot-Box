import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
// @ts-expect-error a plain build script, no types
import { releaseNotes } from '../scripts/release-notes.mjs';

describe('release notes', () => {
  const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
  const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));

  test('the changelog has a section for this version (the release and the updater show it)', () => {
    const notes = releaseNotes(changelog, `v${version}`);
    expect(notes, `add "## ${version}" to CHANGELOG.md`).toBeTruthy();
    expect(notes).toMatch(/^- /);
    expect(notes).not.toMatch(/^## /m);
  });

  test("one version's section only, whatever the heading style", () => {
    const text = '# Changelog\n\n## [1.2.0] - 2026-01-01\n\n- new\n- newer\n\n## v1.1.0\n\n- old\n';
    expect(releaseNotes(text, 'v1.2.0')).toBe('- new\n- newer');
    expect(releaseNotes(text, '1.1.0')).toBe('- old');
    expect(releaseNotes(text, '1.1')).toBeUndefined();
  });
});
