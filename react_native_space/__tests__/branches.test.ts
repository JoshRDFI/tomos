import { linearLinks, pathTo, versionsOf, visiblePath, type BranchNode } from '../lib/branches';

const m = (id: string, parentId: string | null, createdAt: number, selectedChildId: string | null = null): BranchNode =>
  ({ id, parentId, createdAt, selectedChildId });
const ids = (list: BranchNode[]) => list.map((x) => x.id);

// u1 → a1 (old reply) and a2 (regenerated), a1 → u2 → a3; u1' is an edited first prompt.
const tree = () => [
  m('u1', null, 1, 'a1'),
  m('a1', 'u1', 2, 'u2'),
  m('u2', 'a1', 3, 'a3'),
  m('a3', 'u2', 4),
  m('a2', 'u1', 5),
  m('u1b', null, 6),
];

describe('visiblePath', () => {
  it('follows the selected versions', () => {
    expect(ids(visiblePath(tree(), 'u1'))).toEqual(['u1', 'a1', 'u2', 'a3']);
  });

  it('switching a reply shows that branch', () => {
    const t = tree();
    t[0]!.selectedChildId = 'a2';
    expect(ids(visiblePath(t, 'u1'))).toEqual(['u1', 'a2']);
  });

  it('switching the first message shows its branch', () => {
    expect(ids(visiblePath(tree(), 'u1b'))).toEqual(['u1b']);
  });

  it('falls back to the newest version when nothing is selected', () => {
    expect(ids(visiblePath(tree(), null))).toEqual(['u1b']);
    const t = tree();
    t[0]!.selectedChildId = 'gone';
    expect(ids(visiblePath(t, 'u1'))).toEqual(['u1', 'a2']);
  });

  it('is empty for an empty chat and survives a cycle', () => {
    expect(visiblePath([], null)).toEqual([]);
    expect(ids(visiblePath([m('x', null, 1, 'y'), m('y', 'x', 2, 'x')], 'x'))).toEqual(['x', 'y']);
  });
});

describe('pathTo', () => {
  it('returns ancestors, first message first', () => {
    expect(ids(pathTo(tree(), 'u2'))).toEqual(['u1', 'a1', 'u2']);
    expect(ids(pathTo(tree(), 'a2'))).toEqual(['u1', 'a2']);
    expect(pathTo(tree(), null)).toEqual([]);
  });
});

describe('versionsOf', () => {
  it('lists siblings for messages that have them', () => {
    const t = tree();
    const v = versionsOf(t, visiblePath(t, 'u1'));
    expect(v.get('u1')).toEqual({ ids: ['u1', 'u1b'], index: 0 });
    expect(v.get('a1')).toEqual({ ids: ['a1', 'a2'], index: 0 });
    expect(v.has('u2')).toBe(false);
  });
});

describe('linearLinks', () => {
  it('chains a pre-branching chat', () => {
    expect(linearLinks([m('a', null, 1), m('b', null, 2), m('c', null, 3)])).toEqual([
      { id: 'a', parentId: null, selectedChildId: 'b' },
      { id: 'b', parentId: 'a', selectedChildId: 'c' },
      { id: 'c', parentId: 'b', selectedChildId: null },
    ]);
  });
});
