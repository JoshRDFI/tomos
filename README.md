# LLM Chat

Run language models on your Android phone, fully offline. LLM Chat loads GGUF models with [llama.cpp](https://github.com/ggml-org/llama.cpp) (through [llama.rn](https://github.com/mybigday/llama.rn)) and keeps every chat, setting and model file on the device.

## Features

- **Any GGUF model.** Import a `.gguf` file; the app copies it into its own storage and reads its metadata, chat template and recommended settings.
  - The import is a copy, not a move. After importing, the app offers to delete the original (for example from Downloads) to free the space; the app doesn't need it.
- **Full llama.cpp settings.** Sampling, repetition penalties, thinking, context length, threads, GPU layers, KV cache type, and any other llama.rn option, set at four levels:
  - all chats
  - the model file's own recommendations (read automatically)
  - per model
  - per chat
- **Paste flags.** Paste a `llama-cli` command from a model card (for example PrismML's Bonsai 2 settings) and the app applies it.
- Chat history with full-text search, rename, and export to Markdown or text.
- System prompt presets.
- Chat templates: auto (from the file), ChatML, Llama 3, Gemma, Mistral, Phi, Zephyr, Vicuna, Alpaca, raw.
- Long chats are trimmed to fit the context window automatically; the database keeps the full history.
- Dark, light and system themes.
- About screen with every open-source license that ships in the app.

## Requirements

- An Android phone with arm64. Built for a Pixel 9 Pro XL (16 GB RAM); 3B–8B models at Q4_K_M are the sweet spot.
- To build: Node 20+, corepack (yarn 4), JDK 17+, the Android SDK (platform 35/36). No NDK setup for llama.cpp is needed; llama.rn ships prebuilt libraries.

## Development

All app code is in `react_native_space/`.

```bash
cd react_native_space
corepack enable
yarn install

yarn typecheck      # TypeScript
yarn test           # jest unit tests
yarn licenses       # regenerate constants/licenses.json after dependency changes
```

`llama.rn` is a native module, so the app does **not** run in Expo Go. Use a development build (`npx expo run:android`) or an APK.

## Building an APK

`android/` is generated and not committed.

```bash
cd react_native_space
npx expo prebuild --platform android
cd android
ANDROID_HOME=$HOME/Android/Sdk ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
# → android/app/build/outputs/apk/release/app-release.apk
```

By default the generated project signs release builds with the **debug key**, which is fine for installing on your own phone (`adb install -r app-release.apk`). Builds signed with different keys can't update each other; uninstall first when switching keys.

For a Play Store or long-term build, sign with your own key:
- Configure it with a `signingConfigs.release` block that reads the keystore path and password from `~/.gradle/gradle.properties` or environment variables, or sign the output with `apksigner`.
- Never commit keystores or passwords. `.gitignore` blocks `*.jks`, `*.keystore`, `keystore.properties` and similar files.

## Docs

- [`architecture.md`](architecture.md): code layout, data model, the settings layers, the reply pipeline, and conventions.
- [`ux_design.md`](ux_design.md): screens, interactions, visual design, and the roadmap.

## Licensing

Third-party licenses are listed in the app under **Settings → About & licenses**, generated from the installed dependencies by `yarn licenses`.

This repository does not yet include a license for the app's own code. `react_native_space/LICENSE` is the Expo template's license, not the app's.
