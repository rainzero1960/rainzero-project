import useSWR from 'swr';
import { getSession } from 'next-auth/react';
import { authenticatedFetch } from '@/lib/utils';

interface AvailablePrompt {
  id: number | null;
  name: string;
  description: string;
  type: 'default' | 'custom';
  prompt_type: string;
  is_custom: boolean;
  created_at?: string;
  updated_at?: string;
}

const BACK = process.env.NEXT_PUBLIC_BACKEND_URL;

async function fetchAvailablePrompts(): Promise<AvailablePrompt[]> {
  try {
    console.log('[DEBUG] Starting fetchAvailablePrompts...');
    console.log('[DEBUG] BACK URL:', BACK);
    
    const session = await getSession();
    console.log('[DEBUG] Session:', session ? 'exists' : 'null');

    const url = `${BACK}/system_prompts/available-for-summary`;
    console.log('[DEBUG] Full URL:', url);

    const response = await authenticatedFetch(url);

    console.log('[DEBUG] Response status:', response.status);
    console.log('[DEBUG] Response ok:', response.ok);
    console.log('[DEBUG] Response headers:', Object.fromEntries(response.headers.entries()));

    if (response.status === 401) {
      console.log('[DEBUG] 401 Unauthorized error');
      const error = new Error('Unauthorized') as Error & { status?: number };
      error.status = 401;
      throw error;
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.log('[DEBUG] Response error text:', errorText);
      throw new Error(`HTTP ${response.status}: ${errorText || 'Failed to fetch available prompts'}`);
    }

    const data = await response.json();
    console.log('[DEBUG] Response data:', data);
    return data;
  } catch (error) {
    console.error('[DEBUG] Fetch error:', error);
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error('ネットワーク接続エラー: バックエンドサーバーに接続できません');
    }
    throw error;
  }
}

export function useAvailablePrompts() {
  const { data, error, isLoading, mutate } = useSWR<AvailablePrompt[]>(
    'available-prompts',
    fetchAvailablePrompts,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: (error: unknown) => {
        // 認証エラーの場合はリトライしない
        return (error as Error & { status?: number })?.status !== 401;
      },
    }
  );

  // デバッグ情報を追加
  console.log('[useAvailablePrompts] isLoading:', isLoading);
  console.log('[useAvailablePrompts] error:', error);
  console.log('[useAvailablePrompts] data:', data);

  return {
    prompts: data,
    isLoading,
    isError: error,
    mutate
  };
}