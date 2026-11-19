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
    body: `Hugging Face is the main source \u2014 search for "GGUF" to find pre-quantized models.\n\nThe quickest way in: copy a model's link (from a post, or the model page), then Models → Download from Hugging Face. The link field fills in from the clipboard. Tap Find files and pick a file. Links to an original model (not a GGUF one) show its GGUF versions to choose from.\n\nAndroid downloads the file in the background with a notification, so you can leave the app. Wi-Fi only is on by default. If a download fails, the Models screen shows why, with Retry.\n\nDownloading is the only time the app goes online: it asks Hugging Face for the model's file list, the first few MB of the file you pick (to check its format), and the file itself. Nothing else leaves the phone. Models that need a Hugging Face login aren't supported yet; download those in a browser and use Add GGUF model.\n\nPopular uploaders: bartowski, TheBloke, lmstudio-community, unsloth.\n\nGood starters: Llama 3.1/3.2, Qwen 2.5, Gemma 2, Phi-3.5, Mistral 7B.`,
  },
  {
    title: 'Copying files to the phone',
    icon: 'usb',
    body: `Options:\n• USB cable to the Downloads folder (use File Transfer mode)\n• Android Files app\n• Download directly on the phone in a browser\n\nThen use Models → Add GGUF model.\n\nImporting copies the file into the app's own storage; it doesn't move it. After the import, the app asks whether to delete the original (for example from Downloads) to free the space. The app doesn't need it, and models are several GB each. If you keep it, you can delete it later in the Files app.`,
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
    title: 'Thinking models',
    icon: 'lightbulb-outline',
    body: `Reasoning models (Qwen3, Bonsai, DeepSeek-R1 and others) think before they answer. The thinking appears in a collapsible "Thinking" section above the answer: open while the model thinks, then folded to "Thought for N s". Tap it to read the thinking.\n\nOnly the answer is copied, exported as text, searched, and sent back to the model in later turns. Markdown exports include the thinking in a collapsed block.\n\nTo turn thinking off for one chat, use the Thinking switch in Chat settings. For a model or all chats, add the "Thinking" setting in its settings and switch it off.\n\nAbliterated and "heretic" models (versions with their refusals removed) tend to work best with thinking off: their thinking is more likely to wander or run long. Turning it off for that model (Settings → its model → Thinking) saves doing it in every chat. Setting "Reasoning format" to None shows the raw output, tags included.`,
  },
  {
    title: 'Personas',
    icon: 'account-voice',
    body: `A persona gives the model a personality: instructions (who it is and how it replies), plus an optional greeting, example exchanges, and its own settings such as temperature. Pick one for each chat from the chip on a new chat or in Chat settings, and choose the one new chats start with in Settings.\n\nExamples shape the tone more than descriptions do, especially on small models: two or three short exchanges in the voice you want work better than a paragraph about it.\n\nA persona is sent with every message, so a long one leaves less room for the conversation. The editor shows roughly how many tokens it uses.\n\nImport a Markdown file (for example a soul.md) from Settings → Personas → Import: the whole file becomes the instructions, or use "## Greeting" and "## Examples" sections (User: / Assistant: lines) for the rest. Notes between <!-- and --> are ignored, so a file can explain itself. The project's source code has a commented template, personas/soul.md. Export writes the same format.`,
  },
  {
    title: 'Repetition',
    icon: 'repeat-variant',
    body: `Small local models sometimes repeat themselves: the same phrases in every reply, or a "continued" story that retells the last part with small changes. Three settings help. Add them in Chat settings → Settings for this chat, or on a model in Settings so every chat with it gets them:\n\n• DRY multiplier (on at 0.8 by default): penalises repeating any run of words from anywhere in the chat. Try 1.0–1.5 if a model still copies sentences. DRY base, allowed length and last N only matter while it's above 0.\n• Presence penalty (0 by default): discourages words already used, which catches reworded repeats that DRY misses. Try 1.0, up to 1.5; Qwen recommends this for its models. Higher makes the writing stiff.\n• Repeat last N (512 by default): how far back presence, frequency and repeat penalty look, about the last reply or two. Raise it to 1024 if a model repeats from further back.\n\nA model copies its own earlier replies: once a closing line appears twice, it becomes the pattern. Long-press a reply → Edit reply to cut a repeated line before you answer, or regenerate it, and ask in the persona's instructions for what you want, e.g. "End on action or dialogue, never a recap or a question. Don't repeat what the user said."\n\nHow you ask matters too. "Continue" invites a retelling; "Now the storm hits" or "Tell it from her side" gives the model something new to write. Abliterated and "heretic" models repeat more than their originals.`,
  },
  {
    title: 'Long chats',
    icon: 'text-box-multiple-outline',
    body: `A model can only read so much at once (its context window). When a chat gets close to that, the app asks the model to condense the oldest messages into a short summary, right after a reply. You'll see "Condensing earlier messages…" for a minute or so; you can keep typing, and sending a message stops it.\n\nA divider marks where the summary starts; tap it to read the summary. Every message stays saved and visible: only what the model reads changes. If you edit a message that was condensed, the summary no longer applies to that version.\n\nTo start fresh but keep the thread, use Chat settings → Continue in a new chat. The new chat starts with the summary and your last exchange, the same persona and settings, and a link back to the old chat.`,
  },
  {
    title: 'Versions, continuing and backups',
    icon: 'source-branch',
    body: `Regenerating a reply or editing a message or reply (long-press → Edit) keeps the old one: use ‹ 2/3 › under the message to switch between versions.\n\nIf a reply was stopped or cut off by the length limit, tap ▷ under it (or long-press → Continue) to let the model carry on from where it stopped.\n\nSettings → Backup saves all chats, personas and settings to one file you can keep in Files or Drive, and restores them later (model files aren't included).`,
  },
  {
    title: 'Performance tips',
    icon: 'speedometer',
    body: `• Threads: use the number of fast cores (4 on a Pixel 9). More threads can be slower, because work spills onto the efficiency cores.\n• Context length is 8192 by default (less if the model was trained for less). Lower it to 4096 if a model loads slowly or the app runs out of memory; raise it for fewer summaries in long chats.\n• The first load of a model takes longer than subsequent loads.\n• Smaller quantizations (Q4_K_M) run faster than larger ones (Q5_K_M, Q6_K).`,
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
