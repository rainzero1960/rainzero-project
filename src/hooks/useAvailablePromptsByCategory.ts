import useSWR from 'swr';
import { getSession } from 'next-auth/react';
import { authenticatedFetch } from '@/lib/utils';

interface AvailablePrompt {
  id: number | null;
  name: string;
  description: string;
  type: 'default' | 'custom';
  prompt_type: string;
  category: string;
  is_custom: boolean;
  created_at?: string;
  updated_at?: string;
}

const BACK = process.env.NEXT_PUBLIC_BACKEND_URL;

async function fetchAvailablePromptsByCategory(category: string): Promise<AvailablePrompt[]> {
  try {
    console.log(`[DEBUG] Starting fetchAvailablePromptsByCategory for category: ${category}`);
    console.log('[DEBUG] BACK URL:', BACK);
    
    const session = await getSession();
    console.log('[DEBUG] Session:', session ? 'exists' : 'null');

    const url = `${BACK}/system_prompts/available-by-category/${category}`;
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

export function useAvailablePromptsByCategory(category: string) {
  const { data, error, isLoading, mutate } = useSWR<AvailablePrompt[]>(
    category ? `available-prompts-${category}` : null,
    () => fetchAvailablePromptsByCategory(category),
    {
      revalidateOnFocus: false,
      shouldRetryOnError: (error: unknown) => {
        // 認証エラーの場合はリトライしない
        return (error as Error & { status?: number })?.status !== 401;
      },
    }
  );

  // デバッグ情報を追加
  console.log(`[useAvailablePromptsByCategory][${category}] isLoading:`, isLoading);
  console.log(`[useAvailablePromptsByCategory][${category}] error:`, error);
  console.log(`[useAvailablePromptsByCategory][${category}] data:`, data);

  return {
    prompts: data,
    isLoading,
    isError: error,
    mutate
  };
}