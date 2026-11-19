import { exportFileName, exportText, type ExportDeps } from '../lib/exportFile';

describe('exportFileName', () => {
  it('keeps letters, digits, spaces, dashes and underscores', () => expect(exportFileName('Luci the guide', '.md')).toBe('Luci the guide.md'));
  it('replaces other characters', () => expect(exportFileName('Trip: day 1/2?', '.txt')).toBe('Trip_ day 1_2_.txt'));
  it('falls back when the title is empty', () => expect(exportFileName('  ', '.md', 'persona')).toBe('persona.md'));
});

function deps(choice: 'save' | 'share' | 'cancel', saved = true) {
  const calls: string[] = [];
  const d: ExportDeps = {
    choose: async () => choice,
    save: async (name, mime) => { calls.push(`save:${name}:${mime}`); return saved; },
    share: async (name, mime) => { calls.push(`share:${name}:${mime}`); },
  };
  return { d, calls };
}

describe('exportText', () => {
  const file = { name: 'Luci.md', mimeType: 'text/markdown', content: '# Luci' };
  it('saves to the phone', async () => {
    const { d, calls } = deps('save');
    expect(await exportText(file, d)).toBe('saved');
    expect(calls).toEqual(['save:Luci.md:text/markdown']);
  });
  it('a cancelled save picker is a cancel', async () => {
    const { d } = deps('save', false);
    expect(await exportText(file, d)).toBe('cancelled');
  });
  it('shares', async () => {
    const { d, calls } = deps('share');
    expect(await exportText(file, d)).toBe('shared');
    expect(calls).toEqual(['share:Luci.md:text/markdown']);
  });
  it('cancel does nothing', async () => {
    const { d, calls } = deps('cancel');
    expect(await exportText(file, d)).toBe('cancelled');
    expect(calls).toEqual([]);
  });
});
