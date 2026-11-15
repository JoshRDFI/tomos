/**
 * Message branches: editing a prompt or regenerating a reply adds a sibling
 * version instead of deleting the old one.
 *
 * Every message has a parent (null for the first message). A parent's
 * `selectedChildId` (or the session's `rootMessageId` for first messages)
 * picks which version is shown; the visible chat is the path that follows
 * those choices.
 *
 * Model follows DeepSeek's chat demo (src/services/chat/branches.ts, MIT,
 * Copyright (c) 2026 DeepSeek; full notice in lib/markdown.ts), reworked for
 * rows in SQLite.
 */

export interface BranchNode {
  id: string;
  parentId?: string | null;
  selectedChildId?: string | null;
  createdAt: number;
}

export interface Versions {
  /** Sibling ids, oldest first. */
  ids: string[];
  /** Position of this message among them. */
  index: number;
}

function childrenByParent<T extends BranchNode>(all: T[]): Map<string | null, T[]> {
  const map = new Map<string | null, T[]>();
  for (const m of all) {
    const key = m.parentId ?? null;
    const list = map.get(key);
    if (list) list.push(m);
    else map.set(key, [m]);
  }
  for (const list of map.values()) list.sort((a, b) => a.createdAt - b.createdAt);
  return map;
}

/**
 * The messages shown: from the selected first message, follow each selected
 * child. A missing or unknown selection falls back to the newest version.
 */
export function visiblePath<T extends BranchNode>(all: T[], rootMessageId: string | null | undefined): T[] {
  const children = childrenByParent(all);
  const pick = (list: T[] | undefined, selected: string | null | undefined) =>
    list && list.length > 0 ? (list.find((m) => m.id === selected) ?? list[list.length - 1]) : undefined;

  const path: T[] = [];
  const seen = new Set<string>();
  let cur = pick(children.get(null), rootMessageId);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.push(cur);
    cur = pick(children.get(cur.id), cur.selectedChildId);
  }
  return path;
}

/** `leafId` and its ancestors, first message first. */
export function pathTo<T extends BranchNode>(all: T[], leafId: string | null): T[] {
  const byId = new Map(all.map((m) => [m.id, m]));
  const path: T[] = [];
  const seen = new Set<string>();
  let cur = leafId ? byId.get(leafId) : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.push(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path.reverse();
}

/** Versions of each message on `path` that has siblings. */
export function versionsOf<T extends BranchNode>(all: T[], path: T[]): Map<string, Versions> {
  const children = childrenByParent(all);
  const out = new Map<string, Versions>();
  for (const m of path) {
    const siblings = children.get(m.parentId ?? null) ?? [];
    if (siblings.length > 1) {
      const ids = siblings.map((s) => s.id);
      out.set(m.id, { ids, index: ids.indexOf(m.id) });
    }
  }
  return out;
}

/**
 * Parent links for a chat stored before branching existed: each message's
 * parent is the one before it.
 */
export function linearLinks<T extends BranchNode>(ordered: T[]): { id: string; parentId: string | null; selectedChildId: string | null }[] {
  return ordered.map((m, i) => ({
    id: m.id,
    parentId: ordered[i - 1]?.id ?? null,
    selectedChildId: ordered[i + 1]?.id ?? null,
  }));
}
