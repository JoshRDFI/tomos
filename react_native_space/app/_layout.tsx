import React, { useEffect, useState } from 'react';
import { Platform, useColorScheme } from 'react-native';
import { Stack } from 'expo-router';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import { StatusBar } from 'expo-status-bar';
import { ThemeProvider, DefaultTheme } from '@react-navigation/native';
import { SettingsProvider, useSettings } from '@/contexts/SettingsContext';
import { ModelProvider } from '@/contexts/ModelContext';
import { darkTheme, lightTheme } from '@/constants/theme';

SplashScreen.preventAutoHideAsync();

function ThemeWrapper({ children }: { children: React.ReactNode }) {
  const { themeMode, ready } = useSettings();
  const systemScheme = useColorScheme();

  let isDark = true;
  if (themeMode === 'light') isDark = false;
  else if (themeMode === 'system') isDark = systemScheme !== 'light';

  const theme = isDark ? darkTheme : lightTheme;

  // Build a react-navigation theme to match Paper, so Stack backgrounds + headers use our colors
  const navTheme = React.useMemo(() => ({
    dark: isDark,
    colors: {
      primary: theme.appColors.brand,
      background: theme.appColors.background,
      card: theme.appColors.surface,
      text: theme.appColors.text,
      border: theme.appColors.hairline,
      notification: theme.appColors.brand,
    },
    fonts: DefaultTheme.fonts,
  }), [isDark, theme]);

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [ready]);

  if (!ready) return null;

  return (
    <PaperProvider theme={theme}>
      <ThemeProvider value={navTheme}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        {children}
      </ThemeProvider>
    </PaperProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      // fonts done, settings will hide splash
    }
    // Safety timeout
    const t = setTimeout(() => SplashScreen.hideAsync().catch(() => {}), 5000);
    return () => clearTimeout(t);
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <ModelProvider>
          <ThemeWrapper>
            <Stack
              screenOptions={{
                animation: 'slide_from_right',
              }}
            >
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="chat-settings" options={{ title: 'Chat settings' }} />
              <Stack.Screen name="search" options={{ headerShown: false }} />
              <Stack.Screen name="models" options={{ title: 'Models' }} />
              <Stack.Screen name="download" options={{ title: 'Download from Hugging Face' }} />
              <Stack.Screen name="settings/index" options={{ title: 'Settings' }} />
              <Stack.Screen name="settings/presets" options={{ title: 'System Prompt Presets' }} />
              <Stack.Screen name="settings/model" options={{ title: 'Model settings' }} />
              <Stack.Screen name="settings/about" options={{ title: 'About' }} />
              <Stack.Screen name="help" options={{ title: 'Help' }} />
              <Stack.Screen name="+not-found" options={{ title: 'Not Found' }} />
            </Stack>
          </ThemeWrapper>
        </ModelProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}
