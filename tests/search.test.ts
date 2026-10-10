import { describe, expect, it } from 'vitest';
import { searchMatcher } from '../src/core';

describe('vault search', () => {
  const mf = '15% better chance of getting magic items\n+20 to life';
  it('finds stats by what people call them', () => {
    expect(searchMatcher('magic find')!(mf)).toBe(true);
    expect(searchMatcher('mf')!(mf)).toBe(true);
    expect(searchMatcher('fcr')!('+20% faster cast rate')).toBe(true);
    expect(searchMatcher('ll')!('6% life stolen per hit')).toBe(true);
    expect(searchMatcher('all res')!('all resistances +20')).toBe(true);
    expect(searchMatcher('magic find')!('+20 to life')).toBe(false);
  });
  it('wants every word', () => {
    const t = searchMatcher('magic find life')!;
    expect(t(mf)).toBe(true);
    expect(t('15% better chance of getting magic items')).toBe(false);
  });
  it('does nothing with an empty box and keeps plain words', () => {
    expect(searchMatcher('  ')).toBeUndefined();
    expect(searchMatcher('shako')!('harlequin crest shako')).toBe(true);
  });
});
