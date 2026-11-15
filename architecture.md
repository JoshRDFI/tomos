# LLM Chat — Architecture

An offline Android app that runs GGUF language models on the phone with llama.cpp (via `llama.rn`). There is no backend, account or network call. The app is Expo SDK 54 / React Native 0.81 and lives in `react_native_space/`.

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
    chat-settings.tsx     per-chat system prompt and settings layer
    search.tsx            FTS search across chats
    models.tsx            model library: import, load, template, rename, remove
    help.tsx
    settings/index.tsx    appearance, system prompt, settings for all chats, per-model list, About
    settings/model.tsx    one model: file recommendations + its own settings layer
    settings/about.tsx    version, llama.cpp build, open-source licenses
    settings/presets.tsx  system prompt presets
  components/
    chat/                 MessageBubble (built-in markdown subset), ChatInput, EmptyChat
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
    contextWindow.ts      fitToContext(): drop oldest turns to fit n_ctx
    templates.ts          manual chat templates + stop strings
    gguf.ts               quant/size parsing from file names
    fts.ts                buildFtsQuery(): safe FTS5 MATCH strings
  constants/theme.ts      tokens, type scale, spacing, radii (no inline hex elsewhere)
  constants/licenses.json generated; see "Licenses"
  scripts/generate-licenses.mjs
  __tests__/              unit tests for the pure lib modules
```

## Data

All state is in SQLite, opened through `lib/sqliteLoader`. Tables:

- `settings`: key/value JSON (`themeMode`, `defaultSystemPrompt`, `globalParams`, `lastSessionId`, `lastModelId`)
- `models`: the library, including `fileParams` (recommended settings read from the GGUF) and `paramsOverride` (this model's settings)
- `sessions`: chats, including `systemPromptOverride` and `paramsOverride` (this chat's settings)
- `messages`, with `messages_fts` (FTS5) kept in sync by triggers
- `prompt_presets`

Migrations are additive and run at startup in `lib/db.ts` (`PRAGMA table_info` then `ALTER TABLE ADD COLUMN`). Never rewrite or drop existing columns; installed copies carry old data.

Model files are copied into `documentDirectory/models/` on import. The app never reads a model from its original location.

## Model settings

Settings are a `ParamSet`: a flat map of **llama.rn parameter names** to values. Using llama.rn's own names means any option it supports can be passed through, including ones the catalog doesn't know about ("Custom…").

Five layers, later wins (`resolveParams` in `lib/params.ts`):

1. `APP_DEFAULTS`
2. settings for all chats (`settings.globalParams`)
3. model file recommendations (`models.fileParams`, from GGUF `general.sampling.*`)
4. this model (`models.paramsOverride`)
5. this chat (`sessions.paramsOverride`)

Each layer stores only the keys set at that level. The resolved result records the source layer of every value so the UI can show where it came from.

`splitParams` divides the resolved set into **load** settings (anything `initLlama` takes, listed in `LOAD_PARAM_KEYS`) and **completion** settings. `loadSignature(load)` is compared with the loaded context; a difference reloads the model before the next reply. `RESERVED_KEYS` (model, prompt, messages, jinja, …) belong to the app and can't be set by the user.

`parseCliFlags` turns a llama.cpp command line from a model card into a ParamSet, so users can paste e.g. PrismML's Bonsai 2 command. The Bonsai command is a test case in `__tests__/params.test.ts`.

To add a known setting, add an entry to `lib/paramCatalog.ts` (and a flag alias in `params.ts` if llama.cpp's CLI name differs). No other code needs to change.

## Reply pipeline

`runGeneration` in `app/index.tsx`, guarded by `generatingRef`:

1. Re-read the session from the DB (chat settings may have changed while away).
2. `prepareModel(model, session)`: re-read the model, read GGUF recommendations once if missing, resolve and split settings.
3. Reload the model if its load signature changed. `ModelContext` serializes loads through a promise chain.
4. `llama.generate()`:
   - Caps `n_predict` at half of `n_ctx`.
   - Runs `fitToContext` to drop the oldest turns. The system prompt and latest message are always kept, and kept history never starts on an assistant turn.
   - Uses jinja with the file's template when the template is "auto" and the file has one; otherwise formats with `lib/templates.ts`.
   - Merges user `stop` strings with the template's.
   - Streams tokens to the UI.
5. Save the reply with token count and speed. A stopped reply is marked `stopped`; an empty stopped reply is discarded.

`stopGeneration()` calls `stopCompletion()` immediately. `releaseModel()` stops and awaits any in-flight completion before releasing the context, so a model switch or unload never frees memory under a running completion.

## Licenses

`yarn licenses` runs `scripts/generate-licenses.mjs`, which writes `constants/licenses.json`. It collects:

- the production npm dependency graph;
- the native code `llama.rn` compiles in (llama.cpp and its vendored libraries, versions from `vendor/VERSIONS`);
- the bundled fonts.

Rerun it whenever dependencies change, and commit the result. The About screen loads the JSON lazily.

## Building

`android/` is generated by `npx expo prebuild --platform android` and is git-ignored; config belongs in `app.json` (package `com.rdfindustries.llmchat`). `llama.rn` ships prebuilt arm64 libraries, so no NDK build of llama.cpp is needed. See the README for build commands.

Signing keys and keystore files never go in the repo (`.gitignore` blocks them).

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
