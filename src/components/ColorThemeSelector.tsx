"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useColorTheme } from '@/hooks/useColorTheme';
import { useTheme } from 'next-themes';
import { Palette, Check } from 'lucide-react';
import {COLOR_THEMES} from './ThemeInitializer'; // カラーパレット定義をインポート

// カラーパレット定義
{/*export const COLOR_THEMES = {
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
    dark: '#160027',
  },
  lightgreen: {
    name: 'ライトグリーン/グリーン',
    light: '#e0f2f1',
    dark: '#00695c',
  },
  lightyellow: {
    name: 'ライトイエロー/ゴールド',
    light: '#fffde7',
    dark: '#f57f17',
  },
} as const;*/}

export type ColorThemeKey = keyof typeof COLOR_THEMES;

interface ColorThemeSelectorProps {
  onThemeUpdate?: () => void;
}

export function ColorThemeSelector({ onThemeUpdate }: ColorThemeSelectorProps) {
  const { user, isLoading, updateColorTheme } = useColorTheme();
  const { theme: systemTheme } = useTheme();
  const [selectedTheme, setSelectedTheme] = useState<ColorThemeKey>('white');
  const [previewTheme, setPreviewTheme] = useState<ColorThemeKey | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // ユーザーデータからテーマを初期化
  useEffect(() => {
    if (user) {
      const lightTheme = user.color_theme_light as ColorThemeKey;
      const darkTheme = user.color_theme_dark as ColorThemeKey;
      
      let newTheme: ColorThemeKey;
      // ライトとダークが一致する場合はそのテーマを選択
      if (lightTheme === darkTheme && COLOR_THEMES[lightTheme]) {
        newTheme = lightTheme;
      } else {
        // 一致しない場合はライトテーマを優先、無効な場合はwhite
        newTheme = COLOR_THEMES[lightTheme] ? lightTheme : 'white';
      }
      
      setSelectedTheme(newTheme);
      // 初期化時にテーマを適用
      const theme = COLOR_THEMES[newTheme] || COLOR_THEMES.white;
      const color = systemTheme === 'dark' ? theme.dark : theme.light;
      document.documentElement.style.setProperty('--background-custom', color);
      document.documentElement.style.setProperty('--background', color);
    }
  }, [user, systemTheme]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateColorTheme(selectedTheme, selectedTheme);
      // プレビューをリセット
      setPreviewTheme(null);
      applyCurrentTheme();
      
      // テーマ更新成功時にコールバックを呼び出し（背景画像設定を再取得）
      if (onThemeUpdate) {
        onThemeUpdate();
      }
    } catch (error) {
      console.error('Failed to save color theme:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleThemeSelect = (themeKey: ColorThemeKey) => {
    setSelectedTheme(themeKey);
  };

  const handlePreview = (themeKey: ColorThemeKey) => {
    setPreviewTheme(themeKey);
    applyBackgroundPreview(themeKey);
  };

  const clearPreview = () => {
    setPreviewTheme(null);
    applyCurrentTheme();
  };

  const applyBackgroundPreview = (themeKey: ColorThemeKey) => {
    const theme = COLOR_THEMES[themeKey] || COLOR_THEMES.white;
    const color = systemTheme === 'dark' ? theme.dark : theme.light;
    document.documentElement.style.setProperty('--background-custom', color);
    document.documentElement.style.setProperty('--background', color);
  };

  const applyCurrentTheme = () => {
    const theme = COLOR_THEMES[selectedTheme] || COLOR_THEMES.white;
    const color = systemTheme === 'dark' ? theme.dark : theme.light;
    document.documentElement.style.setProperty('--background-custom', color);
    document.documentElement.style.setProperty('--background', color);
  };

  if (isLoading) {
    return <div>読み込み中...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="w-5 h-5" />
          背景色テーマ設定
        </CardTitle>
        <CardDescription>
          ライトモードとダークモードの背景色をセットで設定できます。
          カーソルを合わせるとリアルタイムで背景がプレビューされます。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 現在のプレビュー状態 */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">プレビュー状態</h3>
            <Badge variant="outline">
              {systemTheme === 'dark' ? '🌙 ダーク' : '☀️ ライト'}モード
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground min-h-[1.5rem]">
            {previewTheme ? (
              <>プレビュー中: {COLOR_THEMES[previewTheme].name}</>
            ) : (
              <>選択中: {COLOR_THEMES[selectedTheme].name}</>
            )}
          </div>
        </div>

        {/* テーマセット選択 */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium">テーマセット選択</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(COLOR_THEMES).map(([key, theme]) => {
              const isSelected = selectedTheme === key;
              const isPreview = previewTheme === key;
              
              return (
                <div 
                  key={key} 
                  className={`relative cursor-pointer rounded-lg border-2 transition-all p-4 ${
                    isSelected 
                      ? 'border-blue-500 ring-2 ring-blue-200' 
                      : 'border-gray-300 hover:border-gray-400'
                  } ${isPreview ? 'ring-2 ring-orange-200' : ''}`}
                  onClick={() => handleThemeSelect(key as ColorThemeKey)}
                  onMouseEnter={() => handlePreview(key as ColorThemeKey)}
                  onMouseLeave={clearPreview}
                >
                  {/* 分割カラーボタン */}
                  <div className="flex items-center gap-3">
                    <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-300">
                      {/* ライト側（左半分） */}
                      <div 
                        className="absolute left-0 top-0 w-1/2 h-full"
                        style={{ backgroundColor: theme.light }}
                      />
                      {/* ダーク側（右半分） */}
                      <div 
                        className="absolute right-0 top-0 w-1/2 h-full"
                        style={{ backgroundColor: theme.dark }}
                      />
                      {/* 斜めの区切り線 */}
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div 
                          className="w-px h-full bg-gray-400 transform rotate-12 opacity-50"
                        />
                      </div>
                      {/* 選択チェックマーク */}
                      {isSelected && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="bg-blue-500 rounded-full p-1">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        </div>
                      )}
                    </div>
                    
                    {/* テーマ情報 */}
                    <div className="flex-1">
                      <h4 className="font-medium text-sm">{theme.name}</h4>
                      <div className="text-xs text-muted-foreground mt-1">
                        <div>ライト: {theme.light}</div>
                        <div>ダーク: {theme.dark}</div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 保存ボタン */}
        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="min-w-[100px]"
          >
            {isSaving ? '保存中...' : '保存'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}