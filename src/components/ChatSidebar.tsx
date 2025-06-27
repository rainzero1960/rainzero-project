// src/components/ChatSidebar.tsx - セッション対応版
"use client";

import { useChatBySession } from "@/hooks/useChatBySession";
import { usePaperChatSessions } from "@/hooks/usePaperChatSessions";
import { usePaperChatStatus } from "@/hooks/usePaperChatStatus";
import { useState, useEffect, useRef, useCallback, memo, useMemo, forwardRef } from "react";
import { ModelSetting } from "./ModelSettings";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Copy, Sparkles, Brain, Trash2 } from "lucide-react";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useChatBackgroundImage } from "@/hooks/useThemeBackgroundImage";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// AIローディングコンポーネント
const AIThinkingLoader = memo(() => {
  const [dots, setDots] = useState(0);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev + 1) % 4);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-start space-x-2 p-2">
      <div className="relative">
        {/* AI アバター */}
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center animate-pulse">
          <Brain className="w-5 h-5 text-white" />
        </div>
        
        {/* 思考中のスパークルアニメーション */}
        <div className="absolute -top-1 -right-1">
          <Sparkles className="w-4 h-4 text-yellow-400 animate-spin" />
        </div>
      </div>
      
      <div className="flex-1">
        {/* メッセージバブル */}
        <div className="inline-block bg-background/70 backdrop-blur-none rounded-lg px-4 py-3 relative overflow-hidden border border-border/50">
          {/* 背景グラデーションアニメーション - シンプル版 */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/10 to-transparent opacity-50 animate-pulse" />
          
          {/* タイピングインジケーター */}
          <div className="flex items-center space-x-1 relative z-10">
            <span className="text-sm text-foreground">考え中です</span>
            <div className="flex space-x-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className={`w-2 h-2 rounded-full bg-primary/60 animate-bounce`}
                  style={{
                    animationDelay: `${i * 0.15}s`,
                    animationDuration: '1.4s',
                  }}
                />
              ))}
            </div>
          </div>
          
          {/* サブテキスト */}
          <div className="text-xs text-foreground/70 mt-1 flex items-center space-x-1">
            <span>分析中</span>
            <span>{'.'.repeat(dots)}</span>
          </div>
        </div>
      </div>
    </div>
  );
});

AIThinkingLoader.displayName = "AIThinkingLoader";

// メッセージコンポーネントをメモ化
const ChatMessage = memo(({ 
  message, 
  onDelete, 
  onCopy,
  isLast 
}: { 
  message: {
    id: number;
    content: string;
    role: string;
    created_at: string;
    is_deep_research_step?: boolean;
  }; 
  onDelete: () => void;
  onCopy: () => void;
  isLast: boolean;
}) => {
  const messageRef = useRef<HTMLDivElement>(null);

  // 最後のメッセージの場合のみスクロール
  useEffect(() => {
    if (isLast && messageRef.current) {
      messageRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [isLast]);

  return (
    <div 
      ref={messageRef} 
      className={message.role === "user" ? "text-right" : ""}
    >
      <div className={`prose dark:prose-invert relative inline-block max-w-[90%] rounded px-2 py-1 text-sm ${
        message.role === "user" 
          ? "bg-background/80 backdrop-blur-none text-foreground border border-primary/10 text-left" 
          : "bg-muted/80 backdrop-blur-none text-foreground border border-border/50"
      }`}>
        <div className="chat-message-content">
          <ReactMarkdown 
            remarkPlugins={[remarkGfm, remarkMath]} 
            rehypePlugins={[rehypeKatex]}
          >
            {message.content.replace(/\n/g, "  \n") ?? ""}
          </ReactMarkdown>
        </div>
        
        {/* メッセージ削除ボタン */}
        {typeof message.id === "number" && !message.is_deep_research_step && (
          <button 
            className="absolute -top-2 -left-1 text-xs text-red-500 hover:text-red-700 bg-background/80 rounded-full w-5 h-5 flex items-center justify-center" 
            title="このメッセージを削除" 
            onClick={onDelete}
          >
            ×
          </button>
        )}
        
        {/* コピー用ボタン */}
        <button
          className="absolute -bottom-0.5 left-0.5 z-10 text-xs text-muted-foreground hover:text-foreground bg-background/20 rounded p-1"
          title="クリップボードにコピー"
          onClick={onCopy}
        >
          <Copy className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
});

ChatMessage.displayName = "ChatMessage";

// 入力エリアをメモ化
const ChatInput = memo(forwardRef<HTMLTextAreaElement, { 
  onSend: (message: string) => void; 
  sending: boolean;
  children?: React.ReactNode;
}>(({ onSend, sending, children }, ref) => {
  const [input, setInput] = useState("");
  
  const handleSend = useCallback(() => {
    const msg = input.trim();
    if (!msg || sending) return;
    setInput("");
    onSend(msg);
  }, [input, sending, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div className="relative">
      <Textarea 
        ref={ref}
        className="h-20 bg-background/70 backdrop-blur-none placeholder:text-muted-foreground border-border/50" 
        placeholder="質問を入力…（改行: Enter / 送信: Ctrl+Enter）" 
        value={input} 
        onChange={(e) => setInput(e.target.value)} 
        onKeyDown={handleKeyDown}
        disabled={sending}
      />
      <div className="flex gap-2 mt-2">
        <Button 
          className="bg-primary/80 backdrop-blur-none hover:bg-primary" 
          onClick={handleSend} 
          disabled={sending || !input.trim()}
        >
          送信
        </Button>
        {children}
      </div>
    </div>
  );
}));

ChatInput.displayName = "ChatInput";

export default function ChatSidebar({
  paperId,
  model,
  selectedPrompt,
  useCharacterPrompt,
}: {
  paperId: string;
  model: ModelSetting | null;
  selectedPrompt?: { id: number | null; type: 'default' | 'custom' } | null;
  useCharacterPrompt?: boolean;
}) {
  const { sessions, ensureEmptySession, deleteSession, isLoading: sessionsLoading, mutate: mutateSessions } = usePaperChatSessions(paperId);
  const [selectedSessionId, setSelectedSessionId] = useState<number | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [isPollingActive, setIsPollingActive] = useState(false);
  const { backgroundImagePath } = useChatBackgroundImage();
  
  // 背景画像パスのデバッグログ
  useEffect(() => {
    console.log(`[チャットサイドバー] 背景画像パス:`, backgroundImagePath);
  }, [backgroundImagePath]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  
  // ポーリング機能（セッションが選択されていて、処理中の場合のみ）
  const { statusData, sendAsync, isProcessing, isCompleted, isFailed, mutate: mutateStatus } = usePaperChatStatus(
    selectedSessionId, 
    isPollingActive
  );

  // 従来のメッセージ取得（表示用）
  const { messages: staticMessages, removeByIndex, mutate } = useChatBySession(selectedSessionId, paperId);
  
  // ポーリングデータと静的データを統合してメッセージ表示
  // 処理中の場合のみポーリングデータを使用、それ以外は常に静的データを使用（削除等の即時反映）
  const displayMessages = useMemo(() => {
    // 処理中で、かつポーリングデータが存在する場合のみポーリングデータを使用
    if (isProcessing && statusData?.messages && statusData.messages.length > 0) {
      return statusData.messages;
    }
    // それ以外は静的データを使用（削除操作等の即時反映のため）
    return staticMessages || [];
  }, [isProcessing, statusData?.messages, staticMessages]);
  
  // 新しい空白セッション作成時のコールバック（自動遷移はしない）
  // const _handleNewEmptySession = useCallback((_newSessionId: number) => {
  //   // 新しい空白セッションが作成されたことを知らせるだけで、自動遷移はしない
  //   mutateSessions(); // セッション一覧を再取得して、新しいセッションをプルダウンに表示
  // }, [mutateSessions]);

  // 初期セッション設定：空白セッションを確保して選択
  useEffect(() => {
    if (!sessionsLoading && sessions.length >= 0 && !selectedSessionId) {
      ensureEmptySession().then(emptySession => {
        if (emptySession) {
          setSelectedSessionId(emptySession.id);
        }
      });
    }
  }, [sessionsLoading, sessions, selectedSessionId, ensureEmptySession]);

  // セッション変更時の処理中タスク検出
  useEffect(() => {
    if (selectedSessionId && statusData) {
      const hasProcessingTask = statusData.status === "pending" || statusData.status === "processing";
      if (hasProcessingTask && !isPollingActive) {
        setIsPollingActive(true);
      } else if (!hasProcessingTask && isPollingActive) {
        setIsPollingActive(false);
      }
    }
  }, [selectedSessionId, statusData, isPollingActive]);

  // ポーリング制御：処理完了時の自動停止
  useEffect(() => {
    if (isCompleted || isFailed) {
      setIsPollingActive(false);
      setSending(false);
      mutate(); // 静的メッセージを更新
      mutateSessions(); // セッション一覧を更新
    }
  }, [isCompleted, isFailed, mutate, mutateSessions]);

  // メッセージ送信処理をメモ化（非同期版）
  const handleSend = useCallback(async (message: string) => {
    if (!selectedSessionId || !paperId) return;
    
    setSending(true);
    setIsPollingActive(true);
    
    try {
      await sendAsync(
        Number(paperId), 
        message, 
        model ?? undefined, 
        selectedPrompt ?? undefined, 
        selectedSessionId,
        useCharacterPrompt
      );
      // 送信成功後、ポーリングが自動的に開始される
      mutateSessions(); // セッション一覧を更新
    } catch (error) {
      console.error("Failed to send message:", error);
      setSending(false);
      setIsPollingActive(false);
      alert("メッセージの送信に失敗しました。");
    }
  }, [sendAsync, model, selectedPrompt, selectedSessionId, paperId, mutateSessions, useCharacterPrompt]);

  // メッセージ削除処理をメモ化
  const handleDelete = useCallback(async (index: number) => {
    if (confirm("このメッセージを削除しますか？")) {
      await removeByIndex(index);
      // 削除後、両方のデータソースを強制更新
      await mutate();
      await mutateStatus();
    }
  }, [removeByIndex, mutate, mutateStatus]);

  // セッション削除処理
  const handleDeleteSession = useCallback(async () => {
    if (!selectedSessionId) return;
    if (!confirm("このセッションとその会話履歴をすべて削除しますか？")) return;
    
    const success = await deleteSession(selectedSessionId);
    if (success) {
      // 空白セッションを確保して選択
      const emptySession = await ensureEmptySession();
      if (emptySession) {
        setSelectedSessionId(emptySession.id);
      }
    }
  }, [selectedSessionId, deleteSession, ensureEmptySession]);

  // コピー処理をメモ化
  const handleCopy = useCallback((content: string) => {
    const text = typeof content === "string" 
      ? content 
      : JSON.stringify(content);
    navigator.clipboard.writeText(text);
  }, []);

  // セッション選択時の処理
  const handleSessionChange = useCallback((sessionId: string) => {
    setSelectedSessionId(Number(sessionId));
  }, []);

  // 選択中のセッションが空白セッションかどうか
  const selectedSession = sessions.find(s => s.id === selectedSessionId);
  const isEmptySession = selectedSession && displayMessages.length === 0;
  
  // 送信状態の判定（送信中 または 処理中）
  const isCurrentlySending = sending || isProcessing;
  const prevIsSendingRef = useRef<boolean>(false);

  useEffect(() => {
    // isCurrentlySending が true -> false に変わった瞬間にフォーカス
    if (prevIsSendingRef.current === true && !isCurrentlySending) {
      // メモ欄がアクティブでない場合のみフォーカスを当てる
      if (document.activeElement?.id !== 'memo-textarea') {
        inputRef.current?.focus();
      }
    }
    // 現在の状態を ref に保存
    prevIsSendingRef.current = isCurrentlySending;
  }, [isCurrentlySending]);

  // ローディング中の表示
  if (sessionsLoading || (!selectedSessionId && !sessionsLoading)) {
    return (
      <Card className="h-full flex flex-col bg-background/70 backdrop-blur-none border-border/50">
        <CardHeader>
          <CardTitle className="text-lg">LLMに質問する</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col p-2 min-h-0">
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            セッションを準備中...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="h-full relative">
      {/* 背景画像 */}
      <div 
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `url('${backgroundImagePath}')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
      
      {/* オーバーレイ（画像を少し暗くして文字を読みやすく） */}
      <div className="absolute inset-0 bg-black/20" />
      
      {/* チャットコンテンツ */}
      <Card className="h-full flex flex-col relative z-10 bg-background/10 backdrop-blur-none border-border/50">
        <CardContent className="flex-1 flex flex-col p-2 min-h-0">
          <ScrollArea className="flex-1 overflow-auto mb-2">
            <div className="space-y-2 p-1">
              {(displayMessages ?? []).map((m, idx, arr) => {
                const rev = arr.length - 1 - idx;
                const isLastMessage = idx === arr.length - 1;
                
                return (
                  <ChatMessage
                    key={m.id}
                    message={m}
                    onDelete={() => handleDelete(rev)}
                    onCopy={() => handleCopy(m.content)}
                    isLast={isLastMessage}
                  />
                );
              })}
              {isCurrentlySending && <AIThinkingLoader />}
            </div>
          </ScrollArea>
          
          <div className="bg-background/80 backdrop-blur-none p-2 rounded-lg border border-border/50">
            <ChatInput ref={inputRef} onSend={handleSend} sending={isCurrentlySending}>
              {/* セッション選択とゴミ箱を送信ボタンの右側に配置 */}
              <div className="flex gap-2 flex-1">
                <Select value={selectedSessionId?.toString() || ""} onValueChange={handleSessionChange}>
                  <SelectTrigger className="bg-background/70 backdrop-blur-none border-border/50 min-w-[120px]">
                    <SelectValue placeholder="セッション選択..." />
                  </SelectTrigger>
                  <SelectContent>
                    {sessions.map(session => (
                      <SelectItem key={session.id} value={session.id.toString()}>
                        {session.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!isEmptySession && selectedSessionId && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDeleteSession}
                    className="flex-shrink-0"
                    disabled={isCurrentlySending}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </ChatInput>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}