import { MD3DarkTheme, MD3LightTheme, configureFonts } from 'react-native-paper';
import type { MD3Theme } from 'react-native-paper';
import { Platform } from 'react-native';

// ── Palettes ──

export const darkColors = {
  background: '#0E1113',
  surface: '#161A1D',
  surfaceRaised: '#1E2327',
  hairline: '#2A3035',
  text: '#E4E7EA',
  textSecondary: '#949CA4',
  brand: '#4DB6A8',
  brandTint: '#16302D',
  accent: '#E3A34F',
  error: '#EF6B5E',
  userBubble: '#1F3B37',
  assistantBubble: '#181D21',
  codeBg: '#0A0D0F',
  logoBackdrop: '#FFFFFF',
  // Code highlighting
  synComment: '#6B747C',
  synKeyword: '#C792EA',
  synString: '#A5D6A7',
  synNumber: '#F7A26B',
  synFunction: '#82AAFF',
  synType: '#4DB6A8',
  synPunct: '#949CA4',
} as const;

export const lightColors = {
  background: '#F5F6F7',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  hairline: '#DDE1E4',
  text: '#15191C',
  textSecondary: '#5A636B',
  brand: '#2B8478',
  brandTint: '#E1F1EE',
  accent: '#B8741C',
  error: '#C8432F',
  userBubble: '#DCEFEB',
  assistantBubble: '#FFFFFF',
  codeBg: '#F0F2F4',
  logoBackdrop: '#FFFFFF',
  // Code highlighting
  synComment: '#6A737D',
  synKeyword: '#8E3FB0',
  synString: '#2E7D32',
  synNumber: '#B5531A',
  synFunction: '#1F5FBF',
  synType: '#2B8478',
  synPunct: '#5A636B',
} as const;

export type AppColors = {
  background: string;
  surface: string;
  surfaceRaised: string;
  hairline: string;
  text: string;
  textSecondary: string;
  brand: string;
  brandTint: string;
  accent: string;
  error: string;
  userBubble: string;
  assistantBubble: string;
  codeBg: string;
  /** The RDF logo is drawn for a white background, in both themes. */
  logoBackdrop: string;
  synComment: string;
  synKeyword: string;
  synString: string;
  synNumber: string;
  synFunction: string;
  synType: string;
  synPunct: string;
};

// ── Fonts ──

const interFallback = Platform.select({
  ios: 'System',
  android: 'Roboto',
  default: 'Arial, sans-serif',
}) as string;

const monoFallback = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
}) as string;

export const fontFamilies = {
  inter: 'Inter_400Regular',
  interMedium: 'Inter_500Medium',
  interSemiBold: 'Inter_600SemiBold',
  mono: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium',
  interFallback,
  monoFallback,
} as const;

// ── Type Scale ──

export const typeScale = {
  display: { fontFamily: fontFamilies.interSemiBold, fontSize: 26, lineHeight: 32 },
  title: { fontFamily: fontFamilies.interSemiBold, fontSize: 18, lineHeight: 24 },
  titleSmall: { fontFamily: fontFamilies.interSemiBold, fontSize: 15, lineHeight: 20 },
  body: { fontFamily: fontFamilies.inter, fontSize: 16, lineHeight: 24 },
  caption: { fontFamily: fontFamilies.inter, fontSize: 12, lineHeight: 16 },
  mono: { fontFamily: fontFamilies.mono, fontSize: 13, lineHeight: 18 },
} as const;

// ── Spacing (8pt grid) ──

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

// ── Radii ──

export const radii = {
  bubble: 18,
  bubbleTail: 6,
  card: 12,
  chip: 8,
  button: 24,
  input: 14,
} as const;

// ── Paper Themes ──

function buildTheme(isDark: boolean): MD3Theme & { appColors: AppColors } {
  const colors = isDark ? darkColors : lightColors;
  const base = isDark ? MD3DarkTheme : MD3LightTheme;

  const fontConfig = {
    displayLarge: { fontFamily: fontFamilies.interSemiBold },
    displayMedium: { fontFamily: fontFamilies.interSemiBold },
    displaySmall: { fontFamily: fontFamilies.interSemiBold },
    headlineLarge: { fontFamily: fontFamilies.interSemiBold },
    headlineMedium: { fontFamily: fontFamilies.interSemiBold },
    headlineSmall: { fontFamily: fontFamilies.interSemiBold },
    titleLarge: { fontFamily: fontFamilies.interSemiBold },
    titleMedium: { fontFamily: fontFamilies.interMedium },
    titleSmall: { fontFamily: fontFamilies.interSemiBold },
    bodyLarge: { fontFamily: fontFamilies.inter },
    bodyMedium: { fontFamily: fontFamilies.inter },
    bodySmall: { fontFamily: fontFamilies.inter },
    labelLarge: { fontFamily: fontFamilies.interMedium },
    labelMedium: { fontFamily: fontFamilies.interMedium },
    labelSmall: { fontFamily: fontFamilies.inter },
  } as const;

  return {
    ...base,
    dark: isDark,
    colors: {
      ...base.colors,
      primary: colors.brand,
      onPrimary: isDark ? colors.background : '#FFFFFF',
      primaryContainer: colors.brandTint,
      onPrimaryContainer: colors.brand,
      secondary: colors.textSecondary,
      background: colors.background,
      onBackground: colors.text,
      surface: colors.surface,
      onSurface: colors.text,
      surfaceVariant: colors.surfaceRaised,
      onSurfaceVariant: colors.textSecondary,
      outline: colors.hairline,
      error: colors.error,
      onError: '#FFFFFF',
      errorContainer: colors.error + '22',
      onErrorContainer: colors.error,
      elevation: {
        level0: 'transparent',
        level1: colors.surface,
        level2: colors.surfaceRaised,
        level3: colors.surfaceRaised,
        level4: colors.surfaceRaised,
        level5: colors.surfaceRaised,
      },
    },
    fonts: configureFonts({ config: fontConfig }),
    appColors: colors,
  };
}

export const darkTheme = buildTheme(true);
export const lightTheme = buildTheme(false);

export type AppTheme = typeof darkTheme;
