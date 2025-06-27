"use client";

import React from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useColorTheme } from '@/hooks/useColorTheme';
import { Sparkles } from 'lucide-react';

interface CharacterPromptToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * キャラクタープロンプトのON/OFF切り替えチェックボックスコンポーネント
 */
export function CharacterPromptToggle({ 
  enabled, 
  onChange, 
  disabled = false,
  className = ""
}: CharacterPromptToggleProps) {
  const { user } = useColorTheme();
  
  // ユーザーがキャラクターを選択していない場合は非表示
  if (!user?.selected_character) {
    return null;
  }

  // キャラクター名を表示名に変換
  const getCharacterDisplayName = (character: string) => {
    switch (character) {
      case 'sakura':
        return 'さくら';
      case 'miyuki':
        return 'みゆき';
      default:
        return character;
    }
  };

  const characterName = getCharacterDisplayName(user.selected_character);

  return (
    <div className={`flex items-center space-x-2 mt-2 ${className}`}>
      <Checkbox
        id="character-prompt-toggle"
        checked={enabled}
        onCheckedChange={(checked) => {
          if (typeof checked === 'boolean') {
            onChange(checked);
          }
        }}
        disabled={disabled}
      />
      <div className="flex items-center space-x-1">
        <Label 
          htmlFor="character-prompt-toggle" 
          className={`text-sm font-medium cursor-pointer ${
            disabled ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        >
          {characterName}のキャラクタープロンプトを使用する
        </Label>
        <Sparkles className="h-3 w-3 text-pink-500 opacity-70" />
      </div>
    </div>
  );
}