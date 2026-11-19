import Constants from 'expo-constants';

// The app's display name lives in app.json ("expo.name"); everything else reads it from there.
export const APP_NAME = Constants.expoConfig?.name ?? 'Tomos';
export const PUBLISHER = 'RDF Industries, Inc.';
export const COPYRIGHT = `© 2026 ${PUBLISHER}`;
export const CODE_LICENSE = 'Apache License 2.0';
export const REPO_URL = 'https://github.com/JoshRDFI/android-llm-chat';
