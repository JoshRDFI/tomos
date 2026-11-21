<p align="center">
  <img src="react_native_space/assets/rdfi-logo-small.png" width="96" alt="RDF Industries logo">
</p>

# Tomos

**An RDF Industries app.** Run language models on your Android phone, fully offline. Tomos loads GGUF models with [llama.cpp](https://github.com/ggml-org/llama.cpp) (through [llama.rn](https://github.com/mybigday/llama.rn)) and keeps every chat, setting and model file on the device.

## Why "Tomos"

Greek scribes wrote long works on rolls of papyrus, and a single roll was a *tomos* (τόμος), literally "a cut", from *temnein*, "to cut": a length cut from the papyrus. It later came to mean a volume, and gave English the word "tome".

The name fits twice. The app is meant to be just the scroll: a plain surface to read and write on, with nothing between you and the words. And the models it runs are small cuts of something much larger, trimmed to fit in a pocket.

## Privacy

Everything runs on the phone. There are no accounts, no analytics, no ads and no servers of ours. The app itself connects to the internet only when you ask it to download a model from Hugging Face.

Your chats leave the device only if you send them somewhere. Exporting a chat, a persona or a backup asks whether to **save it to the phone** (Android's own save picker; Downloads, Documents or any folder you choose) or **share** it with another app. Sharing hands the file to the app you pick, such as Drive or email, and that app may upload it.

## Features

- **Any GGUF model.** Import a `.gguf` file; the app copies it into its own storage and reads its metadata, chat template and recommended settings.
  - The import is a copy, not a move. After importing, the app offers to delete the original (for example from Downloads) to free the space; the app doesn't need it.
  - Rename a model (for example "Chat" or "Coding") to tell your models apart; its card still shows the file name.
- **Download from Hugging Face.** Paste a model link (from a post or the model page) and pick a file. Android's download manager fetches it in the background, Wi-Fi only by default. Links to an original model list its GGUF versions; split models download as one. This is the app's only network use, and only when you ask for it. Gated models (Hugging Face login) aren't supported yet.
- **Full llama.cpp settings.** Sampling, repetition penalties, thinking, context length, threads, GPU layers, KV cache type, and any other llama.rn option, set at four levels:
  - all chats
  - the model file's own recommendations (read automatically)
  - per model
  - per chat
- **Paste flags.** Paste a `llama-cli` command from a model card (for example PrismML's Bonsai 2 settings) and the app applies it.
- Chat history with full-text search, rename, and export to Markdown or text.
- **Personas.** Instructions plus an optional greeting, example exchanges and sampling settings, picked per chat. Import a `soul.md` (or any Markdown file) as a persona, and export them the same way. [`personas/soul.md`](personas/soul.md) is a commented template showing every field.
- Chat templates: auto (from the file), ChatML, Llama 3, Gemma, Mistral, Phi, Zephyr, Vicuna, Alpaca, raw.
- **Long chats keep their thread.** When a chat fills the context window, the model condenses older messages into a summary it keeps reading (you can view it; every message stays saved). **Continue in a new chat** carries the summary and your last exchange into a fresh chat with a link back.
- **Edit the model's replies** (long-press → Edit reply) to cut a repeated line before it becomes a habit; the original stays as a version. DRY repetition penalty is on by default.
- **Keeps going with the screen off.** A reply keeps generating when you lock the phone or switch apps, with a notification (and Stop); you're notified when it's ready. On Android 17 and later this needs a model that fits the background memory limit (about 4 GB on a 16 GB phone, so 3–4B models); larger models pause until you open the app.
- Dark, light and system themes.
- Backups of chats, personas and settings (model files aren't included), saved to the phone or shared.
- About screen with every open-source license that ships in the app.

## Get the app

There are no published builds yet. To use it now, build it yourself (below).

## Requirements

- A 64-bit (arm64) Android phone, Android 7 or newer. Developed and tested on a Pixel 9 Pro XL (16 GB RAM); other phones should work but haven't been tested.
- Memory decides model size: 8 GB of RAM runs 3–4B models, 12 GB or more runs 7–8B. Q4_K_M is the sweet spot. To keep generating with the screen off or in another app on Android 17+, the model must fit about a quarter of the phone's RAM.
- Samsung, Xiaomi, OnePlus and some other phones stop background apps to save battery; the app asks once to be allowed to run in the background so replies finish with the screen off.
- To build: Node 20+, corepack (yarn 4), JDK 17+, the Android SDK (platform 35/36). No NDK setup for llama.cpp is needed; llama.rn ships prebuilt libraries.

## Build it yourself

All app code is in `react_native_space/`. `android/` is generated and not committed.

```bash
cd react_native_space
corepack enable
yarn install
npx expo prebuild --platform android
cd android
ANDROID_HOME=$HOME/Android/Sdk ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
# → android/app/build/outputs/apk/release/app-release.apk
adb install -r app/build/outputs/apk/release/app-release.apk
```

`llama.rn` is a native module, so the app does **not** run in Expo Go. Use an APK as above, or a development build (`npx expo run:android`).

### Before you share a build

The generated project signs release builds with the **debug key**. That's fine for your own phone, but anything you give to other people should be your own app:

1. **Use your own application ID.** In `react_native_space/app.json`, change `expo.android.package` from `com.rdfindustries.tomos` to an ID you own, and run `npx expo prebuild --platform android --clean`.
2. **Use your own name and icon.** Change `expo.name` in `app.json` (the app reads its name from there) and replace the icon files in `react_native_space/assets/` (`icon.png`, `android-icon-*.png`, `favicon.png`). The RDF Industries name and logo aren't covered by the code license; see [License](#license).
3. **Sign with your own key.** Make one with `keytool` (it comes with the JDK):

   ```bash
   keytool -genkeypair -v -keystore ~/keys/my-release.jks -alias my-key \
     -keyalg RSA -keysize 4096 -validity 10000 -storetype PKCS12
   ```

   Then add it to `~/.gradle/gradle.properties` (outside the repo):

   ```properties
   TOMOS_RELEASE_STORE_FILE=/home/you/keys/my-release.jks
   TOMOS_RELEASE_STORE_PASSWORD=...
   TOMOS_RELEASE_KEY_ALIAS=my-key
   TOMOS_RELEASE_KEY_PASSWORD=...
   ```

   Run `npx expo prebuild --platform android` once so the signing setup (`react_native_space/plugins/withReleaseSigning.js`) is in `android/`; release builds then sign with your key. Without those settings they use the debug key. Back up the key and its password: Android only installs updates signed with the same key.

Never commit keystores or passwords. `.gitignore` blocks `*.jks`, `*.keystore`, `keystore.properties` and similar files.

## Development

```bash
cd react_native_space
corepack enable
yarn install

yarn typecheck      # TypeScript
yarn test           # jest unit tests
yarn licenses       # regenerate constants/licenses.json after dependency changes
```


## Docs

- [`architecture.md`](architecture.md): code layout, data model, the settings layers, the reply pipeline, and conventions.
- [`ux_design.md`](ux_design.md): screens, interactions, visual design, and the roadmap.
- [`personas/soul.md`](personas/soul.md): a persona template to copy, with notes on each field.

## License

Copyright 2026 RDF Industries, Inc. Licensed under the [Apache License, Version 2.0](LICENSE); see also [NOTICE](NOTICE).

**Name and logo.** The RDF Industries name and logo (the app icon, made from `react_native_space/assets/rdfi-logo.png`) are trademarks of RDF Industries, Inc. and aren't licensed under Apache-2.0. You're welcome to build, change and share the code; give your build its own name, icon and application ID (see [Before you share a build](#before-you-share-a-build)).

Third-party licenses are listed in the app under **Settings → About & licenses**, generated from the installed dependencies by `yarn licenses`.

### Code adapted from DeepSeek's chat demo

Parts of the chat UI are adapted from DeepSeek's [chat-demo](https://github.com/deepseek-ai/chat-demo) (MIT License, Copyright (c) 2026 DeepSeek), reworked for React Native and this app's data model:

| In `react_native_space/` | Adapted from | What |
|---|---|---|
| `lib/markdown.ts` | `src/services/markdown/parse.ts` | Markdown + GFM → syntax tree for replies |
| `components/chat/Markdown.tsx` | `src/components/markdown/MarkdownAstRenderer.tsx` | Rendering that tree (rewritten for React Native views) |
| `components/chat/useThrottledText.ts` | `src/components/markdown/useThrottleMarkdownRender.ts` | Throttled re-rendering while a reply streams |
| `lib/highlight.ts` | `src/services/markdown/highlight.ts` | Code-block language list and aliases |
| `lib/branches.ts` | `src/services/chat/branches.ts` | Message branching model (versions of replies and edited prompts) |
| `lib/backup.ts` | `src/services/chat/backup.ts` | Idea for backup files that carry chats and settings but no model |

Each file keeps DeepSeek's notice; the full MIT text is in `lib/markdown.ts` and in the app's licenses screen.

### Expo template

The project scaffolding comes from the Expo app template (MIT License, Copyright (c) 2015-present 650 Industries, Inc.). Its license is in [`react_native_space/third_party/expo-template-MIT.txt`](react_native_space/third_party/expo-template-MIT.txt).
