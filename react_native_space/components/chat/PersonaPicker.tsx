import React, { useState, type ReactNode } from 'react';
import { Menu } from 'react-native-paper';
import type { PersonaChoice } from '@/lib/db';
import type { Persona } from '@/types';

/** Label for a choice ("Default" for no persona). */
export function personaChoiceLabel(choice: PersonaChoice, personas: Persona[]): string {
  if (choice.kind === 'custom') return 'Custom';
  if (choice.kind === 'persona') return personas.find((p) => p.id === choice.id)?.name ?? 'Default';
  return 'Default';
}

interface Props {
  value: PersonaChoice;
  personas: Persona[];
  allowCustom: boolean;
  onChange: (c: PersonaChoice) => void;
  anchor: (open: () => void) => ReactNode;
}

/** No persona (default system prompt) / each persona / Custom. */
export default function PersonaPicker({ value, personas, allowCustom, onChange, anchor }: Props) {
  const [open, setOpen] = useState(false);
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
    </Menu>
  );
}
