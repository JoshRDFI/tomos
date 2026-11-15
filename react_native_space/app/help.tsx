import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { List, Text, useTheme } from 'react-native-paper';
import { Stack } from 'expo-router';
import type { AppTheme } from '@/constants/theme';
import { spacing, fontFamilies } from '@/constants/theme';

const sections = [
  {
    title: 'Supported format',
    icon: 'file-check-outline',
    body: 'This app uses GGUF files only (llama.cpp format). Other formats like safetensors, .bin, PyTorch checkpoints, MLC, or ONNX must first be converted or re-downloaded as GGUF.',
  },
  {
    title: 'Which quantization?',
    icon: 'chip',
    body: `On a Pixel 9 Pro XL (~16 GB RAM), Q4_K_M is the best balance of quality and speed, and Q5_K_M is slightly better quality but larger.\n\nApproximate file sizes:\n• 3B Q4_K_M ≈ 2 GB\n• 7–8B Q4_K_M ≈ 4.5–5 GB\n• 8B Q5_K_M ≈ 5.7 GB\n\nAvoid models over ~9 GB. Larger context lengths also use more memory.`,
  },
  {
    title: 'Where to find models',
    icon: 'magnify',
    body: `Hugging Face is the main source \u2014 search for "GGUF" to find pre-quantized models.\n\nPopular uploaders: bartowski, TheBloke, lmstudio-community, unsloth.\n\nGood starters: Llama 3.1/3.2, Qwen 2.5, Gemma 2, Phi-3.5, Mistral 7B.`,
  },
  {
    title: 'Copying files to the phone',
    icon: 'usb',
    body: `Options:\n• USB cable to the Downloads folder (use File Transfer mode)\n• Android Files app\n• Download directly on the phone in a browser\n\nThen use Models → Add GGUF model. The app copies the file into its own storage, so you can delete the original afterwards to save space.`,
  },
  {
    title: 'Chat templates',
    icon: 'code-tags',
    body: `"Auto" reads the template embedded in the GGUF file. Most modern models include one.\n\nIf replies look garbled, cut off, or never stop generating, try setting the matching template manually in the Model Manager (… menu → Chat template).\n\nCommon templates: ChatML (default fallback), Llama 3, Gemma, Mistral, Phi, Zephyr, Vicuna, Alpaca.`,
  },
  {
    title: 'Model settings (llama.cpp)',
    icon: 'tune-variant',
    body: `Settings are layered; each level overrides the ones before it:\n\n1. App defaults\n2. Settings → Model settings for all chats\n3. Recommendations stored in the model file (read automatically)\n4. Settings → Settings per model (or Models → … → Settings)\n5. A chat's own settings (⚙ in the chat)\n\nUse "Add setting" to pick any llama.cpp option, or "Custom…" to type any llama.rn parameter name and value. "Paste flags" accepts a command from a model card, e.g. --temp 1.0 --top-p 0.95 --presence-penalty 1.0.\n\nSettings marked "reloads model" (context length, threads, GPU layers…) apply the next time the model loads; the app reloads it automatically before the next reply.`,
  },
  {
    title: 'Performance tips',
    icon: 'speedometer',
    body: `• Threads: use the number of fast cores (4 on a Pixel 9). More threads can be slower, because work spills onto the efficiency cores.\n• Keep context length at 4096 unless you need longer conversations.\n• The first load of a model takes longer than subsequent loads.\n• Smaller quantizations (Q4_K_M) run faster than larger ones (Q5_K_M, Q6_K).`,
  },
];

export default function HelpScreen() {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;

  return (
    <>
      <Stack.Screen options={{ title: 'Help', headerStyle: { backgroundColor: c.surface }, headerTintColor: c.text }} />
      <ScrollView style={{ flex: 1, backgroundColor: c.background }} contentContainerStyle={{ paddingBottom: 40 }}>
        <List.Section>
          {sections.map((s, i) => (
            <List.Accordion
              key={i}
              title={s.title}
              left={(props) => <List.Icon {...props} icon={s.icon} color={c.brand} />}
              titleStyle={{ color: c.text, fontFamily: fontFamilies.interMedium }}
              style={{ backgroundColor: c.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.hairline }}
            >
              <Text style={[styles.body, { color: c.text, fontFamily: fontFamilies.inter }]}>{s.body}</Text>
            </List.Accordion>
          ))}
        </List.Section>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 14, lineHeight: 22, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, paddingLeft: 56 },
});
