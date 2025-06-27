// src/hooks/useUserInfo.ts
import useSWR, { mutate as globalMutate } from 'swr';
import { authenticatedFetch } from '@/lib/utils';

export interface UserInfo {
  id: number;
  username: string;
  email?: string;
  selected_character?: string;
  sakura_affinity_level: number;
  miyuki_affinity_level: number;
  created_at: string;
  // 他のフィールドも必要に応じて追加
}

export interface BulkUpdateProgress {
  is_running: boolean;
  total_papers: number;
  processed_papers: number;
  estimated_remaining_seconds?: number;
  error_message?: string;
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

async function fetchUserInfo(): Promise<UserInfo> {
  const response = await authenticatedFetch(`${BACKEND_URL}/auth/me`);
  if (!response.ok) {
    throw new Error('Failed to fetch user info');
  }
  return response.json();
}

export function useUserInfo() {
  const { data, error, isLoading, mutate } = useSWR<UserInfo>(
    `${BACKEND_URL}/auth/me`,
    fetchUserInfo,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  // キャラクター選択のみ即座実行（一括更新なし）
  const updateCharacterSelectionImmediate = async (selectedCharacter: string | null) => {
    try {
      const characterResponse = await authenticatedFetch(`${BACKEND_URL}/auth/character-selection`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ selected_character: selectedCharacter }),
      });

      if (!characterResponse.ok) {
        throw new Error('Failed to update character selection');
      }

      // ユーザー情報を更新
      mutate();
      
      return true;
    } catch (error) {
      console.error('Failed to update character selection:', error);
      throw error;
    }
  };

  // 一括更新をバックグラウンドで開始（非同期）
  const startBulkUpdateBackground = async () => {
    try {
      const bulkUpdateResponse = await authenticatedFetch(`${BACKEND_URL}/auth/character-selection-bulk-update-async`, {
        method: 'PUT',
      });

      if (!bulkUpdateResponse.ok) {
        console.error('Background bulk update failed to start:', bulkUpdateResponse.status);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Failed to start background bulk update:', error);
      return false;
    }
  };

  // 一括更新の進捗確認
  const checkBulkUpdateProgress = async (): Promise<BulkUpdateProgress | null> => {
    try {
      const progressResponse = await authenticatedFetch(`${BACKEND_URL}/auth/character-selection-bulk-update-progress`);

      if (!progressResponse.ok) {
        console.error('Failed to check bulk update progress:', progressResponse.status);
        return null;
      }

      return await progressResponse.json();
    } catch (error) {
      console.error('Failed to check bulk update progress:', error);
      return null;
    }
  };

  // メイン関数：即座キャラクター更新 + バックグラウンド一括更新
  const updateCharacterSelectionWithBackgroundUpdate = async (selectedCharacter: string | null) => {
    try {
      // 1. キャラクター選択を即座実行
      await updateCharacterSelectionImmediate(selectedCharacter);

      // 2. バックグラウンドで一括更新を開始（完了を待たない）
      const bulkUpdateStarted = await startBulkUpdateBackground();

      if (!bulkUpdateStarted) {
        console.warn('Bulk update failed to start, but character selection succeeded');
      }

      return { success: true, bulkUpdateStarted };
    } catch (error) {
      console.error('Failed to update character selection:', error);
      throw error;
    }
  };

  // 旧関数との互換性のため（廃止予定）
  const updateCharacterSelectionWithBulkUpdate = updateCharacterSelectionWithBackgroundUpdate;

  // 一括更新完了後にキャッシュをクリアする関数
  const clearPapersCache = async () => {
    await globalMutate(
      (key) => typeof key === 'string' && key.includes('/papers?'),
      undefined,
      { revalidate: true }
    );
  };

  return {
    user: data,
    isLoading,
    isError: error,
    mutate,
    // 新しい関数群
    updateCharacterSelectionImmediate,
    startBulkUpdateBackground,
    checkBulkUpdateProgress,
    updateCharacterSelectionWithBackgroundUpdate,
    clearPapersCache,
    // 旧関数（互換性のため）
    updateCharacterSelectionWithBulkUpdate,
  };
}