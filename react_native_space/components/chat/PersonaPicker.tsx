import React, { useState, type ReactNode } from 'react';
import { Menu, Divider } from 'react-native-paper';
import { useRouter } from 'expo-router';
import type { PersonaChoice } from '@/lib/db';
import type { Persona } from '@/types';

/** Label for a choice ("Default" for no persona). */
export function personaChoiceLabel(choice: PersonaChoice, personas: Persona[], noneLabel = 'Default'): string {
  if (choice.kind === 'custom') return 'Custom';
  if (choice.kind === 'persona') return personas.find((p) => p.id === choice.id)?.name ?? noneLabel;
  return noneLabel;
}

interface Props {
  value: PersonaChoice;
  personas: Persona[];
  allowCustom: boolean;
  onChange: (c: PersonaChoice) => void;
  anchor: (open: () => void) => ReactNode;
  /** "Import from file…": pick a Markdown file; the parent imports it and applies it. */
  onImport?: () => void;
}

/** No persona (default system prompt) / each persona / Custom, then Import from file… / Manage personas…. */
export default function PersonaPicker({ value, personas, allowCustom, onChange, anchor, onImport }: Props) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pick = (c: PersonaChoice) => {
    setOpen(false);
    onChange(c);
  };
  const isPersona = (id: string) => value.kind === 'persona' && value.id === id;
  return (
    <Menu visible={open} onDismiss={() => setOpen(false)} anchor={anchor(() => setOpen(true))}>
      <Menu.Item title="No persona (default system prompt)" leadingIcon={value.kind === 'none' ? 'check' : undefined} onPress={() => pick({ kind: 'none' })} />
      {personas.map((p) => (
        <Menu.Item key={p.id} title={p.name} leadingIcon={isPersona(p.id) ? 'check' : undefined} onPress={() => pick({ kind: 'persona', id: p.id })} />
      ))}
      {allowCustom && (
        <Menu.Item
          title="Custom"
          leadingIcon={value.kind === 'custom' ? 'check' : undefined}
          onPress={() => pick({ kind: 'custom', text: value.kind === 'custom' ? value.text : '' })}
        />
      )}
      <Divider />
      {onImport && (
        <Menu.Item title="Import from file…" leadingIcon="file-import-outline" onPress={() => { setOpen(false); onImport(); }} />
      )}
      <Menu.Item title="Manage personas…" leadingIcon="account-cog-outline" onPress={() => { setOpen(false); router.push('/settings/personas'); }} />
    </Menu>
  );
}
