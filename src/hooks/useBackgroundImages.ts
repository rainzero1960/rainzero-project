import useSWR from 'swr';
import { useSession } from "next-auth/react";
import { authenticatedFetch } from '@/lib/utils';
import { UserData } from '@/types/user';

interface BackgroundImageInfo {
  set_number: string;
  image_path: string;
  required_points: number;
}

interface AvailableBackgroundImagesResponse {
  light_theme: {
    theme_name: string;
    theme_number: number;
  };
  dark_theme: {
    theme_name: string;
    theme_number: number;
  };
  user_points: number;
  available_images: {
    "chat-background-dark": BackgroundImageInfo[];
    "chat-background-light": BackgroundImageInfo[];
    "rag-background-dark": BackgroundImageInfo[];
    "rag-background-light": BackgroundImageInfo[];
  };
}

interface BackgroundImagesUpdateRequest {
  chat_background_dark_set?: string;
  chat_background_light_set?: string;
  rag_background_dark_set?: string;
  rag_background_light_set?: string;
}

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

const fetcher = async (url: string): Promise<AvailableBackgroundImagesResponse> => {
  const res = await authenticatedFetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch background images: ${res.status}`);
  }
  return res.json();
};

const userFetcher = async (url: string): Promise<UserData> => {
  const res = await authenticatedFetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch user data: ${res.status}`);
  }
  return res.json();
};

export function useBackgroundImages() {
  const { data: session, status } = useSession();
  
  // ログインしていない場合はAPIを呼び出さない
  const shouldFetch = status === "authenticated" && session?.accessToken;
  
  const { data, error, mutate, isLoading } = useSWR<AvailableBackgroundImagesResponse>(
    shouldFetch ? `${BACKEND}/auth/available-background-images` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: (err) => {
        if (err.message.includes("401")) return false;
        return true;
      }
    }
  );

  const updateBackgroundImages = async (images: BackgroundImagesUpdateRequest) => {
    try {
      const res = await authenticatedFetch(`${BACKEND}/auth/background-images`, {
        method: 'PUT',
        body: JSON.stringify(images),
      });

      if (!res.ok) {
        throw new Error(`Failed to update background images: ${res.status}`);
      }

      // SWRキャッシュを更新
      await mutate();
      return await res.json();
    } catch (error) {
      console.error('Failed to update background images:', error);
      throw error;
    }
  };

  return {
    backgroundImages: data,
    isLoading,
    isError: !!error,
    updateBackgroundImages,
    mutate,
    refetch: mutate,
  };
}

export function useUserBackgroundSettings() {
  const { data: session, status } = useSession();
  
  // ログインしていない場合はAPIを呼び出さない
  const shouldFetch = status === "authenticated" && session?.accessToken;
  
  const { data, error, mutate, isLoading } = useSWR<UserData>(
    shouldFetch ? `${BACKEND}/auth/me` : null,
    userFetcher,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: (err) => {
        if (err.message.includes("401")) return false;
        return true;
      }
    }
  );

  return {
    user: data,
    isLoading,
    isError: !!error,
    mutate,
    refetch: mutate,
  };
}