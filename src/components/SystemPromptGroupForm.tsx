// src/components/SystemPromptGroupForm.tsx
"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Save, X, AlertTriangle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useMultiplePromptsByType } from "@/hooks/usePromptsByType";
import type { 
  SystemPromptGroupCreate, 
  SystemPromptGroupUpdate, 
  SystemPromptGroupRead,
  PromptOption
} from '@/types/prompt-group';

interface SystemPromptGroupFormProps {
  initialData?: SystemPromptGroupRead;
  onSubmit: (data: SystemPromptGroupCreate | SystemPromptGroupUpdate) => Promise<void>;
  onCancel: () => void;
  isEdit?: boolean;
}

// エージェントタイプの定義
const AGENT_TYPES = ['coordinator', 'planner', 'supervisor', 'agent', 'summary'] as const;
type AgentType = typeof AGENT_TYPES[number];

// カテゴリ別プロンプトタイプマッピング
const PROMPT_TYPE_MAPPING: Record<'deepresearch' | 'deeprag', Record<AgentType, string>> = {
  deepresearch: {
    coordinator: 'deepresearch_coordinator',
    planner: 'deepresearch_planner',
    supervisor: 'deepresearch_supervisor',
    agent: 'deepresearch_agent',
    summary: 'deepresearch_summary'
  },
  deeprag: {
    coordinator: 'deeprag_coordinator',
    planner: 'deeprag_planner',
    supervisor: 'deeprag_supervisor',
    agent: 'deeprag_agent',
    summary: 'deeprag_summary'
  }
};

// エージェント名の日本語表示
const AGENT_LABELS: Record<AgentType, string> = {
  coordinator: 'コーディネーター',
  planner: 'プランナー',
  supervisor: 'スーパーバイザー',
  agent: 'エージェント',
  summary: 'サマリー'
};

export default function SystemPromptGroupForm({
  initialData,
  onSubmit,
  onCancel,
  isEdit = false
}: SystemPromptGroupFormProps) {
  // フォーム状態
  const [formData, setFormData] = useState({
    name: initialData?.name || '',
    description: initialData?.description || '',
    category: initialData?.category || 'deepresearch' as 'deepresearch' | 'deeprag',
    coordinator_prompt_id: initialData?.coordinator_prompt_id ?? null,
    planner_prompt_id: initialData?.planner_prompt_id ?? null,
    supervisor_prompt_id: initialData?.supervisor_prompt_id ?? null,
    agent_prompt_id: initialData?.agent_prompt_id ?? null,
    summary_prompt_id: initialData?.summary_prompt_id ?? null,
    is_active: initialData?.is_active ?? true
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // initialDataが変更された場合（編集モードでデータがロードされた後など）にフォームデータを更新
  useEffect(() => {
    if (initialData) {
      setFormData({
        name: initialData.name,
        description: initialData.description,
        category: initialData.category,
        coordinator_prompt_id: initialData.coordinator_prompt_id ?? null,
        planner_prompt_id: initialData.planner_prompt_id ?? null,
        supervisor_prompt_id: initialData.supervisor_prompt_id ?? null,
        agent_prompt_id: initialData.agent_prompt_id ?? null,
        summary_prompt_id: initialData.summary_prompt_id ?? null,
        is_active: initialData.is_active
      });
    }
  }, [initialData]);

  // 選択されたカテゴリに応じたプロンプトタイプを取得
  const promptTypesForHooks = AGENT_TYPES.map(agentType => {
    const categoryKey = formData.category; // formData.categoryを直接使用
    return PROMPT_TYPE_MAPPING[categoryKey][agentType];
  });

  // プロンプト一覧を取得
  const { promptsByType, isLoading: promptsLoading } = useMultiplePromptsByType(promptTypesForHooks);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formData.name.trim()) {
      setFormError('グループ名を入力してください');
      return;
    }

    if (!formData.description.trim()) {
      setFormError('説明を入力してください');
      return;
    }

    try {
      setIsSubmitting(true);
      await onSubmit(formData);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setFormError(errorMessage || 'エラーが発生しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInputChange = (field: string, value: unknown) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setFormError(null);
  };

  const getPromptOptionsForAgent = (agentType: AgentType): PromptOption[] => {
    const categoryKey = formData.category;
    const promptType = PROMPT_TYPE_MAPPING[categoryKey][agentType];
    return promptsByType[promptType] || [];
  };

  const getSelectedPromptId = (agentType: AgentType): number | null => {
    const field = `${agentType}_prompt_id` as keyof typeof formData;
    return formData[field] as number | null;
  };

  const setSelectedPromptId = (agentType: AgentType, promptId: number | null) => {
    const field = `${agentType}_prompt_id`;
    handleInputChange(field, promptId);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* 基本情報 */}
      <Card>
        <CardHeader>
          <CardTitle>基本情報</CardTitle>
          <CardDescription>
            プロンプトグループの基本情報を設定します
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">グループ名 *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                placeholder="例: 女の子ロールプレイグループ"
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="category">カテゴリ *</Label>
              <Select
                value={formData.category}
                onValueChange={(value: 'deepresearch' | 'deeprag') => { // 型を明示
                  handleInputChange('category', value);
                  // カテゴリ変更時にプロンプト選択をリセット
                  AGENT_TYPES.forEach(agentType => {
                    setSelectedPromptId(agentType, null);
                  });
                }}
                disabled={isEdit} // 編集時はカテゴリ変更不可
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="deepresearch">DeepResearch</SelectItem>
                  <SelectItem value="deeprag">DeepRAG</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">説明 *</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
              placeholder="このプロンプトグループの目的や特徴を説明してください"
              rows={3}
              required
            />
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="is_active"
              checked={formData.is_active}
              onCheckedChange={(checked) => handleInputChange('is_active', checked)}
            />
            <Label htmlFor="is_active">アクティブ</Label>
          </div>
        </CardContent>
      </Card>

      {/* エージェント別プロンプト設定 */}
      <Card>
        <CardHeader>
          <CardTitle>エージェント別プロンプト設定</CardTitle>
          <CardDescription>
            各エージェントで使用するプロンプトを選択します（省略可能）
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {promptsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span className="text-sm text-muted-foreground">プロンプト一覧を読み込み中...</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {AGENT_TYPES.map((agentType) => {
                const options = getPromptOptionsForAgent(agentType);
                const selectedId = getSelectedPromptId(agentType);
                
                return (
                  <div key={agentType} className="space-y-2">
                    <Label htmlFor={`${agentType}_prompt`}>
                      {AGENT_LABELS[agentType]}プロンプト
                    </Label>
                    <Select
                      value={selectedId?.toString() || "none"}
                      onValueChange={(value) => {
                        if (value === "none" || value === "default") { // "default"もnoneとして扱う
                          setSelectedPromptId(agentType, null);
                        } else {
                          setSelectedPromptId(agentType, value ? parseInt(value) : null);
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="プロンプトを選択（省略可能）" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">選択なし（デフォルト使用）</SelectItem>
                        {options.map((option) => (
                          <SelectItem key={option.id || 'default-option'} value={option.id?.toString() || "default-option-value"}>
                            {option.name}
                            {option.type === 'custom' && (
                              <span className="ml-2 text-xs text-muted-foreground">(カスタム)</span>
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {options.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        このタイプのプロンプトがありません
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* エラー表示 */}
      {formError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      {/* アクションボタン */}
      <div className="flex gap-2 justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          <X className="mr-2 h-4 w-4" />
          キャンセル
        </Button>
        <Button
          type="submit"
          disabled={isSubmitting || promptsLoading}
        >
          {isSubmitting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          {isSubmitting 
            ? (isEdit ? '更新中...' : '作成中...') 
            : (isEdit ? '更新' : '作成')
          }
        </Button>
      </div>
    </form>
  );
}