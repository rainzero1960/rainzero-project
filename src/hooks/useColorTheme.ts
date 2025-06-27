import useSWR from 'swr';
import { useSession } from "next-auth/react";
import { authenticatedFetch } from '@/lib/utils';
import { UserData } from '@/types/user';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

const fetcher = async (url: string): Promise<UserData> => {
  const res = await authenticatedFetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch user data: ${res.status}`);
  }
  return res.json();
};

export function useColorTheme() {
  const { data: session, status } = useSession();
  
  // ログインしていない場合はAPIを呼び出さない
  const shouldFetch = status === "authenticated" && session?.accessToken;
  
  const { data, error, mutate, isLoading } = useSWR<UserData>(
    shouldFetch ? `${BACKEND}/auth/me` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: (err) => {
        if (err.message.includes("401")) return false;
        return true;
      }
    }
  );

  const updateColorTheme = async (lightTheme: string, darkTheme: string) => {
    try {
      const res = await authenticatedFetch(`${BACKEND}/auth/color-theme`, {
        method: 'PUT',
        body: JSON.stringify({
          color_theme_light: lightTheme,
          color_theme_dark: darkTheme,
        }),
      });

      if (!res.ok) {
        throw new Error(`Failed to update color theme: ${res.status}`);
      }

      // SWRキャッシュを更新
      await mutate();
      return await res.json();
    } catch (error) {
      console.error('Failed to update color theme:', error);
      throw error;
    }
  };

  return {
    user: data,
    isLoading,
    isError: !!error,
    updateColorTheme,
    mutate,
    refetch: mutate, // mutateを refetch として再エクスポート
  };
}