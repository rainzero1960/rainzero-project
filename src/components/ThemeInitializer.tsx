"use client";

import { useEffect } from 'react';
import { useSession } from "next-auth/react";
import { useColorTheme } from '@/hooks/useColorTheme';
import { useTheme } from 'next-themes';

// カラーパレット定義（ColorThemeSelectorと同じ）
export const COLOR_THEMES = {
  white: {
    name: 'ホワイト/ブラック',
    light: '#ffffff',
    dark: '#000000',
  },
  lightblue: {
    name: 'ライトブルー/ネイビー', 
    light: '#e0f2fe',
    dark: '#001016',
  },
  pink: {
    name: 'ピンク/レッド',
    light: '#fce4ec',
    dark: '#220011',
  },
  orange: {
    name: 'オレンジ/ディープオレンジ',
    light: '#fff3e0',
    dark: '#251500',
  },
  lightpurple: {
    name: 'ライトパープル/パープル',
    light: '#f3e5f5',
    dark: '#120021',
  },
  lightgreen: {
    name: 'ライトグリーン/グリーン',
    light: '#e0f2f1',
    dark: '#001204',
  },
  lightyellow: {
    name: 'ライトイエロー/ゴールド',
    light: '#fffde7',
    dark: '#211800',
  },
} as const;

type ColorThemeKey = keyof typeof COLOR_THEMES;

export function ThemeInitializer() {
  const { data: session, status } = useSession();
  const { theme: systemTheme } = useTheme();
  const { user, isLoading } = useColorTheme();

  useEffect(() => {
    // ログインしていない場合はデフォルトテーマを設定
    if (status === "unauthenticated" || !session?.accessToken) {
      const defaultColor = systemTheme === 'dark' ? COLOR_THEMES.white.dark : COLOR_THEMES.white.light;
      document.documentElement.style.setProperty('--background-custom', defaultColor);
      document.documentElement.style.setProperty('--background', defaultColor);
      return;
    }

    // ログイン中でデータロード中の場合は何もしない
    if (isLoading || !user) return;

    const lightTheme = (user.color_theme_light as ColorThemeKey) || 'white';
    const darkTheme = (user.color_theme_dark as ColorThemeKey) || 'white';
    
    const currentTheme = systemTheme === 'dark' ? darkTheme : lightTheme;
    const color = systemTheme === 'dark' ? 
      COLOR_THEMES[currentTheme]?.dark || COLOR_THEMES.white.dark :
      COLOR_THEMES[currentTheme]?.light || COLOR_THEMES.white.light;

    document.documentElement.style.setProperty('--background-custom', color);
    document.documentElement.style.setProperty('--background', color);
  }, [user, systemTheme, isLoading, session, status]);

  return null; // このコンポーネントは何も描画しない
}