// src/components/SystemPromptGroupManager.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Settings, Trash2, Edit, CheckCircle, XCircle, AlertTriangle, EyeOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useSystemPromptGroups, useSystemPromptGroupOperations } from "@/hooks/useSystemPromptGroups";
import type { SystemPromptGroupRead, SystemPromptGroupCreate, SystemPromptGroupUpdate } from '@/types/prompt-group';
import SystemPromptGroupForm from './SystemPromptGroupForm';

export default function SystemPromptGroupManager() {
  const [selectedCategory, setSelectedCategory] = useState<'deepresearch' | 'deeprag' | 'all'>('all');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<SystemPromptGroupRead | null>(null);
  const [validationResults, setValidationResults] = useState<Record<number, boolean>>({});
  const [operationLoading, setOperationLoading] = useState<number | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);

  const { groups, isLoading, error, mutate: mutateGroups } = useSystemPromptGroups(
    selectedCategory === 'all' ? undefined : selectedCategory
  );
  const { createGroup, updateGroup, deleteGroup, validateGroup } = useSystemPromptGroupOperations();

  const handleCreateGroup = async (data: SystemPromptGroupCreate | SystemPromptGroupUpdate) => {
    try {
      setOperationError(null);
      if (!('name' in data && data.name && 
            'description' in data && data.description && 
            'category' in data && data.category && 
            'is_active' in data && typeof data.is_active === 'boolean')) {
        setOperationError('作成に必要な情報が不足しています。');
        return;
      }
      const createData: SystemPromptGroupCreate = {
        name: data.name,
        description: data.description,
        category: data.category,
        coordinator_prompt_id: data.coordinator_prompt_id,
        planner_prompt_id: data.planner_prompt_id,
        supervisor_prompt_id: data.supervisor_prompt_id,
        agent_prompt_id: data.agent_prompt_id,
        summary_prompt_id: data.summary_prompt_id,
        is_active: data.is_active,
      };
      await createGroup(createData);
      setIsCreateDialogOpen(false);
      mutateGroups(); // グループ一覧を再取得
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setOperationError(errorMessage || 'プロンプトグループの作成に失敗しました');
    }
  };

  const handleUpdateGroup = async (groupId: number, groupData: SystemPromptGroupUpdate) => {
    try {
      setOperationError(null);
      setOperationLoading(groupId);
      await updateGroup(groupId, groupData);
      setEditingGroup(null);
      mutateGroups(); // グループ一覧を再取得
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setOperationError(errorMessage || 'プロンプトグループの更新に失敗しました');
    } finally {
      setOperationLoading(null);
    }
  };

  const handleDeleteGroup = async (groupId: number) => {
    try {
      setOperationError(null);
      setOperationLoading(groupId);
      await deleteGroup(groupId);
      mutateGroups(); // グループ一覧を再取得
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setOperationError(errorMessage || 'プロンプトグループの削除に失敗しました');
    } finally {
      setOperationLoading(null);
    }
  };

  const handleValidateGroup = async (groupId: number) => {
    try {
      setOperationError(null);
      const result = await validateGroup(groupId);
      setValidationResults(prev => ({
        ...prev,
        [groupId]: result.is_valid
      }));
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setOperationError(errorMessage || 'プロンプトグループの検証に失敗しました');
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p className="text-sm text-muted-foreground">プロンプトグループを読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold">プロンプトグループ管理</h2>
          <p className="text-sm text-muted-foreground">
            DeepResearch/DeepRAG用の5つのエージェントプロンプトをグループとして管理します
          </p>
        </div>
        
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              新しいグループを作成
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>新しいプロンプトグループを作成</DialogTitle>
              <DialogDescription>
                DeepResearch/DeepRAGで使用する5つのエージェント用プロンプトをグループとして設定します
              </DialogDescription>
            </DialogHeader>
            <SystemPromptGroupForm
              onSubmit={handleCreateGroup}
              onCancel={() => setIsCreateDialogOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* カテゴリフィルター */}
      <div className="flex gap-2">
        <Button
          variant={selectedCategory === 'all' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setSelectedCategory('all')}
        >
          すべて
        </Button>
        <Button
          variant={selectedCategory === 'deepresearch' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setSelectedCategory('deepresearch')}
        >
          DeepResearch
        </Button>
        <Button
          variant={selectedCategory === 'deeprag' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setSelectedCategory('deeprag')}
        >
          DeepRAG
        </Button>
      </div>

      {/* エラー表示 */}
      {(error || operationError) && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>エラー</AlertTitle>
          <AlertDescription>
            {error?.message || operationError}
          </AlertDescription>
        </Alert>
      )}

      {/* プロンプトグループ一覧 */}
      {groups.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <Settings className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">プロンプトグループがありません</h3>
            <p className="text-sm text-muted-foreground mb-4">
              最初のプロンプトグループを作成しましょう
            </p>
            <Button onClick={() => setIsCreateDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              新しいグループを作成
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <Card key={group.id} className={`relative ${!group.is_active ? 'opacity-60 bg-muted/20 border-dashed' : ''}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{group.name}</CardTitle>
                    <CardDescription className="text-sm">
                      {group.description}
                    </CardDescription>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant={group.category === 'deepresearch' ? 'default' : 'secondary'}>
                      {group.category === 'deepresearch' ? 'DeepResearch' : 'DeepRAG'}
                    </Badge>
                    {!group.is_active && (
                      <Badge variant="outline" className="text-xs border-orange-500 text-orange-500">
                        <EyeOff className="h-3 w-3 mr-1" />
                        非アクティブ
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              
              <CardContent className="space-y-4">
                {/* プロンプト設定状況 */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-1">
                    {group.coordinator_prompt_id ? (
                      <CheckCircle className="h-3 w-3 text-green-500" />
                    ) : (
                      <XCircle className="h-3 w-3 text-muted-foreground" />
                    )}
                    <span className="text-muted-foreground">Coordinator</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {group.planner_prompt_id ? (
                      <CheckCircle className="h-3 w-3 text-green-500" />
                    ) : (
                      <XCircle className="h-3 w-3 text-muted-foreground" />
                    )}
                    <span className="text-muted-foreground">Planner</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {group.supervisor_prompt_id ? (
                      <CheckCircle className="h-3 w-3 text-green-500" />
                    ) : (
                      <XCircle className="h-3 w-3 text-muted-foreground" />
                    )}
                    <span className="text-muted-foreground">Supervisor</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {group.agent_prompt_id ? (
                      <CheckCircle className="h-3 w-3 text-green-500" />
                    ) : (
                      <XCircle className="h-3 w-3 text-muted-foreground" />
                    )}
                    <span className="text-muted-foreground">Agent</span>
                  </div>
                  <div className="flex items-center gap-1 col-span-2">
                    {group.summary_prompt_id ? (
                      <CheckCircle className="h-3 w-3 text-green-500" />
                    ) : (
                      <XCircle className="h-3 w-3 text-muted-foreground" />
                    )}
                    <span className="text-muted-foreground">Summary</span>
                  </div>
                </div>

                {/* 検証状況 */}
                {validationResults[group.id] !== undefined && (
                  <div className="flex items-center gap-2 text-xs">
                    {validationResults[group.id] ? (
                      <>
                        <CheckCircle className="h-3 w-3 text-green-500" />
                        <span className="text-green-600">検証済み</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="h-3 w-3 text-red-500" />
                        <span className="text-red-600">検証エラー</span>
                      </>
                    )}
                  </div>
                )}

                {/* アクションボタン */}
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleValidateGroup(group.id)}
                    disabled={operationLoading === group.id}
                    className="flex-grow sm:flex-grow-0"
                  >
                    <Settings className="h-3 w-3 mr-1" />
                    検証
                  </Button>
                  
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingGroup(group)}
                        disabled={operationLoading === group.id}
                        className="flex-grow sm:flex-grow-0"
                      >
                        <Edit className="h-3 w-3 mr-1" />
                        編集
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>プロンプトグループを編集</DialogTitle>
                        <DialogDescription>
                          {group.name} の設定を変更します
                        </DialogDescription>
                      </DialogHeader>
                      {editingGroup && editingGroup.id === group.id && (
                        <SystemPromptGroupForm
                          initialData={editingGroup}
                          onSubmit={(data) => handleUpdateGroup(group.id, data)}
                          onCancel={() => setEditingGroup(null)}
                          isEdit
                        />
                      )}
                    </DialogContent>
                  </Dialog>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={operationLoading === group.id}
                        className="flex-grow sm:flex-grow-0"
                      >
                        {operationLoading === group.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3 mr-1" />
                        )}
                        削除
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>プロンプトグループを削除しますか？</AlertDialogTitle>
                        <AlertDialogDescription>
                          「{group.name}」を削除します。この操作は元に戻せません。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>キャンセル</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDeleteGroup(group.id)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          削除
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}