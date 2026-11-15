// Platform-specific: this file is for native (resolved by Metro as default).
// The web version is sqliteLoader.web.ts which stubs the function.
import { openDatabaseAsync } from 'expo-sqlite';
export { openDatabaseAsync };
