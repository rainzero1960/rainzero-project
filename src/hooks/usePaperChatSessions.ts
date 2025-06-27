// src/hooks/usePaperChatSessions.ts
import useSWR from "swr";
import { authenticatedFetch, createApiHeaders } from "@/lib/utils";

const BACK = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

export interface PaperChatSession {
  id: number;
  user_paper_link_id: number;
  title: string;
  created_at: string;
  last_updated: string;
}

const fetcher = async (url: string): Promise<PaperChatSession[]> => {
  const res = await authenticatedFetch(url);
  if (!res.ok) {
    const msg = await res.text();
    if ((res.status === 401 || res.status === 403) && typeof window !== "undefined") {
        console.error("Authentication error fetching chat sessions. Status:", res.status, "Message:", msg);
    }
    throw new Error(`status ${res.status}: ${msg}`);
  }
  const text = await res.text();
  if (!text) {
      return [];
  }
  try {
      return JSON.parse(text) as PaperChatSession[];
  } catch (e) {
      console.error("Failed to parse chat sessions JSON:", e, "Response text:", text);
      throw new Error("Failed to parse chat sessions response.");
  }
};

export function usePaperChatSessions(userPaperLinkId: string | number | undefined) {
  const url = userPaperLinkId ? `${BACK}/papers/${userPaperLinkId}/chat-sessions` : null;

  const { data, mutate, error } = useSWR<PaperChatSession[]>(url, fetcher);

  const createSession = async (title?: string): Promise<PaperChatSession | null> => {
    if (!userPaperLinkId) return null;

    const headers = await createApiHeaders();
    
    try {
      const payload = { user_paper_link_id: Number(userPaperLinkId), title: title || "" };
      const res = await fetch(`${BACK}/papers/${userPaperLinkId}/chat-sessions`, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errorText = await res.text();
        console.error("Failed to create chat session:", res.status, errorText);
        throw new Error(`Failed to create session: ${res.status} ${errorText}`);
      }
      const newSession = await res.json();
      mutate(); // データを再取得
      return newSession;
    } catch (e) {
      console.error("Error creating chat session:", e);
      alert("セッションの作成に失敗しました。");
      return null;
    }
  };

  const deleteSession = async (sessionId: number): Promise<boolean> => {
    const headers = await createApiHeaders();
    
    try {
      const res = await fetch(`${BACK}/papers/chat-sessions/${sessionId}`, {
        method: "DELETE",
        headers: headers,
      });
      if (!res.ok) {
        const errorText = await res.text();
        console.error("Failed to delete chat session:", res.status, errorText);
        throw new Error(`Failed to delete session: ${res.status} ${errorText}`);
      }
      mutate(); // データを再取得
      return true;
    } catch (e) {
      console.error("Error deleting chat session:", e);
      alert("セッションの削除に失敗しました。");
      return false;
    }
  };

  const ensureEmptySession = async (): Promise<PaperChatSession | null> => {
    if (!userPaperLinkId) return null;

    try {
      const res = await authenticatedFetch(`${BACK}/papers/${userPaperLinkId}/ensure-empty-session`);
      if (!res.ok) {
        const errorText = await res.text();
        console.error("Failed to ensure empty session:", res.status, errorText);
        throw new Error(`Failed to ensure empty session: ${res.status} ${errorText}`);
      }
      const emptySession = await res.json();
      mutate(); // データを再取得
      return emptySession;
    } catch (e) {
      console.error("Error ensuring empty session:", e);
      return null;
    }
  };

  const sessionsToDisplay = Array.isArray(data) ? data : [];

  return { 
    sessions: sessionsToDisplay, 
    createSession, 
    deleteSession, 
    ensureEmptySession,
    isLoading: !error && !data, 
    isError: !!error,
    mutate
  };
}