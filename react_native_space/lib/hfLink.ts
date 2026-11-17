// Parse a Hugging Face link as people paste it: a model card, a file page,
// a resolve link, a bare "owner/repo", or a post's text with a link inside.

export interface HfLink {
  repo: string;
  revision: string | null;
  file: string | null;
}

const NOT_REPOS = new Set(['docs', 'spaces', 'datasets', 'models', 'api', 'settings', 'blog', 'papers', 'collections', 'organizations']);
const URL_RE = /(?:https?:\/\/)?(?:www\.)?(?:huggingface\.co|hf\.co)\/[^\s]*/i;
const NAME_RE = /^[\w.-]+$/;

export function parseHfLink(input: string): HfLink | null {
  const text = input.trim();
  // Sentence punctuation right after a pasted link isn't part of it.
  const url = text.match(URL_RE)?.[0]?.replace(/[.,;:!?)\]]+$/, '');
  if (!url) {
    const parts = text.split('/');
    return parts.length === 2 && parts.every((p) => NAME_RE.test(p)) ? { repo: text, revision: null, file: null } : null;
  }
  const path = url.replace(/^(?:https?:\/\/)?(?:www\.)?[^/]+\//i, '').replace(/[?#].*$/, '');
  let segs: string[];
  try {
    segs = path.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  } catch {
    return null; // malformed %-escape
  }
  if (segs.length < 2 || NOT_REPOS.has(segs[0].toLowerCase()) || !NAME_RE.test(segs[0]) || !NAME_RE.test(segs[1])) return null;
  const repo = `${segs[0]}/${segs[1]}`;
  if (['tree', 'blob', 'resolve'].includes(segs[2]) && segs[3]) {
    const file = segs.slice(4).join('/');
    return { repo, revision: segs[3], file: segs[2] === 'tree' || !file ? null : file };
  }
  return { repo, revision: null, file: null };
}
