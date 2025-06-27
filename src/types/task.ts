/**
 * バックグラウンドタスク処理に関する型定義
 * background-processor.ts と ServiceWorkerManager.tsx で共通使用
 */

// タスクのステータス
export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

// プログレス情報
export interface TaskProgress {
  current: number;
  total: number;
  message?: string;
}

// 処理情報（ハートビート、プロセスID等）
export interface ProcessingInfo {
  processId: string;
  lastHeartbeat: string; // ISO date string
  startedAt: string; // ISO date string
}

// 基本的なタスクインターフェース
export interface BaseTask {
  id: string;
  type: string;
  status: TaskStatus;
  progress?: TaskProgress;
  processingInfo?: ProcessingInfo;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
  data?: Record<string, unknown>;
}

// 論文処理タスクの具体的な型
export interface PaperProcessingTask extends BaseTask {
  type: 'paper_processing';
  data: {
    arxivId?: string;
    paperUrl?: string;
    userPaperLinkId?: number;
    summaryType?: 'default' | 'custom';
    customPromptId?: number;
  };
}

// ServiceWorkerManager で使用されるロック詳細情報
export interface LockDetail {
  id: string;
  status: TaskStatus;
  progress: string; // "current/total" 形式
  owner: string;
  heartbeatAge: number; // 秒数
  isStuck: boolean;
  lastHeartbeat: string; // ローカライズされた時刻文字列
}

// タスクキャンセル時のブロードキャストデータ
export interface TaskCancelledBroadcastData {
  taskId: string;
  reason?: string;
  timestamp: string;
}

// ユニオン型でタスクの種類を定義
export type Task = PaperProcessingTask | BaseTask;

// タスク配列型
export type TaskList = Task[];