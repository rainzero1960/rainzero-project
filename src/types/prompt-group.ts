// src/types/prompt-group.ts
/**
 * システムプロンプトグループの型定義
 */

export interface SystemPromptGroupBase {
  name: string;
  description: string;
  category: 'deepresearch' | 'deeprag';
  coordinator_prompt_id?: number | null;
  planner_prompt_id?: number | null;
  supervisor_prompt_id?: number | null;
  agent_prompt_id?: number | null;
  summary_prompt_id?: number | null;
  is_active: boolean;
}

export type SystemPromptGroupCreate = SystemPromptGroupBase;

export type SystemPromptGroupUpdate = Partial<SystemPromptGroupBase>;

export interface SystemPromptGroupRead extends SystemPromptGroupBase {
  id: number;
  user_id?: number | null;
  created_at: string;
  updated_at: string;
}

export interface SystemPromptGroupListResponse {
  groups: SystemPromptGroupRead[];
  total: number;
}

export interface SystemPromptGroupValidationResult {
  group_id: number;
  is_valid: boolean;
  prompt_ids: {
    coordinator?: number | null;
    planner?: number | null;
    supervisor?: number | null;
    agent?: number | null;
    summary?: number | null;
  };
  category: string;
}

// プロンプト選択用の型
export interface PromptOption {
  id: number | null;
  name: string;
  description: string;
  type: 'default' | 'custom';
  prompt_type: string;
  category: string;
  is_custom: boolean;
  created_at?: string;
  updated_at?: string;
}

// エージェント別プロンプト選択の状態管理用
export interface AgentPromptSelection {
  coordinator?: PromptOption | null;
  planner?: PromptOption | null;
  supervisor?: PromptOption | null;
  agent?: PromptOption | null;
  summary?: PromptOption | null;
}

// プロンプトグループのエラーハンドリング用
export interface PromptGroupError {
  field?: keyof SystemPromptGroupBase;
  message: string;
  code?: string;
}