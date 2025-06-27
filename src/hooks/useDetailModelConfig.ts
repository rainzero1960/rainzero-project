import useSWR from "swr";

const BACK = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

// APIレスポンスの型定義
export interface ModelConfig {
  default_model: { provider: string; model_name: string };
  default_models_by_provider: Record<string, string>;
  models: Record<
    string,
    {
      provider: string;
      // API仕様に応じて必須かオプショナルかを選択してください
      temperature_range: [number, number];
      top_p_range: [number, number];
    }
  >;
}

// データ取得とエラーハンドリングを行う fetcher 関数
const fetcher = async (url: string): Promise<ModelConfig> => {
  const res = await fetch(url);

  // fetch自体が失敗した場合 (ネットワークエラーなど) は SWR が内部でエラーをハンドル

  // レスポンスステータスがエラーを示す場合 (例: 4xx, 5xx)
  if (!res.ok) {
    let errorInfo = `Status: ${res.status}`;
    try {
      // エラーレスポンスのボディに詳細情報が含まれているか試行
      const errorData = await res.json();
      errorInfo += `, Message: ${JSON.stringify(errorData)}`;
    } catch {
      // ボディがJSONでない、または読み取れない場合
      errorInfo += `, Body: ${await res.text()}`;
    }
    const error = new Error(`Failed to fetch detail model config: ${errorInfo}`);
    // SWR がエラー状態として認識できるように例外をスロー
    throw error;
  }

  // 正常なレスポンスの場合、JSONをパースして返す
  try {
    const data = await res.json();
    // ここで Zod などを使ってさらに厳密な型検証を行うことも可能です
    return data as ModelConfig; // 型アサーション (必要に応じて検証を追加)
  } catch {
    throw new Error("Failed to parse detail model config JSON.");
  }
};

// カスタムフック本体
export function useDetailModelConfig() {
  const swrResponse = useSWR<ModelConfig, Error>( // 成功時の型とエラー時の型を指定
    `${BACK}/papers/config/detail-models`,
    fetcher,
    {
      // 必要に応じてSWRのオプションを設定
      // revalidateOnFocus: false, // ウィンドウフォーカス時の自動再検証を無効にするか
      // shouldRetryOnError: false, // エラー発生時にリトライするかどうか
    }
  );

  return {
    data: swrResponse.data,
    isLoading: swrResponse.isLoading,
    isError: !!swrResponse.error, // errorオブジェクトの存在有無でboolean値を生成
    error: swrResponse.error,     // errorオブジェクト自体も返す
    mutate: swrResponse.mutate,   // キャッシュの手動更新用関数
  };
}