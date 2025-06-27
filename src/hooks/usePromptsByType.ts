// src/hooks/usePromptsByType.ts
import useSWR from 'swr';
import { useSession } from 'next-auth/react';
import { authenticatedFetch } from '@/lib/utils';
import type { PromptOption } from '@/types/prompt-group';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

/**
 * 特定のプロンプトタイプで利用可能なプロンプト一覧を取得するhook
 */
export function usePromptsByType(promptType: string | null) {
  const { data: session } = useSession();
  
  const { data, error, isLoading } = useSWR<PromptOption[]>(
    session?.accessToken && promptType ? `/system_prompts/available-by-type/${promptType}` : null,
    async (url) => {
      const response = await authenticatedFetch(`${BACKEND_URL}${url}`);

      if (!response.ok) {
        if (response.status === 401) {
          const error = new Error('Unauthorized') as Error & { status?: number };
          error.status = 401;
          throw error;
        }
        throw new Error(`プロンプト一覧の取得に失敗しました: ${response.statusText}`);
      }

      const data = await response.json();
      
      // APIからのデータをPromptOption型に変換
      return data.map((prompt: unknown) => {
        const p = prompt as {
          id?: number;
          name?: string;
          description?: string;
          type?: string;
          prompt_type?: string;
          category?: string;
          is_custom?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        return {
          id: p.id,
          name: p.name,
          description: p.description,
          type: p.type,
          prompt_type: p.prompt_type,
          category: p.category,
          is_custom: p.is_custom,
          created_at: p.created_at,
          updated_at: p.updated_at
        };
      });
    },
    {
      revalidateOnFocus: false,
      shouldRetryOnError: (error: unknown) => {
        // 認証エラーの場合はリトライしない
        return (error as Error & { status?: number })?.status !== 401;
      },
    }
  );

  return {
    prompts: data || [],
    isLoading,
    error
  };
}

/**
 * 複数のプロンプトタイプで利用可能なプロンプト一覧を取得するhook
 */
export function useMultiplePromptsByType(promptTypes: string[]) {
  const { data: session } = useSession();
  
  // 複数タイプを一括取得するAPIエンドポイントを使用
  const { data, error, isLoading } = useSWR<Record<string, PromptOption[]>>(
    session?.accessToken && promptTypes.length > 0 
      ? `/system_prompts/available-by-types?types=${promptTypes.join(',')}` 
      : null,
    async (url) => {
      const response = await authenticatedFetch(`${BACKEND_URL}${url}`);

      if (!response.ok) {
        if (response.status === 401) {
          const error = new Error('Unauthorized') as Error & { status?: number };
          error.status = 401;
          throw error;
        }
        const errorText = await response.text();
        throw new Error(`プロンプト一覧の取得に失敗しました: ${errorText || response.statusText}`);
      }

      const data = await response.json();
      return data as Record<string, PromptOption[]>;
    },
    {
      revalidateOnFocus: false,
      shouldRetryOnError: (error: unknown) => {
        return (error as Error & { status?: number })?.status !== 401;
      },
    }
  );

  return {
    promptsByType: data || {},
    isLoading,
    hasError: !!error
  };
}