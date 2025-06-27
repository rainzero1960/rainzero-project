// src/hooks/useChat.ts
import useSWR from "swr";
// import { Paper } from "@/types/paper"; // Paper型は直接使わない
import { authenticatedFetch, createApiHeaders } from "@/lib/utils";

const BACK = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

export interface ChatMsg { // APIスキーマ (ChatMessageRead) に合わせる
  id: number;
  user_paper_link_id: number; // ★ 追加
  role: "user" | "assistant";
  content: string;
  created_at: string; // ISO string
  // APIレスポンスに含まれるなら provider, model なども追加可能
  provider?: string;
  model?: string;
  is_deep_research_step?: boolean; // DeepResearch用 (papers APIでは通常false)
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

// paperId は userPaperLinkId を想定
export function useChat(userPaperLinkId: string | number | undefined) {
  const url = userPaperLinkId ? `${BACK}/papers/${userPaperLinkId}/messages` : null; // URLを userPaperLinkId で構築

  const { data, mutate, error } = useSWR<ChatMsg[]>(url, fetcher);

  const send = async (
      msg: string,
      modelConfig?: { provider: string; model: string; temperature: number; top_p: number }, // model を modelConfig に変更
      selectedPrompt?: { id: number | null; type: 'default' | 'custom' }, // プロンプト情報を追加
      useCharacterPrompt?: boolean // キャラクタープロンプト使用フラグ
    ) => {
    if (!userPaperLinkId) return; // userPaperLinkId がないと送信不可

    const optimisticUserMsg: ChatMsg = { // user_paper_link_id を含める
        id: Date.now(), // 一時的なID (数値型に)
        user_paper_link_id: Number(userPaperLinkId), // 数値型に変換
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
          use_character_prompt?: boolean;
        } = { 
          role: "user", 
          content: msg, 
          ...modelConfig,
          use_character_prompt: useCharacterPrompt ?? false
        };
        
        // プロンプト情報を追加
        if (selectedPrompt) {
          if (selectedPrompt.type === 'custom' && selectedPrompt.id) {
            payload.system_prompt_id = selectedPrompt.id;
          }
          // デフォルトの場合は何も追加しない（バックエンドでデフォルトプロンプトが使用される）
        }
        
        const res = await fetch(url!, { // urlがnullでないことを保証 (userPaperLinkIdがあるため)
          method: "POST",
          headers: headers,
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
             const errorText = await res.text();
             console.error("Failed to post chat message:", res.status, errorText);
             throw new Error(`Failed to post message: ${res.status} ${errorText}`);
        }
        mutate();
    } catch (e) {
        console.error("Error sending chat message:", e);
        alert("メッセージの送信に失敗しました。");
        mutate((prevData) => Array.isArray(prevData) ? prevData.filter(m => m.id !== optimisticUserMsg.id) : undefined, false);
    }
  };

  const removeByIndex = async (reverseIndex: number) => {
    if (!userPaperLinkId || !url) return; // userPaperLinkId と url がないと削除不可

    const headers = await createApiHeaders();

    try {
        const res = await fetch(`${url}/index/${reverseIndex}`, { // url をベースに構築
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

  return { messages: messagesToDisplay, send, removeByIndex, isLoading: !error && !data, isError: !!error };
}