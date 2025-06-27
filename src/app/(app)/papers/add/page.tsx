"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea"; 
import { Checkbox } from "@/components/ui/checkbox"; 
import { Progress } from "@/components/ui/progress"; 
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"; 
import ModelSettings, { ModelSetting } from "@/components/ModelSettings";
import { getSession, useSession, signIn } from "next-auth/react";
import { ArrowLeft, ListChecks, UploadCloud, Rocket, Loader2, AlertTriangle, Square, Zap, Clock } from "lucide-react"; 
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAvailablePrompts } from "@/hooks/useAvailablePrompts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { backgroundProcessor, type PaperProcessingConfig, type PaperProcessingTask } from "@/lib/background-processor";
import { createApiHeaders } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

// 並列処理設定UIの表示制御フラグ（後から復活可能）
const ENABLE_PARALLEL_PROCESSING_SETTING = false;

// バックグラウンド処理設定UIの表示制御フラグ（後から復活可能）
const ENABLE_BACKGROUND_PROCESSING_SETTING = false;

// useAvailablePromptsから型をインポート
interface AvailablePrompt {
  id: number | null;
  name: string;
  description: string;
  type: 'default' | 'custom';
  prompt_type: string;
  is_custom: boolean;
  created_at?: string;
  updated_at?: string;
}



interface PromptSelection {
    type: "default" | "custom";
    system_prompt_id?: number;
}

// 埋め込みターゲットの型を変更
type EmbeddingTargetSelection = {
    type: "default";
} | {
    type: "custom";
    system_prompt_id: number;
} | {
    type: "none";  // 埋め込みベクトルを作成しない
};

// 共通の埋め込みベクトル設定コンポーネント
const EmbeddingSettings = ({ 
  // createEmbeddings: _createEmbeddings,  // 未使用
  // setCreateEmbeddings: _setCreateEmbeddings,  // 未使用
  promptMode, 
  setPromptMode, 
  selectedPrompts, 
  setSelectedPrompts, 
  embeddingTarget, 
  setEmbeddingTarget, 
  availablePrompts, 
  isPromptsLoading, 
  disabled,
  useParallelProcessing,
  setUseParallelProcessing 
}: {
  createEmbeddings: boolean;
  setCreateEmbeddings: (value: boolean) => void;
  promptMode: "default" | "prompt_selection";
  setPromptMode: (value: "default" | "prompt_selection") => void;
  selectedPrompts: PromptSelection[];
  setSelectedPrompts: React.Dispatch<React.SetStateAction<PromptSelection[]>>;
  embeddingTarget: EmbeddingTargetSelection | null;
  setEmbeddingTarget: (value: EmbeddingTargetSelection | null) => void;
  availablePrompts: AvailablePrompt[];
  isPromptsLoading: boolean;
  disabled: boolean;
  useParallelProcessing: boolean;
  setUseParallelProcessing: (value: boolean) => void;
}) => {
  // selectedPromptsが変更されたときに、embeddingTargetを調整
  useEffect(() => {
    if (selectedPrompts.length === 0) {
      // プロンプトが選択されていない場合は「作成しない」
      setEmbeddingTarget({ type: 'none' });
    } else if (selectedPrompts.length === 1) {
      // 1つだけ選択されている場合は自動的にそれに設定
      const prompt = selectedPrompts[0];
      if (prompt.type === 'default') {
        setEmbeddingTarget({ type: 'default' });
      } else if (prompt.system_prompt_id !== undefined && prompt.system_prompt_id !== null) {
        setEmbeddingTarget({ type: 'custom', system_prompt_id: prompt.system_prompt_id });
      }
    } else {
      // 2つ以上選択されている場合、デフォルトプロンプトがあるかチェック
      const hasDefaultPrompt = selectedPrompts.some(p => p.type === 'default');
      if (hasDefaultPrompt) {
        // デフォルトプロンプトがある場合はそれを優先
        setEmbeddingTarget({ type: 'default' });
      } else {
        // デフォルトプロンプトがない場合は最初の選択肢に設定
        const firstPrompt = selectedPrompts[0];
        if (firstPrompt.system_prompt_id !== undefined && firstPrompt.system_prompt_id !== null) {
          setEmbeddingTarget({ type: 'custom', system_prompt_id: firstPrompt.system_prompt_id });
        }
      }
    }
  }, [selectedPrompts, setEmbeddingTarget]);

  return (
    <div className="space-y-4 p-4 border border-border rounded-lg bg-muted/20">
      {/* プロンプトモード選択 - 常時表示 */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">プロンプト選択</Label>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant={promptMode === "default" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setPromptMode("default");
              setSelectedPrompts([{ type: 'default' }]); // デフォルトモード時はデフォルトプロンプトを設定
            }}
            disabled={disabled}
            className="text-xs"
          >
            デフォルト
          </Button>
          <Button
            variant={promptMode === "prompt_selection" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setPromptMode("prompt_selection");
              setSelectedPrompts([{ type: 'default' }]); // デフォルトプロンプトを初期選択状態にする
            }}
            disabled={disabled}
            className="text-xs"
          >
            プロンプト選択
          </Button>
        </div>
      </div>

      {/* プロンプト選択詳細設定 - プロンプト選択モード時のみ編集可能 */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">選択されているプロンプト</Label>
        {promptMode === "default" ? (
          <div className="text-sm text-muted-foreground p-2 bg-muted/10 rounded border">
            ✓ デフォルトプロンプト（自動選択）
          </div>
        ) : isPromptsLoading ? (
          <div className="text-sm text-muted-foreground">プロンプト一覧を読み込み中...</div>
        ) : !availablePrompts || availablePrompts.length === 0 ? (
          <div className="text-sm text-muted-foreground">利用可能なプロンプトがありません。</div>
        ) : (
          <div className="space-y-2 max-h-32 overflow-y-auto border border-border rounded p-2">
            {availablePrompts.map((prompt) => (
              <div key={prompt.id || 'default'} className="flex items-center space-x-2">
                <Checkbox
                  id={`prompt-${prompt.id || 'default'}`}
                  checked={selectedPrompts.some(p => 
                    prompt.type === 'default' 
                      ? p.type === 'default' 
                      : p.type === 'custom' && p.system_prompt_id === prompt.id
                  )}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      if (prompt.type === 'default') {
                        setSelectedPrompts(prev => {
                          // デフォルトが既に存在しない場合のみ追加
                          if (!prev.some(p => p.type === 'default')) {
                            return [...prev, { type: 'default' }];
                          }
                          return prev;
                        });
                      } else if (prompt.id !== null && prompt.id !== undefined) {
                        setSelectedPrompts(prev => {
                          // 同じカスタムプロンプトが既に存在しない場合のみ追加
                          if (!prev.some(p => p.type === 'custom' && p.system_prompt_id === prompt.id)) {
                            return [...prev, { type: 'custom', system_prompt_id: prompt.id as number }];
                          }
                          return prev;
                        });
                      }
                    } else {
                      // 最後の1つのプロンプトの場合は削除を防ぐ
                      setSelectedPrompts(prev => {
                        const filteredPrompts = prev.filter(p => 
                          prompt.type === 'default' 
                            ? p.type !== 'default' 
                            : !(p.type === 'custom' && p.system_prompt_id === prompt.id)
                        );
                        // 削除後に空になる場合は削除しない
                        return filteredPrompts.length > 0 ? filteredPrompts : prev;
                      });
                    }
                  }}
                  disabled={disabled || (
                    selectedPrompts.length === 1 && 
                    selectedPrompts.some(p => 
                      prompt.type === 'default' 
                        ? p.type === 'default' 
                        : p.type === 'custom' && p.system_prompt_id === prompt.id
                    )
                  )}
                />
                <Label htmlFor={`prompt-${prompt.id || 'default'}`} className="text-sm cursor-pointer flex-1">
                  {prompt.name}
                  {prompt.type === 'custom' && <span className="text-blue-600 ml-1">[Custom]</span>}
                </Label>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 作成対象選択 - 常時表示 */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">作成対象</Label>
        <Select 
          value={embeddingTarget ? JSON.stringify(embeddingTarget) : ""} 
          onValueChange={(value: string) => {
            if (value) {
              const target = JSON.parse(value) as EmbeddingTargetSelection;
              setEmbeddingTarget(target);
            }
          }} 
          disabled={disabled}
        >
          <SelectTrigger className="w-full">
            <SelectValue>
              {embeddingTarget ? (() => {
                if (embeddingTarget.type === 'none') {
                  return '埋め込みベクトルを作成しない';
                }
                const prompt = availablePrompts.find(p => 
                  embeddingTarget.type === 'default' 
                    ? p.type === 'default'
                    : embeddingTarget.type === 'custom' && p.id === embeddingTarget.system_prompt_id
                );
                return prompt ? prompt.name : '選択してください';
              })() : '選択してください'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {/* 埋め込みベクトルを作成しないオプション */}
            <SelectItem value={JSON.stringify({ type: 'none' })}>
              埋め込みベクトルを作成しない
            </SelectItem>
            
            {/* 選択されたプロンプトのオプション */}
            {selectedPrompts.map((selectedPrompt, index) => {
              const prompt = availablePrompts.find(p => 
                selectedPrompt.type === 'default' 
                  ? p.type === 'default'
                  : p.type === 'custom' && p.id === selectedPrompt.system_prompt_id
              );
              if (!prompt) return null;
              
              const value = selectedPrompt.type === 'default' 
                ? JSON.stringify({ type: 'default' })
                : JSON.stringify({ type: 'custom', system_prompt_id: selectedPrompt.system_prompt_id });
              
              return (
                <SelectItem key={index} value={value}>
                  {prompt.name}
                  {prompt.type === 'custom' && <span className="text-blue-600 ml-1">[Custom]</span>}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* 並列処理設定 - フラグによる表示制御 */}
      {ENABLE_PARALLEL_PROCESSING_SETTING && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">処理方式</Label>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="useParallelProcessing"
              checked={useParallelProcessing}
              onCheckedChange={(checked) => setUseParallelProcessing(Boolean(checked))}
              disabled={disabled}
            />
            <Label htmlFor="useParallelProcessing" className="text-sm cursor-pointer">
              並列処理を使用（複数プロンプト選択時のみ有効）
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            {useParallelProcessing 
              ? "複数プロンプト選択時に並列で要約を生成します（高速）" 
              : "従来の逐次処理を使用します（安定性重視）"
            }
          </p>
        </div>
      )}
    </div>
  );
};

function AddPaperPageContent() {
  const searchParams = useSearchParams();
  const initialArxivUrl = searchParams.get("arxiv_url");

  const [urls, setUrls] = useState(initialArxivUrl || "");
  const [saving, setSaving] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [isStopping, setIsStopping] = useState(false);
  const [processType, setProcessType] = useState<"arxiv" | "huggingface" | null>(null);
  const router = useRouter();

  const [modelConfig, setModelConfig] = useState<ModelSetting | null>(null);
  const [useHfDate, setUseHfDate] = useState(false);
  const [hfDate, setHfDate] = useState("");

  const { status: authStatus } = useSession();
  const [isRedirecting, setIsRedirecting] = useState(false);
  
  // 利用可能なプロンプト一覧を取得
  const { prompts: availablePrompts, isLoading: isPromptsLoading } = useAvailablePrompts();
  
  // 新しい論文追加設定
  const [promptMode, setPromptMode] = useState<"default" | "prompt_selection">("default");
  const [selectedPrompts, setSelectedPrompts] = useState<PromptSelection[]>([{ type: 'default' }]);
  const [createEmbeddings, setCreateEmbeddings] = useState(true);
  const [embeddingTarget, setEmbeddingTarget] = useState<EmbeddingTargetSelection | null>({ type: 'default' });
  
  // 並列処理設定（フラグがfalseの場合は強制的にON、trueの場合はユーザー選択可能）
  const [useParallelProcessing, setUseParallelProcessing] = useState(true);
  
  // createEmbeddingsをembeddingTargetから計算
  const shouldCreateEmbeddings = embeddingTarget?.type !== 'none';

  // selectedPromptsは常に1つ以上の要素を持つことを保証

  // 重複実行防止用のRef
  const isSubmittingHuggingFaceRef = useRef(false);

  // 統合確認ダイアログ用の状態（重複+ベクトル未存在）
  const [showConfirmationDialog, setShowConfirmationDialog] = useState(false);
  const [existingVectorUrls, setExistingVectorUrls] = useState<string[]>([]);
  const [existingSummaryInfo, setExistingSummaryInfo] = useState<Array<{
    url: string;
    prompt_name: string;
    prompt_type: "default" | "custom";
    system_prompt_id?: number;
  }>>([]);
  const [missingVectorUrls, setMissingVectorUrls] = useState<string[]>([]);
  const [missingVectorInfo, setMissingVectorInfo] = useState<{total: number; missing: number}>({total: 0, missing: 0});
  const [pendingProcessType, setPendingProcessType] = useState<"arxiv" | "huggingface" | null>(null);
  const [pendingUrls, setPendingUrls] = useState<string[]>([]);

  // 停止フラグをuseRefで管理（レンダリングをトリガーしない）
  const shouldStopRef = useRef(false);

  // Background processor states
  const [useBackgroundProcessing, setUseBackgroundProcessing] = useState(true);
  const [currentTask, setCurrentTask] = useState<PaperProcessingTask | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [isServiceWorkerSupported, setIsServiceWorkerSupported] = useState(false);
  const [isBpmInitialized, setIsBpmInitialized] = useState(false); // ★ 初期化完了状態を追加
  
  // ★★★ Service Worker復旧機能用の状態 ★★★
  const [isRecovering, setIsRecovering] = useState(false);
  const [lastRecoveryAttempt, setLastRecoveryAttempt] = useState<Date | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  
  // ★★★ 既存タスクチェック用の状態 ★★★
  const [isCheckingExistingTasks, setIsCheckingExistingTasks] = useState(false);
  const [hasCheckedExistingTasks, setHasCheckedExistingTasks] = useState(false);

  useEffect(() => {
    if (authStatus === "loading" || isRedirecting) {
      return;
    }
    if (authStatus === "unauthenticated") {
      setIsRedirecting(true);
      signIn(undefined, { callbackUrl: "/papers/add" });
    }
  }, [authStatus, router, isRedirecting]);

  // Initialize service worker
  useEffect(() => {
    const initializeBackgroundProcessor = async () => {
      console.log('[UI] Starting background processor initialization...');
      
      try {
        // まずサポート状況を確認
        const isSupported = backgroundProcessor.isServiceWorkerSupported();
        setIsServiceWorkerSupported(isSupported);
        
        if (!isSupported) {
          console.log('[UI] Service Worker not supported, skipping initialization.');
          setIsBpmInitialized(true); // サポートされていなくても初期化完了とする
          return;
        }

        console.log('[UI] Waiting for background processor initialization...');
        
        // 初期化にタイムアウトを設定（20秒）
        const initializationPromise = backgroundProcessor.waitForInitialization();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Initialization timeout')), 20000)
        );
        
        await Promise.race([initializationPromise, timeoutPromise]);
        console.log('[UI] Background processor initialization complete.');
        
      } catch (error) {
        console.error('[UI] Failed to initialize background processor:', error);
        // エラーでもUI操作を可能にするため初期化完了とする
      } finally {
        // どんな状況でも必ず初期化完了をマークする
        console.log('[UI] Setting initialization as completed');
        setIsBpmInitialized(true);
      }
    };

    initializeBackgroundProcessor();
  }, []); // 依存配列は空
  
  // ★★★ 既存タスクのチェックを別のuseEffectで実行 ★★★
  useEffect(() => {
    const checkExistingTasks = async () => {
      if (!useBackgroundProcessing || isCheckingExistingTasks || hasCheckedExistingTasks) {
        return;
      }
      
      setIsCheckingExistingTasks(true);
      console.log('[UI] Starting existing tasks check...');
      
      try {
        // Service Worker初期化完了を待たずに、リトライ付きでタスクチェック
        let retryCount = 0;
        const maxRetries = 3;
        let existingTask = null;
        
        while (retryCount < maxRetries && !existingTask) {
          try {
            console.log(`[UI] Checking for existing tasks (attempt ${retryCount + 1}/${maxRetries})...`);
            existingTask = await backgroundProcessor.getCurrentTask();
            
            if (!existingTask) {
              // getCurrentTaskがnullの場合、getAllTasksも試す
              const allTasks = await backgroundProcessor.getAllTasks();
              const activeTasks = allTasks.filter(task => 
                task && task.status && (task.status === 'pending' || task.status === 'processing')
              );
              if (activeTasks.length > 0) {
                existingTask = activeTasks[0];
              }
            }
            
            if (existingTask) break;
            
          } catch (error) {
            console.warn(`[UI] Attempt ${retryCount + 1} failed:`, error);
          }
          
          retryCount++;
          if (retryCount < maxRetries && !existingTask) {
            // 1秒待機してからリトライ
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        
        if (existingTask && (existingTask.status === 'pending' || existingTask.status === 'processing')) {
          console.log('[UI] Found existing active task:', existingTask);
          setCurrentTask(existingTask);
          setTaskId(existingTask.id);
          setSaving(true);
          setProcessType(existingTask.type);
          setTotalCount(existingTask.progress.total);
          setCurrentIndex(existingTask.progress.current);
          
          // ★★★ より安全な処理再開（エラーを無視） ★★★
          console.log('[UI] Attempting to resume existing task processing...');
          try {
            // resumeTaskProcessing がない場合の代替手段
            if (typeof backgroundProcessor.resumeTaskProcessing === 'function') {
              await backgroundProcessor.resumeTaskProcessing(existingTask.id);
              console.log('[UI] Task processing resumed successfully');
            } else {
              console.log('[UI] resumeTaskProcessing method not available, skipping resume');
            }
          } catch (resumeError) {
            console.warn('[UI] Failed to resume task processing, but continuing:', resumeError);
            // 再開に失敗してもUI表示は継続
          }
        } else {
          console.log('[UI] No existing active tasks found');
        }
        
      } catch (error) {
        console.error('[UI] Error checking for existing tasks:', error);
        // タスクチェックに失敗してもUI表示は継続
      } finally {
        setIsCheckingExistingTasks(false);
        setHasCheckedExistingTasks(true);
      }
    };
    
    // Service Workerサポート状況に関わらず、タスクチェックを実行
    checkExistingTasks();
  }, [useBackgroundProcessing, isCheckingExistingTasks, hasCheckedExistingTasks])

  // Listen for task progress updates
  useEffect(() => {
    if (!isServiceWorkerSupported || !useBackgroundProcessing) return;

    const unsubscribe = backgroundProcessor.onProgress((task: PaperProcessingTask) => {
      console.log('Task progress update:', task);
      
      // ★★★ 復旧関連のメッセージ処理 ★★★
      if (task.error) {
        if (task.error.includes('復旧を試行中')) {
          setIsRecovering(true);
          setLastRecoveryAttempt(new Date());
          setRecoveryError(null);
          console.log('[UI] Recovery attempt detected:', task.error);
        } else if (task.error.includes('復旧に失敗')) {
          setIsRecovering(false);
          setRecoveryError(task.error);
          console.log('[UI] Recovery failure detected:', task.error);
        }
      } else {
        // 正常な進捗更新の場合は復旧状態をリセット
        if (isRecovering) {
          setIsRecovering(false);
          setRecoveryError(null);
          console.log('[UI] Normal progress detected, recovery state reset');
        }
      }
      
      if (task.id === taskId || !taskId) {
        setCurrentTask(task);
        if (!taskId) setTaskId(task.id);
        
        // Update UI states
        setTotalCount(task.progress.total);
        setCurrentIndex(task.progress.current);
        setProcessType(task.type);
        
        if (task.status === 'processing' || task.status === 'pending') {
          setSaving(true);
        } else if (task.status === 'completed' || task.status === 'cancelled' || task.status === 'failed') {
          setSaving(false);
          setTaskId(null);
          setCurrentTask(null);
          
          // Reset recovery states on task completion
          setIsRecovering(false);
          setRecoveryError(null);
          setLastRecoveryAttempt(null);
          
          // Show completion notification
          if (task.status === 'completed') {
            const successCount = task.progress.completed.length;
            const failCount = task.progress.failed.length;
            
            // ★★★ 緊急修正: 完了通知の詳細デバッグ ★★★
            console.log(`[onProgress] 🎉 Task completion detected:`, {
              taskId: task.id,
              status: task.status,
              totalProgress: task.progress.total,
              currentProgress: task.progress.current,
              successCount,
              failCount,
              completedItems: task.progress.completed,
              failedItems: task.progress.failed,
              timestamp: new Date().toISOString()
            });
            
            // ★ 早期完了判定の防止: 実際に処理が行われたかを確認
            if (task.progress.total === 0 || (successCount === 0 && failCount === 0 && task.progress.current === 0)) {
              console.error(`[onProgress] 🚨 SUSPICIOUS COMPLETION: Task marked complete but no work was done!`, {
                total: task.progress.total,
                current: task.progress.current,
                successCount,
                failCount
              });
              // 疑わしい完了の場合は通知を表示せず、エラーログを出力
              alert(`⚠️ 処理が正常に完了していない可能性があります。\n\nデバッグ情報:\n- 総タスク数: ${task.progress.total}\n- 現在の進捗: ${task.progress.current}\n- 成功件数: ${successCount}\n- 失敗件数: ${failCount}\n\nブラウザのコンソールログを確認してください。`);
              return;
            }
            
            alert(`バックグラウンド処理完了: 成功 ${successCount} 件, 失敗 ${failCount} 件`);
            
            if (successCount > 0) {
              router.push("/papers");
              router.refresh();
            }
          } else if (task.status === 'failed') {
            // 復旧エラーでない場合のみアラート表示
            if (!task.error?.includes('復旧に失敗')) {
              console.log(`[onProgress] ❌ Task failure detected:`, {
                taskId: task.id,
                error: task.error,
                timestamp: new Date().toISOString()
              });
              alert(`バックグラウンド処理でエラーが発生しました: ${task.error}`);
            }
          }
          
          // Reset processing state
          resetProcessingState();
        }
      }
    });

    return unsubscribe;
  }, [isServiceWorkerSupported, useBackgroundProcessing, taskId, router, isRecovering]);


  const configOverrides: Record<string, string | number | boolean> = {};
  if (modelConfig) {
    configOverrides.llm_name = modelConfig.provider;
    configOverrides.llm_model_name = modelConfig.model;
    configOverrides.rag_llm_temperature = modelConfig.temperature;
    configOverrides.rag_llm_top_p = modelConfig.top_p;
  }
  configOverrides.huggingface_use_config_date = useHfDate;
  if (useHfDate && hfDate) {
    configOverrides.huggingface_custom_date = hfDate;
  }

  // 統一された停止ボタンの処理
  const handleStop = async () => {
    if (!saving || isStopping) return;
    
    // Service Worker バックグラウンド処理の場合
    if (useBackgroundProcessing && isServiceWorkerSupported && taskId) {
      if (confirm("バックグラウンド処理を停止しますか？")) {
        try {
          await backgroundProcessor.cancelTask(taskId);
          setTaskId(null);
          setCurrentTask(null);
          resetProcessingState();
        } catch (error: unknown) {
          console.error('Failed to cancel background task:', error);
          alert(`処理の停止に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } 
    // 従来の処理の場合
    else if (confirm("処理を停止しますか？\n現在処理中の論文が完了後、以降の処理が停止されます。")) {
      shouldStopRef.current = true;
      setIsStopping(true);
    }
  };

  // 処理の完全停止とリセット
  const resetProcessingState = () => {
    setSaving(false);
    setIsStopping(false);
    setProcessType(null);
    setCurrentIndex(0);
    setTotalCount(0);
    shouldStopRef.current = false;
    
    // ★★★ 復旧状態もリセット ★★★
    setIsRecovering(false);
    setRecoveryError(null);
    setLastRecoveryAttempt(null);
  };

  // 統合重複チェック機能（ベクトル+要約）
  const checkDuplications = useCallback(async (urls: string[]): Promise<{
    existingVectorUrls: string[]; 
    existingSummaryInfo: Array<{
      url: string;
      prompt_name: string;
      prompt_type: "default" | "custom";
      system_prompt_id?: number;
    }>;
  }> => {
    try {
      const headers = await createApiHeaders();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/papers/check_duplications`,
        {
          method: "POST",
          headers: headers,
          body: JSON.stringify({ 
            urls,
            prompt_mode: promptMode,
            selected_prompts: selectedPrompts
          }),
        }
      );

      if (!response.ok) {
        console.error("Duplication check failed:", response.statusText);
        return { existingVectorUrls: [], existingSummaryInfo: [] };
      }

      const data = await response.json();
      return {
        existingVectorUrls: data.existing_vector_urls || [],
        existingSummaryInfo: data.existing_summary_info || []
      };
    } catch (error) {
      console.error("Error checking duplications:", error);
      return { existingVectorUrls: [], existingSummaryInfo: [] };
    }
  }, [promptMode, selectedPrompts]);

  // ベクトル未存在チェック機能
  const checkMissingVectors = async (urls: string[]): Promise<{
    missingVectorUrls: string[];
    totalUrls: number;
    missingCount: number;
  }> => {
    try {
      const headers = await createApiHeaders();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/papers/check_missing_vectors`,
        {
          method: "POST",
          headers: headers,
          body: JSON.stringify({ urls }),
        }
      );

      if (!response.ok) {
        console.error("Missing vector check failed:", response.statusText);
        return { missingVectorUrls: [], totalUrls: urls.length, missingCount: 0 };
      }

      const data = await response.json();
      return {
        missingVectorUrls: data.missing_vector_urls || [],
        totalUrls: data.total_urls || urls.length,
        missingCount: data.missing_count || 0
      };
    } catch (error) {
      console.error("Error checking missing vectors:", error);
      return { missingVectorUrls: [], totalUrls: urls.length, missingCount: 0 };
    }
  };

  // 統合確認ダイアログでユーザーが続行を選択した場合の処理
  const handleConfirmationConfirm = () => {
    console.log('[DEBUG_LOG] ================================');
    console.log('[DEBUG_LOG] handleConfirmationConfirm START');
    console.log('[DEBUG_LOG] pendingProcessType:', pendingProcessType);
    console.log('[DEBUG_LOG] pendingUrls:', pendingUrls);
    console.log('[DEBUG_LOG] ================================');
    
    setShowConfirmationDialog(false);
    
    if (pendingProcessType === "arxiv") {
      console.log('[DEBUG_LOG] Proceeding with arXiv processing');
      // arXiv処理を実行
      proceedWithArxivProcessing(pendingUrls);
    } else if (pendingProcessType === "huggingface") {
      console.log('[DEBUG_LOG] Proceeding with HuggingFace processing');
      // HuggingFace処理を実行  
      proceedWithHuggingfaceProcessing();
    }
    
    // 状態をリセット
    resetConfirmationStates();
    console.log('[DEBUG_LOG] handleConfirmationConfirm END');
  };

  // 統合確認ダイアログでユーザーがキャンセルを選択した場合の処理
  const handleConfirmationCancel = () => {
    console.log('[DEBUG_LOG] handleConfirmationCancel called');
    setShowConfirmationDialog(false);
    resetConfirmationStates();
  };

  // 確認ダイアログの状態をリセット
  const resetConfirmationStates = () => {
    setPendingProcessType(null);
    setPendingUrls([]);
    setExistingVectorUrls([]);
    setExistingSummaryInfo([]);
    setMissingVectorUrls([]);
    setMissingVectorInfo({total: 0, missing: 0});
  };

  // 実際のarXiv処理を実行する関数（チェック後）
  const proceedWithArxivProcessing = async (paperUrls: string[]) => {
    console.log('[DEBUG_LOG] ================================');
    console.log('[DEBUG_LOG] proceedWithArxivProcessing START');
    console.log('[DEBUG_LOG] paperUrls received:', paperUrls);
    console.log('[DEBUG_LOG] ================================');
    
    // 元のsubmitArxivBackgroundのロジックをここに移動
    // ★ 安全なプロンプト配列を再度確認
    let safeSelectedPrompts = selectedPrompts;
    if (!selectedPrompts || !Array.isArray(selectedPrompts) || selectedPrompts.length === 0) {
      console.warn('[DEBUG_LOG] selectedPrompts is invalid, forcing default prompt');
      safeSelectedPrompts = [{ type: 'default' }];
    }
    console.log('[DEBUG_LOG] Safe selected prompts:', safeSelectedPrompts);
    
    await executeArxivProcessing(paperUrls, safeSelectedPrompts);
    console.log('[DEBUG_LOG] proceedWithArxivProcessing END');
  };

  // 実際のHuggingFace処理を実行する関数（チェック後）
  const proceedWithHuggingfaceProcessing = async () => {
    // 元のimportFromHuggingfaceBackgroundのロジックをここに移動
    await executeHuggingfaceProcessing();
  };

  // arXiv処理の実行部分
  const executeArxivProcessing = useCallback(async (paperUrls: string[], safeSelectedPrompts: PromptSelection[]) => {
    console.log('[DEBUG_LOG] ================================');
    console.log('[DEBUG_LOG] executeArxivProcessing START');
    console.log('[DEBUG_LOG] ================================');
    
    if (!modelConfig) {
      console.log('[DEBUG_LOG] ERROR: modelConfig not available');
      alert("モデル設定がまだ読み込まれていません。ページを再読み込みするか、設定が完了するまでお待ちください。");
      return;
    }

    // ★★★ 緊急修正: 処理実行時のデバッグ情報 ★★★
    console.log('[DEBUG_LOG] executeArxivProcessing debug info:', {
      paperUrls,
      paperCount: paperUrls.length,
      safeSelectedPrompts,
      safeSelectedPromptsLength: safeSelectedPrompts.length,
      originalSelectedPrompts: selectedPrompts,
      shouldCreateEmbeddings,
      embeddingTarget
    });

    // embeddingTargetをバックエンドの期待する形式に変換
    let embeddingTargetString = "default_only";
    let embeddingTargetSystemPromptId: number | null = null;
    
    if (embeddingTarget) {
      if (embeddingTarget.type === "default") {
        embeddingTargetString = "default_only";
      } else if (embeddingTarget.type === "custom") {
        embeddingTargetString = "custom_only";
        embeddingTargetSystemPromptId = embeddingTarget.system_prompt_id;
      } else if (embeddingTarget.type === "none") {
        // "none"の場合はcreate_embeddingsがfalseになっているので、この値は使用されない
        embeddingTargetString = "default_only";
      }
    }

    try {
      // Create configuration for background processing
      const config: Omit<PaperProcessingConfig, 'backendUrl'> = { // 型を明示的に指定
        provider: modelConfig?.provider,
        model: modelConfig?.model,
        temperature: modelConfig?.temperature,
        top_p: modelConfig?.top_p,
        prompt_mode: promptMode,
        selected_prompts: safeSelectedPrompts, // ★ 安全なプロンプト配列を使用
        create_embeddings: shouldCreateEmbeddings,
        embedding_target: embeddingTargetString as 'default_only' | 'custom_only' | 'both',
        embedding_target_system_prompt_id: embeddingTargetSystemPromptId,
        // ★ 新しい1要約1APIの使用フラグを追加
        useNewApi: true,  // 新しいAPIを使用するかどうか（将来的に設定で切り替え可能にする）
        // ★ 並列処理フラグを追加
        useParallelProcessing: useParallelProcessing
      };

      console.log('[DEBUG_LOG] Final config for background processing:', config);

      console.log('[DEBUG_LOG] About to call backgroundProcessor.startPaperProcessing');
      
      // Start background processing
      const newTaskId = await backgroundProcessor.startPaperProcessing('arxiv', paperUrls, config);
      
      console.log('[DEBUG_LOG] backgroundProcessor.startPaperProcessing returned taskId:', newTaskId);
      
      setTaskId(newTaskId);
      setSaving(true);
      setProcessType("arxiv");
      setTotalCount(paperUrls.length);
      setCurrentIndex(0);
      
      console.log('[DEBUG_LOG] Background processing started with task ID:', newTaskId);
      console.log('[DEBUG_LOG] executeArxivProcessing completed successfully');
      
    } catch (error: unknown) {
      console.error('[DEBUG_LOG] Failed to start background processing:', error);
      alert(`バックグラウンド処理の開始に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log('[DEBUG_LOG] executeArxivProcessing END');
  }, [modelConfig, shouldCreateEmbeddings, embeddingTarget, promptMode, useParallelProcessing, selectedPrompts]);

  // ボタンクリック時のハンドラー（どちらの関数が呼ばれるかをログ出力）
  const handleArxivSubmitClick = () => {
    console.log('[DEBUG_LOG] !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.log('[DEBUG_LOG] BUTTON CLICKED - ArXiv Submit');
    console.log('[DEBUG_LOG] useBackgroundProcessing:', useBackgroundProcessing);
    console.log('[DEBUG_LOG] isServiceWorkerSupported:', isServiceWorkerSupported);
    
    if (useBackgroundProcessing && isServiceWorkerSupported) {
      console.log('[DEBUG_LOG] Calling submitArxivBackground');
      submitArxivBackground();
    } else {
      console.log('[DEBUG_LOG] Calling submitArxiv');
      submitArxiv();
    }
    console.log('[DEBUG_LOG] !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  };

  // HuggingFace処理の実行部分  
  const executeHuggingfaceProcessing = useCallback(async () => {
    // HuggingFace処理のロジックをここに実装
    // 元のimportFromHuggingfaceBackgroundの内容
    if (!modelConfig) {
      alert("モデル設定がまだ読み込まれていません。ページを再読み込みするか、設定が完了するまでお待ちください。");
      return;
    }


    // embeddingTargetをバックエンドの期待する形式に変換
    let embeddingTargetString = "default_only";
    let embeddingTargetSystemPromptId: number | null = null;
    
    if (embeddingTarget) {
      if (embeddingTarget.type === "default") {
        embeddingTargetString = "default_only";
      } else if (embeddingTarget.type === "custom") {
        embeddingTargetString = "custom_only";
        embeddingTargetSystemPromptId = embeddingTarget.system_prompt_id;
      } else if (embeddingTarget.type === "none") {
        // "none"の場合はcreate_embeddingsがfalseになっているので、この値は使用されない
        embeddingTargetString = "default_only";
      }
    }

    try {
      // First, fetch arXiv IDs from Hugging Face
      const currentAuthSession = await getSession();
      if (!currentAuthSession || !currentAuthSession.accessToken) {
        alert("認証されていません。ログインしてください。");
        signIn(undefined, { callbackUrl: "/papers/add" });
        return;
      }

      setSaving(true);
      setProcessType("huggingface");
      
      const headers = await createApiHeaders();

      const configOverrides: Record<string, string | number | boolean> = {};
      if (modelConfig) {
        configOverrides.llm_name = modelConfig.provider;
        configOverrides.llm_model_name = modelConfig.model;
        configOverrides.rag_llm_temperature = modelConfig.temperature;
        configOverrides.rag_llm_top_p = modelConfig.top_p;
      }
      configOverrides.huggingface_use_config_date = useHfDate;
      if (useHfDate) {
        configOverrides.huggingface_custom_date = hfDate;
      }

      const arxivIdsRes = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000"}/papers/fetch_huggingface_arxiv_ids`,
        {
          method: "POST",
          headers: headers,
          body: JSON.stringify({ config_overrides: configOverrides }),
        }
      );

      if (!arxivIdsRes.ok) {
        const errorData = await arxivIdsRes.json().catch(() => ({detail: "Failed to fetch arXiv IDs from Hugging Face"}));
        throw new Error(errorData.detail || arxivIdsRes.statusText);
      }

      const arxivIds: string[] = await arxivIdsRes.json();

      if (arxivIds.length === 0) {
        alert("Hugging Face から登録対象の arXiv ID が見つかりませんでした。");
        resetProcessingState();
        return;
      }

      // Convert arXiv IDs to URLs
      const paperUrls = arxivIds.map(id => `https://arxiv.org/abs/${id}`);

      // Create configuration for background processing
      const config: Omit<PaperProcessingConfig, 'backendUrl'> = { // 型を明示的に指定
        provider: modelConfig?.provider,
        model: modelConfig?.model,
        temperature: modelConfig?.temperature,
        top_p: modelConfig?.top_p,
        prompt_mode: promptMode,
        selected_prompts: selectedPrompts,
        create_embeddings: shouldCreateEmbeddings,
        embedding_target: embeddingTargetString as 'default_only' | 'custom_only' | 'both',
        embedding_target_system_prompt_id: embeddingTargetSystemPromptId,
        // ★ 新しい1要約1APIの使用フラグを追加
        useNewApi: true,  // 新しいAPIを使用するかどうか（将来的に設定で切り替え可能にする）
        // ★ 並列処理フラグを追加
        useParallelProcessing: useParallelProcessing
      };

      console.log('Starting background Hugging Face processing with config:', config);
      
      // Start background processing
      const newTaskId = await backgroundProcessor.startPaperProcessing('huggingface', paperUrls, config);
      
      setTaskId(newTaskId);
      setSaving(true);
      setProcessType("huggingface");
      setTotalCount(paperUrls.length);
      setCurrentIndex(0);
      
      console.log('Background processing started with task ID:', newTaskId);
      
    } catch (error: unknown) {
      console.error('Failed to start background processing:', error);
      alert(`バックグラウンド処理の開始に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
      resetProcessingState();
    }
  }, [modelConfig, embeddingTarget, useHfDate, hfDate, promptMode, selectedPrompts, shouldCreateEmbeddings, useParallelProcessing]);

  // ★ 二重実行防止のためのRef
  const isSubmittingRef = useRef(false);

  // Background processing with Service Worker
  const submitArxivBackground = useCallback(async () => {
    // ★ 二重実行防止: 既に実行中の場合は早期リターン
    if (isSubmittingRef.current) {
      console.log('[submitArxivBackground] Already processing, skipping duplicate call');
      return;
    }
    
    isSubmittingRef.current = true;
    console.log('[DEBUG_LOG] ================================');
    console.log('[DEBUG_LOG] submitArxivBackground START');
    console.log('[DEBUG_LOG] ================================');
    
    try {
      const paperUrls = urls
        .split('\n')
        .map(url => url.trim())
        .filter(url => url.length > 0);
      
      if (paperUrls.length === 0) {
        alert("少なくとも 1 つ以上の arXiv URL を入力してください");
        return;
      }

      if (!modelConfig) {
        alert("モデル設定がまだ読み込まれていません。ページを再読み込みするか、設定が完了するまでお待ちください。");
        return;
      }

      if (shouldCreateEmbeddings && promptMode === "prompt_selection" && selectedPrompts.length === 0) {
        alert("プロンプト選択モードではプロンプトを選択してください。");
        return;
      }

      // ★★★ 緊急修正: 送信前のデバッグ情報を出力 ★★★
      console.log('[submitArxivBackground] 🔍 Pre-processing debug info:', {
        paperUrls,
        paperCount: paperUrls.length,
        promptMode,
        selectedPrompts,
        selectedPromptsLength: selectedPrompts.length,
        shouldCreateEmbeddings,
        embeddingTarget,
        modelConfig
      });

      // ★★★ 防御的チェック: selectedPromptsの確実な初期化 ★★★
      let safeSelectedPrompts = selectedPrompts;
      if (!selectedPrompts || !Array.isArray(selectedPrompts) || selectedPrompts.length === 0) {
        console.warn('[submitArxivBackground] ⚠️ selectedPrompts is invalid, forcing default prompt');
        safeSelectedPrompts = [{ type: 'default' }];
      }

      console.log('[submitArxivBackground] ✅ Safe selected prompts:', safeSelectedPrompts);

      setIsChecking(true);
    try {
      // 同時に重複チェックとベクトル未存在チェックを実行
      console.log('[DEBUG_LOG] About to execute checkDuplications and checkMissingVectors');
      console.log('[DEBUG_LOG] paperUrls:', paperUrls);
      console.log('[DEBUG_LOG] shouldCreateEmbeddings:', shouldCreateEmbeddings);
      
      const [duplications, missingVectorCheck] = await Promise.all([
        checkDuplications(paperUrls),
        !shouldCreateEmbeddings ? checkMissingVectors(paperUrls) : Promise.resolve({ missingVectorUrls: [], totalUrls: paperUrls.length, missingCount: 0 })
      ]);
      
      console.log('[DEBUG_LOG] checkDuplications result:', duplications);
      console.log('[DEBUG_LOG] missingVectorCheck result:', missingVectorCheck);

      const hasVectorDuplicates = shouldCreateEmbeddings && duplications.existingVectorUrls.length > 0;
      const hasSummaryDuplicates = duplications.existingSummaryInfo.length > 0;
      const hasMissingVectors = !shouldCreateEmbeddings && missingVectorCheck.missingCount > 0;
      
      console.log('[DEBUG_LOG] Condition analysis:');
      console.log('[DEBUG_LOG] hasVectorDuplicates:', hasVectorDuplicates, '(shouldCreateEmbeddings:', shouldCreateEmbeddings, 'existingVectorUrls.length:', duplications.existingVectorUrls.length, ')');
      console.log('[DEBUG_LOG] hasSummaryDuplicates:', hasSummaryDuplicates, '(existingSummaryInfo.length:', duplications.existingSummaryInfo.length, ')');
      console.log('[DEBUG_LOG] hasMissingVectors:', hasMissingVectors, '(!shouldCreateEmbeddings:', !shouldCreateEmbeddings, 'missingCount:', missingVectorCheck.missingCount, ')');

      // いずれかの問題がある場合は確認ダイアログを表示
      if (hasVectorDuplicates || hasSummaryDuplicates || hasMissingVectors) {
        console.log('[DEBUG_LOG] SHOWING CONFIRMATION DIALOG - issues detected');
        setExistingVectorUrls(duplications.existingVectorUrls);
        setExistingSummaryInfo(duplications.existingSummaryInfo);
        setMissingVectorUrls(missingVectorCheck.missingVectorUrls);
        setMissingVectorInfo({
          total: missingVectorCheck.totalUrls,
          missing: missingVectorCheck.missingCount
        });
        setPendingProcessType("arxiv");
        setPendingUrls(paperUrls);
        setShowConfirmationDialog(true);
        setIsChecking(false);
        console.log('[DEBUG_LOG] submitArxivBackground ENDING - showing dialog');
        return;
      }

      console.log('[DEBUG_LOG] No issues detected, proceeding directly to executeArxivProcessing');
      setIsChecking(false);
      // ★ 安全なプロンプト配列を使用して処理実行
      await executeArxivProcessing(paperUrls, safeSelectedPrompts);
      console.log('[DEBUG_LOG] executeArxivProcessing completed');
      } catch (error) {
        console.error('[DEBUG_LOG] Error in submitArxivBackground:', error);
        alert("処理の開始に失敗しました。");
        setIsChecking(false);
      }
    } finally {
      // ★ 処理完了時にRef状態をリセット
      isSubmittingRef.current = false;
      console.log('[DEBUG_LOG] submitArxivBackground FINALLY - Processing completed, flag reset');
      console.log('[DEBUG_LOG] ================================');
    }
  }, [urls, modelConfig, shouldCreateEmbeddings, promptMode, selectedPrompts, embeddingTarget, checkDuplications, executeArxivProcessing]);

  const importFromHuggingfaceBackground = useCallback(async () => {
    // 重複実行防止
    if (isSubmittingHuggingFaceRef.current) {
      console.log('[importFromHuggingfaceBackground] Already processing, ignoring duplicate call');
      return;
    }

    if (!modelConfig) {
      alert("モデル設定がまだ読み込まれていません。ページを再読み込みするか、設定が完了するまでお待ちください。");
      return;
    }

    console.log('[importFromHuggingfaceBackground] Starting HuggingFace processing');
    isSubmittingHuggingFaceRef.current = true;

    if (shouldCreateEmbeddings && promptMode === "prompt_selection" && selectedPrompts.length === 0) {
      alert("プロンプト選択モードではプロンプトを選択してください。");
      isSubmittingHuggingFaceRef.current = false;
      return;
    }

    if (!confirm("Hugging Face ページからarXiv IDを取得し、バックグラウンドで順次登録処理を実行しますか？\n(設定された日付以前の論文が対象となります)")) {
      isSubmittingHuggingFaceRef.current = false;
      return;
    }

    setIsChecking(true);
    try {
      const currentAuthSession = await getSession();
      if (!currentAuthSession || !currentAuthSession.accessToken) {
        alert("認証されていません。ログインしてください。");
        signIn(undefined, { callbackUrl: "/papers/add" });
        setIsChecking(false);
        return;
      }

      const headers = await createApiHeaders();

      const configOverrides: Record<string, string | number | boolean> = {};
      if (modelConfig) {
        configOverrides.llm_name = modelConfig.provider;
        configOverrides.llm_model_name = modelConfig.model;
        configOverrides.rag_llm_temperature = modelConfig.temperature;
        configOverrides.rag_llm_top_p = modelConfig.top_p;
      }
      configOverrides.huggingface_use_config_date = useHfDate;
      if (useHfDate) {
        configOverrides.huggingface_custom_date = hfDate;
      }

      const arxivIdsRes = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000"}/papers/fetch_huggingface_arxiv_ids`,
        {
          method: "POST",
          headers: headers,
          body: JSON.stringify({ config_overrides: configOverrides }),
        }
      );

      if (!arxivIdsRes.ok) {
        const errorData = await arxivIdsRes.json().catch(() => ({detail: "Failed to fetch arXiv IDs from Hugging Face"}));
        throw new Error(errorData.detail || arxivIdsRes.statusText);
      }

      const arxivIds: string[] = await arxivIdsRes.json();

      if (arxivIds.length === 0) {
        alert("Hugging Face から登録対象の arXiv ID が見つかりませんでした。");
        setIsChecking(false);
        isSubmittingHuggingFaceRef.current = false;
        return;
      }

      const paperUrls = arxivIds.map(id => `https://arxiv.org/abs/${id}`);

      // 同時に重複チェックとベクトル未存在チェックを実行
      const [duplications, missingVectorCheck] = await Promise.all([
        checkDuplications(paperUrls),
        !shouldCreateEmbeddings ? checkMissingVectors(paperUrls) : Promise.resolve({ missingVectorUrls: [], totalUrls: paperUrls.length, missingCount: 0 })
      ]);

      const hasVectorDuplicates = shouldCreateEmbeddings && duplications.existingVectorUrls.length > 0;
      const hasSummaryDuplicates = duplications.existingSummaryInfo.length > 0;
      const hasMissingVectors = !shouldCreateEmbeddings && missingVectorCheck.missingCount > 0;

      // いずれかの問題がある場合は確認ダイアログを表示
      if (hasVectorDuplicates || hasSummaryDuplicates || hasMissingVectors) {
        setExistingVectorUrls(duplications.existingVectorUrls);
        setExistingSummaryInfo(duplications.existingSummaryInfo);
        setMissingVectorUrls(missingVectorCheck.missingVectorUrls);
        setMissingVectorInfo({
          total: missingVectorCheck.totalUrls,
          missing: missingVectorCheck.missingCount
        });
        setPendingProcessType("huggingface");
        setPendingUrls(paperUrls);
        setShowConfirmationDialog(true);
        setIsChecking(false);
        isSubmittingHuggingFaceRef.current = false;
        return;
      }

      setIsChecking(false);
      await executeHuggingfaceProcessing();
      
    } catch (error: unknown) {
      console.error('Failed to check vector existence for HuggingFace:', error);
      alert(`エラーが発生しました: ${error instanceof Error ? error.message : String(error)}`);
      setIsChecking(false);
    } finally {
      // 処理完了時にフラグをリセット
      isSubmittingHuggingFaceRef.current = false;
      console.log('[importFromHuggingfaceBackground] Processing completed, flag reset');
    }
  }, [modelConfig, shouldCreateEmbeddings, promptMode, selectedPrompts, useHfDate, hfDate, checkDuplications, executeHuggingfaceProcessing]);

  // Cancel current background task
  const cancelBackgroundTask = useCallback(async () => {
    if (!taskId) return;
    
    if (confirm("バックグラウンド処理を停止しますか？")) {
      try {
        await backgroundProcessor.cancelTask(taskId);
        setTaskId(null);
        setCurrentTask(null);
        resetProcessingState();
      } catch (error: unknown) {
        console.error('Failed to cancel background task:', error);
        alert(`処理の停止に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }, [taskId]);

  const submitArxiv = async () => {
    const list = urls
      .split(/\r?\n/)
      .map((u) => u.trim())
      .filter(Boolean);
    if (list.length === 0) {
      alert("少なくとも 1 つ以上の arXiv URL を入力してください");
      return;
    }
    if (!modelConfig) {
      alert("モデル設定がまだ読み込まれていません。ページを再読み込みするか、設定が完了するまでお待ちください。");
      return;
    }

    // 埋め込みベクトルを作成する場合、プロンプト選択モードでプロンプトが選択されているかチェック
    if (shouldCreateEmbeddings && promptMode === "prompt_selection" && selectedPrompts.length === 0) {
      alert("プロンプト選択モードではプロンプトを選択してください。");
      return;
    }

    // embeddingTargetをバックエンドの期待する文字列形式に変換
    let embeddingTargetString = "default_only"; // デフォルト値
    if (embeddingTarget) {
      if (embeddingTarget.type === "default") {
        embeddingTargetString = "default_only";
      } else if (embeddingTarget.type === "custom") {
        embeddingTargetString = "custom_only";
      } else if (embeddingTarget.type === "none") {
        // "none"の場合はcreate_embeddingsがfalseになっているので、この値は使用されない
        embeddingTargetString = "default_only";
      }
    }

    const currentAuthSession = await getSession();
    if (!currentAuthSession || !currentAuthSession.accessToken) {
      alert("認証されていません。ログインしてください。");
      setSaving(false);
      signIn(undefined, { callbackUrl: "/papers/add" });
      return;
    }

    setTotalCount(list.length);
    setCurrentIndex(0);
    setSaving(true);
    setProcessType("arxiv");
    shouldStopRef.current = false;
    let success = 0;
    let fail = 0;

    const headers = await createApiHeaders();

    for (let i = 0; i < list.length; i++) {
      // 停止チェック
      if (shouldStopRef.current) {
        break;
      }
      
      const url = list[i];
      setCurrentIndex(i + 1);
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000"}/papers/import_from_arxiv`,
          {
            method: "POST",
            headers: headers,
            body: JSON.stringify({ 
              url, 
              config_overrides: configOverrides, 
              prompt_mode: promptMode,
              selected_prompts: selectedPrompts,
              create_embeddings: createEmbeddings,
              embedding_target: embeddingTargetString
            }),
          }
        );
        if (res.ok) {
          success++;
        } else {
          const errorData = await res.json().catch(() => ({detail: "Unknown error"}));
          console.error("Import error (arXiv):", res.status, errorData);
          
          // プロンプト関連のエラーの場合は即座に停止してユーザーに通知
          if (res.status === 400 && errorData.detail && errorData.detail.includes("プロンプト")) {
            resetProcessingState();
            if (confirm(`エラー: ${errorData.detail}\n\n設定ページに移動しますか？`)) {
              window.open('/settings', '_blank');
            }
            return;
          }
          
          fail++;
        }
      } catch(e) {
        console.error("Fetch error during arXiv import:", e);
        fail++;
      }
    }

    // 処理完了後のリセット
    resetProcessingState();
    
    const statusMessage = shouldStopRef.current 
      ? `arXiv 論文登録が停止されました: 成功 ${success} 件, 失敗 ${fail} 件`
      : `arXiv 論文登録完了: 成功 ${success} 件, 失敗 ${fail} 件`;
    alert(statusMessage);
    
    if (success > 0) {
        router.push("/papers");
        router.refresh();
    }
  };

  const importFromHuggingface = async () => {
    if (!modelConfig) {
      alert("モデル設定がまだ読み込まれていません。ページを再読み込みするか、設定が完了するまでお待ちください。");
      return;
    }

    // 埋め込みベクトルを作成する場合、プロンプト選択モードでプロンプトが選択されているかチェック
    if (shouldCreateEmbeddings && promptMode === "prompt_selection" && selectedPrompts.length === 0) {
      alert("プロンプト選択モードではプロンプトを選択してください。");
      return;
    }

    // embeddingTargetをバックエンドの期待する文字列形式に変換
    let embeddingTargetString = "default_only"; // デフォルト値
    if (embeddingTarget) {
      if (embeddingTarget.type === "default") {
        embeddingTargetString = "default_only";
      } else if (embeddingTarget.type === "custom") {
        embeddingTargetString = "custom_only";
      } else if (embeddingTarget.type === "none") {
        // "none"の場合はcreate_embeddingsがfalseになっているので、この値は使用されない
        embeddingTargetString = "default_only";
      }
    }

    if (!confirm("Hugging Face ページからarXiv IDを取得し、順次登録処理を実行しますか？\n(設定された日付以前の論文が対象となります)")) {
      return;
    }

    const currentAuthSession = await getSession();
    if (!currentAuthSession || !currentAuthSession.accessToken) {
      alert("認証されていません。ログインしてください。");
      setSaving(false);
      signIn(undefined, { callbackUrl: "/papers/add" });
      return;
    }
    
    setSaving(true);
    setProcessType("huggingface");
    shouldStopRef.current = false;
    setTotalCount(0); 
    setCurrentIndex(0); 
    let successCount = 0;
    let failCount = 0;

    const headers = await createApiHeaders();

    try {
      const arxivIdsRes = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000"}/papers/fetch_huggingface_arxiv_ids`,
        {
          method: "POST",
          headers: headers,
          body: JSON.stringify({ config_overrides: configOverrides }),
        }
      );

      if (!arxivIdsRes.ok) {
        const errorData = await arxivIdsRes.json().catch(() => ({detail: "Failed to fetch arXiv IDs from Hugging Face"}));
        throw new Error(errorData.detail || arxivIdsRes.statusText);
      }

      const arxivIds: string[] = await arxivIdsRes.json();

      if (arxivIds.length === 0) {
        alert("Hugging Face から登録対象の arXiv ID が見つかりませんでした。");
        resetProcessingState();
        return;
      }

      setTotalCount(arxivIds.length);

      for (let i = 0; i < arxivIds.length; i++) {
        // 停止チェック
        if (shouldStopRef.current) {
          break;
        }
        
        const arxivId = arxivIds[i];
        setCurrentIndex(i + 1);
        const arxivUrl = `https://arxiv.org/abs/${arxivId}`;
        
        try {
          const importRes = await fetch(
            `${process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000"}/papers/import_from_arxiv`,
            {
              method: "POST",
              headers: headers, 
              body: JSON.stringify({ 
                url: arxivUrl, 
                config_overrides: configOverrides, 
                prompt_mode: promptMode,
                selected_prompts: selectedPrompts,
                create_embeddings: shouldCreateEmbeddings,
                embedding_target: embeddingTargetString
              }),
            }
          );

          if (importRes.ok) {
            successCount++;
          } else {
            const errorData = await importRes.json().catch(() => ({detail: `Failed to import ${arxivUrl}`}));
            console.error(`Import error for ${arxivUrl}:`, importRes.status, errorData);
            
            // プロンプト関連のエラーの場合は即座に停止してユーザーに通知
            if (importRes.status === 400 && errorData.detail && errorData.detail.includes("プロンプト")) {
              resetProcessingState();
              if (confirm(`エラー: ${errorData.detail}\n\n設定ページに移動しますか？`)) {
                window.open('/settings', '_blank');
              }
              return;
            }
            
            failCount++;
          }
        } catch (e) {
          console.error(`Fetch error during import of ${arxivUrl}:`, e);
          failCount++;
        }
      }

      const statusMessage = shouldStopRef.current 
        ? `Hugging Face 経由の論文登録が停止されました: 成功 ${successCount} 件, 失敗 ${failCount} 件`
        : `Hugging Face 経由の論文登録完了: 成功 ${successCount} 件, 失敗 ${failCount} 件`;
      alert(statusMessage);
      
      if (successCount > 0) {
          router.push("/papers");
          router.refresh();
      }

    } catch (error: unknown) {
      console.error("Error in Hugging Face import process:", error);
      alert(`エラーが発生しました: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      resetProcessingState();
    }
  };

  if (authStatus === "loading" || isRedirecting) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-custom">
        <Loader2 className="h-12 w-12 animate-spin text-blue-600 mb-4" />
        <p className="text-lg text-gray-600">読み込み中...</p>
      </div>
    );
  }

  if (authStatus === "unauthenticated") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-custom">
        <AlertTriangle className="h-12 w-12 text-orange-500 mb-4" />
        <Alert variant="default" className="w-full max-w-md bg-orange-50 border-orange-300">
          <AlertTitle className="text-orange-700">認証が必要です</AlertTitle>
          <AlertDescription className="text-orange-600">
            このページを表示するにはログインが必要です。ログインページへリダイレクトします...
          </AlertDescription>
        </Alert>
      </div>
    );
  }


  return (
    <div className="container mx-auto py-8 px-4 md:px-6">
      <div className="flex items-center justify-between mb-6">
        <Button variant="outline" asChild className="btn-nav">
          <Link href="/">
            <ArrowLeft className="mr-2 h-4 w-4" />
            トップページへ
          </Link>
        </Button>
        <h1 className="text-3xl font-bold text-center">論文の追加</h1>
        <Button variant="outline" asChild className="btn-nav">
          <Link href="/papers">
            論文一覧へ
            <ListChecks className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>

      <div className="grid gap-8 md:grid-cols-1 lg:grid-cols-3">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>モデル設定</CardTitle>
              <CardDescription>
                論文の処理に使用するAIモデルやパラメータを設定します。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ModelSettings onChange={setModelConfig} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>共通設定</CardTitle>
              <CardDescription>
                論文登録時の共通設定を行います。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EmbeddingSettings
                createEmbeddings={shouldCreateEmbeddings}
                setCreateEmbeddings={setCreateEmbeddings}
                promptMode={promptMode}
                setPromptMode={setPromptMode}
                selectedPrompts={selectedPrompts}
                setSelectedPrompts={setSelectedPrompts}
                embeddingTarget={embeddingTarget}
                setEmbeddingTarget={setEmbeddingTarget}
                availablePrompts={availablePrompts || []}
                isPromptsLoading={isPromptsLoading}
                disabled={saving}
                useParallelProcessing={useParallelProcessing}
                setUseParallelProcessing={setUseParallelProcessing}
              />

              {/* Background Processing Settings - フラグによる表示制御 */}
              {ENABLE_BACKGROUND_PROCESSING_SETTING ? (
                <div className="space-y-4 pt-4 border-t">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label className="text-sm font-medium">バックグラウンド処理</Label>
                    <p className="text-xs text-muted-foreground">
                      Service Worker利用でページ遷移してもバックグラウンドで処理を継続<br />
                      <strong>⚠️ 各論文の処理は1論文あたり2-10分程度かかる場合があります</strong><br />
                      Webアプリのタブ自体は落とさずに残しておいてください。不具合時は「停止」ボタンをご利用ください。
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {isBpmInitialized ? ( // ★ 初期化完了を待ってから表示
                      isServiceWorkerSupported ? (
                        <div className="flex items-center gap-2">
                          <Zap className="h-4 w-4 text-green-600" />
                          <Checkbox
                            id="useBackgroundProcessing"
                            checked={useBackgroundProcessing}
                            onCheckedChange={(checked) => setUseBackgroundProcessing(checked === true)}
                            disabled={saving}
                          />
                          <Label htmlFor="useBackgroundProcessing" className="text-sm">
                            有効
                          </Label>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <AlertTriangle className="h-4 w-4" />
                          <span className="text-xs">未サポート</span>
                        </div>
                      )
                    ) : (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-xs">確認中...</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* ★ 詳細バックグラウンドタスクステータス表示 */}
                {(currentTask || isCheckingExistingTasks) && (
                  <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
                    <div className="flex items-center gap-2 mb-2">
                      {isCheckingExistingTasks ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                          <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
                            既存のバックグラウンドタスクを確認中...
                          </span>
                        </>
                      ) : (
                        <>
                          <Clock className="h-4 w-4 text-blue-600" />
                          <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
                            バックグラウンド処理中
                          </span>
                          <span className="text-xs text-blue-600 dark:text-blue-400">
                            (ID: {currentTask?.id.slice(0, 8)}...)
                          </span>
                        </>
                      )}
                    </div>
                    {currentTask && (
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs text-blue-700 dark:text-blue-300">
                          <span>種類: {currentTask.type === 'arxiv' ? 'arXiv' : 'Hugging Face'}</span>
                          <span>ステータス: {currentTask.status}</span>
                        </div>
                      
                      {/* ★ 詳細進捗情報（論文とタスク） */}
                      {currentTask.progress.paperProgress && currentTask.progress.summaryProgress && (
                        <>
                          <div className="flex justify-between text-xs text-blue-700 dark:text-blue-300">
                            <span>📄 論文進捗: {(currentTask.progress.paperProgress.currentPaperIndex || 0) + 1} / {currentTask.progress.paperProgress.totalPapers || 0}</span>
                            <span>📝 要約進捗: {(currentTask.progress.summaryProgress.currentSummaryIndex || 0) + 1} / {currentTask.progress.summaryProgress.totalSummaries || 1}</span>
                          </div>
                          
                          {/* 現在処理中の内容 */}
                          <div className="text-xs text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/50 p-2 rounded border">
                            <div className="font-medium mb-1">🔄 現在処理中:</div>
                            {currentTask.progress.paperProgress.currentArxivId && (
                              <div>📊 arXiv: {currentTask.progress.paperProgress.currentArxivId}</div>
                            )}
                            {currentTask.progress.summaryProgress.currentPromptName && (
                              <div>🏷️ プロンプト: {currentTask.progress.summaryProgress.currentPromptName}</div>
                            )}
                          </div>
                        </>
                      )}
                      
                      <div className="flex justify-between text-xs text-blue-700 dark:text-blue-300">
                        <span>全体進捗: {currentTask.progress.current} / {currentTask.progress.total}</span>
                        <span>
                          ✅ 成功: {currentTask.progress.completed.length}, 
                          ❌ 失敗: {currentTask.progress.failed.length}
                        </span>
                      </div>
                      {currentTask.progress.total > 0 && (
                        <Progress 
                          value={(currentTask.progress.current / currentTask.progress.total) * 100} 
                          className="w-full h-2" 
                        />
                      )}
                      </div>
                    )}
                  </div>
                )}

                {/* ★★★ Service Worker復旧状況表示 ★★★ */}
                {(isRecovering || recoveryError || lastRecoveryAttempt) && (
                  <div className={`p-3 rounded-lg border ${
                    isRecovering 
                      ? 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800'
                      : recoveryError
                      ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800'
                      : 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800'
                  }`}>
                    <div className="flex items-center gap-2 mb-2">
                      {isRecovering ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin text-yellow-600" />
                          <span className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                            Service Worker復旧中...
                          </span>
                        </>
                      ) : recoveryError ? (
                        <>
                          <AlertTriangle className="h-4 w-4 text-red-600" />
                          <span className="text-sm font-medium text-red-800 dark:text-red-200">
                            復旧に失敗しました
                          </span>
                        </>
                      ) : (
                        <>
                          <Clock className="h-4 w-4 text-green-600" />
                          <span className="text-sm font-medium text-green-800 dark:text-green-200">
                            復旧完了
                          </span>
                        </>
                      )}
                    </div>
                    
                    {isRecovering && (
                      <div className="text-xs text-yellow-700 dark:text-yellow-300 mb-2">
                        バックグラウンド処理の復旧を試行しています...
                      </div>
                    )}
                    
                    {recoveryError && (
                      <div className="text-xs text-red-700 dark:text-red-300 mb-2">
                        {recoveryError.replace('❌ 復旧に失敗しました: ', '')}
                      </div>
                    )}
                    
                    {lastRecoveryAttempt && (
                      <div className="text-xs text-muted-foreground">
                        最終復旧試行: {lastRecoveryAttempt.toLocaleTimeString()}
                      </div>
                    )}
                    
                    {/* 手動復旧ボタン */}
                    {(recoveryError || (!isRecovering && currentTask)) && (
                      <div className="mt-2 flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            if (!currentTask) return;
                            
                            setIsRecovering(true);
                            setRecoveryError(null);
                            try {
                              console.log('[UI] Manual recovery attempt for task:', currentTask.id);
                              await backgroundProcessor.resumeTaskProcessing(currentTask.id);
                              setLastRecoveryAttempt(new Date());
                            } catch (error) {
                              console.error('[UI] Manual recovery failed:', error);
                              setRecoveryError(`手動復旧に失敗: ${error instanceof Error ? error.message : String(error)}`);
                            } finally {
                              setTimeout(() => setIsRecovering(false), 3000);
                            }
                          }}
                          disabled={isRecovering}
                          className="text-xs h-6"
                        >
                          {isRecovering ? (
                            <>
                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              復旧中...
                            </>
                          ) : (
                            '手動復旧 (重い処理対応)'
                          )}
                        </Button>
                        {recoveryError && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setRecoveryError(null);
                              setLastRecoveryAttempt(null);
                            }}
                            className="text-xs h-6"
                          >
                            エラーをクリア
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
                </div>
              ) : (
                <div className="space-y-4 pt-4 border-t">
                  <div className="p-3 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded-md">
                    <p className="text-xs text-muted-foreground">
                      <strong>⚠️ 各論文の処理は1論文あたり2-10分程度かかる場合があります</strong><br />
                      Webアプリのタブ自体は落とさずに残しておいてください。不具合時は「停止」ボタンをご利用ください。
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>arXiv 論文登録</CardTitle>
              <CardDescription>
                arXivの論文URLを改行区切りで入力し、一括で登録します。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="arxivUrls">URL リスト（改行区切り）</Label>
                <Textarea
                  id="arxivUrls"
                  className="mt-1 w-full h-48 text-sm"
                  placeholder={`https://arxiv.org/abs/2504.12345\nhttps://arxiv.org/abs/2401.00001\n...`}
                  value={urls}
                  onChange={(e) => setUrls(e.target.value)}
                  disabled={saving || isChecking}
                />
              </div>
              {saving && processType === "arxiv" && (
                <div className="space-y-1">
                  <Label>
                    {isStopping ? "停止中です。お待ちください..." : 
                     isCheckingExistingTasks ? "既存タスクを確認中..." :
                     totalCount > 0 ? `arXiv 登録進捗: ${currentIndex} / ${totalCount}` : 
                     "処理を開始しています..."}
                  </Label>
                  {totalCount > 0 ? (
                    <Progress value={(currentIndex / totalCount) * 100} className="w-full" />
                  ) : (
                    <Progress value={0} className="w-full animate-pulse" />
                  )}
                </div>
              )}
            </CardContent>
            <CardFooter className="flex flex-col gap-4">
              <Button
                onClick={handleArxivSubmitClick}
                disabled={!isBpmInitialized || saving || isChecking || !modelConfig || urls.trim() === "" || (shouldCreateEmbeddings && promptMode === "prompt_selection" && selectedPrompts.length === 0)}
                className="w-full"
              >
                {isChecking ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    確認中...
                  </>
                ) : saving && processType === "arxiv" && currentIndex > 0 ? (
                  `登録中… ${currentIndex}/${totalCount}`
                ) : (
                  <>
                    {useBackgroundProcessing && isServiceWorkerSupported ? (
                      <Zap className="mr-2 h-4 w-4" />
                    ) : (
                      <UploadCloud className="mr-2 h-4 w-4" />
                    )}
                    arXiv 論文を登録
                    {useBackgroundProcessing && isServiceWorkerSupported && (
                      <span className="ml-1 text-xs opacity-70">(バックグラウンド)</span>
                    )}
                  </>
                )}
              </Button>

              <div className="flex justify-between items-center w-full">
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">
                    {!shouldCreateEmbeddings 
                      ? "埋め込みベクトルなしで登録します"
                      : promptMode === "default" 
                        ? "デフォルトプロンプトで要約を生成します" 
                        : `${selectedPrompts.length}個のプロンプトが選択されています`
                    }
                  </span>
                </div>
                {saving && processType === "arxiv" && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={useBackgroundProcessing && isServiceWorkerSupported ? cancelBackgroundTask : handleStop}
                    disabled={isStopping}
                  >
                    <Square className="mr-2 h-4 w-4" />
                    停止
                  </Button>
                )}
              </div>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Hugging Face 一括登録</CardTitle>
              <CardDescription>
                Hugging Faceから論文を一括でインポートします。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="useHfDate"
                    checked={useHfDate}
                    onCheckedChange={(checked) => setUseHfDate(Boolean(checked))}
                    disabled={saving || isChecking}
                  />
                  <Label htmlFor="useHfDate" className="cursor-pointer">
                    Hugging Face の日付をカスタム指定
                  </Label>
                </div>
                {useHfDate && (
                  <div className="space-y-1">
                    <Label htmlFor="hfDateInput">カスタム日付</Label>
                    <Input
                      id="hfDateInput"
                      type="date"
                      value={hfDate}
                      onChange={(e) => setHfDate(e.target.value)}
                      className="w-full"
                      disabled={saving || isChecking}
                    />
                    <p className="text-xs text-muted-foreground">
                      この日付以前の論文がインポート対象となります。
                    </p>
                  </div>
                )}
                {saving && processType === "huggingface" && (
                  <div className="space-y-1">
                    <Label>
                      {isStopping ? "停止中です。お待ちください..." : 
                       isCheckingExistingTasks ? "既存タスクを確認中..." :
                       totalCount > 0 ? `Hugging Face 登録進捗: ${currentIndex} / ${totalCount}` : 
                       "arXiv IDを取得中..."}
                    </Label>
                    {totalCount > 0 ? (
                      <Progress value={(currentIndex / totalCount) * 100} className="w-full" />
                    ) : (
                      <Progress value={0} className="w-full animate-pulse" />
                    )}
                  </div>
                )}
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-4">
              <Button
                onClick={useBackgroundProcessing && isServiceWorkerSupported ? importFromHuggingfaceBackground : importFromHuggingface}
                disabled={!isBpmInitialized || saving || isChecking || !modelConfig || (shouldCreateEmbeddings && promptMode === "prompt_selection" && selectedPrompts.length === 0)}
                className="w-full"
              >
                {isChecking ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    確認中...
                  </>
                ) : saving && processType === "huggingface" && currentIndex > 0 && totalCount > 0 ? (
                  `登録中… ${currentIndex}/${totalCount}`
                ) : saving && processType === "huggingface" ? (
                  "取得中…"
                ) : (
                  <>
                    {useBackgroundProcessing && isServiceWorkerSupported ? (
                      <Zap className="mr-2 h-4 w-4" />
                    ) : (
                      <Rocket className="mr-2 h-4 w-4" />
                    )}
                    Hugging Face から一括登録
                    {useBackgroundProcessing && isServiceWorkerSupported && (
                      <span className="ml-1 text-xs opacity-70">(バックグラウンド)</span>
                    )}
                  </>
                )}
              </Button>

              <div className="flex justify-between items-center w-full">
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">
                    {!shouldCreateEmbeddings 
                      ? "埋め込みベクトルなしで登録します"
                      : promptMode === "default" 
                        ? "デフォルトプロンプトで要約を生成します" 
                        : `${selectedPrompts.length}個のプロンプトが選択されています`
                    }
                  </span>
                </div>
                {saving && processType === "huggingface" && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={useBackgroundProcessing && isServiceWorkerSupported ? cancelBackgroundTask : handleStop}
                    disabled={isStopping}
                  >
                    <Square className="mr-2 h-4 w-4" />
                    停止
                  </Button>
                )}
              </div>
            </CardFooter>
          </Card>
        </div>
      </div>

      {/* 統合確認ダイアログ（重複確認+ベクトル未存在警告） */}
      <AlertDialog open={showConfirmationDialog} onOpenChange={setShowConfirmationDialog}>
        <AlertDialogContent className="max-w-4xl max-h-[80vh] overflow-hidden">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {(() => {
                const hasVectorDup = shouldCreateEmbeddings && existingVectorUrls.length > 0;
                const hasSummaryDup = existingSummaryInfo.length > 0;
                const hasMissingVectors = !shouldCreateEmbeddings && missingVectorInfo.missing > 0;
                
                if ((hasVectorDup || hasSummaryDup) && hasMissingVectors) {
                  return "重複データの上書き確認 & RAG機能への影響警告";
                } else if (hasVectorDup || hasSummaryDup) {
                  return "重複データの上書き確認";
                } else if (hasMissingVectors) {
                  return "RAG機能への影響に関する警告";
                }
                return "確認が必要です";
              })()}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const hasVectorDup = shouldCreateEmbeddings && existingVectorUrls.length > 0;
                const hasSummaryDup = existingSummaryInfo.length > 0;
                const hasMissingVectors = !shouldCreateEmbeddings && missingVectorInfo.missing > 0;
                
                const messages = [];
                
                if (hasVectorDup || hasSummaryDup) {
                  if (hasVectorDup && hasSummaryDup) {
                    messages.push("既に埋め込みベクトルおよび要約が存在する論文があります。続行すると既存のデータが上書きされます。");
                  } else if (hasVectorDup) {
                    messages.push("既に埋め込みベクトルが存在する論文があります。続行すると既存のデータが上書きされます。");
                  } else {
                    messages.push("既に要約が存在する論文があります。続行すると既存のデータが上書きされます。");
                  }
                }
                
                if (hasMissingVectors) {
                  messages.push("埋め込みベクトルが存在しない論文があります。これによりRAGや推薦機能が正常に動作しない可能性があります。");
                }
                
                return messages.join(" ");
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          <ScrollArea className="max-h-[60vh] overflow-y-auto">
            <div className="py-4 space-y-4">
              {/* 埋め込みベクトル重複 */}
              {shouldCreateEmbeddings && existingVectorUrls.length > 0 && (
                <div>
                  <div className="text-sm font-medium mb-2 text-orange-700 dark:text-orange-400">
                    🔹 既存埋め込みベクトルがある論文 ({existingVectorUrls.length}件):
                  </div>
                  <ScrollArea className="h-32 w-full border border-border rounded-md p-2 bg-muted/20">
                    <div className="space-y-1">
                      {existingVectorUrls.map((url, index) => (
                        <div key={`vector-${index}`} className="text-xs text-foreground/70 break-all">
                          {url}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {/* 要約重複 */}
              {existingSummaryInfo.length > 0 && (
                <div>
                  <div className="text-sm font-medium mb-2 text-red-700 dark:text-red-400">
                    📄 既存要約がある論文 ({existingSummaryInfo.length}件):
                  </div>
                  <ScrollArea className="h-40 w-full border border-border rounded-md p-2 bg-muted/20">
                    <div className="space-y-2">
                      {existingSummaryInfo.map((summary, index) => (
                        <div key={`summary-${index}`} className="text-xs border-b border-border/50 pb-1">
                          <div className="text-foreground/70 break-all">
                            📎 <strong>URL:</strong> {summary.url}
                          </div>
                          <div className="text-blue-700 dark:text-blue-400 mt-1">
                            🏷️ <strong>プロンプト:</strong> {summary.prompt_name} 
                            <span className="ml-1 text-foreground/50">
                              ({summary.prompt_type === "default" ? "デフォルト" : "カスタム"})
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {/* ベクトル未存在警告 */}
              {!shouldCreateEmbeddings && missingVectorInfo.missing > 0 && (
                <div>
                  <div className="text-sm font-medium mb-2 text-orange-700 dark:text-orange-400">
                    ⚠️ 埋め込みベクトルが存在しない論文 ({missingVectorInfo.missing}/{missingVectorInfo.total}件):
                  </div>
                  <ScrollArea className="h-32 w-full border border-border rounded-md p-2 bg-muted/20">
                    <div className="space-y-1">
                      {missingVectorUrls.map((url, index) => (
                        <div key={`missing-${index}`} className="text-xs text-foreground/70 break-all">
                          {url}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                  
                  <div className="text-sm text-muted-foreground bg-orange-50 dark:bg-orange-950/30 p-3 rounded-lg border border-orange-200 dark:border-orange-800 mt-2">
                    <div className="font-medium text-orange-800 dark:text-orange-200 mb-1">影響する機能:</div>
                    <ul className="text-xs text-orange-700 dark:text-orange-300 space-y-1">
                      <li>• RAGページでの論文検索・質問応答</li>
                      <li>• 論文推薦システム</li>
                      <li>• 関連論文の自動検出</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleConfirmationCancel}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmationConfirm}>
              {(() => {
                const hasVectorDup = shouldCreateEmbeddings && existingVectorUrls.length > 0;
                const hasSummaryDup = existingSummaryInfo.length > 0;
                const hasMissingVectors = !shouldCreateEmbeddings && missingVectorInfo.missing > 0;
                
                if ((hasVectorDup || hasSummaryDup) && hasMissingVectors) {
                  return "続行（上書き・RAG機能制限あり）";
                } else if (hasVectorDup || hasSummaryDup) {
                  return "続行（上書き）";
                } else if (hasMissingVectors) {
                  return "続行（RAG機能は制限されます）";
                }
                return "続行";
              })()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function AddPaperPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <AddPaperPageContent />
    </Suspense>
  );
}