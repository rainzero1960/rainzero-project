// src/hooks/usePaperTagsSummary.ts
import useSWR from "swr";
import { getSession, signOut } from "next-auth/react";
import { authenticatedFetch } from '@/lib/utils';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

export type TagsSummaryResponse = Record<string, number>;

const fetcher = async (url: string): Promise<TagsSummaryResponse> => {
  const session = await getSession();

  if (!session?.accessToken) {
    if (typeof window !== "undefined") {
      signOut({ callbackUrl: '/auth/signin?error=NoAccessTokenForTags', redirect: false }).then(() => {
        window.location.href = '/auth/signin?error=NoAccessTokenForTags';
      });
    }
    throw new Error("No access token available for fetching tags summary. Redirecting to login.");
  }

  const res = await authenticatedFetch(url);

  if (!res.ok) {
    const errorBody = await res.text();
    if (res.status === 401) {
      if (typeof window !== "undefined") {
        signOut({ callbackUrl: '/auth/signin?error=SessionExpiredForTags', redirect: false }).then(() => {
          window.location.href = '/auth/signin?error=SessionExpiredForTags';
        });
      }
      throw new Error(`Authentication failed (401) fetching tags summary: ${errorBody}. Redirecting to login.`);
    }
    throw new Error(`API Error (status ${res.status}) fetching tags summary: ${errorBody}`);
  }
  return res.json();
};

export function usePaperTagsSummary() {
  const url = `${BACKEND}/papers/tags_summary`;
  const { data, error, isLoading, mutate } = useSWR<TagsSummaryResponse>(url, fetcher, {
    revalidateOnFocus: false, // 必要に応じて調整
    shouldRetryOnError: (err) => {
      if (err.message.includes("401")) return false;
      return true;
    }
  });

  return {
    tagsSummary: data,
    isLoadingTagsSummary: isLoading,
    isErrorTagsSummary: !!error,
    mutateTagsSummary: mutate,
  };
}