import { buildFtsQuery } from '@/lib/fts';

describe('buildFtsQuery', () => {
  it('returns null for blank input', () => {
    expect(buildFtsQuery('')).toBeNull();
    expect(buildFtsQuery('   ')).toBeNull();
  });
  it('quotes words and prefix-matches the last one', () => {
    expect(buildFtsQuery('hello wor')).toBe('"hello" "wor"*');
  });
  it('neutralizes FTS5 syntax characters and operators', () => {
    expect(buildFtsQuery("don't")).toBe('"don\'t"*');
    expect(buildFtsQuery('c++ foo:bar -x')).toBe('"c++" "foo:bar" "-x"*');
    expect(buildFtsQuery('cats OR dogs')).toBe('"cats" "OR" "dogs"*');
  });
  it('escapes embedded double quotes', () => {
    expect(buildFtsQuery('say "hi"')).toBe('"say" """hi"""*');
  });
});
