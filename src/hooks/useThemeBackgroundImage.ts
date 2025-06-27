import { useState, useEffect, useCallback } from 'react';
import { useColorTheme } from '@/hooks/useColorTheme';
import { useTheme } from 'next-themes';
import { authenticatedFetch } from '@/lib/utils';
import useSWR from 'swr';

type BackgroundType = 'rag' | 'chat';

interface UseThemeBackgroundImageResult {
  backgroundImagePath: string;
  isLoading: boolean;
  error: string | null;
}

interface UserImageInfo {
  "chat-background-dark": string | null;
  "chat-background-light": string | null;
  "rag-background-dark": string | null;
  "rag-background-light": string | null;
  themes: {
    light_theme: string;
    dark_theme: string;
    light_theme_number: number;
    dark_theme_number: number;
  };
  sets: {
    chat_dark_set: string;
    chat_light_set: string;
    rag_dark_set: string;
    rag_light_set: string;
  };
}

/**
 * テーマに応じた背景画像のパスを動的に取得するフック（実際のファイル名対応版）
 * 
 * @param backgroundType - 背景画像の種類（'rag' | 'chat'）
 * @returns 背景画像のパス、ローディング状態、エラー情報
 */
export function useThemeBackgroundImage(backgroundType: BackgroundType): UseThemeBackgroundImageResult {
  const { user, isLoading: userLoading } = useColorTheme();
  const { theme: systemTheme } = useTheme();
  
  const [backgroundImagePath, setBackgroundImagePath] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

  // ユーザーの実際の画像ファイル情報を取得
  const { data: imageInfo, error: imageInfoError, isLoading: imageInfoLoading } = useSWR<UserImageInfo>(
    user ? `${backendUrl}/background-images/user-image-info` : null,
    async (url) => {
      const response = await authenticatedFetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch image info: ${response.status}`);
      }
      return response.json();
    },
    {
      revalidateOnFocus: false,
      shouldRetryOnError: (err) => {
        if (err.message.includes("401")) return false;
        return true;
      }
    }
  );

  /**
   * フォールバック画像パスを取得
   */
  const getFallbackImagePath = useCallback((bgType: BackgroundType): string => {
    return `/${bgType}-background.png`;
  }, []);

  // 背景画像パスを更新
  useEffect(() => {
    console.log(`[背景画像デバッグ] useThemeBackgroundImage開始: ${backgroundType}`);
    console.log(`[背景画像デバッグ] userLoading:`, userLoading);
    console.log(`[背景画像デバッグ] user:`, user);
    console.log(`[背景画像デバッグ] systemTheme:`, systemTheme);
    console.log(`[背景画像デバッグ] imageInfo:`, imageInfo);
    console.log(`[背景画像デバッグ] imageInfoError:`, imageInfoError);
    
    if (userLoading || imageInfoLoading) {
      console.log(`[背景画像デバッグ] ローディング中...`);
      return;
    }

    if (!user || imageInfoError) {
      const fallbackPath = getFallbackImagePath(backgroundType);
      console.log(`[背景画像デバッグ] ユーザー未認証またはエラー、フォールバック使用:`, fallbackPath);
      setBackgroundImagePath(fallbackPath);
      setError(imageInfoError?.message || null);
      return;
    }

    if (!imageInfo) {
      console.log(`[背景画像デバッグ] 画像情報が取得できていない`);
      return;
    }

    // ライト/ダークモードを決定
    const mode = systemTheme === 'dark' ? 'dark' : 'light';
    console.log(`[背景画像デバッグ] モード決定:`, mode);

    // 画像タイプとモードに基づいて適切なファイル名を取得
    const imageKey = `${backgroundType}-background-${mode}` as keyof Pick<UserImageInfo, "chat-background-dark" | "chat-background-light" | "rag-background-dark" | "rag-background-light">;
    const filename = imageInfo[imageKey];
    
    console.log(`[背景画像デバッグ] 画像キー:`, imageKey);
    console.log(`[背景画像デバッグ] ファイル名:`, filename);

    if (!filename) {
      const fallbackPath = getFallbackImagePath(backgroundType);
      console.log(`[背景画像デバッグ] ファイルが見つからない、フォールバック使用:`, fallbackPath);
      setBackgroundImagePath(fallbackPath);
      return;
    }

    // テーマ番号を取得
    const themeNumber = mode === 'dark' 
      ? imageInfo.themes.dark_theme_number 
      : imageInfo.themes.light_theme_number;

    // 認証付きで画像を取得してBlob URLを作成
    const loadAuthenticatedImage = async () => {
      try {
        const imageUrl = `${backendUrl}/backend/image/thema${themeNumber}/${filename}`;
        console.log(`[背景画像デバッグ] 認証付きで画像取得開始:`, imageUrl);
        
        const response = await authenticatedFetch(imageUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.status}`);
        }
        
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        
        console.log(`[背景画像デバッグ] Blob URL作成成功:`, blobUrl);
        setBackgroundImagePath(blobUrl);
        setError(null);
        
        // クリーンアップ用にBlob URLを保存
        return () => {
          URL.revokeObjectURL(blobUrl);
        };
      } catch (err) {
        console.error(`[背景画像デバッグ] 認証付き画像取得失敗:`, err);
        const fallbackPath = getFallbackImagePath(backgroundType);
        console.log(`[背景画像デバッグ] フォールバックに切り替え:`, fallbackPath);
        setBackgroundImagePath(fallbackPath);
        setError(err instanceof Error ? err.message : 'Failed to load image');
      }
    };

    const cleanup = loadAuthenticatedImage();
    
    // クリーンアップ関数を返す
    return () => {
      if (cleanup && typeof cleanup.then === 'function') {
        cleanup.then(cleanupFn => {
          if (cleanupFn) cleanupFn();
        });
      }
    };
  }, [
    user,
    userLoading,
    imageInfo,
    imageInfoError,
    imageInfoLoading,
    systemTheme,
    backgroundType,
    backendUrl,
    getFallbackImagePath
  ]);

  // 戻り値をログ出力
  useEffect(() => {
    console.log(`[背景画像デバッグ] useThemeBackgroundImage戻り値 (${backgroundType}):`, {
      backgroundImagePath,
      isLoading: userLoading || imageInfoLoading,
      error,
    });
  }, [backgroundImagePath, userLoading, imageInfoLoading, error, backgroundType]);

  return {
    backgroundImagePath,
    isLoading: userLoading || imageInfoLoading,
    error,
  };
}

/**
 * RAGページ用の背景画像フック
 */
export function useRagBackgroundImage() {
  return useThemeBackgroundImage('rag');
}

/**
 * チャット（論文詳細）ページ用の背景画像フック
 */
export function useChatBackgroundImage() {
  return useThemeBackgroundImage('chat');
}