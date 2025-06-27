// src/hooks/useTagCategories.ts
import useSWR from "swr";
import { getSession, signOut } from "next-auth/react";
import { authenticatedFetch } from '@/lib/utils';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

export type TagCategoriesResponse = Record<string, string[]>;

const fetcher = async (url: string): Promise<TagCategoriesResponse> => {
  const session = await getSession();

  if (!session?.accessToken) {
    if (typeof window !== "undefined") {
      signOut({ callbackUrl: '/auth/signin?error=NoAccessTokenForTagCategories', redirect: false }).then(() => {
        window.location.href = '/auth/signin?error=NoAccessTokenForTagCategories';
      });
    }
    throw new Error("No access token available for fetching tag categories. Redirecting to login.");
  }

  const res = await authenticatedFetch(url);

  if (!res.ok) {
    const errorBody = await res.text();
    if (res.status === 401) {
      if (typeof window !== "undefined") {
        signOut({ callbackUrl: '/auth/signin?error=SessionExpiredForTagCategories', redirect: false }).then(() => {
          window.location.href = '/auth/signin?error=SessionExpiredForTagCategories';
        });
      }
      throw new Error(`Authentication failed (401) fetching tag categories: ${errorBody}. Redirecting to login.`);
    }
    throw new Error(`API Error (status ${res.status}) fetching tag categories: ${errorBody}`);
  }
  return res.json();
};

export function useTagCategories() {
  const url = `${BACKEND}/papers/tag_categories`;
  const { data, error, isLoading, mutate } = useSWR<TagCategoriesResponse>(url, fetcher, {
    revalidateOnFocus: false, // 必要に応じて調整
    shouldRetryOnError: (err) => {
      if (err.message.includes("401")) return false;
      return true;
    }
  });

  // フラットなタグリストを生成
  const allTags = data ? Object.values(data).flat() : [];

  return {
    tagCategories: data,
    allTags,
    isLoadingTagCategories: isLoading,
    isErrorTagCategories: !!error,
    mutateTagCategories: mutate,
  };
}