// Personas as Markdown files (so a soul.md can be imported). Pure.
//
//   ---
//   name: Friendly explainer
//   temperature: 0.8
//   ---
//   <instructions>
//
//   ## Greeting
//   <greeting>
//
//   ## Examples
//   User: …
//   Assistant: …
import { CATALOG_BY_KEY } from './paramCatalog';
import { parseValue, type ParamSet } from './params';
import { completionParamsOnly } from './personas';
import type { Persona, PersonaExample } from '@/types';

export type PersonaDraft = Pick<Persona, 'name' | 'content' | 'greeting' | 'examples' | 'params'>;

const SECTION = /^##\s+(greeting|examples)\s*$/i;

function nameFromFile(fileName: string): string {
  const base = (fileName.split('/').pop() ?? fileName).replace(/\.[^.]+$/, '').trim() || 'Imported persona';
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function parseFrontMatter(text: string): { fields: Record<string, string>; body: string } {
  if (!text.startsWith('---\n')) return { fields: {}, body: text };
  const end = text.indexOf('\n---', 4);
  if (end < 0) return { fields: {}, body: text };
  const fields: Record<string, string> = {};
  for (const line of text.slice(4, end).split('\n')) {
    const m = /^\s*([A-Za-z_][\w.-]*)\s*:\s*(.*)$/.exec(line);
    if (m) fields[m[1]!] = m[2]!.trim();
  }
  const after = text.indexOf('\n', end + 4);
  return { fields, body: after < 0 ? '' : text.slice(after + 1) };
}

function parseExamples(lines: string[]): PersonaExample[] {
  const out: PersonaExample[] = [];
  let user: string[] | null = null;
  let assistant: string[] | null = null;
  let cur: string[] | null = null;
  const flush = () => {
    const u = user?.join('\n').trim();
    const a = assistant?.join('\n').trim();
    if (u && a) out.push({ user: u, assistant: a });
    user = assistant = cur = null;
  };
  for (const line of lines) {
    const um = /^User:\s?(.*)$/.exec(line);
    const am = /^Assistant:\s?(.*)$/.exec(line);
    if (um) {
      flush();
      user = [um[1]!];
      cur = user;
    } else if (am && user) {
      assistant = [am[1]!];
      cur = assistant;
    } else if (cur) {
      cur.push(line);
    }
  }
  flush();
  return out;
}

export function parsePersonaMarkdown(text: string, fileName: string): PersonaDraft {
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const { fields, body } = parseFrontMatter(clean);

  const sections: Record<string, string[]> = { instructions: [] };
  let current = 'instructions';
  for (const line of body.split('\n')) {
    const m = SECTION.exec(line);
    if (m) {
      current = m[1]!.toLowerCase();
      sections[current] = [];
    } else {
      sections[current]!.push(line);
    }
  }

  const params: ParamSet = {};
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'name' || !CATALOG_BY_KEY[k]) continue;
    const value = parseValue(k, v);
    if (value !== undefined) params[k] = value;
  }

  const greeting = sections.greeting?.join('\n').trim() || null;
  return {
    name: fields.name?.trim() || nameFromFile(fileName),
    content: sections.instructions!.join('\n').trim(),
    greeting,
    examples: sections.examples ? parseExamples(sections.examples) : [],
    params: completionParamsOnly(params),
  };
}

function formatValue(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v);
}

export function serializePersonaMarkdown(p: PersonaDraft): string {
  const front = ['---', `name: ${p.name}`, ...Object.entries(p.params).map(([k, v]) => `${k}: ${formatValue(v)}`), '---'];
  const parts = [front.join('\n'), p.content.trim()];
  if (p.greeting) parts.push(`## Greeting\n${p.greeting.trim()}`);
  if (p.examples.length) {
    parts.push(`## Examples\n${p.examples.map((e) => `User: ${e.user.trim()}\nAssistant: ${e.assistant.trim()}`).join('\n\n')}`);
  }
  return parts.join('\n\n') + '\n';
}
