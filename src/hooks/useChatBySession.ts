// src/hooks/useChatBySession.ts - セッション対応チャットフック
import useSWR from "swr";
import { authenticatedFetch, createApiHeaders } from "@/lib/utils";

const BACK = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

export interface ChatMsg {
  id: number;
  user_paper_link_id: number;
  paper_chat_session_id?: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  provider?: string;
  model?: string;
  is_deep_research_step?: boolean;
}

export interface ChatMessageResponse {
  messages: ChatMsg[];
  new_empty_session_id?: number;
}

const fetcher = async (url: string): Promise<ChatMsg[]> => {
  const res = await authenticatedFetch(url);
  if (!res.ok) {
    const msg = await res.text();
    if ((res.status === 401 || res.status === 403) && typeof window !== "undefined") {
        console.error("Authentication error fetching chat messages. Status:", res.status, "Message:", msg);
    }
    throw new Error(`status ${res.status}: ${msg}`);
  }
  const text = await res.text();
  if (!text) {
      return [];
  }
  try {
      return JSON.parse(text) as ChatMsg[];
  } catch (e) {
      console.error("Failed to parse chat messages JSON:", e, "Response text:", text);
      throw new Error("Failed to parse chat messages response.");
  }
};

export function useChatBySession(
  sessionId: number | undefined,
  userPaperLinkId: string | number | undefined,
  onNewEmptySession?: (newSessionId: number) => void  // 新しい空白セッション作成時のコールバック
) {
  const url = sessionId ? `${BACK}/papers/chat-sessions/${sessionId}/messages` : null;

  const { data, mutate, error } = useSWR<ChatMsg[]>(url, fetcher, {
    revalidateOnFocus: false, // フォーカス復帰時の自動更新を無効化
    dedupingInterval: 500, // 重複リクエスト防止時間を短縮
    errorRetryCount: 2, // エラー時のリトライ回数を制限
  });

  const send = async (
      msg: string,
      modelConfig?: { provider: string; model: string; temperature: number; top_p: number },
      selectedPrompt?: { id: number | null; type: 'default' | 'custom' },
      useCharacterPrompt?: boolean
    ) => {
    if (!userPaperLinkId || !sessionId) return;

    const optimisticUserMsg: ChatMsg = {
        id: Date.now(),
        user_paper_link_id: Number(userPaperLinkId),
        paper_chat_session_id: sessionId,
        role: "user",
        content: msg,
        created_at: new Date().toISOString(),
    };
    mutate((prevData) => Array.isArray(prevData) ? [...prevData, optimisticUserMsg] : [optimisticUserMsg], false);

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
          paper_chat_session_id: sessionId,
          use_character_prompt: useCharacterPrompt ?? false,
          ...modelConfig 
        };
        
        // プロンプト情報を追加
        if (selectedPrompt) {
          if (selectedPrompt.type === 'custom' && selectedPrompt.id) {
            payload.system_prompt_id = selectedPrompt.id;
          }
        }
        
        const res = await fetch(`${BACK}/papers/${userPaperLinkId}/messages`, {
          method: "POST",
          headers: headers,
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
             const errorText = await res.text();
             console.error("Failed to post chat message:", res.status, errorText);
             throw new Error(`Failed to post message: ${res.status} ${errorText}`);
        }
        
        // レスポンスを解析して新しい空白セッションIDをチェック
        const response: ChatMessageResponse = await res.json();
        if (response.new_empty_session_id && onNewEmptySession) {
          onNewEmptySession(response.new_empty_session_id);
        }
        
        mutate();
    } catch (e) {
        console.error("Error sending chat message:", e);
        alert("メッセージの送信に失敗しました。");
        mutate((prevData) => Array.isArray(prevData) ? prevData.filter(m => m.id !== optimisticUserMsg.id) : undefined, false);
    }
  };

  const removeByIndex = async (reverseIndex: number) => {
    if (!sessionId) return;

    const headers = await createApiHeaders();

    try {
        const res = await fetch(`${BACK}/papers/chat-sessions/${sessionId}/messages/index/${reverseIndex}`, {
          method: "DELETE",
          headers: headers,
        });
        if (!res.ok) {
             const errorText = await res.text();
             console.error("Failed to delete chat message:", res.status, errorText);
             throw new Error(`Failed to delete message: ${res.status} ${errorText}`);
        }
        mutate();
    } catch (e) {
        console.error("Error deleting chat message:", e);
        alert("メッセージの削除に失敗しました。");
    }
  };

  const messagesToDisplay = Array.isArray(data) ? data : [];

  return { 
    messages: messagesToDisplay, 
    send, 
    removeByIndex, 
    isLoading: !error && !data, 
    isError: !!error,
    mutate
  };
}