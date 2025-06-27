/**
 * API応答型定義
 * background-processor.ts で使用される API レスポンスの型を定義
 */

// API応答の型定義
export interface SingleSummaryResponse {
  summary: string;
  tags?: string[];
  arxiv_id?: string;
  title?: string;
  [key: string]: unknown;
}

export interface MultipleSummaryResponse {
  summaries: SingleSummaryResponse[];
  total: number;
  [key: string]: unknown;
}

export interface PromptSelection {
  type: 'default' | 'custom';
  system_prompt_id?: number;
}

// LLMモデル設定の型定義
export interface LLMModelConfig {
  provider?: string;
  model: string;
  temperature?: number;
  top_p?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  [key: string]: unknown; // 追加の設定項目に対応
}

// 通信メッセージの型定義
export interface SendMessageData<T = unknown> {
  type?: string;
  data?: T;
  timestamp?: string;
  taskId?: string;
  [key: string]: unknown;
}

// タスクキャンセル通知の型定義
export interface TaskCancelledBroadcastData {
  taskId: string;
  reason?: string;
  timestamp: string;
  fromInstance?: string;
}

// API応答の基本型
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  taskId?: string;
  task?: T;
  tasks?: T[];
  [key: string]: unknown;
}

// 要約API応答のユニオン型
export type SummaryResponse = SingleSummaryResponse | MultipleSummaryResponse;

// 要約API応答の配列型
export type SummaryResponseList = SummaryResponse[];

// 型定義は上記で既に定義済み