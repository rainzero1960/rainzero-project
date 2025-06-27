import { useState, useEffect, useCallback } from 'react';

type ContextType = 'chat' | 'rag';

/**
 * キャラクタープロンプトのON/OFF状態を管理するカスタムフック
 * ローカルストレージに設定を永続化し、コンテキスト別に管理
 */
export function useCharacterPromptToggle(context: ContextType) {
  const [enabled, setEnabledState] = useState<boolean>(true);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  // ローカルストレージのキー
  const storageKey = `character-prompt-${context}`;

  // 初期化時にローカルストレージから値を読み込み
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) {
        const parsedValue = JSON.parse(stored);
        if (typeof parsedValue === 'boolean') {
          setEnabledState(parsedValue);
        } else {
          // 無効な値の場合はデフォルト値（true）を設定
          setEnabledState(true);
        }
      } else {
        // 値が存在しない場合はデフォルト値（true）を設定
        setEnabledState(true);
      }
    } catch (error) {
      console.warn(`Failed to load character prompt setting for ${context}:`, error);
      // エラーの場合はデフォルト値（true）を維持
      setEnabledState(true);
    } finally {
      setIsLoaded(true);
    }
  }, [context, storageKey]);

  // 設定を更新する関数
  const setEnabled = useCallback((newEnabled: boolean) => {
    setEnabledState(newEnabled);
    
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(storageKey, JSON.stringify(newEnabled));
      } catch (error) {
        console.warn(`Failed to save character prompt setting for ${context}:`, error);
      }
    }
  }, [context, storageKey]);

  // 設定をトグルする関数
  const toggleEnabled = useCallback(() => {
    setEnabled(!enabled);
  }, [enabled, setEnabled]);

  return {
    enabled,
    setEnabled,
    toggleEnabled,
    isLoaded, // 初期化が完了したかどうか
  };
}