# LLM Chat — Architecture

An offline Android app that runs GGUF language models on the phone with llama.cpp (via `llama.rn`). There is no backend or account. The only network use is downloading a model from Hugging Face when the user asks for one (see "Hugging Face downloads"). The app is Expo SDK 54 / React Native 0.81 and lives in `react_native_space/`.

For screens, layouts and visual design, see [`ux_design.md`](ux_design.md). This file covers how the code is put together and the rules to follow when changing it.

## Stack

| Concern | Choice |
|---|---|
| Framework | Expo SDK 54, React Native 0.81, New Architecture |
| Navigation | expo-router 6, a single root `Stack` (no tabs, no route groups) |
| UI | react-native-paper (MD3) with a custom `appColors` theme extension; Inter and JetBrains Mono fonts |
| Lists | `@shopify/flash-list` v2 |
| Storage | `expo-sqlite` (with FTS5) |
| Inference | `llama.rn` **pinned to `0.13.0-rc.11`** (llama.cpp b12292) |
| Package manager | yarn 4 via corepack |
| Tests | jest with `jest-expo` |

Web is not a target. The web build only shows a notice ("On-device inference requires the Android app") and lets the UI layout be previewed.

## Layout

```
react_native_space/
  app/                    expo-router screens
    _layout.tsx           fonts, providers (Database → Settings → Model → Paper), root Stack
    index.tsx             chat screen; owns the left drawer and the reply pipeline
    chat-settings.tsx     per-chat persona/custom instructions and settings layer
    search.tsx            FTS search across chats
    models.tsx            model library: import, load, template, rename, remove; download cards
    download.tsx          Hugging Face link → file list → start a download
    help.tsx
    settings/index.tsx    appearance, default persona / system prompt, settings for all chats, per-model list, About
    settings/model.tsx    one model: file recommendations + its own settings layer
    settings/about.tsx    version, llama.cpp build, open-source licenses
    settings/personas.tsx personas list, starters, Markdown import
    settings/persona.tsx  one persona: instructions, greeting, examples, settings, export
  components/
    chat/                 MessageBubble, Markdown (mdast → RN views), useThrottledText, ChatInput, EmptyChat
    drawer/               DrawerContent
    params/ParamEditor    the shared llama.cpp settings editor
  contexts/               SettingsContext (theme, default system prompt), ModelContext (load state)
  lib/
    db.ts                 schema, migrations, queries, getEffectiveParams()
    sqliteLoader(.web).ts platform split so web export never imports expo-sqlite
    llama.ts              llama.rn wrapper: load/release, generate, stop, tokenize
    params.ts             ParamSet, APP_DEFAULTS, layer resolution, load/completion split, CLI flag parser
    paramCatalog.ts       catalog of known llama.cpp settings (labels, help, ranges, load vs completion)
    modelMeta.ts          GGUF recommended settings; prepareModel() for each reply
    contextWindow.ts      fitToContext(): drop oldest turns to fit n_ctx (the fallback)
    compaction.ts         auto-compaction planning: active summary, condense range, carry-over (pure)
    compactionRunner.ts   compactIfNeeded() / prepareContinuation(): runs the summary completion
    branches.ts           visiblePath(), pathTo(), versionsOf(): message versions
    continuation.ts       buildContinuation(): prompt suffix + display prefix for Continue
    dateContext.ts        withDate(): today's date in the system prompt
    personas.ts           which instructions a chat uses, migration linking, helpers (pure)
    personaMarkdown.ts    persona ⇄ Markdown (soul.md import)
    prompt.ts             composeSystemMessage, formatExamples, toChatMessages (pure)
    backup.ts             backup file format, validation, model matching (DB side in db.ts)
    templates.ts          manual chat templates + stop strings
    gguf.ts               quant/size parsing from file names
    ggufHeader.ts         GGUF header reader; checkCompatibility() against the bundled ggml types
    fts.ts                buildFtsQuery(): safe FTS5 MATCH strings
    modelImport.ts        finishModel(): metadata + DB row for a GGUF in app storage (import and download)
    hfLink.ts             parseHfLink(): pasted text → repo / revision / file
    hfApi.ts              Hub API: repo files, GGUF versions of a base model, ggufRows(), range reads
    downloader.ts         the only entry point to the download backend (modules/hf-download)
    downloads.ts          start / retry / cancel, reconcile with DownloadManager, finish as models
    thinking.ts           splitThinking(): separate <think> blocks from the answer
    markdown.ts           toMdAst(): markdown + GFM → mdast (ported from DeepSeek's demo, MIT)
    highlight.ts          Prism languages/aliases; highlightCode() → flat styled runs
  modules/hf-download/    local Expo module (Kotlin): Android DownloadManager enqueue/query/remove
  constants/theme.ts      tokens, type scale, spacing, radii (no inline hex elsewhere)
  constants/licenses.json generated; see "Licenses"
  constants/app.ts        app name (read from app.json), publisher, code license, repo URL
  scripts/generate-licenses.mjs
  __tests__/              unit tests for the pure lib modules
```

## Data

All state is in SQLite, opened through `lib/sqliteLoader`. Tables:

- `settings`: key/value JSON (`themeMode`, `defaultSystemPrompt`, `defaultPersonaId`, `includeDate`, `globalParams`, `lastSessionId`, `lastModelId`)
- `models`: the library, including `fileParams` (recommended settings read from the GGUF) and `paramsOverride` (this model's settings)
- `sessions`: chats, including `personaId`, `systemPromptOverride` (custom text) and `paramsOverride` (this chat's settings)
- `messages`, with `messages_fts` (FTS5) kept in sync by triggers. Messages form a tree (`lib/branches.ts`): `parentId` links each message to the one it follows, and the parent's `selectedChildId` (or `sessions.rootMessageId` for first messages) picks the version shown. `getSessionMessages()` returns the visible path with `versions` on messages that have siblings. Edit and regenerate insert a sibling; nothing is deleted. Chats from before branching were linked into a single branch by a one-time migration.
- `prompt_presets`: personas (instructions in `content`, plus `greeting`, `examples` JSON, `params` JSON of completion settings). Presets became personas by migration; chats whose custom text exactly matched a preset were linked to it. `messages.kind = 'greeting'` marks a persona's greeting.
- `summaries`: auto-compaction summaries (`throughMessageId` = last message covered, content, model, time); cascade-deleted with the chat. `sessions.continuedFromId` and `sessions.carryOver` belong to "Continue in a new chat".
- `downloads`: Hugging Face downloads (repo, pinned revision, parts as JSON with their DownloadManager ids and status, Wi-Fi only, error). Not in backups.

Backups (`Settings → Backup`) are a JSON dump of every table except `downloads` (and model files); restore replaces chats, personas and settings in one transaction and inserts only columns the current schema has, so older backups restore into newer schemas.

Migrations are additive and run at startup in `lib/db.ts` (`PRAGMA table_info` then `ALTER TABLE ADD COLUMN`); `getDb()` resolves only after they finish. Never rewrite or drop existing columns; installed copies carry old data.

Model files are copied into `documentDirectory/models/` on import (legacy `copyAsync`: the picker returns `content://` URIs, which the new File API can't copy). The app never reads a model from its original location; after a successful import it offers to delete the picked original (`new File(contentUri).delete()`, which goes through `DocumentsContract.deleteDocument`; the legacy `deleteAsync` only accepts `com.android.externalstorage` URIs, so it can't delete from the Downloads provider). Before or right after the copy, `lib/ggufHeader.ts` reads the GGUF header and flags tensor types missing from the bundled llama.cpp. Its type tables mirror `ggml.h`/`llama.h` of the pinned llama.rn; update them when upgrading llama.rn.


## Hugging Face downloads

- **Network.** Only on explicit user action, anonymous, to `huggingface.co`:
  - `GET /api/models/<repo>?blobs=true` → `{id, sha, gated, siblings[{rfilename, size}]}`, or `/api/models/<repo>/revision/<rev>?blobs=true` when the link names a branch, tag or commit (unknown revision → 404). Missing and private repos both return 401; gated repos return 200 with `gated: "auto"|"manual"`, so the app checks that field (and treats a 403 as needing a login).
  - `GET /api/models?filter=base_model:quantized:<repo>&filter=gguf&sort=downloads&direction=-1&limit=20` for an original model's GGUF versions.
  - `GET /<repo>/resolve/<sha>/<path>` (302 to the CDN, supports `Range`). Files are fetched by the repo `sha`, not `main`, so every part of a split model comes from one revision. The header check reads the first MB or so with range requests.
- **Native module** `modules/hf-download` (Expo Modules, Kotlin; `android/` is generated, so native code lives only here). It wraps `DownloadManager`: `enqueue` (`setDestinationInExternalFilesDir`, `setAllowedOverMetered(!wifiOnly)`, visible notification), `query` (status, bytes, reason, local path; ids Android no longer knows come back as `missing`), `remove`. No storage permission is needed.
- **Files** go to `getExternalFilesDir(null)/models/<download id>/<basename>` (`Android/data/<package>/files/models/…`), one folder per model so split parts sit together and llama.cpp finds them from the first part. The download id becomes the model id. Removing the model deletes the folder. Imported models stay in `documentDirectory/models/`.
- **Reconciliation** (`lib/downloads.ts`): the Models screen calls `syncDownloads()` on focus and every second; the chat screen calls it at startup and whenever the app returns to the foreground. It queries DownloadManager for active downloads, marks parts done or failed (`reconcile()`, pure and tested), and finishes a download once every part is done: claim it (`status = 'done'`) after re-reading the row, then `finishModel()`. Concurrent calls share one run, so focus firing twice can't create two models. Downloads that finish while the app is closed are picked up next time Models opens.
- Retry re-enqueues failed parts from zero after removing their old DownloadManager entries; finished parts are kept. If queueing or saving fails partway (start or Retry), the parts queued so far are removed, so nothing downloads untracked.
- The free-space check before a download counts what downloads in progress still need (`pendingDownloadBytes()`).

## Model settings

Settings are a `ParamSet`: a flat map of **llama.rn parameter names** to values. Using llama.rn's own names means any option it supports can be passed through, including ones the catalog doesn't know about ("Custom…").

Six layers, later wins (`resolveParams` in `lib/params.ts`):

1. `APP_DEFAULTS`
2. settings for all chats (`settings.globalParams`)
3. model file recommendations (`models.fileParams`, from GGUF `general.sampling.*`)
4. this model (`models.paramsOverride`)
5. the chat's persona (`prompt_presets.params`, completion settings only, so switching persona never reloads the model)
6. this chat (`sessions.paramsOverride`)

Each layer stores only the keys set at that level. The resolved result records the source layer of every value so the UI can show where it came from.

`splitParams` divides the resolved set into **load** settings (anything `initLlama` takes, listed in `LOAD_PARAM_KEYS`) and **completion** settings. `loadSignature(load)` is compared with the loaded context; a difference reloads the model before the next reply. `RESERVED_KEYS` (model, prompt, messages, jinja, …) belong to the app and can't be set by the user.

`parseCliFlags` turns a llama.cpp command line from a model card into a ParamSet, so users can paste e.g. PrismML's Bonsai 2 command. The Bonsai command is a test case in `__tests__/params.test.ts`.

To add a known setting, add an entry to `lib/paramCatalog.ts` (and a flag alias in `params.ts` if llama.cpp's CLI name differs). No other code needs to change.

## Reply pipeline

`runGeneration(sessionId, model, parentId)` in `app/index.tsx`, guarded by `generatingRef`. It replies to `parentId` (a user message) using the path leading to it:

1. Re-read the session from the DB (chat settings may have changed while away), and load the path to `parentId`. `db.buildSystemMessage(session, path)` builds the system message: instructions (custom text > persona > default prompt, `resolveInstructions`), the date line, then the persona's examples (`composeSystemMessage`). Every request for a chat builds it here.
2. `prepareModel(model, session)`: re-read the model, read GGUF recommendations once if missing, resolve and split settings.
3. Reload the model if its load signature changed. `ModelContext` serializes loads through a promise chain.
4. `llama.generate()`:
   - Caps `n_predict` at half of `n_ctx`.
   - Runs `fitToContext` to drop the oldest turns. The system prompt and latest message are always kept, and kept history never starts on an assistant turn.
   - Uses jinja with the file's template when the template is "auto" and the file has one; otherwise formats with `lib/templates.ts`.
   - Merges user `stop` strings with the template's.
   - Separates thinking from the answer as it streams: llama.rn's `reasoning_content` with jinja (`reasoning_format` defaults to `auto`), else `splitThinking()` on `<think>` tags.
   - Streams tokens to the UI.
5. Save the reply under `parentId` (and select it) with token count and speed. `messages.stopped` is 1 when the user stopped it and 2 when it hit the length limit or a full context.

**Continue** passes the stopped reply as `cont`: `generate(..., prefill)` formats the chat up to the assistant turn (`getFormattedChat` with `add_generation_prompt`, or the manual template), appends the partial reply (`lib/continuation.ts`), and runs a raw-prompt completion; the result is written back into the same message. The answer goes in `content` and the thinking in `reasoning` (with `thinkingMs`); only answers are sent back to the model in later turns. A stopped reply is marked `stopped`; an empty stopped reply is discarded.

## Long chats: compaction and continuing

After a reply is saved, `runGeneration` starts `compactIfNeeded()` in the background (`app/index.tsx`, `compactionRef`):

1. The **active summary** is the newest `summaries` row whose `throughMessageId` is on the visible path (`activeSummary`). Summaries belong to a branch: editing a condensed message moves the path off it, and an older summary (or none) applies.
2. `planCompaction` counts the system message (with the summary) and each message after the summary. Over **70%** of the prompt budget (`n_ctx − n_predict − 16`, `llama.promptBudget`) it condenses the oldest messages until the rest is at most **40%**, always keeping the last **4** messages and starting the kept part on a user message.
3. The request is the chat's own system message and the messages being condensed, then a user turn with `SUMMARY_INSTRUCTION` (`summaryRequest`). Because the system message comes from the same `db.buildSystemMessage`, the prompt starts with exactly what the model already read for the chat, and llama.rn reuses that prefix: it only reads the instruction. Thinking off, `n_predict` 400, temperature ≤ 0.5. Its `[gen] compaction:` log lines show `prompt_n` for checking that on a device.
4. The result (thinking stripped) is saved as a new summary. Nothing is saved when it was stopped (a per-run cancel token, honoured even before the request starts), hit the length limit, had messages dropped to fit, ran while the model was swapped, or came back empty. The next summary is written with the current one in its system message, so it covers everything before the kept messages.

The chat prompt sends only the messages after the active summary (`promptPath`); a persona greeting at the start of the path goes in the system message instead of as a leading assistant turn, which some templates (Gemma, older Mistral) reject. `buildSystemMessage` adds the greeting, then the summary, after the instructions, date and examples ("Summary of the earlier part of this conversation:"), or a continued chat's `carryOver` ("Earlier conversation (continued from another chat):") when no summary applies yet. `fitToContext` still runs as the safety net.

Sending, regenerating, continuing, switching chat or model all `await stopCompaction()` first (`stopGeneration()`, wait, nothing saved). The input stays usable during compaction.

**Continue in a new chat** (chat settings, or the hint after the 3rd summary on a path): `prepareContinuation()` condenses first with a 40% trigger when a model is loaded, then `buildCarryOver(summary, messages after it)` (oldest dropped first to fit 40% of the budget). `db.createContinuation()` copies model, persona or custom text, and settings; no greeting.

`stopGeneration()` calls `stopCompletion()` immediately. `releaseModel()` stops and awaits any in-flight completion before releasing the context, so a model switch or unload never frees memory under a running completion.

## Personas as files

`lib/personaMarkdown.ts` parses and writes the persona Markdown format. The format is front matter (`name` and completion settings; `#` lines are ignored), then the instructions, then optional `## Greeting` and `## Examples` sections. HTML comments in the body are dropped on import. [`personas/soul.md`](personas/soul.md) is the commented template; `__tests__/personaMarkdown.test.ts` imports it, so a parser change that breaks it fails the tests.

## Licenses

`yarn licenses` runs `scripts/generate-licenses.mjs`, which writes `constants/licenses.json`. It collects:

- the production npm dependency graph;
- the native code `llama.rn` compiles in (llama.cpp and its vendored libraries, versions from `vendor/VERSIONS`);
- the bundled fonts;
- source adapted into the app: DeepSeek's chat-demo and the Expo template (`third_party/expo-template-MIT.txt`).

Rerun it whenever dependencies change, and commit the result. The About screen loads the JSON lazily.

## Building

`android/` is generated by `npx expo prebuild --platform android` and is git-ignored; config belongs in `app.json` (package `com.rdfindustries.llmchat`). `llama.rn` ships prebuilt arm64 libraries, so no NDK build of llama.cpp is needed. See the README for build commands.

Signing keys and keystore files never go in the repo (`.gitignore` blocks them).

The app's display name is `expo.name` in `app.json`; code reads it through `APP_NAME` in `constants/app.ts`, so a rename is one edit (plus a prebuild). User-facing text shouldn't hard-code the name.

The app's own code is Apache-2.0 (root `LICENSE`, `NOTICE`), copyright RDF Industries, Inc. The RDF name and logo are excluded from the license.

## Rules for changes

- **FlashList v2**: no `estimatedItemSize`, no `inverted`. The chat list is chronological with `maintainVisibleContentPosition.startRenderingFromBottom`.
- **Drawer**: `react-native-drawer-layout`'s `Drawer` with `drawerStyle` for width and `renderDrawerContent` (not `renderNavigationView`).
- **SQLite imports** always go through `lib/sqliteLoader`, or the web export breaks.
- **Colors** come from `constants/theme.ts`; no inline hex values in screens.
- **Icons**: MaterialCommunityIcons only, no emoji in the UI.
- Write Unicode characters directly in JSX, not `\uXXXX` escapes.
- **llama.rn** stays pinned to an exact version. Upgrading it changes the bundled llama.cpp: check the changelog, rerun tests and `yarn licenses`, and test on a device.
- Keep pure logic in `lib/` with unit tests. `yarn typecheck` and `yarn test` must pass before committing.
- Code ported from DeepSeek's MIT chat demo keeps its MIT notice.
- **Markdown** packages (`mdast-*`, `micromark*`, …) are ESM-only. Jest transforms them through `transformIgnorePatterns` in `package.json`; add any new ESM dependency there too.
- New Prism languages are static imports in `lib/highlight.ts`, after any language they extend.
