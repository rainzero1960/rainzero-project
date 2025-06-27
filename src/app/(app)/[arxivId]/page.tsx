// src/app/[arxivId]/page.tsx
"use client";

import { useEffect, useState, Suspense } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession, signIn } from "next-auth/react";
import { authenticatedFetch } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FindByArxivResponse {
  user_paper_link_id?: number;
  paper_metadata_id?: number;
  message: string;
}

function ArxivRedirectPageInner() {
  const params = useParams();
  const router = useRouter();
  const { data: session, status: authStatus } = useSession();

  const arxivId = typeof params?.arxivId === "string" ? params.arxivId : null;
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authStatus === "unauthenticated") {
      signIn(undefined, { callbackUrl: `/${arxivId}` }); 
      return;
    }

    if (authStatus === "authenticated" && arxivId && session?.accessToken) {
      const fetchPaperLink = async () => {
        setIsLoading(true);
        setError(null);
        try {
          const res = await authenticatedFetch(
            `${process.env.NEXT_PUBLIC_BACKEND_URL}/papers/find_by_arxiv_id/${arxivId}`
          );

          if (!res.ok) {
            const errorData = await res.json().catch(() => ({ detail: "Failed to fetch paper link info." }));
            throw new Error(errorData.detail || `Error: ${res.status}`);
          }

          const data: FindByArxivResponse = await res.json();

          if (data.user_paper_link_id) {
            router.replace(`/papers/${data.user_paper_link_id}`);
          } else {
            const arxivUrl = `https://arxiv.org/abs/${arxivId}`;
            router.replace(`/papers/add?arxiv_url=${encodeURIComponent(arxivUrl)}`);
          }
        } catch (err: unknown) {
          console.error("Error in ArxivRedirectPage:", err);
          setError(err instanceof Error ? err.message : "An unexpected error occurred.");
          setIsLoading(false);
        }
      };

      fetchPaperLink();
    } else if (authStatus === "authenticated" && !arxivId) {
        setError("無効なarXiv IDが指定されました。");
        setIsLoading(false);
    } else if (authStatus === "loading") {
        // セッション読み込み中は待機
    }

  }, [arxivId, authStatus, session, router]);

  if (isLoading || authStatus === "loading") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-custom">
        <Loader2 className="h-12 w-12 animate-spin text-blue-600 mb-4" />
        <p className="text-lg text-gray-600">情報を確認中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-custom">
        <p className="text-lg text-red-600">エラー: {error}</p>
        <Button onClick={() => router.push("/")} className="mt-4">
          ホームに戻る
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-custom">
      <Loader2 className="h-12 w-12 animate-spin text-blue-600 mb-4" />
      <p className="text-lg text-gray-600">リダイレクトしています...</p>
    </div>
  );
}

export default function ArxivRedirectPage() {
  return (
    <Suspense fallback={
      <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-custom">
        <Loader2 className="h-12 w-12 animate-spin text-blue-600 mb-4" />
        <p className="text-lg text-gray-600">読み込み中...</p>
      </div>
    }>
      <ArxivRedirectPageInner />
    </Suspense>
  );
}