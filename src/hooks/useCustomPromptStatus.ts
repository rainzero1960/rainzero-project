import useSWR from 'swr';
import { useSession } from 'next-auth/react';
import { authenticatedFetch } from '@/lib/utils';

interface CustomPromptStatus {
  has_custom_initial_summary: boolean;
  initial_summary_prompt_name: string | null;
}

const fetcher = async (url: string): Promise<CustomPromptStatus> => {
  const response = await authenticatedFetch(url);

  if (!response.ok) {
    throw new Error('Failed to fetch custom prompt status');
  }

  return response.json();
};

export function useCustomPromptStatus() {
  const { data: session } = useSession();

  const { data, error, isLoading, mutate } = useSWR(
    session?.accessToken
      ? `${process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000"}/papers/config/custom-prompt-status`
      : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000, // 30秒間は重複リクエストを避ける
    }
  );

  return {
    hasCustomPrompt: data?.has_custom_initial_summary ?? false,
    promptName: data?.initial_summary_prompt_name,
    isLoading,
    error,
    mutate, // 手動でリフレッシュする場合に使用
  };
}