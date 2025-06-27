// src/hooks/usePaperChatStatus.ts - 論文チャットステータス監視フック
import useSWR from "swr";
import { authenticatedFetch, createApiHeaders } from "@/lib/utils";
import { ChatMsg } from "./useChatBySession";

const BACK = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

export interface PaperChatSessionStatus {
  session_id: number;
  status: string | null;
  messages: ChatMsg[];
  last_updated: string;
}

export interface PaperChatStartResponse {
  session_id: number;
  message: string;
}

const fetcher = async (url: string): Promise<PaperChatSessionStatus> => {
  const res = await authenticatedFetch(url);
  if (!res.ok) {
    const msg = await res.text();
    if ((res.status === 401 || res.status === 403) && typeof window !== "undefined") {
        console.error("Authentication error fetching chat status. Status:", res.status, "Message:", msg);
    }
    throw new Error(`status ${res.status}: ${msg}`);
  }
  return res.json();
};

export function usePaperChatStatus(
  sessionId: number | undefined,
  isPolling: boolean = true
) {
  const url = sessionId ? `${BACK}/papers/chat-sessions/${sessionId}/status` : null;

  const { data, error, mutate } = useSWR<PaperChatSessionStatus>(
    url,
    fetcher,
    {
      refreshInterval: (latestData) => {
        if (!isPolling || 
            latestData?.status === "completed" || 
            latestData?.status === "failed" ||
            latestData?.status === null) {
          return 0; // ポーリング停止
        }
        return 3000; // 3秒間隔でポーリング
      },
      dedupingInterval: 1000, // 1秒以内の重複リクエスト防止
      revalidateOnFocus: false, // フォーカス復帰時の自動更新を無効化（手動制御のため）
      revalidateIfStale: true, // 古いデータの場合は再取得
      revalidateOnMount: true, // マウント時に再取得
      errorRetryCount: 2, // エラー時のリトライ回数を制限
    }
  );

  // チャットメッセージ送信（非同期）
  const sendAsync = async (
    userPaperLinkId: number,
    msg: string,
    modelConfig?: { provider: string; model: string; temperature: number; top_p: number },
    selectedPrompt?: { id: number | null; type: 'default' | 'custom' },
    targetSessionId?: number,
    useCharacterPrompt?: boolean
  ): Promise<PaperChatStartResponse | null> => {
    const headers = await createApiHeaders();

    try {
      const payload: { 
        role: string; 
        content: string; 
        provider?: string; 
        model?: string; 
        temperature?: number; 
        top_p?: number;
        system_prompt_id?: number;
        paper_chat_session_id?: number;
        use_character_prompt?: boolean;
      } = { 
        role: "user", 
        content: msg, 
        paper_chat_session_id: targetSessionId,
        use_character_prompt: useCharacterPrompt ?? false,
        ...modelConfig 
      };
      
      // プロンプト情報を追加
      if (selectedPrompt) {
        if (selectedPrompt.type === 'custom' && selectedPrompt.id) {
          payload.system_prompt_id = selectedPrompt.id;
        }
      }
      
      const res = await fetch(`${BACK}/papers/${userPaperLinkId}/messages/async`, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload),
      });
      
      if (!res.ok) {
        const errorText = await res.text();
        console.error("Failed to start async chat:", res.status, errorText);
        throw new Error(`Failed to start chat: ${res.status} ${errorText}`);
      }
      
      const response: PaperChatStartResponse = await res.json();
      
      // ポーリング開始のため、データを即座に更新
      mutate();
      
      return response;
    } catch (e) {
      console.error("Error starting async chat:", e);
      throw e;
    }
  };

  // セッションの処理状況を判定
  const isProcessing = data?.status === "pending" || data?.status === "processing";
  const isCompleted = data?.status === "completed";
  const isFailed = data?.status === "failed";
  const hasStatus = data?.status !== null && data?.status !== undefined;

  return { 
    statusData: data, 
    sendAsync,
    isProcessing,
    isCompleted,
    isFailed,
    hasStatus,
    isLoading: !error && !data, 
    isError: !!error,
    mutate
  };
}