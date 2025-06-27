// src/hooks/useRag.ts
import useSWR from "swr";
import { ModelSetting } from "@/components/ModelSettings";
import { useDeepProcessVisibility } from "./usePageVisibility";
import { useEffect, useCallback } from "react";
import { authenticatedFetch, createApiHeaders } from "@/lib/utils";

const BACK =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

const authedFetcher = async (url: string) => {
  const res = await authenticatedFetch(url);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(errorData.detail || `API Error: ${res.status}`);
  }
  return res.json();
};

/* ------------------------------------------------------------------ */
/*                              Sessions                              */
/* ------------------------------------------------------------------ */
export interface RagSessionData {
  id: number;
  user_id: number;
  created_at: string;
  title: string;
  processing_status?: string;
  last_updated: string;
  session_type?: 'simple' | 'Deep' | 'deepRag';
}

export function useRagSessions() {
  const { data, error, mutate, isLoading } = useSWR<RagSessionData[]>(
    `${BACK}/rag/sessions`,
    authedFetcher
  );
  return {
    sessions: data ?? [],
    mutate,
    isLoading,
    isError: !!error,
  };
}

/* ------------------------------------------------------------------ */
/*                              Messages                              */
/* ------------------------------------------------------------------ */
export interface RagMessageData {
  id: number;
  session_id: number;
  role: string;
  content: string;
  created_at: string;
  metadata_json?: string;
  is_deep_research_step: boolean;
}

export function useRagMessages(sessionId?: number) {
  const url = sessionId ? `${BACK}/rag/sessions/${sessionId}/messages` : null;
  const { data, error, mutate, isLoading } = useSWR<RagMessageData[]>(
    url,
    authedFetcher
  );
  return {
    messages: data ?? [],
    mutate,
    isLoading,
    isError: !!error,
  };
}

/* ------------------------------------------------------------------ */
/*                              RAG API                               */
/* ------------------------------------------------------------------ */
export interface PaperRefData {
  type: "paper";
  user_paper_link_id: number;
  paper_metadata_id: number;
  title: string;
  arxiv_id?: string;
  score?: number;
}

export interface WebRefData {
  type: "web";
  title: string;
  url: string;
  snippet?: string;
  score?: number;
}

export type RagAnswerRefDataUnion = PaperRefData | WebRefData;

export async function queryRag(
  query: string,
  tags: string[],
  selectedTools: string[],
  sessionId?: number,
  model?: ModelSetting,
  selectedPrompt?: { id: number | null; type: 'default' | 'custom' }
): Promise<{ answer: string; refs: RagAnswerRefDataUnion[]; session_id: number }> {
  const headers = await createApiHeaders();

  const body_json = {
    query,
    tags,
    selected_tools: selectedTools,
    session_id: sessionId,
    provider: model?.provider,
    model: model?.model,
    temperature: model?.temperature,
    top_p: model?.top_p,
    prompt_mode: selectedPrompt?.type === 'default' ? 'default' : 'prompt_selection',
    selected_prompts: selectedPrompt?.type === 'default' 
      ? [{ type: 'default' }] 
      : [{ type: 'custom', system_prompt_id: selectedPrompt?.id }],
  };

  const res = await fetch(`${BACK}/rag/query`, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(body_json),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: "Unknown RAG query error" }));
    throw new Error(errorData.detail || `RAG Query Failed: ${res.statusText}`);
  }
  return res.json();
}

/* ------------------------ Delete / Create ------------------------- */
export const deleteRagSession = async (sid: number) => {
  const headers = await createApiHeaders();
  return fetch(`${BACK}/rag/sessions/${sid}`, { method: "DELETE", headers });
}

export const deleteRagMessage = async (sid: number, mid: number) => {
  const headers = await createApiHeaders();
  return fetch(`${BACK}/rag/sessions/${sid}/messages/${mid}`, { method: "DELETE", headers });
}

export async function createRagSession(): Promise<RagSessionData> {
  const headers = await createApiHeaders();
  const res = await fetch(`${BACK}/rag/sessions`, {
    method: "POST",
    headers: headers,
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: "Unknown error creating RAG session" }));
    throw new Error(errorData.detail || `Failed to create RAG session: ${res.statusText}`);
  }
  return res.json();
}

/* ------------------------------------------------------------------ */
/*                        Session Type Detection                      */
/* ------------------------------------------------------------------ */
export async function detectSessionType(sessionId: number): Promise<'simple' | 'Deep' | 'deepRag'> {
  const headers = await createApiHeaders();

  try {
    const deepResearchRes = await fetch(`${BACK}/deepresearch/sessions/${sessionId}/status`, {
      headers
    });
    if (deepResearchRes.ok) {
      const data = await deepResearchRes.json();
      if (data && data.session_id === sessionId) {
        return 'Deep';
      }
    }
  } catch {
    // Ignore and continue
  }

  try {
    const deepRagRes = await fetch(`${BACK}/deeprag/sessions/${sessionId}/status`, {
      headers
    });
    if (deepRagRes.ok) {
      const data = await deepRagRes.json();
      if (data && data.session_id === sessionId) {
        return 'deepRag';
      }
    }
  } catch {
    // Ignore and continue
  }

  return 'simple';
}

/* ------------------------------------------------------------------ */
/*                        Deep‑Research (Polling)                      */
/* ------------------------------------------------------------------ */
export async function startDeepResearchTask(
  query: string,
  sessionId?: number,
  promptGroupId?: number | null,
  useCharacterPrompt?: boolean
): Promise<{ session_id: number; message: string }> {
  const headers = await createApiHeaders();
  const res = await fetch(`${BACK}/deepresearch/start`, {
    method: "POST",
    headers: headers,
    body: JSON.stringify({ 
      query, 
      session_id: sessionId,
      system_prompt_group_id: promptGroupId,
      use_character_prompt: useCharacterPrompt,
    }),
  });
  if (!res.ok) {
    const errorData = await res
      .json()
      .catch(() => ({ detail: "Unknown error starting DeepResearch" }));
    throw new Error(
      errorData.detail ||
        `Failed to start DeepResearch task: ${res.statusText}`
    );
  }
  return res.json();
}

export interface DeepResearchStatusData {
  session_id: number;
  status?: string;
  messages: RagMessageData[];
  last_updated: string;
}

export function useDeepResearchStatus(
  sessionId: number | null,
  isPolling: boolean = true
) {
  const key = sessionId
    ? `${BACK}/deepresearch/sessions/${sessionId}/status`
    : null;

  const { isVisible, registerDeepProcessUpdate } = useDeepProcessVisibility();

  const { data, error, mutate, isLoading } = useSWR<DeepResearchStatusData>(
    key,
    authedFetcher,
    {
      refreshInterval: (latest) => {
        if (!isPolling) return 0;
        if (
          latest?.status === "completed" ||
          latest?.status === "failed"
        )
          return 0;
        return 3000;
      },
      dedupingInterval: 1500,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      revalidateIfStale: true,
      refreshWhenHidden: true,
      refreshWhenOffline: false,
    }
  );

  useEffect(() => {
    if (!sessionId || !isPolling) return;

    const cleanup = registerDeepProcessUpdate(
      () => {
        mutate();
      },
      {
        minBackgroundTime: 2000,
        forceUpdate: false
      }
    );

    return cleanup;
  }, [sessionId, isPolling, registerDeepProcessUpdate, mutate]);

  const enhancedMutate = useCallback(async () => {
    return await mutate();
  }, [mutate]);

  return {
    statusData: data,
    isLoading,
    isError: !!error,
    error,
    mutateStatus: enhancedMutate,
    isVisible,
  };
}

/* ------------------------------------------------------------------ */
/*                        DeepRAG (Polling)                           */
/* ------------------------------------------------------------------ */
export async function startDeepRagTask(
  query: string,
  tags: string[],
  sessionId?: number,
  promptGroupId?: number | null,
  useCharacterPrompt?: boolean
): Promise<{ session_id: number; message: string }> {
  const headers = await createApiHeaders();
  const res = await fetch(`${BACK}/deeprag/start`, {
    method: "POST",
    headers: headers,
    body: JSON.stringify({ 
      query, 
      tags, 
      session_id: sessionId,
      system_prompt_group_id: promptGroupId,
      use_character_prompt: useCharacterPrompt,
    }),
  });
  if (!res.ok) {
    const errorData = await res
      .json()
      .catch(() => ({ detail: "Unknown error starting DeepRAG" }));
    throw new Error(
      errorData.detail ||
        `Failed to start DeepRAG task: ${res.statusText}`
    );
  }
  return res.json();
}

export function useDeepRagStatus(
  sessionId: number | null,
  isPolling: boolean = true
) {
  const key = sessionId
    ? `${BACK}/deeprag/sessions/${sessionId}/status`
    : null;

  const { isVisible, registerDeepProcessUpdate } = useDeepProcessVisibility();

  const { data, error, mutate, isLoading } = useSWR<DeepResearchStatusData>(
    key,
    authedFetcher,
    {
      refreshInterval: (latest) => {
        if (!isPolling) return 0;
        if (
          latest?.status === "completed" ||
          latest?.status === "failed"
        )
          return 0;
        return 3000;
      },
      dedupingInterval: 1500,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      revalidateIfStale: true,
      refreshWhenHidden: true,
      refreshWhenOffline: false,
    }
  );

  useEffect(() => {
    if (!sessionId || !isPolling) return;

    const cleanup = registerDeepProcessUpdate(
      () => {
        mutate();
      },
      {
        minBackgroundTime: 2000,
        forceUpdate: false
      }
    );

    return cleanup;
  }, [sessionId, isPolling, registerDeepProcessUpdate, mutate]);

  const enhancedMutate = useCallback(async () => {
    return await mutate();
  }, [mutate]);

  return {
    statusData: data,
    isLoading,
    isError: !!error,
    error,
    mutateStatus: enhancedMutate,
    isVisible,
  };
}

/* ------------------------------------------------------------------ */
/*                        Simple RAG (Polling)                        */
/* ------------------------------------------------------------------ */
export async function startSimpleRagTask(
  query: string,
  tags: string[],
  selectedTools: string[],
  sessionId?: number,
  model?: ModelSetting,
  selectedPrompt?: { id: number | null; type: 'default' | 'custom' },
  useCharacterPrompt?: boolean
): Promise<{ session_id: number; message: string }> {
  const headers = await createApiHeaders();

  const body_json = {
    query,
    tags,
    selected_tools: selectedTools,
    session_id: sessionId,
    provider: model?.provider,
    model: model?.model,
    temperature: model?.temperature,
    top_p: model?.top_p,
    prompt_mode: selectedPrompt?.type === 'default' ? 'default' : 'prompt_selection',
    selected_prompts: selectedPrompt?.type === 'default' 
      ? [{ type: 'default' }] 
      : [{ type: 'custom', system_prompt_id: selectedPrompt?.id }],
    use_character_prompt: useCharacterPrompt ?? false,
  };

  const res = await fetch(`${BACK}/rag/start_async`, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(body_json),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: "Unknown Simple RAG start error" }));
    throw new Error(errorData.detail || `Failed to start Simple RAG task: ${res.statusText}`);
  }
  return res.json();
}

export interface SimpleRagStatusData {
  session_id: number;
  status?: string;
  messages: RagMessageData[];
  last_updated: string;
  refs?: RagAnswerRefDataUnion[];
}

export function useSimpleRagStatus(
  sessionId: number | null,
  isPolling: boolean = true
) {
  const key = sessionId
    ? `${BACK}/rag/sessions/${sessionId}/status`
    : null;

  const { data, error, mutate, isLoading } = useSWR<SimpleRagStatusData>(
    key,
    authedFetcher,
    {
      refreshInterval: (latest) => {
        if (!isPolling || latest?.status === "completed" || latest?.status === "failed") {
          return 0;
        }
        return 3000;
      },
      dedupingInterval: 1500,
      revalidateOnFocus: true,
    }
  );

  return {
    statusData: data,
    isLoading,
    isError: !!error,
    error,
    mutateStatus: mutate,
  };
}