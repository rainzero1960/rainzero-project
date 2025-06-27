// src/hooks/usePaperDetail.ts
import useSWR from "swr";
import { Paper } from "@/types/paper"; // 更新されたPaper型をインポート
import { authenticatedFetch } from '@/lib/utils';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

const fetcher = async (url: string): Promise<Paper> => { // レスポンスの型を Paper に
  const res = await authenticatedFetch(url);
  if (!res.ok) {
    const msg = await res.text();
    if (res.status === 401 && typeof window !== "undefined") {
        console.error("Authentication error fetching paper detail. Status:", res.status, "Message:", msg);
    }
    throw new Error(`status ${res.status}: ${msg}`);
  }
  return res.json();
};

// id は userPaperLinkId を想定
export function usePaperDetail(userPaperLinkId: string | number | undefined) {
  const shouldFetch = !!userPaperLinkId;
  const { data, error, isLoading, mutate } = useSWR<Paper>( // SWRの型を Paper に
    shouldFetch ? `${BACKEND}/papers/${userPaperLinkId}` : null, // URLを userPaperLinkId で構築
    fetcher
  );
  return {
    paper: data, // dataがundefinedの場合もある
    isLoading,
    isError: !!error,
    mutate,
  };
}