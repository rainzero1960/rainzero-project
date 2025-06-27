// src/app/papers/[id]/DetailClient.tsx - 軽量化版
"use client";

import { useMemo, Fragment, useEffect, useState, useRef, useCallback, memo } from "react";
import { useRouter, usePathname } from "next/navigation"; 
import { usePaperDetail } from "@/hooks/usePaperDetail";
import { useAvailablePrompts } from "@/hooks/useAvailablePrompts";
import { useAvailablePromptsByCategory } from "@/hooks/useAvailablePromptsByCategory";
import { useUserInfo } from "@/hooks/useUserInfo";
import { testBackendConnection } from "@/utils/apiTest";
import InfoCard from "@/components/InfoCard";
import ChatSidebar from "@/components/ChatSidebar";
import ModelSettings, { ModelSetting } from "@/components/ModelSettings";
import { CharacterPromptToggle } from "@/components/CharacterPromptToggle";
import { useCharacterPromptToggle } from "@/hooks/useCharacterPromptToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import Link from "next/link";
import { authenticatedFetch } from "@/lib/utils";
import { mutate as globalMutate } from "swr";

import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GeneratedSummary, EditedSummary, CustomGeneratedSummary } from "@/types/paper";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Loader2, Edit3, Save, XCircle, Eye, AlertTriangle, Copy, List, FilePlus2, Menu, MessageSquare, RotateCcw, Home } from "lucide-react"; 

const BACK = process.env.NEXT_PUBLIC_BACKEND_URL;

// デバウンス関数
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

// 入力最適化フック（修正版）
function useOptimizedInput(initialValue: string, onSave: (value: string) => void, saveDelay: number = 1000) {
  const [localValue, setLocalValue] = useState(initialValue);
  const [isTyping, setIsTyping] = useState(false);
  const [isSaving, setIsSaving] = useState(false); // 保存中フラグを追加
  const debouncedValue = useDebounce(localValue, saveDelay);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedValueRef = useRef(initialValue); // 最後に保存した値を記録

  // 外部からの値変更を反映（ページロード時など）
  useEffect(() => {
    // 保存中でなく、タイピング中でなく、最後に保存した値と異なる場合のみ更新
    if (!isSaving && !isTyping && initialValue !== lastSavedValueRef.current) {
      setLocalValue(initialValue);
      lastSavedValueRef.current = initialValue;
    }
  }, [initialValue, isTyping, isSaving]);

  // デバウンスされた値で保存実行
  useEffect(() => {
    if (debouncedValue !== lastSavedValueRef.current && !isSaving) {
      const saveValue = async () => {
        setIsSaving(true);
        try {
          await onSave(debouncedValue);
          lastSavedValueRef.current = debouncedValue;
        } finally {
          setIsSaving(false);
        }
      };
      saveValue();
    }
  }, [debouncedValue, onSave, isSaving]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalValue(e.target.value);
    setIsTyping(true);
    
    // タイピング状態をリセット
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
    }, 500);
  }, []);

  const handleBlur = useCallback(() => {
    setIsTyping(false);
    // ブラー時は即座に保存（最後に保存した値と異なる場合のみ）
    if (localValue !== lastSavedValueRef.current && !isSaving) {
      const saveValue = async () => {
        setIsSaving(true);
        try {
          await onSave(localValue);
          lastSavedValueRef.current = localValue;
        } finally {
          setIsSaving(false);
        }
      };
      saveValue();
    }
  }, [localValue, onSave, isSaving]);

  return {
    value: localValue,
    onChange: handleChange,
    onBlur: handleBlur,
    isTyping: isTyping || isSaving // タイピング中または保存中の場合true
  };
}

// モバイル検出をカスタムフック化
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    
    // デバウンスされたリサイズハンドラー
    let timeoutId: NodeJS.Timeout;
    const debouncedResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(checkMobile, 150);
    };
    
    window.addEventListener('resize', debouncedResize);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', debouncedResize);
    };
  }, []);
  
  return isMobile;
}

// モバイルキーボード&Sheet対応のカスタムフック
function useMobileSheetScrollFix() {
  const scrollPositionRef = useRef<number>(0);
  const isSheetOpenRef = useRef<boolean>(false);
  
  const saveScrollPosition = useCallback(() => {
    if (typeof window !== 'undefined') {
      scrollPositionRef.current = window.scrollY || document.documentElement.scrollTop || 0;
    }
  }, []);
  
  const restoreScrollPosition = useCallback(() => {
    if (typeof window !== 'undefined') {
      // 少し遅延させて確実に復元
      setTimeout(() => {
        window.scrollTo(0, scrollPositionRef.current);
        document.documentElement.scrollTop = scrollPositionRef.current;
        document.body.scrollTop = scrollPositionRef.current;
      }, 50);
      
      // さらに確実にするために複数回実行
      setTimeout(() => {
        window.scrollTo(0, scrollPositionRef.current);
      }, 150);
    }
  }, []);
  
  const onSheetOpenChange = useCallback((isOpen: boolean) => {
    if (typeof window === 'undefined') return;
    
    if (isOpen) {
      // Sheet開く前にスクロール位置を保存
      saveScrollPosition();
      isSheetOpenRef.current = true;
      
      // body のスクロールを無効化
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollPositionRef.current}px`;
      document.body.style.width = '100%';
      document.body.style.overflowY = 'hidden';
    } else {
      // Sheet閉じる時にスクロール位置を復元
      isSheetOpenRef.current = false;
      
      // body のスタイルをリセット
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      document.body.style.overflowY = '';
      
      // スクロール位置を復元
      restoreScrollPosition();
    }
  }, [saveScrollPosition, restoreScrollPosition]);
  
  // Visual Viewport API でキーボード対応（iOS Safari対応）
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    
    const handleViewportChange = () => {
      if (!isSheetOpenRef.current) return;
      
      // キーボードが閉じられた時の処理
      if (window.visualViewport!.height > window.innerHeight * 0.75) {
        // キーボードが閉じられたと判断
        setTimeout(() => {
          if (!isSheetOpenRef.current) {
            restoreScrollPosition();
          }
        }, 100);
      }
    };
    
    window.visualViewport.addEventListener('resize', handleViewportChange);
    
    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleViewportChange);
      }
    };
  }, [restoreScrollPosition]);
  
  // ページ遷移時のクリーンアップ
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined') {
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        document.body.style.overflowY = '';
      }
    };
  }, []);
  
  return { onSheetOpenChange };
}

// "## 一言でいうと" セクションを抽出する関数（メモ化）
const extractSummarySection = (text: string): string | null => {
  const pattern = /^\s*#{1,6}\s*\*{0,2}一言でいうと\*{0,2}\s*\n([\s\S]*?)(?=^\s*#{1,6}\s*[^#]|\Z)/m;
  const match = text.match(pattern);
  return match ? match[1].trim() : null;
};

// Markdownレンダラーをメモ化
const MemoizedMarkdown = memo(({ children, className }: { children: string; className?: string }) => (
  <div className={className}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
    >
      {children.replace(/。\n/g, '。  \n')}
    </ReactMarkdown>
  </div>
));
MemoizedMarkdown.displayName = 'MemoizedMarkdown';

// ChatSidebarをメモ化
const MemoizedChatSidebar = memo(({ paperId, model, selectedPrompt, useCharacterPrompt }: { 
  paperId: string; 
  model: ModelSetting | null;
  selectedPrompt?: { id: number | null; type: 'default' | 'custom' } | null;
  useCharacterPrompt?: boolean;
}) => (
  <ChatSidebar paperId={paperId} model={model} selectedPrompt={selectedPrompt} useCharacterPrompt={useCharacterPrompt} />
));
MemoizedChatSidebar.displayName = 'MemoizedChatSidebar';

// 軽量化されたメモコンポーネント（修正版）
const OptimizedMemoTextarea = memo(({ 
  initialValue, 
  onSave, 
  className 
}: { 
  initialValue: string; 
  onSave: (value: string) => void; 
  className?: string;
}) => {
  const { value, onChange, onBlur, isTyping } = useOptimizedInput(initialValue, onSave, 1000);
  
  return (
    <>
      <Textarea
        id="memo-textarea"
        className={className}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
      />
      <p className="text-xs text-muted-foreground">
        {isTyping ? "入力中..." : "フォーカスが外れたとき自動保存されます"}
      </p>
    </>
  );
});
OptimizedMemoTextarea.displayName = 'OptimizedMemoTextarea';

// 左サイドバーをメモ化
const LeftSidebarContent = memo(({ 
  memoInitialValue,
  onMemoSave, 
  currentPaperTags, 
  predefinedTags, 
  onTagClick, 
  onAddTag,
  setChatModel,
  selectedChatPrompt,
  onChatPromptChange,
  useCharacterPrompt,
  setUseCharacterPrompt
}: {
  memoInitialValue: string;
  onMemoSave: (value: string) => void;
  currentPaperTags: string[];
  predefinedTags: string[];
  onTagClick: (tag: string) => void;
  onAddTag: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  setChatModel: (model: ModelSetting | null) => void;
  selectedChatPrompt: { id: number | null; type: 'default' | 'custom' } | null;
  onChatPromptChange: (prompt: { id: number | null; type: 'default' | 'custom' }) => void;
  useCharacterPrompt: boolean;
  setUseCharacterPrompt: (enabled: boolean) => void;
}) => {
  // 新しいフックを使用してPaperカテゴリのプロンプトを取得
  const { prompts: chatPrompts, isLoading: promptsLoading, isError: promptsError } = useAvailablePromptsByCategory('paper');

  // paper_chat_system_prompt タイプのプロンプトのみをフィルタリング
  const filteredChatPrompts = useMemo(() => {
    if (!chatPrompts) return null;
    return chatPrompts.filter(prompt => 
      prompt.prompt_type === 'paper_chat_system_prompt'
    );
  }, [chatPrompts]);

  return (
    <Card className="h-full flex flex-col rounded-none border-0 border-t border-border">
      <CardContent className="flex-1 flex flex-col space-y-4 overflow-auto p-4">
        <div>
          <h3 className="font-semibold mb-2">チャット設定</h3>
          <ModelSettings onChange={setChatModel} context="paper_detail" />
        </div>

        {/* チャット用プロンプト選択 */}
        <div className="space-y-2">
          <h4 className="font-medium text-sm">使用するプロンプト</h4>
          {promptsLoading ? (
            <div className="text-xs text-muted-foreground">読み込み中...</div>
          ) : promptsError ? (
            <div className="text-xs text-red-600">
              プロンプトの読み込みに失敗しました
            </div>
          ) : filteredChatPrompts && filteredChatPrompts.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              利用可能なチャット用プロンプトがありません
            </div>
          ) : (
            <Select
              value={selectedChatPrompt ? 
                (selectedChatPrompt.type === 'default' ? 'default' : `custom_${selectedChatPrompt.id}`) 
                : 'default'}
              onValueChange={(value) => {
                if (value === 'default') {
                  onChatPromptChange({ id: null, type: 'default' });
                } else {
                  const id = parseInt(value.replace('custom_', ''));
                  onChatPromptChange({ id, type: 'custom' });
                }
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {filteredChatPrompts && filteredChatPrompts.map((prompt, index) => (
                  prompt.type === 'default' ? (
                    <SelectItem key={`default_${index}`} value="default">
                      {prompt.name}
                    </SelectItem>
                  ) : (
                    <SelectItem key={`custom_${prompt.id}`} value={`custom_${prompt.id}`}>
                      {prompt.name}
                    </SelectItem>
                  )
                ))}
              </SelectContent>
            </Select>
          )}
          
          {/* キャラクタープロンプトトグル */}
          <CharacterPromptToggle
            enabled={useCharacterPrompt}
            onChange={setUseCharacterPrompt}
          />
        </div>

        <div>
          <h3 className="font-semibold mb-2">メモ</h3>
          <OptimizedMemoTextarea
            className="h-32 bg-background"
            initialValue={memoInitialValue}
            onSave={onMemoSave}
          />
        </div>

        <div>
          <h4 className="font-medium text-sm mb-2">タグ</h4>
          <div className="flex flex-wrap gap-2 text-sm mb-2">
            {predefinedTags.map((t) => (
              <Badge
                key={t}
                variant={currentPaperTags.includes(t) ? "secondary" : "outline"}
                className="cursor-pointer"
                onClick={() => onTagClick(t)}
              >
                {t}
              </Badge>
            ))}
          </div>
          <Input
            placeholder="タグを追加（, 区切り）"
            onKeyDown={onAddTag}
            className="bg-background mb-2"
          />
          <ScrollArea className="h-20">
            <div className="p-1 flex flex-wrap gap-1">
              {currentPaperTags.map((tag, i) => (
                <Badge
                  key={i}
                  variant="outline"
                  className="cursor-pointer"
                  onClick={() => onTagClick(tag)}
                >
                  {tag}×
                </Badge>
              ))}
            </div>
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
});
LeftSidebarContent.displayName = 'LeftSidebarContent';

// スケルトンローディングコンポーネント
const InfoCardSkeleton = () => (
  <Card className="mb-4">
    <CardHeader>
      <Skeleton className="h-8 w-3/4 mb-2" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    </CardHeader>
    <CardContent className="space-y-2">
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/3" />
    </CardContent>
  </Card>
);

const MemoSkeleton = () => (
  <div className="space-y-2">
    <Skeleton className="h-6 w-24" />
    <Card className="p-4">
      <Skeleton className="h-4 w-full mb-2" />
      <Skeleton className="h-4 w-5/6 mb-2" />
      <Skeleton className="h-4 w-4/6" />
    </Card>
  </div>
);

const SummarySkeleton = () => (
  <div className="space-y-4">
    <div>
      <Skeleton className="h-6 w-48 mb-2" />
      <div className="flex items-center gap-2">
        <Skeleton className="h-10 w-[200px]" />
        <Skeleton className="h-10 w-32" />
      </div>
    </div>
    <Card className="p-4">
      <div className="space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/6" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-3/6" />
      </div>
    </Card>
  </div>
);

export default function DetailClient({ userPaperLinkId }: { userPaperLinkId: string }) {
  const router = useRouter();
  const pathname = usePathname(); 
  const { paper, isLoading, isError, mutate } = usePaperDetail(userPaperLinkId);
  const { user: currentUser } = useUserInfo();
  const isMobile = useIsMobile();
  const { onSheetOpenChange } = useMobileSheetScrollFix();

  const [chatModel, setChatModel] = useState<ModelSetting | null>(null);
  const [selectedChatPrompt, setSelectedChatPrompt] = useState<{ id: number | null; type: 'default' | 'custom' }>({ id: null, type: 'default' });
  
  // キャラクタープロンプトトグル
  const { enabled: useCharacterPrompt, setEnabled: setUseCharacterPrompt } = useCharacterPromptToggle('chat');

  // チャットプロンプト変更のコールバック
  const handleChatPromptChange = useCallback((prompt: { id: number | null; type: 'default' | 'custom' }) => {
    setSelectedChatPrompt(prompt);
  }, []);

  const [currentlyDisplayedSummary, setCurrentlyDisplayedSummary] = useState<GeneratedSummary | null>(null);
  const [currentlyDisplayedCustomSummary, setCurrentlyDisplayedCustomSummary] = useState<CustomGeneratedSummary | null>(null);
  const [userEditedSummaryForDisplay, setUserEditedSummaryForDisplay] = useState<EditedSummary | null>(null);
  const [selectedSummaryIdForDropdown, setSelectedSummaryIdForDropdown] = useState<string | undefined>(undefined);
  const [summaryType, setSummaryType] = useState<'default' | 'custom'>('default'); // 現在表示中の要約タイプ
  const [showOriginalSummary, setShowOriginalSummary] = useState(false); // 編集前の要約を表示するかどうか
  const [isChangingSummary, setIsChangingSummary] = useState(false); // 要約切り替え中のローディング状態
  const [isDeletingPaper, setIsDeletingPaper] = useState(false); // 論文削除中のローディング状態

  const [isRegenerateModalOpen, setIsRegenerateModalOpen] = useState(false);
  const [regenerateModelConfig, setRegenerateModelConfig] = useState<ModelSetting | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  
  // プロンプト選択関連の状態
  const [selectedPrompt, setSelectedPrompt] = useState<{id: number | null, type: 'default' | 'custom'}>({id: null, type: 'default'});
  
  // 利用可能なプロンプト一覧を取得
  const { prompts: availablePrompts, isLoading: isPromptsLoading, isError: promptsError, mutate: mutatePrompts } = useAvailablePrompts();
  
  // モーダルを開いたときに初期状態にリセット
  useEffect(() => {
    if (isRegenerateModalOpen) {
      setSelectedPrompt({id: null, type: 'default'});
    }
  }, [isRegenerateModalOpen]);

  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [editedSummaryText, setEditedSummaryText] = useState("");
  const [originalEditedSummaryText, setOriginalEditedSummaryText] = useState(""); 
  const [isSavingEditedSummary, setIsSavingEditedSummary] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false); 
  const [showLeaveConfirmDialog, setShowLeaveConfirmDialog] = useState(false);
  const [nextPath, setNextPath] = useState<string | null>(null);
  

  // モバイルでは固定サイズ、デスクトップでは動的サイズ
  const [leftWidth, setLeftWidth] = useState(250);
  const [rightWidth, setRightWidth] = useState(450);
  const [isLeftOpen, setIsLeftOpen] = useState(!isMobile); // モバイルでは初期状態で閉じる
  const [isRightOpen, setIsRightOpen] = useState(!isMobile);
  
  const [isLeftSheetOpen, setIsLeftSheetOpen] = useState(false);
  const [isRightSheetOpen, setIsRightSheetOpen] = useState(false);
  
  // リサイズ処理を軽量化（モバイルでは無効化）
  const dragSide = useRef<"left" | "right" | null>(null);
  
  const onMouseDownLeft = useCallback(() => { 
    if (!isMobile) dragSide.current = "left"; 
  }, [isMobile]);
  
  const onMouseDownRight = useCallback(() => { 
    if (!isMobile) dragSide.current = "right"; 
  }, [isMobile]);
  
  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragSide.current || isMobile) return;
    
    // RAF を使って描画を最適化
    requestAnimationFrame(() => {
      const min = 240;
      const max = window.innerWidth * 0.5;
      if (dragSide.current === "left") {
        const w = e.clientX;
        setLeftWidth(Math.min(Math.max(w, min), max));
      } else {
        const w = window.innerWidth - e.clientX;
        setRightWidth(Math.min(Math.max(w, min), max));
      }
    });
  }, [isMobile]);
  
  const onMouseUp = useCallback(() => { 
    dragSide.current = null; 
  }, []);

  useEffect(() => {
    if (isMobile) return; // モバイルでは無効化
    
    document.addEventListener("mousemove", onMouseMove, { passive: true });
    document.addEventListener("mouseup", onMouseUp, { passive: true });
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMouseMove, onMouseUp, isMobile]);

  const mainContentScrollRef = useRef<HTMLDivElement>(null);
  const scrollRatioToRestoreRef = useRef<number | null>(null);
  const editingStartScrollRatioRef = useRef<number | null>(null); 

  // メモの初期値を安定化
  const memoInitialValue = useMemo(() => paper?.user_specific_data.memo ?? "", [paper?.user_specific_data.memo]);

  // キャラクター整合性チェック関数
  const checkCharacterConsistency = useCallback((
    currentSummary: GeneratedSummary | CustomGeneratedSummary | null,
    selectedCharacter: string | null
  ) => {
    if (!currentSummary || !selectedCharacter) return true;
    if (!currentSummary.character_role) return true; // キャラクター情報がない場合は整合とみなす
    return currentSummary.character_role === selectedCharacter;
  }, []);

  // 最適な要約を自動選択する関数
  const findBestSummary = useCallback((
    selectedCharacter: string | null,
    availableSummaries: GeneratedSummary[],
    availableCustomSummaries: CustomGeneratedSummary[]
  ): {
    summary: GeneratedSummary | CustomGeneratedSummary | null;
    type: 'default' | 'custom';
  } => {
    // 1. 選択キャラクターの最新カスタム要約を探す
    if (selectedCharacter && availableCustomSummaries.length > 0) {
      const characterCustomSummaries = availableCustomSummaries
        .filter(s => s.character_role === selectedCharacter && 
                     !s.llm_abst?.startsWith("[PLACEHOLDER]") && 
                     !s.llm_abst?.startsWith("[PROCESSING"))
        .sort((a, b) => b.id - a.id);
      
      if (characterCustomSummaries.length > 0) {
        return { summary: characterCustomSummaries[0], type: 'custom' };
      }
    }

    // 2. 選択キャラクターの最新デフォルト要約を探す
    if (selectedCharacter && availableSummaries.length > 0) {
      const characterDefaultSummaries = availableSummaries
        .filter(s => s.character_role === selectedCharacter && 
                     !s.llm_abst?.startsWith("[PLACEHOLDER]") && 
                     !s.llm_abst?.startsWith("[PROCESSING"))
        .sort((a, b) => b.id - a.id);
      
      if (characterDefaultSummaries.length > 0) {
        return { summary: characterDefaultSummaries[0], type: 'default' };
      }
    }

    // 3. キャラクターなし（character_roleがnull/未設定）のカスタム要約を探す
    if (availableCustomSummaries.length > 0) {
      const characterlessCustomSummaries = availableCustomSummaries
        .filter(s => !s.character_role && // キャラクターなしを優先
                     !s.llm_abst?.startsWith("[PLACEHOLDER]") && 
                     !s.llm_abst?.startsWith("[PROCESSING"))
        .sort((a, b) => b.id - a.id);
      
      if (characterlessCustomSummaries.length > 0) {
        return { summary: characterlessCustomSummaries[0], type: 'custom' };
      }
    }

    // 4. キャラクターなし（character_roleがnull/未設定）のデフォルト要約を探す
    if (availableSummaries.length > 0) {
      const characterlessDefaultSummaries = availableSummaries
        .filter(s => !s.character_role && // キャラクターなしを優先
                     !s.llm_abst?.startsWith("[PLACEHOLDER]") && 
                     !s.llm_abst?.startsWith("[PROCESSING"))
        .sort((a, b) => b.id - a.id);
      
      if (characterlessDefaultSummaries.length > 0) {
        return { summary: characterlessDefaultSummaries[0], type: 'default' };
      }
    }

    // 5. 最後の手段：選択キャラクター以外の任意のキャラクターのカスタム要約を探す
    if (availableCustomSummaries.length > 0) {
      const otherCharacterCustomSummaries = availableCustomSummaries
        .filter(s => s.character_role && // キャラクター設定あり
                     s.character_role !== selectedCharacter && // 選択キャラクター以外
                     !s.llm_abst?.startsWith("[PLACEHOLDER]") && 
                     !s.llm_abst?.startsWith("[PROCESSING"))
        .sort((a, b) => b.id - a.id);
      
      if (otherCharacterCustomSummaries.length > 0) {
        return { summary: otherCharacterCustomSummaries[0], type: 'custom' };
      }
    }

    // 6. 最後の手段：選択キャラクター以外の任意のキャラクターのデフォルト要約を探す
    if (availableSummaries.length > 0) {
      const otherCharacterDefaultSummaries = availableSummaries
        .filter(s => s.character_role && // キャラクター設定あり
                     s.character_role !== selectedCharacter && // 選択キャラクター以外
                     !s.llm_abst?.startsWith("[PLACEHOLDER]") && 
                     !s.llm_abst?.startsWith("[PROCESSING"))
        .sort((a, b) => b.id - a.id);
      
      if (otherCharacterDefaultSummaries.length > 0) {
        return { summary: otherCharacterDefaultSummaries[0], type: 'default' };
      }
    }

    return { summary: null, type: 'default' };
  }, []);

  // バックグラウンドでの要約選択更新
  const updateSummarySelectionInBackground = useCallback(async (
    summaryId: number,
    summaryType: 'default' | 'custom'
  ) => {
    try {
      const updatePayload = summaryType === 'custom' 
        ? { selected_custom_generated_summary_id: summaryId, selected_generated_summary_id: null }
        : { selected_generated_summary_id: summaryId, selected_custom_generated_summary_id: null };

      await authenticatedFetch(`${BACK}/papers/${userPaperLinkId}`, {
        method: "PUT",
        body: JSON.stringify(updatePayload),
      });

      // 更新完了後、データを再取得
      mutate();
      
      // 一覧ページのキャッシュもクリア
      await globalMutate(
        (key) => typeof key === 'string' && key.includes('/papers?'),
        undefined,
        { revalidate: true }
      );
    } catch (error) {
      console.error("Failed to update summary selection in background:", error);
    }
  }, [userPaperLinkId, mutate]);

  useEffect(() => {
    if (paper) {
      // memoStateの設定を削除（OptimizedMemoTextareaが管理）
      
      let textToSetForSummary = "";
      let newCurrentlyDisplayedSummary: GeneratedSummary | null = null;
      let newCurrentlyDisplayedCustomSummary: CustomGeneratedSummary | null = null;
      let newSelectedSummaryId: string | undefined = undefined;
      let newUserEditedSummary: EditedSummary | null = null;
      let newSummaryType: 'default' | 'custom' = 'default';
      let needsBackgroundUpdate = false;

      // キャラクター整合性チェック
      const selectedCharacter = currentUser?.selected_character ?? null;
      let currentSelectedSummary: GeneratedSummary | CustomGeneratedSummary | null = null;
      
      if (paper.selected_custom_generated_summary) {
        currentSelectedSummary = paper.selected_custom_generated_summary;
      } else if (paper.selected_generated_summary) {
        currentSelectedSummary = paper.selected_generated_summary;
      }

      // 整合性チェック：現在選択されている要約がユーザーの選択キャラクターと一致するか
      const isConsistent = checkCharacterConsistency(currentSelectedSummary, selectedCharacter);

      if (!isConsistent && currentSelectedSummary) {
        console.log("Character inconsistency detected, finding best matching summary...");
        
        // 不整合の場合、最適な要約を自動選択
        const bestMatch = findBestSummary(
          selectedCharacter,
          paper.available_summaries || [],
          paper.available_custom_summaries || []
        );

        if (bestMatch.summary) {
          needsBackgroundUpdate = true;
          
          if (bestMatch.type === 'custom') {
            const customSummary = bestMatch.summary as CustomGeneratedSummary;
            newCurrentlyDisplayedCustomSummary = customSummary;
            newSelectedSummaryId = `custom_${customSummary.id}`;
            newSummaryType = 'custom';
            
            // バックグラウンドで更新
            updateSummarySelectionInBackground(customSummary.id, 'custom');
          } else {
            const defaultSummary = bestMatch.summary as GeneratedSummary;
            newCurrentlyDisplayedSummary = defaultSummary;
            newSelectedSummaryId = `default_${defaultSummary.id}`;
            newSummaryType = 'default';
            
            // バックグラウンドで更新
            updateSummarySelectionInBackground(defaultSummary.id, 'default');
          }
          
          newUserEditedSummary = paper.user_edited_summary || null;
          textToSetForSummary = newUserEditedSummary?.edited_llm_abst || bestMatch.summary.llm_abst || "";
        }
      }

      // 整合性に問題がない場合、または自動選択できなかった場合は従来のロジック
      if (!needsBackgroundUpdate) {
        // カスタム要約が選択されている場合を優先
        if (paper.selected_custom_generated_summary) {
          newCurrentlyDisplayedCustomSummary = paper.selected_custom_generated_summary;
          newSelectedSummaryId = `custom_${paper.selected_custom_generated_summary.id}`;
          newUserEditedSummary = paper.user_edited_summary || null;
          newSummaryType = 'custom';
          textToSetForSummary = newUserEditedSummary?.edited_llm_abst || newCurrentlyDisplayedCustomSummary?.llm_abst || "";
        } 
        // デフォルト要約が選択されている場合
        else if (paper.selected_generated_summary) {
          newCurrentlyDisplayedSummary = paper.selected_generated_summary;
          newSelectedSummaryId = `default_${paper.selected_generated_summary.id}`;
          newUserEditedSummary = paper.user_edited_summary || null;
          newSummaryType = 'default';
          textToSetForSummary = newUserEditedSummary?.edited_llm_abst || newCurrentlyDisplayedSummary?.llm_abst || "";
        } 
        // 利用可能なカスタム要約がある場合（優先）
        else if (paper.available_custom_summaries && paper.available_custom_summaries.length > 0) {
          const sortedCustomSummaries = [...paper.available_custom_summaries].sort((a,b) => b.id - a.id);
          const firstCustomSummary = sortedCustomSummaries[0];
          newCurrentlyDisplayedCustomSummary = firstCustomSummary;
          newSelectedSummaryId = `custom_${firstCustomSummary.id}`;
          newUserEditedSummary = null;
          newSummaryType = 'custom';
          textToSetForSummary = firstCustomSummary?.llm_abst || "";
        }
        // 利用可能なデフォルト要約がある場合
        else if (paper.available_summaries && paper.available_summaries.length > 0) {
          const sortedSummaries = [...paper.available_summaries].sort((a,b) => b.id - a.id);
          const firstSummary = sortedSummaries[0];
          newCurrentlyDisplayedSummary = firstSummary;
          newSelectedSummaryId = `default_${firstSummary.id}`;
          newUserEditedSummary = null;
          newSummaryType = 'default';
          textToSetForSummary = firstSummary?.llm_abst || "";
        } else {
          newCurrentlyDisplayedSummary = null;
          newCurrentlyDisplayedCustomSummary = null;
          newSelectedSummaryId = undefined;
          newUserEditedSummary = null;
          newSummaryType = 'default';
          textToSetForSummary = "";
        }
      }

      setCurrentlyDisplayedSummary(newCurrentlyDisplayedSummary);
      setCurrentlyDisplayedCustomSummary(newCurrentlyDisplayedCustomSummary);
      setSelectedSummaryIdForDropdown(newSelectedSummaryId);
      setSummaryType(newSummaryType);
      setUserEditedSummaryForDisplay(newUserEditedSummary);
      setShowOriginalSummary(false); // 新しい要約を読み込む時は編集済みを表示する設定にリセット

      if (!isEditingSummary) {
        setEditedSummaryText(textToSetForSummary);
        setOriginalEditedSummaryText(textToSetForSummary);
      }
    }
    
    // body overflow は一度だけ設定
    const orig = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = orig; };
  }, [paper, isEditingSummary, currentUser, checkCharacterConsistency, findBestSummary, updateSummarySelectionInBackground]);

  const summaryToDisplay = showOriginalSummary 
    ? (summaryType === 'custom' ? currentlyDisplayedCustomSummary?.llm_abst : currentlyDisplayedSummary?.llm_abst)
    : (userEditedSummaryForDisplay?.edited_llm_abst || 
       (summaryType === 'custom' ? currentlyDisplayedCustomSummary?.llm_abst : currentlyDisplayedSummary?.llm_abst));

  // 現在表示中の要約の情報をInfoCardに渡すための計算（軽量化）
  const currentSummaryInfo = useMemo(() => {
    const isDisplayingEditedSummary = !showOriginalSummary && !!userEditedSummaryForDisplay?.edited_llm_abst;
    const currentSummary = summaryType === 'custom' ? currentlyDisplayedCustomSummary : currentlyDisplayedSummary;
    
    if (isDisplayingEditedSummary && currentSummary) {
      const onePointFromEdited = extractSummarySection(userEditedSummaryForDisplay.edited_llm_abst);
      
      return {
        llm_provider: currentSummary.llm_provider,
        llm_model_name: currentSummary.llm_model_name,
        one_point: onePointFromEdited,
        isEdited: true,
        summaryType: summaryType,
        systemPromptName: summaryType === 'custom' ? currentlyDisplayedCustomSummary?.system_prompt_name : undefined
      };
    } else if (currentSummary) {
      return {
        llm_provider: currentSummary.llm_provider,
        llm_model_name: currentSummary.llm_model_name,
        one_point: currentSummary.one_point ?? null,
        isEdited: false,
        summaryType: summaryType,
        systemPromptName: summaryType === 'custom' ? currentlyDisplayedCustomSummary?.system_prompt_name : undefined
      };
    }
    
    return null;
  }, [userEditedSummaryForDisplay?.edited_llm_abst, currentlyDisplayedSummary, currentlyDisplayedCustomSummary, summaryType, showOriginalSummary]);

  // 「別モデルで要約生成」ボタンの表示判定（軽量化）
  const shouldShowModel = useMemo(() => {
    const currentSummary = summaryType === 'custom' ? currentlyDisplayedCustomSummary : currentlyDisplayedSummary;
    if (!currentSummary) return false;
    
    // PLACEHOLDER: 現在は使用されない（カスタム/デフォルト分離により廃止）
    // PROCESSING: デフォルト要約の重複実行防止中の状態（現在も使用）
    const isPlaceholder = currentSummary.llm_abst?.startsWith('[PLACEHOLDER]');
    const isProcessing = currentSummary.llm_abst?.startsWith('[PROCESSING');
    const hasUserEditedSummary = currentSummary.has_user_edited_summary || false;
    
    return (!isPlaceholder && !isProcessing) || hasUserEditedSummary;
  }, [currentlyDisplayedSummary, currentlyDisplayedCustomSummary, summaryType]);

  // 好感度レベルによるフィルタリング関数
  const isAffinityAllowed = useCallback((characterRole?: string, affinityLevel?: number) => {
    if (!characterRole || affinityLevel === undefined) return true; // キャラクター情報がない場合は表示
    
    if (!currentUser) return true; // ユーザー情報が取得できない場合は表示
    
    const userAffinityLevel = characterRole === 'sakura' 
      ? currentUser.sakura_affinity_level 
      : characterRole === 'miyuki' 
        ? currentUser.miyuki_affinity_level 
        : 4; // 不明なキャラクターの場合は最大レベルを許可
    
    return affinityLevel <= userAffinityLevel;
  }, [currentUser]);

  // キャラクター選択によるフィルタリング関数
  const isCharacterAllowed = useCallback((characterRole?: string) => {
    if (!characterRole) return true; // キャラクター情報がない場合は表示
    
    if (!currentUser || !currentUser.selected_character) return true; // 選択キャラクターがない場合は全て表示
    
    return characterRole === currentUser.selected_character;
  }, [currentUser]);

  // プルダウン用の要約リスト（軽量化）- デフォルトとカスタムを統合
  const availableSummariesForDropdown = useMemo(() => {
    const summaryOptions: Array<{
      id: string;
      llm_provider: string;
      llm_model_name: string;
      llm_abst: string;
      has_user_edited_summary: boolean;
      created_at: string;
      type: 'default' | 'custom';
      system_prompt_name?: string;
      character_role?: string;
      affinity_level?: number;
      disabled?: boolean; // 非活性項目フラグ
      disabled_reason?: string; // 非活性理由
    }> = [];

    // デフォルト要約を追加
    if (paper?.available_summaries) {
      paper.available_summaries
        .filter(summary => {
          // PLACEHOLDER: 現在は使用されない（カスタム/デフォルト分離により廃止）
          // PROCESSING: デフォルト要約の重複実行防止中の状態（現在も使用）
          const isPlaceholder = summary.llm_abst?.startsWith("[PLACEHOLDER]");
          const isProcessing = summary.llm_abst?.startsWith("[PROCESSING");
          const hasUserEditedSummary = summary.has_user_edited_summary || false;
          const isValidSummary = (!isPlaceholder && !isProcessing) || hasUserEditedSummary;
          
          // 好感度レベルによるフィルタリング
          const isAffinityOk = isAffinityAllowed(summary.character_role, summary.affinity_level);
          
          return isValidSummary && isAffinityOk;
        })
        .forEach(summary => {
          // キャラクター選択によるフィルタリング
          const isCharacterOk = isCharacterAllowed(summary.character_role);
          
          // 非活性理由を決定
          let disabled = false;
          let disabled_reason = '';
          
          if (!isCharacterOk) {
            disabled = true;
            const characterName = summary.character_role === 'sakura' ? 'さくら' : 
                                 summary.character_role === 'miyuki' ? 'みゆき' : summary.character_role;
            disabled_reason = `${characterName}を選択していません`;
          }
          
          summaryOptions.push({
            id: `default_${summary.id}`,
            llm_provider: summary.llm_provider,
            llm_model_name: summary.llm_model_name,
            llm_abst: summary.llm_abst,
            has_user_edited_summary: summary.has_user_edited_summary || false,
            created_at: summary.created_at,
            type: 'default',
            character_role: summary.character_role,
            affinity_level: summary.affinity_level,
            disabled,
            disabled_reason
          });
        });
    }

    // カスタム要約を追加
    if (paper?.available_custom_summaries) {
      paper.available_custom_summaries
        .filter(summary => {
          const isPlaceholder = summary.llm_abst?.startsWith("[PLACEHOLDER]");
          const isProcessing = summary.llm_abst?.startsWith("[PROCESSING");
          const hasUserEditedSummary = summary.has_user_edited_summary || false;
          const isValidSummary = (!isPlaceholder && !isProcessing) || hasUserEditedSummary;
          
          // 好感度レベルによるフィルタリング
          const isAffinityOk = isAffinityAllowed(summary.character_role, summary.affinity_level);
          
          return isValidSummary && isAffinityOk;
        })
        .forEach(summary => {
          // キャラクター選択によるフィルタリング
          const isCharacterOk = isCharacterAllowed(summary.character_role);
          
          // 非活性理由を決定
          let disabled = false;
          let disabled_reason = '';
          
          if (!isCharacterOk) {
            disabled = true;
            const characterName = summary.character_role === 'sakura' ? 'さくら' : 
                                 summary.character_role === 'miyuki' ? 'みゆき' : summary.character_role;
            disabled_reason = `${characterName}を選択していません`;
          }
          
          summaryOptions.push({
            id: `custom_${summary.id}`,
            llm_provider: summary.llm_provider,
            llm_model_name: summary.llm_model_name,
            llm_abst: summary.llm_abst,
            has_user_edited_summary: summary.has_user_edited_summary || false,
            created_at: summary.created_at,
            type: 'custom',
            system_prompt_name: summary.system_prompt_name,
            character_role: summary.character_role,
            affinity_level: summary.affinity_level,
            disabled,
            disabled_reason
          });
        });
    }

    // 作成日時で降順ソート
    return summaryOptions.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [paper?.available_summaries, paper?.available_custom_summaries, isAffinityAllowed, isCharacterAllowed]);

  // Markdownレンダリングを軽量化（条件付きレンダリング）
  const renderedSummaryMarkdown = useMemo(() => {
    const textToRender = isEditingSummary && isPreviewing ? editedSummaryText : summaryToDisplay;
    if (!textToRender && !(isEditingSummary && isPreviewing)) return null;
    
    return <MemoizedMarkdown>{textToRender || ""}</MemoizedMarkdown>;
  }, [summaryToDisplay, isEditingSummary, isPreviewing, editedSummaryText]);

  const previousPathnameRef = useRef(pathname);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isEditingSummary && editedSummaryText !== originalEditedSummaryText) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isEditingSummary, editedSummaryText, originalEditedSummaryText]);

  useEffect(() => {
    if (nextPath && nextPath !== pathname) {
      return;
    }
    if (nextPath && nextPath === pathname) {
      setNextPath(null);
    }

    if (
      previousPathnameRef.current !== pathname &&
      !nextPath && 
      isEditingSummary &&
      editedSummaryText !== originalEditedSummaryText
    ) {
      setNextPath(pathname); 
      setShowLeaveConfirmDialog(true);
      router.replace(previousPathnameRef.current); 
    } else {
      previousPathnameRef.current = pathname;
    }
  }, [pathname, router, isEditingSummary, editedSummaryText, originalEditedSummaryText, nextPath]);

  const handleAttemptNavigation = useCallback((targetPath: string, e?: React.MouseEvent<HTMLAnchorElement, MouseEvent>): boolean => {
    if (isEditingSummary && editedSummaryText !== originalEditedSummaryText) {
      if (e) e.preventDefault();
      setNextPath(targetPath);
      setShowLeaveConfirmDialog(true);
      return false;
    }
    previousPathnameRef.current = targetPath;
    return true;
  }, [isEditingSummary, editedSummaryText, originalEditedSummaryText]);

  const proceedNavigation = useCallback(() => {
    if (nextPath) {
      setIsEditingSummary(false);
      setIsPreviewing(false);
      setShowLeaveConfirmDialog(false);
      const targetPath = nextPath;
      setNextPath(null);
      previousPathnameRef.current = targetPath;
      router.push(targetPath);
    }
  }, [nextPath, router]);

  const cancelNavigation = useCallback(() => {
    setShowLeaveConfirmDialog(false);
    setNextPath(null);
  }, []);

  // currentPaperTagsを軽量化
  const currentPaperTags = useMemo(() => {
    return (paper?.user_specific_data.tags ?? "").split(",").filter(Boolean);
  }, [paper?.user_specific_data.tags]);

// API呼び出し関数群（メモ化）- saveMemo関数の修正版
const saveMemo = useCallback(async (memoValue: string) => {
  try {
    const res = await authenticatedFetch(`${BACK}/papers/${userPaperLinkId}`, {
      method: "PUT",
      body: JSON.stringify({ memo: memoValue }),
    });
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to save memo: ${res.status} ${errorText}`);
    }
    
    // mutateを呼ぶ際に、現在のデータを保持しつつ、memoだけを更新
    await mutate(
      (currentData) => {
        if (!currentData) return currentData;
        return {
          ...currentData,
          user_specific_data: {
            ...currentData.user_specific_data,
            memo: memoValue
          }
        };
      },
      {
        revalidate: false // 即座にサーバーから再取得しない
      }
    );
    
  } catch(error: unknown) {
    console.error("Error saving memo:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    alert(`メモ保存に失敗しました: ${errorMessage}`);
    // エラー時は再取得して最新状態を反映
    mutate();
  }
}, [userPaperLinkId, mutate]);

  const toggleTag = useCallback(async (tag: string) => {
    const originalTags = paper?.user_specific_data.tags ?? "";
    const tags = new Set(originalTags.split(",").filter(Boolean));
    
    if (tags.has(tag)) {
      tags.delete(tag);
    } else {
      tags.add(tag);
    }
    const newTagsString = Array.from(tags).join(",");

    mutate(
      (currentData) => {
        if (!currentData) return currentData;
        return {
          ...currentData,
          user_specific_data: {
            ...currentData.user_specific_data,
            tags: newTagsString,
          },
        };
      },
      { revalidate: false }
    );

    try {
      const res = await authenticatedFetch(`${BACK}/papers/${userPaperLinkId}`, {
        method: "PUT",
        body: JSON.stringify({ tags: newTagsString }),
      });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to toggle tag: ${res.status} ${errorText}`);
      }
      mutate();
    } catch (error: unknown) {
      console.error("Error toggling tag:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      alert(`タグの更新に失敗しました: ${errorMessage}`);
      mutate(
        (currentData) => {
          if (!currentData) return currentData;
          return {
            ...currentData,
            user_specific_data: {
              ...currentData.user_specific_data,
              tags: originalTags,
            },
          };
        },
        { revalidate: false }
      );
    }
  }, [paper?.user_specific_data.tags, userPaperLinkId, mutate]);

  const handleAddTag = useCallback(async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const inputEl = e.currentTarget;
    const newTags = inputEl.value.split(",").map((s) => s.trim()).filter(Boolean);
    if (newTags.length === 0) return;

    const originalTags = paper?.user_specific_data.tags ?? "";
    const existing = new Set(originalTags.split(",").filter(Boolean));
    
    let changed = false;
    newTags.forEach((tag) => {
      if (!existing.has(tag)) {
        existing.add(tag);
        changed = true;
      }
    });

    if (!changed) {
      inputEl.value = "";
      return;
    }

    const newTagsString = Array.from(existing).join(",");
    
    mutate(
      (currentData) => {
        if (!currentData) return currentData;
        return {
          ...currentData,
          user_specific_data: {
            ...currentData.user_specific_data,
            tags: newTagsString,
          },
        };
      },
      { revalidate: false }
    );

    inputEl.value = "";

    try {
      const res = await authenticatedFetch(`${BACK}/papers/${userPaperLinkId}`, {
        method: "PUT",
        body: JSON.stringify({ tags: newTagsString }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to add tag: ${res.status} ${errorText}`);
      }
      mutate();
    } catch (error: unknown) {
      console.error("Error adding tag:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      alert(`タグの追加に失敗しました: ${errorMessage}`);
      mutate(
        (currentData) => {
          if (!currentData) return currentData;
          return {
            ...currentData,
            user_specific_data: {
              ...currentData.user_specific_data,
              tags: originalTags,
            },
          };
        },
        { revalidate: false }
      );
    }
  }, [paper?.user_specific_data.tags, userPaperLinkId, mutate]);

  const handleDeletePaper = useCallback(async () => {
    if (isEditingSummary && editedSummaryText !== originalEditedSummaryText) {
      if (!confirm("編集中の要約があります。破棄して論文を削除しますか？")) {
        return;
      }
      setIsEditingSummary(false);
      setIsPreviewing(false);
    } else {
      if (!confirm("本当にこの論文リンクをあなたのライブラリから削除しますか？")) return;
    }

    setIsDeletingPaper(true); // ローディング開始

    try {
      const res = await authenticatedFetch(`${BACK}/papers/${userPaperLinkId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        previousPathnameRef.current = "/papers"; 
        router.push("/papers");
      } else {
        const errorText = await res.text();
        alert(`削除に失敗しました: ${res.status} ${errorText}`);
      }
    } catch(error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      alert(`削除に失敗しました: ${errorMessage}`);
    } finally {
      setIsDeletingPaper(false); // ローディング終了
    }
  }, [userPaperLinkId, router, isEditingSummary, editedSummaryText, originalEditedSummaryText]);

  const handleSummarySelectionChange = useCallback(async (summaryId: string) => {
    if (isEditingSummary && editedSummaryText !== originalEditedSummaryText) {
      setNextPath(pathname);
      setShowLeaveConfirmDialog(true);
      const currentId = summaryType === 'custom' 
        ? `custom_${currentlyDisplayedCustomSummary?.id}` 
        : `default_${currentlyDisplayedSummary?.id}`;
      setSelectedSummaryIdForDropdown(currentId);
      return;
    }

    const [type, idStr] = summaryId.split('_');
    const newSelectedId = parseInt(idStr, 10);
    
    setIsChangingSummary(true); // ローディング開始
    
    try {
      let updatePayload: { 
        selected_generated_summary_id?: number | null;
        selected_custom_generated_summary_id?: number | null;
      } = {};
      
      if (type === 'default') {
        updatePayload = { 
          selected_generated_summary_id: newSelectedId,
          selected_custom_generated_summary_id: null 
        };
      } else if (type === 'custom') {
        updatePayload = { 
          selected_generated_summary_id: null,
          selected_custom_generated_summary_id: newSelectedId 
        };
      }
      
      const res = await authenticatedFetch(`${BACK}/papers/${userPaperLinkId}`, {
        method: "PUT",
        body: JSON.stringify(updatePayload),
      });
      
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to save summary selection: ${res.status} ${errorText}`);
      }
      
      await mutate(); 
      
      // 一覧ページのキャッシュもクリア
      await globalMutate(
        (key) => typeof key === 'string' && key.includes('/papers?'),
        undefined,
        { revalidate: true }
      );
      
      setIsPreviewing(false); 
    } catch(error: unknown) {
      console.error("Error saving summary selection:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      alert(`要約の選択保存に失敗しました: ${errorMessage}`);
    } finally {
      setIsChangingSummary(false); // ローディング終了
    }
  }, [userPaperLinkId, mutate, isEditingSummary, editedSummaryText, originalEditedSummaryText, pathname, currentlyDisplayedSummary?.id, currentlyDisplayedCustomSummary?.id, summaryType]);

  const handleRegenerateSummary = useCallback(async () => {
    if (isEditingSummary && editedSummaryText !== originalEditedSummaryText) {
      if(!confirm("編集中の内容があります。破棄して新しい要約を生成しますか？")) return;
      setIsEditingSummary(false);
      setIsPreviewing(false);
    }

    if (!paper || !regenerateModelConfig) {
      alert("論文データまたはモデル設定が不十分です。");
      return;
    }
    const currentModelConfig = { ...regenerateModelConfig };
    setIsRegenerating(true);
    setIsRegenerateModalOpen(false);

    try {
      const payload = {
        config_overrides: {
          llm_name: currentModelConfig.provider,
          llm_model_name: currentModelConfig.model,
          rag_llm_temperature: currentModelConfig.temperature,
          rag_llm_top_p: currentModelConfig.top_p,
        },
        prompt_mode: selectedPrompt.type === 'default' ? 'default' : 'prompt_selection',
        selected_prompts: selectedPrompt.type === 'default' 
          ? [{ type: 'default' }] 
          : [{ type: 'custom', system_prompt_id: selectedPrompt.id }],
        create_embeddings: false, // 詳細ページ再生成では埋め込みベクトルを作成しない
        embedding_target: 'default_only' // create_embeddingsがfalseなので実際には使用されない
      };

      const res = await authenticatedFetch(`${BACK}/papers/${userPaperLinkId}/regenerate_summary`, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ detail: "Unknown error during summary regeneration." }));
        throw new Error(errorData.detail || `Failed to regenerate summary: ${res.status}`);
      }
      
      await mutate();
      
      // 一覧ページのキャッシュもクリア（新しい要約が生成されたため）
      await globalMutate(
        (key) => typeof key === 'string' && key.includes('/papers?'),
        undefined,
        { revalidate: true }
      );

    } catch (error: unknown) {
      console.error("Error regenerating summary:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      alert(`要約の再生成に失敗しました: ${errorMessage}`);
    } finally {
      setIsRegenerating(false);
    }
  }, [paper, regenerateModelConfig, userPaperLinkId, mutate, isEditingSummary, editedSummaryText, originalEditedSummaryText, selectedPrompt]);

  const handleEditSummary = useCallback(() => {
    if (mainContentScrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = mainContentScrollRef.current;
      let ratio = 0;
      if (scrollHeight > clientHeight && clientHeight > 0) {
        ratio = scrollTop / (scrollHeight - clientHeight);
      }
      scrollRatioToRestoreRef.current = ratio;
      editingStartScrollRatioRef.current = ratio; 
    } else {
      scrollRatioToRestoreRef.current = null;
      editingStartScrollRatioRef.current = null;
    }

    const currentSummary = summaryType === 'custom' ? currentlyDisplayedCustomSummary : currentlyDisplayedSummary;
    const currentTextToEdit = userEditedSummaryForDisplay?.edited_llm_abst || currentSummary?.llm_abst || "";
    setOriginalEditedSummaryText(currentTextToEdit);
    setEditedSummaryText(currentTextToEdit);
    setIsEditingSummary(true);
    setIsPreviewing(false);
  }, [userEditedSummaryForDisplay, summaryType, currentlyDisplayedCustomSummary, currentlyDisplayedSummary]);

  const handleTogglePreview = useCallback(() => {
    if (mainContentScrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = mainContentScrollRef.current;
      if (scrollHeight > clientHeight && clientHeight > 0) {
        scrollRatioToRestoreRef.current = scrollTop / (scrollHeight - clientHeight);
      } else {
        scrollRatioToRestoreRef.current = 0;
      }
    }
    setIsPreviewing(prev => !prev);
  }, []);

  useEffect(() => {
    if (mainContentScrollRef.current && scrollRatioToRestoreRef.current !== null) {
      const element = mainContentScrollRef.current;
      requestAnimationFrame(() => { 
        if (element) { 
          const currentScrollHeight = element.scrollHeight;
          const currentClientHeight = element.clientHeight;
          if (currentScrollHeight > currentClientHeight && currentClientHeight > 0) { 
            element.scrollTop = scrollRatioToRestoreRef.current! * (currentScrollHeight - currentClientHeight);
          } else {
            element.scrollTop = 0;
          }
        }
      });
    }
  }, [isPreviewing, isEditingSummary]);

  const handleSaveEditedSummary = useCallback(async (isNavigating: boolean = false) => {
    const currentSummary = summaryType === 'custom' ? currentlyDisplayedCustomSummary : currentlyDisplayedSummary;
    if (!currentSummary || !paper) {
      alert("保存対象の要約が選択されていません。");
      return false;
    }

    let scrollRatioBeforeSave: number | null = null;
    if (mainContentScrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = mainContentScrollRef.current;
      if (scrollHeight > clientHeight && clientHeight > 0) {
        scrollRatioBeforeSave = scrollTop / (scrollHeight - clientHeight);
      } else {
        scrollRatioBeforeSave = 0;
      }
    }

    setIsSavingEditedSummary(true);

    try {
      // APIエンドポイントを要約タイプに応じて決定
      const summaryEndpoint = summaryType === 'custom' 
        ? `${BACK}/papers/${paper.user_paper_link_id}/custom-summaries/${currentSummary.id}/edit`
        : `${BACK}/papers/${paper.user_paper_link_id}/summaries/${currentSummary.id}/edit`;
        
      const res = await authenticatedFetch(summaryEndpoint, {
        method: "PUT",
        body: JSON.stringify({ edited_llm_abst: editedSummaryText }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ detail: "Failed to save edited summary." }));
        throw new Error(errorData.detail || `Error: ${res.status}`);
      }
      await mutate(); 
      
      scrollRatioToRestoreRef.current = scrollRatioBeforeSave;
      setOriginalEditedSummaryText(editedSummaryText); 
      setIsEditingSummary(false); 
      setIsPreviewing(false);

      if (isNavigating && nextPath) {
        proceedNavigation();
      }
      return true;
    } catch (error: unknown) {
      console.error("Error saving edited summary:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      alert(`編集済み要約の保存に失敗しました: ${errorMessage}`);
      return false;
    } finally {
      setIsSavingEditedSummary(false);
    }
  }, [currentlyDisplayedSummary, currentlyDisplayedCustomSummary, summaryType, paper, editedSummaryText, mutate, nextPath, proceedNavigation]);

  const handleCancelEditSummary = useCallback(() => {
    if (editedSummaryText !== originalEditedSummaryText) {
      if (!confirm("編集中の内容があります。破棄しますか？")) {
        return;
      }
    }
    
    let scrollRatioBeforeCancel: number | null = null;
    if (mainContentScrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = mainContentScrollRef.current;
      if (scrollHeight > clientHeight && clientHeight > 0) {
        scrollRatioBeforeCancel = scrollTop / (scrollHeight - clientHeight);
      } else {
        scrollRatioBeforeCancel = 0;
      }
    }
    
    scrollRatioToRestoreRef.current = scrollRatioBeforeCancel; 
    setIsEditingSummary(false); 
    setIsPreviewing(false);
    setEditedSummaryText(originalEditedSummaryText); 
  }, [editedSummaryText, originalEditedSummaryText]);

  const handleCopySummary = useCallback(async () => {
    if (summaryToDisplay) {
      try {
        await navigator.clipboard.writeText(summaryToDisplay);
      } catch (err) {
        console.error("Failed to copy summary: ", err);
      }
    }
  }, [summaryToDisplay]);

  const saveAndProceedNavigation = useCallback(async () => {
    await handleSaveEditedSummary(true);
  }, [handleSaveEditedSummary]);

  // Sheet開閉時の処理をラップした関数
  const handleLeftSheetOpenChange = useCallback((isOpen: boolean) => {
    setIsLeftSheetOpen(isOpen);
    onSheetOpenChange(isOpen);
  }, [onSheetOpenChange]);

  const handleRightSheetOpenChange = useCallback((isOpen: boolean) => {
    setIsRightSheetOpen(isOpen);
    onSheetOpenChange(isOpen);
  }, [onSheetOpenChange]);

  // 定数タグ配列をメモ化
  const predefinedTags = useMemo(() => [
    "お気に入り","現時点はそんなに", "興味なし", "理解した", "概要は理解","目を通した", "後で読む","理解できてない","サーベイ論文"
  ], []);

  // ページ全体のローディング
  if (isLoading) {
    return (
      <main className="flex h-screen overflow-hidden bg-background">
        <style jsx global>{`
          .katex-display {
            overflow-x: auto;
            overflow-y: hidden;
            max-width: 100%;
            padding: 0.5rem 0;
          }
          .katex {
            font-size: 1em;
          }
        `}</style>
        
        <div className="flex-1 flex flex-col overflow-auto bg-background">
          <div className="flex justify-between items-center p-4 border-b border-border bg-card">
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 w-24" />
              <Skeleton className="h-9 w-24" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 w-24" />
              <Skeleton className="h-9 w-32" />
            </div>
          </div>
          
          <div className="p-4 space-y-6 overflow-y-auto flex-1">
            <InfoCardSkeleton />
            <MemoSkeleton />
            <SummarySkeleton />
            <div className="flex gap-2 mt-8">
              <Skeleton className="h-10 w-40" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (isError || !paper) {
    return (
      <p className="p-6 text-destructive">
        データ取得に失敗しました。
        <button onClick={() => mutate()} className="underline ml-2">
          再読込
        </button>
      </p>
    );
  }

  return (
    <main className="flex h-screen overflow-hidden bg-background">
      {/* 
        重要: 以下のviewport metaタグをapp/layout.tsxやpages/_document.tsxに追加してください:
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
      */}
      <style jsx global>{`
        .katex-display {
          overflow-x: auto;
          overflow-y: hidden;
          max-width: 100%;
          padding: 0.5rem 0;
        }
        .katex {
          font-size: 1em;
        }
        /* iOS Safari のキーボード問題対策 */
        @supports (-webkit-touch-callout: none) {
          .sheet-content input,
          .sheet-content textarea {
            font-size: 16px; /* iOS でズームを防ぐ */
          }
        }
        
        /* チャットサイドバー用の横スクロール対応 */
        .chat-message-content {
          overflow-x: auto;
          word-wrap: break-word;
          word-break: break-word;
        }
        
        /* 数式の横スクロール制御 - チャット用 */
        .chat-message-content .katex-display {
          overflow-x: auto;
          overflow-y: hidden;
          max-width: 75vw; /* モバイル: ビューポート幅の75% */
          padding: 0.5rem 0;
          margin: 0.5rem 0;
        }
        
        /* タブレット以上の数式 - チャット用 */
        @media (min-width: 768px) {
          .chat-message-content .katex-display {
            max-width: min(35vw, 300px);
          }
        }
        
        /* デスクトップ以上の数式 - チャット用 */
        @media (min-width: 1024px) {
          .chat-message-content .katex-display {
            max-width: min(30vw, 350px);
          }
        }
        
        /* 大画面以上の数式 - チャット用 */
        @media (min-width: 1440px) {
          .chat-message-content .katex-display {
            max-width: min(25vw, 400px);
          }
        }
        
        /* コードブロックの横スクロール制御 - チャット用 */
        .chat-message-content pre {
          overflow-x: auto;
          max-width: 75vw; /* モバイル: ビューポート幅の75% */
          white-space: pre;
          word-wrap: normal;
          word-break: normal;
          margin: 0.5rem 0;
          padding: 0.75rem;
          border-radius: 0.375rem;
          background-color: #1a1a1a; /* ダークな背景 */
          color: #f0f0f0; /* 明るい文字 */
          font-size: 0.875rem;
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
        }
        
        /* タブレット以上のコードブロック - チャット用 */
        @media (min-width: 768px) {
          .chat-message-content pre {
            max-width: min(35vw, 300px);
          }
        }
        
        /* デスクトップ以上のコードブロック - チャット用 */
        @media (min-width: 1024px) {
          .chat-message-content pre {
            max-width: min(30vw, 350px);
          }
        }
        
        /* 大画面以上のコードブロック - チャット用 */
        @media (min-width: 1440px) {
          .chat-message-content pre {
            max-width: min(25vw, 400px);
          }
        }
        
        /* ダークモード用のコードブロック - チャット用 */
        .dark .chat-message-content pre {
          background-color: #0d1117; /* ダークモードではより深い黒 */
          color: #f0f6fc; /* ダークモード用の明るい文字 */
        }
        
        /* インラインコードの制御 - チャット用 */
        .chat-message-content code:not(pre code) {
          max-width: 100%;
          display: inline-block;
          overflow-x: auto;
          word-break: break-all;
          padding: 0.125rem 0.25rem;
          background-color: rgba(226, 232, 240, 0.4); /* ライトモードでも少し暗い背景 */
          color: #c71585; /* 明るい文字 */
          border-radius: 0.25rem;
          font-size: 0.875rem;
          font-weight: normal; /* 太字を解除 */
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          vertical-align: -0.4em; 
        }
      
        
        /* ダークモード用のインラインコード - チャット用 */
        .dark .chat-message-content code:not(pre code) {
          background-color: rgba(226, 232, 240, 0.08);
          color: #ff7f50;
        }
        
        /* 長いリンクの制御 - チャット用 */
        .chat-message-content a {
          word-break: break-all;
          overflow-wrap: break-word;
          max-width: 100%;
          display: inline-block;
        }
        
        /* テーブルの横スクロール制御 - チャット用 */
        .chat-message-content table {
          overflow-x: auto;
          display: block;
          white-space: nowrap;
          max-width: 75vw; /* モバイル: ビューポート幅の75% */
        }
        
        /* タブレット以上のテーブル - チャット用 */
        @media (min-width: 768px) {
          .chat-message-content table {
            max-width: min(35vw, 300px);
          }
        }
        
        /* デスクトップ以上のテーブル - チャット用 */
        @media (min-width: 1024px) {
          .chat-message-content table {
            max-width: min(30vw, 350px);
          }
        }
        
        /* 大画面以上のテーブル - チャット用 */
        @media (min-width: 1440px) {
          .chat-message-content table {
            max-width: min(25vw, 400px);
          }
        }
        
        /* 画像の制御 - チャット用 */
        .chat-message-content img {
          max-width: 100%;
          height: auto;
        }
      `}</style>
      
      {/* デスクトップ左サイドバー */}
      {!isMobile && isLeftOpen && (
        <aside
          className="h-full flex-shrink-0 bg-card flex flex-col"
          style={{ width: leftWidth }}
        >
          <div className="flex justify-start p-2 shrink-0 bg-card">
            <Button variant="ghost" size="sm" onClick={() => setIsLeftOpen(false)}>
              設定バーを隠す
            </Button>
          </div>
          <LeftSidebarContent 
            memoInitialValue={memoInitialValue}
            onMemoSave={saveMemo}
            currentPaperTags={currentPaperTags}
            predefinedTags={predefinedTags}
            onTagClick={toggleTag}
            onAddTag={handleAddTag}
            setChatModel={setChatModel}
            selectedChatPrompt={selectedChatPrompt}
            onChatPromptChange={handleChatPromptChange}
            useCharacterPrompt={useCharacterPrompt}
            setUseCharacterPrompt={setUseCharacterPrompt}
          />
        </aside>
      )}

      {/* デスクトップリサイザー */}
      {!isMobile && isLeftOpen && (
        <div
          className="w-1 bg-muted hover:bg-muted-foreground/20 cursor-ew-resize"
          onMouseDown={onMouseDownLeft}
        />
      )}

      {/* メインコンテンツ */}
      <div className="flex-1 flex flex-col overflow-auto bg-background">
        <div className="flex justify-between items-center p-4 border-b border-border bg-card">
          <div className="flex items-center gap-2">
            {isMobile ? (
              <Sheet open={isLeftSheetOpen} onOpenChange={handleLeftSheetOpenChange}>
                <SheetTrigger asChild>
                  <Button size="sm" variant="outline">
                    <Menu className="mr-2 h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-80 sm:w-96 sheet-content">
                  <SheetHeader>
                    <SheetTitle>論文設定</SheetTitle>
                    <SheetDescription>
                      モデル設定、メモ、タグの管理
                    </SheetDescription>
                  </SheetHeader>
                  <div className="mt-4 h-full overflow-y-auto">
                    <LeftSidebarContent 
                      memoInitialValue={memoInitialValue}
                      onMemoSave={saveMemo}
                      currentPaperTags={currentPaperTags}
                      predefinedTags={predefinedTags}
                      onTagClick={toggleTag}
                      onAddTag={handleAddTag}
                      setChatModel={setChatModel}
                      selectedChatPrompt={selectedChatPrompt}
                      onChatPromptChange={handleChatPromptChange}
                      useCharacterPrompt={useCharacterPrompt}
                      setUseCharacterPrompt={setUseCharacterPrompt}
                    />
                  </div>
                </SheetContent>
              </Sheet>
            ) : (
              <Button size="sm" onClick={() => setIsLeftOpen(!isLeftOpen)}>
                {isLeftOpen ? "設定を隠す" : "設定を表示"}
              </Button>
            )}
            
            {isEditingSummary ? (
              <>
                <Button variant="outline" size="sm" onClick={handleTogglePreview} disabled={isSavingEditedSummary}>
                  {isPreviewing ? <Edit3 className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
                  {isMobile
                    ? (isPreviewing ? "" : "")
                    : (isPreviewing ? "編集に戻る" : "プレビュー")}
                </Button>
                <Button size="sm" onClick={() => handleSaveEditedSummary(false)} disabled={isSavingEditedSummary || isPreviewing}>
                  {isSavingEditedSummary ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {isMobile
                    ? (isSavingEditedSummary ? "" : "")
                    : (isSavingEditedSummary ? "保存中..." : "保存")}
                </Button>
                <Button variant="ghost" size="sm" onClick={handleCancelEditSummary} disabled={isSavingEditedSummary}>
                  <XCircle className="mr-2 h-4 w-4" />
                  {isMobile ? "" : "キャンセル"}
                </Button>
              </>
            ) : (
              (currentlyDisplayedSummary || currentlyDisplayedCustomSummary) && (
                <>
                  <Button variant="ghost" size="icon" onClick={handleCopySummary} title="要約をコピー" disabled={isRegenerating || isChangingSummary}>
                    <Copy className="h-4 w-4" />
                    <span className="sr-only">要約をコピー</span>
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleEditSummary} disabled={isRegenerating || isChangingSummary}>
                    <Edit3 className="mr-2 h-4 w-4" />
                    {isMobile ? "" : "編集"}
                  </Button>
                </>
              )
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/" onClick={(e) => { if (!handleAttemptNavigation("/", e)) {} }}>
                <Home className="h-4 w-4" />
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/papers" onClick={(e) => { if (!handleAttemptNavigation("/papers", e)) {} }}>
                <List className="mr-2 h-4 w-4" />
                {isMobile ? "" : "論文一覧"}
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/papers/add" onClick={(e) => { if (!handleAttemptNavigation("/papers/add", e)) {} }}>
                <FilePlus2 className="mr-2 h-4 w-4" />
                {isMobile ? "" : "論文を追加"}
              </Link>
            </Button>
            <ThemeToggle />
            {isMobile ? (
              <Sheet open={isRightSheetOpen} onOpenChange={handleRightSheetOpenChange}>
                <SheetTrigger asChild>
                  <Button size="sm" variant="outline">
                    <MessageSquare className="mr-2 h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-80 sm:w-96 sheet-content">
                  <SheetHeader>
                    <SheetTitle>論文チャット</SheetTitle>
                    <SheetDescription>
                      論文について質問できます
                    </SheetDescription>
                  </SheetHeader>
                  <div className="mt-4 h-full overflow-y-auto">
                    <MemoizedChatSidebar paperId={userPaperLinkId} model={chatModel} selectedPrompt={selectedChatPrompt} useCharacterPrompt={useCharacterPrompt} />
                  </div>
                </SheetContent>
              </Sheet>
            ) : (
              <Button size="sm" onClick={() => setIsRightOpen(!isRightOpen)}>
                {isRightOpen ? "チャットを隠す" : "チャットを表示"}
              </Button>
            )}
          </div>
        </div>
        
        <div ref={mainContentScrollRef} className="p-4 space-y-6 overflow-y-auto flex-1">
          <InfoCard paper={paper} currentSummaryInfo={currentSummaryInfo} />

          {memoInitialValue && (
            <>
              <h3 className="font-semibold text-lg">ユーザメモ</h3>
              <article className="prose dark:prose-invert max-w-[97%] border border-border p-4 rounded-md bg-card overflow-x-auto">
                <MemoizedMarkdown>{memoInitialValue}</MemoizedMarkdown>
              </article>
            </>
          )}

          <section>
            <div className="mb-4">
              <h3 className="font-semibold text-lg mb-2">
                LLM 要約
                {shouldShowModel && (summaryType === 'custom' ? currentlyDisplayedCustomSummary : currentlyDisplayedSummary) && (() => {
                  const currentSummary = summaryType === 'custom' ? currentlyDisplayedCustomSummary : currentlyDisplayedSummary;
                  const modelName = currentSummary?.llm_model_name.includes("::") ? currentSummary.llm_model_name.split("::")[1] : currentSummary?.llm_model_name.split("::")[0];
                  let displayText = ` (${currentSummary?.llm_provider}/${modelName}`;
                  
                  // キャラクター情報を追加
                  if (currentSummary?.character_role) {
                    const characterName = currentSummary.character_role === 'sakura' ? 'さくら' : 
                                        currentSummary.character_role === 'miyuki' ? 'みゆき' : currentSummary.character_role;
                    const affinityLevel = currentSummary.affinity_level || 0;
                    
                    if (affinityLevel === 0) {
                      displayText += ` - ${characterName}`;
                    } else {
                      const hearts = '♥'.repeat(affinityLevel);
                      displayText += ` - ${characterName}${hearts}`;
                    }
                  }
                  
                  displayText += ')';
                  return displayText;
                })()}
                {summaryType === 'custom' && currentlyDisplayedCustomSummary?.system_prompt_name && <Badge variant="default" className="ml-2">Custom:{currentlyDisplayedCustomSummary.system_prompt_name}</Badge>}
                {userEditedSummaryForDisplay && !isEditingSummary && !showOriginalSummary && <Badge variant="outline" className="ml-2">編集済み</Badge>}
                {showOriginalSummary && <Badge variant="secondary" className="ml-2">編集前</Badge>}
                {isEditingSummary && !isPreviewing && <Badge variant="destructive" className="ml-2">編集中</Badge>}
                {isEditingSummary && isPreviewing && <Badge variant="secondary" className="ml-2">プレビュー中</Badge>}
              </h3>
              <div className={isMobile ? "space-y-3" : "flex flex-wrap items-center gap-2"}>
                {availableSummariesForDropdown.length > 0 && (
                  <Select
                    value={selectedSummaryIdForDropdown}
                    onValueChange={handleSummarySelectionChange}
                    disabled={isEditingSummary || isRegenerating || isChangingSummary}
                  >
                    <SelectTrigger className={`${isMobile ? "w-full" : "w-[200px]"} select-enhanced`}>
                      <SelectValue placeholder="表示する要約を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableSummariesForDropdown.map(s => {
                        // キャラクター情報を取得
                        const characterInfo = s.character_role ? (() => {
                          const characterName = s.character_role === 'sakura' ? 'さくら' : 
                                               s.character_role === 'miyuki' ? 'みゆき' : s.character_role;
                          const affinityLevel = s.affinity_level || 0;
                          
                          if (affinityLevel === 0) {
                            return ` - ${characterName}`;
                          } else {
                            const hearts = '♥'.repeat(affinityLevel);
                            return ` - ${characterName}${hearts}`;
                          }
                        })() : '';

                        // モデル名の最適化（プロバイダ削除、モバイル時の省略）
                        const getOptimizedModelName = () => {
                          const modelName = s.llm_model_name.includes("::") ? s.llm_model_name.split("::")[1] : s.llm_model_name.split("::")[0];
                          // モバイル時にモデル名が20文字以上の場合は省略
                          if (isMobile && modelName.length > 20) {
                            return modelName.substring(0, 17) + "...";
                          }
                          return modelName;
                        };

                        return (
                          <SelectItem 
                            key={s.id} 
                            value={s.id}
                            disabled={s.disabled}
                            className={s.disabled ? "text-muted-foreground opacity-60 cursor-not-allowed" : ""}
                          >
                            <div className="flex flex-col w-full">
                              <div className="flex items-center">
                                {getOptimizedModelName()}{characterInfo}
                                {s.type === 'custom' && s.system_prompt_name && <span className="text-blue-600 ml-1">[{s.system_prompt_name}]</span>}
                                {s.type === 'default' && !s.llm_abst?.startsWith("[PLACEHOLDER]") && !s.llm_abst?.startsWith("[PROCESSING") && !s.has_user_edited_summary && <span className="text-muted-foreground ml-1">[デフォルト]</span>}
                                {s.has_user_edited_summary && <span className="text-green-600 ml-1">[編集済み]</span>}
                              </div>
                              {s.disabled && s.disabled_reason && (
                                <div className="text-xs text-muted-foreground mt-1">
                                  {s.disabled_reason}
                                </div>
                              )}
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                )}

                <Dialog open={isRegenerateModalOpen} onOpenChange={setIsRegenerateModalOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" disabled={isRegenerating || isEditingSummary || isChangingSummary} className={`${isMobile ? "w-full" : ""} btn-nav`}>
                      {isRegenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      {isRegenerating ? "生成処理中..." : (isMobile ? "別モデルで生成" : "別モデルで要約生成")}
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                      <DialogTitle>要約を再生成</DialogTitle>
                      <DialogDescription>
                        新しいLLM設定でこの論文の要約を生成します。既存の要約は保持されます。
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      {/* プロンプト選択セクション */}
                      <div className="space-y-3">
                        <Label className="text-sm font-medium">使用するプロンプト</Label>
                        {isPromptsLoading ? (
                          <div className="text-sm text-muted-foreground">プロンプト一覧を読み込み中...</div>
                        ) : promptsError ? (
                          <div className="space-y-2">
                            <div className="text-sm text-red-600">
                              プロンプトの読み込みに失敗しました。
                            </div>
                            <div className="text-xs text-muted-foreground">
                              エラー: {promptsError.message}
                            </div>
                            <div className="space-y-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => mutatePrompts()}
                                className="w-full"
                              >
                                再試行
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={testBackendConnection}
                                className="w-full"
                              >
                                バックエンド接続テスト (コンソール確認)
                              </Button>
                            </div>
                          </div>
                        ) : !availablePrompts ? (
                          <div className="text-sm text-muted-foreground">
                            プロンプト情報がありません。
                          </div>
                        ) : availablePrompts.length === 0 ? (
                          <div className="text-sm text-muted-foreground">
                            利用可能なプロンプトがありません。
                          </div>
                        ) : (
                          <div className="space-y-3 max-h-48 overflow-y-auto border rounded p-3">
                            {availablePrompts.map((prompt, index) => {
                              // ユニークなキーを生成（インデックスを使用）
                              const promptKey = prompt.type === 'default' ? `default_${index}` : `custom_${prompt.id}`;
                              const isSelected = prompt.type === 'default' 
                                ? selectedPrompt.type === 'default' 
                                : selectedPrompt.type === 'custom' && selectedPrompt.id === prompt.id;
                              
                              return (
                                <div key={promptKey} className="flex items-start space-x-3">
                                  <input
                                    type="radio"
                                    id={`prompt_${index}`}
                                    name="selected-prompt"
                                    checked={isSelected}
                                    onChange={() => {
                                      if (prompt.type === 'default') {
                                        setSelectedPrompt({id: null, type: 'default'});
                                      } else {
                                        setSelectedPrompt({id: prompt.id, type: 'custom'});
                                      }
                                    }}
                                    className="w-4 h-4 mt-1"
                                  />
                                  <label htmlFor={`prompt_${index}`} className="flex-1 cursor-pointer">
                                    <div className="space-y-1">
                                      <div className="font-medium text-sm">{prompt.name}</div>
                                      <div className="text-xs text-muted-foreground">{prompt.description}</div>
                                      {prompt.type === 'custom' && (
                                        <div className="text-xs text-blue-600 font-medium">カスタムプロンプト</div>
                                      )}
                                    </div>
                                  </label>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      
                      {/* LLMモデル設定 */}
                      <div className="border-t pt-4">
                        <Label className="text-sm font-medium mb-2 block">LLMモデル設定</Label>
                        <ModelSettings onChange={setRegenerateModelConfig} context="paper_detail" />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsRegenerateModalOpen(false)}>
                        キャンセル
                      </Button>
                      <Button 
                        onClick={handleRegenerateSummary} 
                        disabled={
                          !regenerateModelConfig || 
                          (selectedPrompt.type === 'custom' && !selectedPrompt.id)
                        }
                      >
                        生成実行
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                {userEditedSummaryForDisplay && !isEditingSummary && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setShowOriginalSummary(!showOriginalSummary)}
                    disabled={isRegenerating || isChangingSummary}
                    className={`${isMobile ? "w-full" : "w-full md:w-auto"} btn-nav`}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    {showOriginalSummary ? (isMobile ? "編集済み" : "編集済みを表示") : (isMobile ? "編集前" : "編集前を表示")}
                  </Button>
                )}
              </div>
            </div>
            
            {isChangingSummary ? (
              // 要約切り替え中のローディング表示
              <div className="space-y-3 p-4 border border-border rounded-md bg-card">
                <div className="flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                  <span className="text-muted-foreground">要約を読み込んでいます...</span>
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-4/6" />
                </div>
              </div>
            ) : isEditingSummary ? (
              isPreviewing ? (
                <div className="w-full overflow-x-auto rounded-md border bg-yellow-100 dark:bg-sky-950">
                  <article className="prose dark:prose-invert max-w-full p-4">
                    {renderedSummaryMarkdown}
                  </article>
                </div>
              ) : (
                <Textarea
                  value={editedSummaryText}
                  onChange={(e) => setEditedSummaryText(e.target.value)}
                  className={`w-full border border-primary p-2 rounded-md bg-background ${isMobile ? 'min-h-[400px] h-auto' : 'min-h-[300px]'}`}
                  disabled={isSavingEditedSummary}
                  placeholder="編集..."
                  style={isMobile ? { minHeight: '400px', height: 'auto' } : {}}
                  rows={isMobile ? 20 : 15}
                />
              )
            ) : summaryToDisplay ? (
              <article className="prose dark:prose-invert max-w-[97%] border border-border p-4 rounded-md bg-card overflow-x-auto">
                {renderedSummaryMarkdown}
              </article>
            ) : (
              <p className="text-muted-foreground">利用可能な要約がありません。</p>
            )}
          </section>

          <div className="flex gap-2 mt-8">
            <Button
              variant="destructive"
              onClick={handleDeletePaper}
              disabled={isDeletingPaper}
            >
              {isDeletingPaper ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {isDeletingPaper ? "削除中..." : "ライブラリから削除"}
            </Button>
          </div>
        </div>
      </div>

      {/* デスクトップ右リサイザー */}
      {!isMobile && isRightOpen && (
        <div
          className="w-1 bg-muted hover:bg-muted-foreground/20 cursor-ew-resize"
          onMouseDown={onMouseDownRight}
        />
      )}

      {/* デスクトップ右サイドバー */}
      {!isMobile && isRightOpen && (
        <aside
          className="h-full flex-shrink-0 bg-card flex flex-col"
          style={{ width: rightWidth }}
        >
          <div className="flex justify-end p-2 shrink-0 bg-card">
            <Button variant="ghost" size="sm" onClick={() => setIsRightOpen(false)}>
              チャットバーを隠す
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <MemoizedChatSidebar paperId={userPaperLinkId} model={chatModel} selectedPrompt={selectedChatPrompt} useCharacterPrompt={useCharacterPrompt} />
          </div>
        </aside>
      )}

      <Dialog open={showLeaveConfirmDialog} onOpenChange={(open) => {
        if (!open) { 
          cancelNavigation();
        }
        setShowLeaveConfirmDialog(open);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center">
              <AlertTriangle className="text-yellow-500 mr-2 h-6 w-6" />
              編集内容の破棄確認
            </DialogTitle>
            <DialogDescription>
              編集中の要約があります。変更を保存せずにページを離れますか？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-between">
            <Button variant="outline" onClick={cancelNavigation}>
              キャンセル (編集を続ける)
            </Button>
            <div className="flex gap-2">
              <Button variant="destructive" onClick={proceedNavigation}>
                破棄して移動
              </Button>
              <Button onClick={saveAndProceedNavigation} disabled={isSavingEditedSummary}>
                {isSavingEditedSummary ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                保存して移動
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </main>
  );
}