// src/hooks/useSystemPromptGroups.ts
import useSWR, { mutate as globalMutate } from 'swr'; // globalMutate をインポート
import { useSession } from 'next-auth/react';
import { authenticatedFetch } from '@/lib/utils';
import type {
  SystemPromptGroupRead,
  SystemPromptGroupListResponse,
  SystemPromptGroupCreate,
  SystemPromptGroupUpdate,
  SystemPromptGroupValidationResult
} from '@/types/prompt-group';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

/**
 * システムプロンプトグループ一覧を取得するhook
 */
export function useSystemPromptGroups(category?: 'deepresearch' | 'deeprag') {
  const { data: session } = useSession();
  
  const queryParams = category ? `?category=${category}` : '';
  const { data, error, isLoading, mutate } = useSWR<SystemPromptGroupListResponse>(
    session?.accessToken ? `/system-prompt-groups/${queryParams}` : null,
    async (url: string) => { // urlの型をstringに指定
      const response = await authenticatedFetch(`${BACKEND_URL}${url}`);

      if (!response.ok) {
        throw new Error(`プロンプトグループ一覧の取得に失敗しました: ${response.statusText}`);
      }

      return response.json();
    }
  );

  return {
    groups: data?.groups || [],
    total: data?.total || 0,
    isLoading,
    error,
    mutate // SWRフックから返されるmutateを使用
  };
}

/**
 * 特定のシステムプロンプトグループを取得するhook
 */
export function useSystemPromptGroup(groupId: number | null) {
  const { data: session } = useSession();
  
  const { data, error, isLoading, mutate } = useSWR<SystemPromptGroupRead>(
    session?.accessToken && groupId ? `/system-prompt-groups/${groupId}` : null,
    async (url: string) => { // urlの型をstringに指定
      const response = await authenticatedFetch(`${BACKEND_URL}${url}`);

      if (!response.ok) {
        throw new Error(`プロンプトグループの取得に失敗しました: ${response.statusText}`);
      }

      return response.json();
    }
  );

  return {
    group: data,
    isLoading,
    error,
    mutate // SWRフックから返されるmutateを使用
  };
}

/**
 * システムプロンプトグループ管理の操作関数
 */
export function useSystemPromptGroupOperations() {
  const { data: session } = useSession();

  /**
   * 新しいプロンプトグループを作成
   */
  const createGroup = async (groupData: SystemPromptGroupCreate): Promise<SystemPromptGroupRead> => {
    if (!session?.accessToken) {
      throw new Error('認証が必要です');
    }

    const response = await authenticatedFetch(`${BACKEND_URL}/system-prompt-groups/`, {
      method: 'POST',
      body: JSON.stringify(groupData),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'プロンプトグループの作成に失敗しました' }));
      throw new Error(errorData.detail || `プロンプトグループの作成に失敗しました: ${response.statusText}`);
    }

    const newGroup = await response.json();
    
    // キャッシュを更新
    globalMutate((key: string | null) => typeof key === 'string' && key.startsWith('/system-prompt-groups'));
    
    return newGroup;
  };

  /**
   * プロンプトグループを更新
   */
  const updateGroup = async (groupId: number, groupData: SystemPromptGroupUpdate): Promise<SystemPromptGroupRead> => {
    if (!session?.accessToken) {
      throw new Error('認証が必要です');
    }

    const response = await authenticatedFetch(`${BACKEND_URL}/system-prompt-groups/${groupId}`, {
      method: 'PUT',
      body: JSON.stringify(groupData),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'プロンプトグループの更新に失敗しました' }));
      throw new Error(errorData.detail || `プロンプトグループの更新に失敗しました: ${response.statusText}`);
    }

    const updatedGroup = await response.json();
    
    // キャッシュを更新
    globalMutate((key: string | null) => typeof key === 'string' && key.startsWith('/system-prompt-groups'));
    
    return updatedGroup;
  };

  /**
   * プロンプトグループを削除
   */
  const deleteGroup = async (groupId: number): Promise<void> => {
    if (!session?.accessToken) {
      throw new Error('認証が必要です');
    }

    const response = await authenticatedFetch(`${BACKEND_URL}/system-prompt-groups/${groupId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'プロンプトグループの削除に失敗しました' }));
      throw new Error(errorData.detail || `プロンプトグループの削除に失敗しました: ${response.statusText}`);
    }
    
    // キャッシュを更新
    globalMutate((key: string | null) => typeof key === 'string' && key.startsWith('/system-prompt-groups'));
  };

  /**
   * プロンプトグループを検証
   */
  const validateGroup = async (groupId: number): Promise<SystemPromptGroupValidationResult> => {
    if (!session?.accessToken) {
      throw new Error('認証が必要です');
    }

    const response = await authenticatedFetch(`${BACKEND_URL}/system-prompt-groups/${groupId}/validate`);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'プロンプトグループの検証に失敗しました' }));
      throw new Error(errorData.detail || `プロンプトグループの検証に失敗しました: ${response.statusText}`);
    }

    return response.json();
  };

  return {
    createGroup,
    updateGroup,
    deleteGroup,
    validateGroup
  };
}