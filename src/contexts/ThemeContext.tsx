"use client";

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { authenticatedFetch } from '@/lib/utils';

// カラーパレット定義
export const COLOR_THEMES = {
  white: {
    name: 'ホワイト',
    light: '#ffffff',
    dark: '#000000',
  },
  lightblue: {
    name: 'ライトブルー',
    light: '#e0f2fe',
    dark: '#0d47a1',
  },
  pink: {
    name: 'ピンク',
    light: '#fce4ec',
    dark: '#c62828',
  },
  orange: {
    name: 'オレンジ',
    light: '#fff3e0',
    dark: '#e65100',
  },
  lightpurple: {
    name: 'ライトパープル',
    light: '#f3e5f5',
    dark: '#4a148c',
  },
  lightgreen: {
    name: 'エメラルドライトグリーン',
    light: '#e0f2f1',
    dark: '#00695c',
  },
  lightyellow: {
    name: 'ライトイエロー',
    light: '#fffde7',
    dark: '#f57f17',
  },
} as const;

export type ColorThemeKey = keyof typeof COLOR_THEMES;

interface ColorThemeContextType {
  lightTheme: ColorThemeKey;
  darkTheme: ColorThemeKey;
  setLightTheme: (theme: ColorThemeKey) => void;
  setDarkTheme: (theme: ColorThemeKey) => void;
  getCurrentBackgroundColor: () => string;
  updateTheme: (light: ColorThemeKey, dark: ColorThemeKey) => Promise<void>;
  isLoading: boolean;
}

const ColorThemeContext = createContext<ColorThemeContextType | undefined>(undefined);

export function useColorTheme() {
  const context = useContext(ColorThemeContext);
  if (context === undefined) {
    throw new Error('useColorTheme must be used within a ColorThemeProvider');
  }
  return context;
}

interface ColorThemeProviderProps {
  children: React.ReactNode;
}

export function ColorThemeProvider({ children }: ColorThemeProviderProps) {
  const { theme: systemTheme } = useTheme();
  const [lightTheme, setLightTheme] = useState<ColorThemeKey>('white');
  const [darkTheme, setDarkTheme] = useState<ColorThemeKey>('white');
  const [isLoading, setIsLoading] = useState(true);

  // ユーザーのテーマ設定を取得
  useEffect(() => {
    const fetchUserTheme = async () => {
      try {
        // ★ 2. authenticatedFetchを使用して、完全なバックエンドURLを呼び出す
        const response = await authenticatedFetch(
          `${process.env.NEXT_PUBLIC_BACKEND_URL}/auth/me`,
          { method: "GET" }
        );
        
        if (response.ok) {
          const user = await response.json();
          if (user.color_theme_light && COLOR_THEMES[user.color_theme_light as ColorThemeKey]) {
            setLightTheme(user.color_theme_light as ColorThemeKey);
          }
          if (user.color_theme_dark && COLOR_THEMES[user.color_theme_dark as ColorThemeKey]) {
            setDarkTheme(user.color_theme_dark as ColorThemeKey);
          }
        }
      } catch (error) {
        console.error('Failed to fetch user theme:', error);
      } finally {
        setIsLoading(false);
      }
    };

    // localStorageからトークンを取得する代わりに、NextAuthのセッションを待つ
    // このコンポーネントは AuthButton などと同様に、NextAuthProvider の内側で使われる想定
    // トークンは authenticatedFetch が自動で付与するため、ここでは不要
    fetchUserTheme();
  }, []); // 依存配列は空のままでOK (初回ロード時に実行)

  // テーマを適用
  useEffect(() => {
    if (isLoading) return;

    const currentTheme = systemTheme === 'dark' ? darkTheme : lightTheme;
    const color = systemTheme === 'dark' ? 
      COLOR_THEMES[currentTheme].dark : 
      COLOR_THEMES[currentTheme].light;

    document.documentElement.style.setProperty('--background-custom', color);
  }, [systemTheme, lightTheme, darkTheme, isLoading]);

  const getCurrentBackgroundColor = () => {
    const currentTheme = systemTheme === 'dark' ? darkTheme : lightTheme;
    return systemTheme === 'dark' ? 
      COLOR_THEMES[currentTheme].dark : 
      COLOR_THEMES[currentTheme].light;
  };

  const updateTheme = async (light: ColorThemeKey, dark: ColorThemeKey) => {
    try {
      const response = await fetch('/api/auth/color-theme', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
        },
        body: JSON.stringify({
          color_theme_light: light,
          color_theme_dark: dark,
        }),
      });

      if (response.ok) {
        setLightTheme(light);
        setDarkTheme(dark);
      } else {
        throw new Error('Failed to update theme');
      }
    } catch (error) {
      console.error('Failed to update theme:', error);
      throw error;
    }
  };

  const value = {
    lightTheme,
    darkTheme,
    setLightTheme,
    setDarkTheme,
    getCurrentBackgroundColor,
    updateTheme,
    isLoading,
  };

  return (
    <ColorThemeContext.Provider value={value}>
      {children}
    </ColorThemeContext.Provider>
  );
}