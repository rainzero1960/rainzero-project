// src/hooks/useRagModelConfig.ts
import useSWR from "swr";

const BACK = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

// APIレスポンスの型定義（papers 用と同じなので共有できます）
export interface ModelConfig {
  default_model: { provider: string; model_name: string };
  default_models_by_provider: Record<string, string>;
  models: Record<
    string,
    {
      provider: string;
      temperature_range: [number, number];
      top_p_range: [number, number];
    }
  >;
}

// fetcher はほぼそのまま
const fetcher = async (url: string): Promise<ModelConfig> => {
  const res = await fetch(url);

  if (!res.ok) {
    let errorInfo = `Status: ${res.status}`;
    try {
      const errorData = await res.json();
      errorInfo += `, Message: ${JSON.stringify(errorData)}`;
    } catch {
      errorInfo += `, Body: ${await res.text()}`;
    }
    throw new Error(`Failed to fetch model config: ${errorInfo}`);
  }

  try {
    return (await res.json()) as ModelConfig;
  } catch {
    throw new Error("Failed to parse model config JSON.");
  }
};

/**
 * RAGページ専用のモデル設定を取得するカスタムフック
 * エンドポイント: GET /rag/config/models
 */
export function useRagModelConfig() {
  const swrResponse = useSWR<ModelConfig, Error>(
    `${BACK}/rag/config/models`,
    fetcher,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    }
  );

  return {
    data: swrResponse.data,
    isLoading: swrResponse.isLoading,
    isError: !!swrResponse.error,
    error: swrResponse.error,
    mutate: swrResponse.mutate,
  };
}
