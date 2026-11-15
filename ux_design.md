# Local LLM Chat — UX Spec (Android, on-device, offline)

## Platform and runtime notes (binding)
- Target: Android APK / dev build on a Pixel 9 Pro XL (about 16 GB RAM). `llama.rn` is a native module and does not run in Expo Go. On web, show one full-screen notice: "On-device inference requires the Android app". No other web support is needed.
- No accounts, no network calls, no backend. All persistence uses `expo-sqlite`. Model files live in `FileSystem.documentDirectory + 'models/'`.
- Libraries:
  - `llama.rn` for inference
  - `expo-document-picker`, `expo-file-system` (copying files, free space), `expo-device` (`Device.totalMemory`)
  - `expo-keep-awake`, `expo-clipboard`, `expo-sharing`, `expo-haptics`
  - `react-native-markdown-display`, `react-native-drawer-layout`, `@shopify/flash-list`
  - `react-native-paper`, `@expo-google-fonts/inter`, `@expo-google-fonts/jetbrains-mono`
  - Icons: MaterialCommunityIcons only, never emoji.

## File structure (expo-router)
```
app/
  _layout.tsx          // fonts, DatabaseProvider, SettingsProvider, ModelProvider, PaperProvider (theme from settings); renders <Stack> with headerShown false on index, standard headers + back arrow elsewhere
  index.tsx            // Chat screen (contains the left Drawer via react-native-drawer-layout)
  chat-settings.tsx    // Per-chat system prompt + parameters (query param ?sessionId=)
  search.tsx           // Full-text search across chats
  models.tsx           // Model Manager
  settings/
    index.tsx          // Global settings (appearance, default system prompt, default params)
    presets.tsx        // System prompt presets (list/create/edit/delete)
  help.tsx             // Help / info
constants/theme.ts
lib/db.ts             // schema, migrations, queries
lib/llama.ts          // context init/release, completion, template formatting
lib/templates.ts      // ChatML, Llama 3, Gemma, Mistral, Phi, Zephyr, Vicuna, Alpaca, raw formatters + stop strings
lib/gguf.ts           // quantization-from-filename parser
contexts/SettingsContext.tsx, contexts/ModelContext.tsx
```
No tabs and no `(group)` folders. The drawer is a component inside `index.tsx`, not a navigator. Secondary screens are stack screens pushed from it.

## Local data model (expo-sqlite, created in `lib/db.ts` on first launch)

**settings** — key TEXT PK, value TEXT (JSON). Keys:
- `themeMode`: 'dark' | 'light' | 'system'; default 'dark'
- `defaultSystemPrompt`; default "You are a helpful, concise assistant."
- `defaultParams`: GenParams JSON
- `lastSessionId`
- `lastModelId`

**models**
- id TEXT PK (uuid)
- displayName TEXT
- fileName TEXT
- filePath TEXT (absolute path in documentDirectory/models)
- fileSizeBytes INTEGER
- quantization TEXT NULL (for example Q4_K_M)
- architecture TEXT NULL
- parameterLabel TEXT NULL (for example 8B)
- detectedTemplate TEXT NULL: raw `tokenizer.chat_template` present → 'auto-available'; else null
- templateOverride TEXT: 'auto' | 'chatml' | 'llama3' | 'gemma' | 'mistral' | 'phi' | 'zephyr' | 'vicuna' | 'alpaca' | 'raw'; default 'auto'
- trainedContext INTEGER NULL
- addedAt INTEGER

**sessions**
- id TEXT PK
- title TEXT; default 'New chat', auto-set from the first 40 chars of the first user message
- modelId TEXT NULL, FK models ON DELETE SET NULL
- systemPromptOverride TEXT NULL: null means use the global default
- paramsOverride TEXT NULL: GenParams JSON; null means use the global defaults
- createdAt INTEGER
- updatedAt INTEGER (indexed DESC)

**messages**
- id TEXT PK
- sessionId TEXT, FK sessions ON DELETE CASCADE, indexed
- role TEXT: 'user' | 'assistant'
- content TEXT
- modelName TEXT NULL
- tokenCount INTEGER NULL
- tokensPerSec REAL NULL
- stopped INTEGER: 0 or 1, set when the user stopped generation
- createdAt INTEGER

**messages_fts** — FTS5 virtual table (content, sessionId UNINDEXED, messageId UNINDEXED), kept in sync by triggers on insert, update and delete of messages.

**prompt_presets**
- id TEXT PK
- name TEXT UNIQUE
- content TEXT
- createdAt INTEGER

**GenParams** = {temperature, topP, topK, minP, repeatPenalty, maxTokens, contextLength, threads}

| Param | Default | Range |
|---|---|---|
| temperature | 0.7 | 0–2, step 0.05 |
| topP | 0.9 | 0–1, step 0.01 |
| topK | 40 | 0–200 |
| minP | 0.05 | 0–1, step 0.01 |
| repeatPenalty | 1.1 | 1.0–2.0, step 0.01 |
| maxTokens | 1024 | 16–8192 |
| contextLength | 4096 | 512–32768, steps of 512 |
| threads | 6 | 1–8 |

Effective params for a session = `paramsOverride ?? defaultParams`.

## Inference behaviour (`lib/llama.ts`, ModelContext)

**ModelContext state and actions**
- State: `loadedModelId`, `loadedCtxParams` ({contextLength, threads}), `status` ('idle' | 'loading' | 'ready' | 'error'), `error`, `isGenerating`.
- Actions: `loadModel(modelId, ctxParams)`, `unload()`, `generate(sessionId, messages, onToken)`, `stop()`.

**Loading**
- `initLlama({model: filePath, n_ctx, n_threads, use_mlock: false})`.
- Release any previous context first.
- Before init, if `fileSizeBytes > 0.6 * Device.totalMemory`, show the error: "This model (X GB) is likely too large for this phone's memory. Try a smaller quantization like Q4_K_M or a model of 8B parameters or fewer."
- If init throws, show: "Couldn't load this file. It may not be a valid GGUF model or may be corrupted." plus the native message in a collapsible "Details" area.

**Templates**
- `templateOverride === 'auto'` and the GGUF has `tokenizer.chat_template`: call `context.completion({messages, jinja: true, ...})` so llama.rn applies the model's own template.
- Otherwise (auto with no template, or a manual choice): build the prompt string with the matching formatter in `lib/templates.ts` and pass `prompt` plus that template's `stop` strings.
- Auto with no embedded template falls back to ChatML and shows a one-time snackbar: "No template in file — using ChatML. Change it in Model Manager."

**Messages and sampling**
- The messages sent are `[system (effective system prompt, omitted if empty), ...session messages]`.
- Sampling params map to `temperature`, `top_p`, `top_k`, `min_p`, `penalty_repeat`, `n_predict`.

**Streaming and stats**
- The partial-token callback appends to the in-progress assistant bubble.
- The result's `timings.predicted_per_second` is stored as `tokensPerSec`, and `timings.predicted_n` as `tokenCount`.

**Context and model changes**
- If the session's effective contextLength or threads differ from `loadedCtxParams`, or the session's modelId differs from `loadedModelId`, reload the model before generating. Show the loading banner while it reloads.
- `activateKeepAwakeAsync('gen')` runs when generation starts; `deactivateKeepAwake('gen')` runs on finish, stop or error.
- On app start, if `lastModelId` exists, auto-load it in the background.

<screens>

### 1. Chat (app/index.tsx) — first screen
**Purpose:** full-screen conversation with the local model.

**Top bar** (56dp, surface colour, hairline bottom border):
- Left: hamburger icon button (`menu`, a11y "Open menu").
- Centre-left: current model name (titleSmall, one line, ellipsized) plus the quant chip beneath in caption mono (for example `Q4_K_M · 8B`). Tapping the model name opens a model-switch menu (react-native-paper Menu):
  - Lists library models with a check on the current one.
  - Last item: "Manage models…", which pushes Model Manager.
  - Picking a model sets `session.modelId` and loads it. This works mid-session; history is kept.
- Right: `tune-variant` icon button (a11y "Chat settings"), which pushes Chat Settings for this session.

**Model-status banner** (below the top bar, only when relevant):
- Loading: thin indeterminate progress bar plus "Loading Llama-3.1-8B… (first load can take 10–30 s)".
- Error: amber-tinted band with the error text and a "Details" expander.

**Message list** (FlashList, inverted, 16dp horizontal padding)
- User bubble:
  - Right-aligned, max 85% width, `userBubble` colour, radius 18 with a 6 bottom-right corner.
  - Body text, plain.
- Assistant message:
  - Left-aligned and full width, `assistantBubble` colour, radius 18 with a 6 top-left corner.
  - Rendered with `react-native-markdown-display` styled from the theme: headings, lists, bold, inline code, tables.
  - Fenced code blocks: `codeBg` panel, JetBrains Mono 13, horizontal scroll, header row with the language label and a "Copy" text button.
- Footer row under each assistant message (caption mono, secondary colour):
  - `412 tok · 18.3 tok/s`, plus `· stopped` when stopped.
  - Icon buttons: copy (`content-copy`) on every assistant message; regenerate (`refresh`) only on the last one.
- While streaming:
  - The bubble shows text as it arrives, with a blinking block cursor ▍.
  - Before the first token, it shows three pulsing dots.

**Long-press menu on a message** (bottom sheet via Paper Portal + Modal):
- Copy (both roles).
- "Edit & resend" (user messages only).
- "Regenerate" (last assistant message only).
- Copy triggers a light haptic and the snackbar "Copied".

**Edit & resend**
- The composer switches to edit mode with the text prefilled and an "Editing message" chip with a ✕ (`close`) to cancel.
- Send updates that message, deletes every later message in the session, then generates a new reply.

**Regenerate**
- Deletes the last assistant message and generates again from the same history.

**Composer** (docked bottom, surface colour, safe-area aware)
- Multiline TextInput, 1–6 lines, placeholder "Message".
- Circular 48dp action button on the right:
  - Send (`arrow-up`, brand fill) when idle; disabled when the input is empty or no model is ready.
  - Stop (`stop`, accent fill) while generating, which calls `stop()`. The partial reply is saved with `stopped = 1`.
- Sending persists the user message, creates the assistant message row on completion and updates `session.updatedAt`.

**Empty states (first-run content)**
- **No models in library:** centred focal card on a tinted `brandTint` block:
  - Icon `chip`, title "Run models on your phone".
  - Body: "Add a GGUF model file (e.g. Q4_K_M, 3B–8B) to start chatting offline."
  - Primary button "Add a model", which pushes Model Manager and auto-opens the file picker.
  - Text button "What files do I need?", which pushes Help.
- **Model ready, empty chat:**
  - Large model name (display style, wraps to two lines max) with its quant/size chip.
  - Below it, 4 suggestion chips that fill the composer when tapped: "Explain a concept simply", "Summarize this text:", "Write a Python function that…", "Brainstorm ideas for…".
  - These sit in the lower half, above the composer.
- **Session has no model and the library is not empty:** inline row "Choose a model for this chat" with a button that opens the model-switch menu.

**Drawer (left, react-native-drawer-layout, width 84% max 360dp, surface colour)**
- Header: app title "Local Chat" (titleLarge) and a full-width primary button "New chat" (`plus`).
  - New chat creates a session with `modelId = loadedModelId ?? lastModelId`, closes the drawer and shows that session.
- Search field row: tapping it pushes Search.
- "Chats" section: FlashList of sessions ordered by updatedAt DESC, grouped under captions Today / Yesterday / Previous 7 days / Older.
  - Each row (52dp): title (one line), and a secondary line with the model name and relative time.
  - The active session has a `brandTint` background and a 3dp brand left bar.
  - Tap: switch session and close the drawer.
  - Row trailing `dots-vertical` menu: Rename, Export as Markdown, Export as text, Delete.
- Pinned bottom section (hairline top border) with three list rows:
  - "Models" (`chip`) → push Model Manager.
  - "Settings" (`cog-outline`) → push Settings.
  - "Help" (`help-circle-outline`) → push Help.

**Drawer dialogs and actions**
- Rename: Paper Dialog with a TextInput and Save/Cancel.
- Delete: confirm Dialog "Delete this chat? This can't be undone." Deleting the active session switches to the most recent remaining session, or a new empty one.
- Export:
  - Build a string with title, model and date, then each message.
  - Markdown: `**You:**` / `**Assistant:**` with content as-is.
  - Text: `You:` / `Assistant:`.
  - Write it to `cacheDirectory/<title>.md|.txt` and call `Sharing.shareAsync`.

**Startup:** open the `lastSessionId` session if it exists; otherwise create a new empty session.

### 2. Chat Settings (app/chat-settings.tsx?sessionId=)
Stack header: "Chat settings" with a back arrow.

**System prompt section**
- Switch "Use default system prompt" (on when `systemPromptOverride` is null).
- When off, a multiline TextInput (4–10 lines) shows the override.
- Buttons:
  - "Load preset": menu of presets that fills the field.
  - "Save as preset": name dialog, inserts into prompt_presets; a duplicate name shows an inline error.

**Parameters section**
- Switch "Use global defaults". When off, show controls for all 8 GenParams, each as a row with a label, current value in mono, and a slider (`@react-native-community/slider`) with ±step buttons.
- Note under contextLength/threads: "Changing this reloads the model on next message."
- Text button "Reset to defaults" copies the global defaults into the override.

**Model row:** shows the session's model with a "Change" button (same model menu as in the chat).

Changes auto-save to sessions on blur or change (debounced 300 ms).

### 3. Search (app/search.tsx)
- Header with an autofocused search TextInput.
- Queries `messages_fts MATCH ?` (prefix query `term*`), debounced 250 ms, limit 100, joined to the session title.
- Result rows:
  - Session title (titleSmall).
  - A snippet using FTS5 `snippet()` with the matched term in brand colour and bold.
  - Role and date caption.
- Tap: set the active session, pop back to Chat and scroll to that message (briefly highlighted with a `brandTint` flash).
- Empty query: hint text "Search across all your chats".
- No results: "No matches for ‘term’".

### 4. Model Manager (app/models.tsx)
Stack header: "Models", with a "Help" icon button on the right that pushes Help.

**Storage card** (tinted block): "Library: N models · X.X GB used · Y.Y GB free" (from `getFreeDiskStorageAsync`) and "Device RAM: 16 GB".

**Primary button "Add GGUF model"**
1. Open `DocumentPicker.getDocumentAsync({type: '*/*', copyToCacheDirectory: false})`.
2. Validate: the name ends with `.gguf` (case-insensitive), else show the error "Not a GGUF file. Only .gguf models are supported."
3. Check free space against size, else show "Not enough storage to import (needs X GB)."
4. Copy to `documentDirectory/models/<uuid>-<fileName>` with a progress dialog: indeterminate bar, "Importing 4.9 GB… keep the app open", and a Cancel button.
5. Read metadata via `loadLlamaModelInfo(path)`: `general.name`, `general.architecture`, `general.file_type`, `general.size_label`, `<arch>.context_length`, `tokenizer.chat_template`.
6. Quantization comes from the filename regex `(IQ\d_[A-Z_]+|Q\d_K_[SML]|Q\d_K|Q\d_\d|F16|BF16|F32)` (case-insensitive), falling back to file_type.
7. If metadata reading fails, delete the copy and show: "This file isn't a readable GGUF model."

**Model list** (cards, one per model)
- displayName (titleMedium).
- Chips in mono: quant, parameter label, size (for example `4.92 GB`), architecture.
- Template line: "Template: Auto (from file)" or "Template: ChatML (manual)".
- Memory hint chip:
  - Green "Fits" when size ≤ 40% RAM.
  - Amber "Tight" at 40–60%.
  - Red "Too large" above 60%; Load still attempts after a confirm.
- Actions:
  - Primary "Load", or a "Loaded" badge with a check when current. Loading shows an inline spinner and "Loading…".
  - Overflow menu: "Chat template…" (radio dialog: Auto, ChatML, Llama 3, Gemma, Mistral, Phi, Zephyr, Vicuna, Alpaca, Raw/none), "Rename", "Remove".
  - Remove: confirm "Remove model and delete its file from app storage?" This unloads it if loaded, deletes the file, deletes the row, and sessions using it get modelId null.
- Load: if no session is generating, load the model and set it as the active session's model.

**States:** an empty state matching the Chat no-model card; an error band for load failures with Retry.

### 5. Settings (app/settings/index.tsx)
- **Appearance:** SegmentedButtons Dark / Light / System (default Dark). Applies instantly.
- **Default system prompt:**
  - Multiline TextInput.
  - "Load preset" menu.
  - Row "Manage presets" → push Presets.
- **Default generation parameters:** the same 8 controls as Chat Settings, plus "Reset to defaults", which restores the factory values in the table above.
- **About:** app version and "All data stays on this device."

### 6. Presets (app/settings/presets.tsx)
- List of presets: name plus a 2-line content preview.
- FAB "New preset".
- Tap a preset to open an edit dialog (name and content).
- Swipe or overflow menu to delete, with a confirm.
- Empty state with one tap-to-add suggestion card per starter preset: "Concise assistant", "Code reviewer", "Writing editor". Each card shows its content prefilled.

### 7. Help (app/help.tsx)
Static sections as Paper List.Accordion items:
1. **Supported format:** GGUF only (llama.cpp). Other formats (safetensors, .bin, PyTorch, MLC, ONNX) must be converted or downloaded as GGUF.
2. **Which quantization:** On a Pixel 9 Pro XL (~16 GB RAM), Q4_K_M is the best balance and Q5_K_M is slightly better quality, for 3B–8B models. Approximate file sizes: 3B Q4_K_M ≈ 2 GB, 7–8B Q4_K_M ≈ 4.5–5 GB, 8B Q5_K_M ≈ 5.7 GB. Avoid models over ~9 GB; larger context lengths use more memory.
3. **Where to find models:** Hugging Face (search "GGUF"), bartowski, TheBloke, lmstudio-community, unsloth. Good starters: Llama 3.1/3.2, Qwen 2.5, Gemma 2, Phi-3.5, Mistral 7B.
4. **Copying files to the phone:** USB cable to the Downloads folder (File Transfer mode), Android Files app, or downloading directly on the phone in a browser. Then use Models → Add GGUF model. The app copies the file into its own storage, so you can delete the original afterwards to save space.
5. **Chat templates:** Auto reads the template from the file. If replies look garbled or never stop, set the matching template in Models.
6. **Performance tips:** 4–6 threads is usually fastest. Keep context at 4096 unless needed. The first load is slower.

</screens>

<navigation>
- No authentication and no auth guards. The app opens directly on Chat.
- Root `<Stack>` in `app/_layout.tsx`:
  - `index` (Chat): headerShown false, with its custom top bar.
  - `chat-settings`, `search`, `models`, `settings/index`, `settings/presets`, `help`: native headers with a back arrow. They slide in from the right on push and pop on back or the Android back button.
- Left drawer lives only on Chat. It opens via the hamburger or a swipe from the left edge, and closes on scrim tap, swipe, back press or selection.
- Drawer actions:
  - Selecting a session or tapping New chat closes the drawer and swaps the session in place (no navigation).
  - Models, Settings, Help and the search field close the drawer and push their screen.
- Search result tap: pop to Chat with the target session and message highlighted.
- Model Manager and Help are also reachable from the Chat empty state and the model-switch menu.
- When the theme mode changes, SettingsContext updates and the PaperProvider theme swaps app-wide (state-driven, no navigation).
</navigation>

<design_direction>
**Audience and moment:** one technical user running local models on their own Pixel, often for long sessions, frequently at night. The app should feel quiet, precise and tool-like: a well-made terminal companion, not a consumer chatbot.

**First screen:** the Chat screen of the last session. The conversation fills the screen. The composer and send/stop button sit at the bottom in thumb reach, and the model name in the slim top bar confirms what is running. On an empty chat, the model name is the largest element, with suggestion chips just above the composer.

**First-run content:** described under Chat empty states — the "Add a model" focal card on a tinted block, then the model name plus suggestion chips. Presets has starter suggestion cards.

**References:**
- ChatGPT Android: minimal chrome, drawer history grouped by date.
- LM Studio: model cards with quant/size chips and mono stats.
- Termux / GitHub mobile dark: restrained palette and monospace accents.

**Appearance:** dark by default (user request), with a Light/System toggle. app.json `userInterfaceStyle: "automatic"` so the System option works. The stored `themeMode` defaults to 'dark'.

**Palette — dark**

| Token | Hex |
|---|---|
| background | #0E1113 |
| surface | #161A1D |
| surfaceRaised | #1E2327 |
| hairline | #2A3035 |
| text | #E4E7EA |
| textSecondary | #949CA4 |
| brand (signal teal) | #4DB6A8 |
| brandTint | #16302D |
| accent (amber, stop/warnings) | #E3A34F |
| error | #EF6B5E |
| userBubble | #1F3B37 (text #E4E7EA) |
| assistantBubble | #181D21 |
| codeBg | #0A0D0F |

**Palette — light**

| Token | Hex |
|---|---|
| background | #F5F6F7 |
| surface | #FFFFFF |
| surfaceRaised | #FFFFFF |
| hairline | #DDE1E4 |
| text | #15191C |
| textSecondary | #5A636B |
| brand | #2B8478 |
| brandTint | #E1F1EE |
| accent | #B8741C |
| error | #C8432F |
| userBubble | #DCEFEB |
| assistantBubble | #FFFFFF with hairline border |
| codeBg | #F0F2F4 |

No gradients and no glass effects.

**Typography:** Inter (400/500/600) for UI and body; JetBrains Mono (400/500) for code, stats, quant chips and parameter values.

| Style | Font and size |
|---|---|
| display | Inter 600, 26/32, max 2 lines |
| title | Inter 600, 18/24 |
| titleSmall | Inter 600, 15/20 |
| body | Inter 400, 16/24 (message text) |
| caption | Inter 400, 12/16 |
| mono | JetBrains Mono 13/18 |

**Shape and depth**
- Radii: bubbles 18 (with a 6 tail corner), cards 12, chips 8, buttons 24 (pill), inputs 14.
- Flat surfaces separated by hairline borders, no drop shadows except the drawer scrim.
- Tinted blocks (`brandTint`) for focal and status areas.

**Imagery:** none. Icons only (MaterialCommunityIcons).

**Components**
- Primary button: brand fill with background-coloured text. Secondary: hairline outline with text colour. Text buttons in brand colour.
- Send button: 48dp circle. Stop: accent circle with a square icon.
- List rows: 52dp, 16dp padding.
- Chips: mono caption on surfaceRaised.
- Inputs: surfaceRaised fill, focused border in brand.
- Loading: thin brand progress bars and inline spinners.
- Error: error-tinted band with a Retry action.
- Empty states: tinted focal card with one primary action.
- Snackbars for confirmations.

**Theme file:** `constants/theme.ts` exports dark and light Paper MD3 themes extended with the tokens above, plus fonts, type scale, spacing (8pt grid: 4/8/12/16/24/32) and radii. Every screen and the markdown styles read from it; no inline hex values.
</design_direction>

<animation_and_motion>
- Drawer slides 250 ms. Stack screens use the default slide.
- Streaming cursor blinks; the pre-token dots pulse.
- Send/stop button cross-fades between states (150 ms) with a press scale of 0.95.
- Haptics (Android): light on copy, medium on stop. None on web.
- When reduce motion is on (`AccessibilityInfo.isReduceMotionEnabled`), disable the pulsing and blinking and use fades instead.
</animation_and_motion>

<component_standards>
- Every data screen (Chat, drawer list, Search, Models, Presets) has loading, empty (one clear action) and error (with Retry) states, as described above.
- FlashList for the message list, session list, search results and model list.
- Accessibility:
  - Contrast ≥ 4.5:1 in both themes.
  - All icon buttons ≥ 44dp with accessibilityLabel ("Open menu", "Chat settings", "Send", "Stop generating", "Copy message", "Regenerate response").
  - New streamed text announced politely only when generation completes.
</component_standards>