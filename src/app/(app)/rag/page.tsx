// src/app/rag/page.tsx
"use client";

import { useState, useEffect, useRef, useCallback, useMemo, memo, startTransition, useDeferredValue, forwardRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useRagSessions,
  createRagSession,
  deleteRagMessage,
  deleteRagSession,
  startDeepResearchTask,
  useDeepResearchStatus,
  startDeepRagTask,
  useDeepRagStatus,
  detectSessionType,
  RagSessionData,
  RagMessageData,
  useSimpleRagStatus,
  startSimpleRagTask,
} from "@/hooks/useRag";
import { useTagCategories } from "@/hooks/useTagCategories";
import { usePaperTagsSummary } from "@/hooks/usePaperTagsSummary";
import { useAvailablePromptsByCategory } from "@/hooks/useAvailablePromptsByCategory";
import { useSystemPromptGroups } from "@/hooks/useSystemPromptGroups";
import { useRagBackgroundImage } from "@/hooks/useThemeBackgroundImage";
import ModelSettings, { ModelSetting } from "@/components/ModelSettings";
import { CharacterPromptToggle } from "@/components/CharacterPromptToggle";
import { useCharacterPromptToggle } from "@/hooks/useCharacterPromptToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Listbox } from "@headlessui/react";
import { Check, ChevronDown, Copy, Loader2, ListFilter, Home, List, FilePlus2, Menu, Settings, Sparkles, Brain } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Textarea } from "@/components/ui/textarea";
import { signIn, useSession, getSession } from "next-auth/react";
import { authenticatedFetch } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

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
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center animate-pulse">
          <Brain className="w-5 h-5 text-white" />
        </div>
        <div className="absolute -top-1 -right-1">
          <Sparkles className="w-4 h-4 text-yellow-400 animate-spin" />
        </div>
      </div>
      <div className="flex-1">
        <div className="inline-block bg-background/70 backdrop-blur-none rounded-lg px-4 py-3 relative overflow-hidden border border-border/50">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/10 to-transparent opacity-50 animate-pulse" />
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

interface RagMessageDisplay extends Omit<RagMessageData, "id" | "session_id"> {
  id: number | string;
  session_id?: number;
  role: string;
  content: string;
  created_at: string;
  is_deep_research_step: boolean;
}

const AVAILABLE_SIMPLE_TOOLS = [
  { id: "local_rag_search_tool", label: "論文DB検索 (RAG)" },
  { id: "web_search_tool", label: "ウェブ検索 (Search)" },
];

type TagSortMode = 'alphabetical' | 'categorical';

const RagMessage = memo(({
  message,
  isLastMessage,
  onRemoveMessage
}: {
  message: RagMessageDisplay;
  isLastMessage: boolean;
  onRemoveMessage: (id: string | number) => void;
}) => {
  const lastMessageRef = useRef<HTMLDivElement>(null);
  const isThinkingStep = message.is_deep_research_step && message.role === "system_step";

  useEffect(() => {
    if (isLastMessage && lastMessageRef.current) {
      lastMessageRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [isLastMessage]);

  const processedContent = useMemo(() => {
    return message.role === "user" && typeof message.content === "string"
      ? message.content.replace(/\n/g, "  \n")
      : typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content, null, 2);
  }, [message.content, message.role]);

  const handleCopy = useCallback(() => {
    const text = typeof message.content === "string" ? message.content : JSON.stringify(message.content);
    navigator.clipboard.writeText(text);
  }, [message.content]);

  const handleRemove = useCallback(() => {
    onRemoveMessage(message.id);
  }, [message.id, onRemoveMessage]);

  const isLongContent = processedContent.length > 1000;

  return (
    <div
      key={message.id}
      ref={isLastMessage ? lastMessageRef : null}
      className={`rag-message-wrapper ${message.role === "user" ? "text-right" : ""}`}
    >
      <div className={`prose dark:prose-invert relative inline-block rounded px-2 py-1 text-sm ${
        message.role === "user"
          ? "bg-background/80 backdrop-blur-none text-foreground text-left"
          : isThinkingStep
            ? "bg-yellow-100/80 dark:bg-yellow-900/80 backdrop-blur-none border border-yellow-300 dark:border-yellow-700 text-yellow-900 dark:text-yellow-200"
            : "bg-muted/80 backdrop-blur-none text-foreground border border-border/50"
      }`}>
        <div className={`rag-message-content ${isLongContent ? 'force-wrap' : ''}`}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={{
              a: ({ href, children, ...props }) => {
                let displayChildren = children;
                if (
                  href &&
                  typeof children === 'string' &&
                  children === href &&
                  href.length > 50
                ) {
                  const url = new URL(href);
                  displayChildren = `${url.hostname}${url.pathname.length > 20 ? url.pathname.substring(0, 20) + '...' : url.pathname}`;
                } else if (
                  href &&
                  Array.isArray(children) &&
                  children.length === 1 &&
                  typeof children[0] === 'string' &&
                  children[0] === href &&
                  href.length > 50
                ) {
                  const url = new URL(href);
                  displayChildren = `${url.hostname}${url.pathname.length > 20 ? url.pathname.substring(0, 20) + '...' : url.pathname}`;
                }
                return (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={href}
                    {...props}
                  >
                    {displayChildren}
                  </a>
                );
              },
              p: ({ children, ...props }) => (
                <p {...props} style={{ 
                  wordBreak: 'break-word', 
                  overflowWrap: 'anywhere',
                  margin: '4px 0'
                }}>
                  {children}
                </p>
              ),
              pre: ({ children, ...props }) => (
                <pre {...props} style={{ maxWidth: '100%', overflow: 'auto' }}>
                  {children}
                </pre>
              ),
              hr: ({ ...props }) => (
                <hr {...props} style={{ 
                  margin: '8px 0', 
                  border: 'none', 
                  borderTop: '1px solid rgba(128, 128, 128, 0.3)',
                  height: 0
                }} />
              ),
              ul: ({ children, ...props }) => (
                <ul {...props} style={{ 
                  margin: '4px 0', 
                  paddingLeft: '1.5rem',
                  listStyleType: 'disc'
                }}>
                  {children}
                </ul>
              ),
              ol: ({ children, ...props }) => (
                <ol {...props} style={{ 
                  margin: '4px 0', 
                  paddingLeft: '1.5rem',
                  listStyleType: 'decimal'
                }}>
                  {children}
                </ol>
              ),
              li: ({ children, ...props }) => (
                <li {...props} style={{ 
                  margin: '2px 0',
                  lineHeight: '1.4'
                }}>
                  {children}
                </li>
              )
            }}
          >
            {processedContent}
          </ReactMarkdown>
        </div>
        {typeof message.id === "number" && (
          <button
            className={`absolute -top-2 z-10 text-xs text-red-500 hover:text-red-700 bg-background/90 rounded-full w-5 h-5 flex items-center justify-center ${message.role === "user" ? "-left-2" : "-left-2"}`}
            title="このメッセージを削除"
            onClick={handleRemove}
          >
            ×
          </button>
        )}
        <button
          className={`absolute -bottom-0.5 z-10 text-xs text-muted-foreground hover:text-foreground bg-background/10 rounded p-1 ${message.role === "user" ? "-left-0.5" : "-left-0.5"}`}
          title="クリップボードにコピー"
          onClick={handleCopy}
        >
          <Copy className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
});

RagMessage.displayName = "RagMessage";

const OptimizedInputArea = memo(forwardRef<HTMLTextAreaElement, {
  onSend: (message: string) => void;
  isProcessing: boolean;
}>(( { onSend, isProcessing }, ref) => {
  const [localInput, setLocalInput] = useState("");

  const handleSend = useCallback(() => {
    const trimmedInput = localInput.trim();
    if (!trimmedInput || isProcessing) return;

    startTransition(() => {
      onSend(trimmedInput);
      setLocalInput("");
      if (ref && typeof ref !== 'function' && ref.current) {
        ref.current.style.height = 'auto';
      }
    });
  }, [localInput, onSend, isProcessing, ref]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalInput(e.target.value);
  }, []);

  const handleInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget;
    target.style.height = 'auto';
    target.style.height = `${target.scrollHeight}px`;
  }, []);

  return (
    <div className="border-t border-border/50 p-4 bg-background/80 backdrop-blur-none flex items-end gap-2 shrink-0 rounded-b-lg">
      <Textarea
        ref={ref}
        className="flex-1 min-h-[40px] max-h-40 resize-none overflow-y-auto bg-background/70 backdrop-blur-none placeholder:text-muted-foreground border-border/50"
        placeholder="質問を入力… (Ctrl+Enter で送信)"
        value={localInput}
        onChange={handleInputChange}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        disabled={isProcessing}
      />
      <Button
        size="sm"
        onClick={handleSend}
        disabled={isProcessing || !localInput.trim()}
        className="h-[40px] bg-primary/80 backdrop-blur-none hover:bg-primary"
      >
        {isProcessing ? "処理中…" : "送信"}
      </Button>
    </div>
  );
}));

OptimizedInputArea.displayName = "OptimizedInputArea";

const SessionLoadingDisplay = memo(() => {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[300px] space-y-4">
      <div className="relative">
        <div className="w-16 h-16 border-4 border-primary/20 rounded-full"></div>
        <div className="absolute top-0 left-0 w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
      <div className="space-y-2 text-center">
        <p className="text-sm font-medium text-foreground animate-pulse">
          セッションを読み込んでいます...
        </p>
        <div className="flex items-center justify-center space-x-1">
          <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0ms" }}></div>
          <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></div>
          <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></div>
        </div>
      </div>
    </div>
  );
});

SessionLoadingDisplay.displayName = "SessionLoadingDisplay";

export default function RagPage() {
  const { sessions, mutate: mutateSessions, isLoading: isLoadingSessions } = useRagSessions();
  const { backgroundImagePath } = useRagBackgroundImage();
  
  // 背景画像パスのデバッグログ
  useEffect(() => {
    console.log(`[RAGページ] 背景画像パス:`, backgroundImagePath);
  }, [backgroundImagePath]);
  const router = useRouter();
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);

  const [executionMode, setExecutionMode] = useState<'simple' | 'Deep' | 'deepRag'>('simple');
  const [selectedSimpleTools, setSelectedSimpleTools] = useState<string[]>(["local_rag_search_tool"]);
  
  // キャラクタープロンプトトグル
  const { enabled: useCharacterPrompt, setEnabled: setUseCharacterPrompt } = useCharacterPromptToggle('rag');

  const [isPollingActive, setIsPollingActive] = useState(false);
  const [isSendingUserInput, setIsSendingUserInput] = useState(false);

  const { statusData: deepResearchStatus, isLoading: isLoadingDeepResearch, mutateStatus: mutateDeepResearch, error: errorDeepResearch } = useDeepResearchStatus(activeSessionId, executionMode === 'Deep' && isPollingActive);
  const { statusData: deepRagStatus, isLoading: isLoadingDeepRag, mutateStatus: mutateDeepRag, error: errorDeepRag } = useDeepRagStatus(activeSessionId, executionMode === 'deepRag' && isPollingActive);
  const { statusData: simpleRagStatus, isLoading: isLoadingSimpleRag, mutateStatus: mutateSimpleRag, error: errorSimpleRag } = useSimpleRagStatus(activeSessionId, executionMode === 'simple' && isPollingActive);

  const [displayMessages, setDisplayMessages] = useState<RagMessageDisplay[]>([]);

  const [isLoadingSession, setIsLoadingSession] = useState(false);

  const [, setRefsHeight] = useState(150);
  const [isDraggingRefs, setIsDraggingRefs] = useState(false);
  const refsContainerRef = useRef<HTMLDivElement>(null);

  const aiThinkingRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevIsAnyProcessingRef = useRef<boolean>(false);

  const { status: authStatus } = useSession();

  const [isMobile, setIsMobile] = useState(false);
  const [isLeftSheetOpen, setIsLeftSheetOpen] = useState(false);
  const [isRightSheetOpen, setIsRightSheetOpen] = useState(false);

  const [leftSidebarWidth, setLeftSidebarWidth] = useState(240);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(320);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isModelOpen, setIsModelOpen] = useState(true);
  const dragSide = useRef<"left" | "right" | null>(null);

  const onMouseDownLeft = useCallback(() => { dragSide.current = "left"; }, []);
  const onMouseDownRight = useCallback(() => { dragSide.current = "right"; }, []);

  const handleHorizontalMouseMove = useCallback((e: MouseEvent) => {
    if (!dragSide.current) return;
    const minWidth = 200;
    const maxWidth = (typeof window !== "undefined" ? window.innerWidth : 1200) * 0.5;

    if (dragSide.current === "left") {
      const newWidth = e.clientX;
      setLeftSidebarWidth(Math.min(Math.max(newWidth, minWidth), maxWidth));
    } else if (dragSide.current === "right") {
      const newWidth = (typeof window !== "undefined" ? window.innerWidth : 1200) - e.clientX;
      setRightSidebarWidth(Math.min(Math.max(newWidth, minWidth), maxWidth));
    }
  }, []);

  const handleHorizontalMouseUp = useCallback(() => {
    dragSide.current = null;
  }, []);

  useEffect(() => {
    document.addEventListener("mousemove", handleHorizontalMouseMove);
    document.addEventListener("mouseup", handleHorizontalMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleHorizontalMouseMove);
      document.removeEventListener("mouseup", handleHorizontalMouseUp);
    };
  }, [handleHorizontalMouseMove, handleHorizontalMouseUp]);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (authStatus === "unauthenticated") {
        signIn(undefined, { callbackUrl: "/rag"});
    }
  }, [authStatus]);

  useEffect(() => {
    if (activeSessionId === null) {
      setDisplayMessages([]);
      setIsPollingActive(false);
      setIsSendingUserInput(false);
      setIsLoadingSession(false);
      return;
    }

    setIsLoadingSession(true);

    const fetchInitialMessages = async (sessionId: number) => {
      try {
        const currentAuthSession = await getSession();
        if (!currentAuthSession?.accessToken) {
          signIn(); throw new Error("User not authenticated.");
        }
        const res = await authenticatedFetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/rag/sessions/${sessionId}/messages`);
        if (!res.ok) {
          if (res.status === 401) { signIn(); }
          throw new Error(`Failed to fetch RAG messages (status: ${res.status}) for session ${sessionId}`);
        }
        const data: RagMessageData[] = await res.json();
        const messages: RagMessageDisplay[] = data.map((m) => ({ ...m }));
        
        setDisplayMessages(messages);

      } catch (err: unknown) {
        console.error(`Error fetching RAG messages for session ${sessionId}:`, err instanceof Error ? err.message : String(err));
        setDisplayMessages([{ id: `fetch-error-${sessionId}`, role: 'assistant', content: `メッセージの読み込みに失敗しました。\nエラー: ${err instanceof Error ? err.message : String(err)}`, created_at: new Date().toISOString(), is_deep_research_step: false }]);
      } finally {
        setIsLoadingSession(false);
      }
    };

    if (executionMode === 'simple') {
      fetchInitialMessages(activeSessionId);
      mutateSimpleRag();
      setIsPollingActive(true);
    } else if (executionMode === 'Deep') {
      setDisplayMessages([]);
      setIsLoadingSession(false);
      mutateDeepResearch().then(() => {
        setIsPollingActive(true);
      });
    } else if (executionMode === 'deepRag') {
      setDisplayMessages([]);
      setIsLoadingSession(false);
      mutateDeepRag().then(() => {
        setIsPollingActive(true);
      });
    } else {
      setDisplayMessages([]);
      setIsLoadingSession(false);
      setIsPollingActive(false);
    }
  }, [activeSessionId, executionMode, mutateDeepResearch, mutateDeepRag, mutateSimpleRag]);


  useEffect(() => {
    let currentStatusData = null;
    let currentStatusError = null;

    if (executionMode === 'Deep') {
        currentStatusData = deepResearchStatus;
        currentStatusError = errorDeepResearch;
    } else if (executionMode === 'deepRag') {
        currentStatusData = deepRagStatus;
        currentStatusError = errorDeepRag;
    } else if (executionMode === 'simple') {
        currentStatusData = simpleRagStatus;
        currentStatusError = errorSimpleRag;
    } else {
        setIsPollingActive(false);
        return;
    }

    if (activeSessionId === null) {
        setIsPollingActive(false);
        return;
    }

    if (currentStatusError) {
      console.error(`Error fetching ${executionMode} status:`, currentStatusError);
      setIsPollingActive(false);
      setIsSendingUserInput(false);
      return;
    }

    if (currentStatusData && currentStatusData.session_id === activeSessionId) {
      const serverMessages: RagMessageDisplay[] = currentStatusData.messages.map((m) => ({ ...m }));
      
      if (JSON.stringify(displayMessages) !== JSON.stringify(serverMessages)) {
        setDisplayMessages(serverMessages);
      }
      
      const isCompletedOrFailed = currentStatusData.status === "completed" || currentStatusData.status === "failed";

      if (isCompletedOrFailed) {
        setIsPollingActive(false);
        setIsSendingUserInput(false);
      } else if (currentStatusData.status) {
        if (!isPollingActive) {
          setIsPollingActive(true);
        }
        if (!isSendingUserInput) {
          setIsSendingUserInput(true);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    deepResearchStatus, deepRagStatus, simpleRagStatus,
    activeSessionId, executionMode,
    errorDeepResearch, errorDeepRag, errorSimpleRag,
    displayMessages
  ]);

  const handleMouseMoveRefs = useCallback((e: MouseEvent) => {
    if (!isDraggingRefs || !refsContainerRef.current) return;
    const parentRect = refsContainerRef.current.parentElement?.getBoundingClientRect();
    if (!parentRect) return;
    const newHeight = e.clientY - parentRect.top;
    const minHeight = 50;
    const maxHeight = parentRect.height * 0.8;
    setRefsHeight(Math.max(minHeight, Math.min(newHeight, maxHeight)));
  }, [isDraggingRefs]);

  const handleMouseUpRefs = useCallback(() => setIsDraggingRefs(false), []);

  useEffect(() => {
    if (isDraggingRefs) {
      document.addEventListener('mousemove', handleMouseMoveRefs);
      document.addEventListener('mouseup', handleMouseUpRefs);
    } else {
      document.removeEventListener('mousemove', handleMouseMoveRefs);
      document.removeEventListener('mouseup', handleMouseUpRefs);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMoveRefs);
      document.removeEventListener('mouseup', handleMouseUpRefs);
    };
  }, [isDraggingRefs, handleMouseMoveRefs, handleMouseUpRefs]);

  const removeMessageById = useCallback(async (messageId: string | number) => {
    if (activeSessionId === null) return;
    if (!confirm("このメッセージを削除しますか？")) return;
    const originalMessages = [...displayMessages];
    setDisplayMessages((prev) => prev.filter((m) => m.id !== messageId));
    if (typeof messageId === "number") {
      try {
        await deleteRagMessage(activeSessionId, messageId);
        if (executionMode === 'Deep') mutateDeepResearch();
        if (executionMode === 'deepRag') mutateDeepRag();
        if (executionMode === 'simple') {
            mutateSimpleRag();
        }
      } catch (error) {
        console.error("Failed to delete message:", error);
        alert("メッセージの削除に失敗しました。");
        setDisplayMessages(originalMessages);
      }
    }
  }, [activeSessionId, displayMessages, executionMode, mutateDeepResearch, mutateDeepRag, mutateSimpleRag]);

  const [modelCfg, setModelCfg] = useState<ModelSetting | null>(null);

  const { tagCategories, isLoadingTagCategories, isErrorTagCategories } = useTagCategories();
  const { tagsSummary, isLoadingTagsSummary, isErrorTagsSummary } = usePaperTagsSummary();
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagSortMode, setTagSortMode] = useState<TagSortMode>('categorical');

  const [selectedPrompt, setSelectedPrompt] = useState<{ id: number | null; type: 'default' | 'custom' }>({ id: null, type: 'default' });
  const [selectedPromptGroup, setSelectedPromptGroup] = useState<number | null>(null);

  const promptCategory = useMemo(() => {
    if (executionMode === 'simple') {
      return 'rag';
    } else if (executionMode === 'deepRag') {
      return 'deeprag';
    } else if (executionMode === 'Deep') {
      return 'deepresearch';
    }
    return 'rag';
  }, [executionMode]);

  const { prompts: availablePrompts, isLoading: promptsLoading, isError: promptsError } = useAvailablePromptsByCategory(promptCategory);

  const filteredPrompts = useMemo(() => {
    if (!availablePrompts) return [];
    if (executionMode === 'simple') {
      const targetPromptType = selectedSimpleTools.length === 0
        ? 'rag_no_tool_system_template'
        : 'rag_base_system_template';
      return availablePrompts.filter(prompt =>
        prompt.prompt_type === targetPromptType
      );
    }
    return availablePrompts;
  }, [availablePrompts, executionMode, selectedSimpleTools]);

  const promptGroupCategory = useMemo(() => {
    switch (executionMode) {
      case 'Deep':
        return 'deepresearch' as const;
      case 'deepRag':
        return 'deeprag' as const;
      default:
        return undefined;
    }
  }, [executionMode]);

  const { groups: availablePromptGroups, isLoading: promptGroupsLoading, error: promptGroupsError } = useSystemPromptGroups(promptGroupCategory);

  useEffect(() => {
    setSelectedPrompt({ id: null, type: 'default' });
    setSelectedPromptGroup(null);
  }, [executionMode]);

  const tagToOrderIndex = useMemo(() => {
    if (!tagCategories) return new Map<string, number>();
    const orderedTags = Object.values(tagCategories).flat();
    const map = new Map<string, number>();
    orderedTags.forEach((tag, index) => {
      map.set(tag, index);
    });
    return map;
  }, [tagCategories]);

  const allTags = useMemo(() => {
    if (!tagsSummary) return [];
    const tags = Object.keys(tagsSummary).filter(tag => tag !== '興味なし' && tag !== 'Recommended');
    if (tagSortMode === 'alphabetical') {
      tags.sort((a, b) => a.localeCompare(b, 'ja'));
    } else {
      tags.sort((a, b) => {
        const orderA = tagToOrderIndex.get(a);
        const orderB = tagToOrderIndex.get(b);
        if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
        if (orderA !== undefined) return -1;
        if (orderB !== undefined) return 1;
        return a.localeCompare(b, 'ja');
      });
    }
    return tags;
  }, [tagsSummary, tagSortMode, tagToOrderIndex]);

  const tagCounts = useMemo(() => {
    if (!tagsSummary) return {};
    const filteredCounts: Record<string, number> = {};
    Object.entries(tagsSummary).forEach(([tag, count]) => {
      if (tag !== '興味なし' && tag !== 'Recommended') {
        filteredCounts[tag] = count;
      }
    });
    return filteredCounts;
  }, [tagsSummary]);

const handleNewSession = useCallback(async () => {
    setExecutionMode('simple');
    setActiveSessionId(null);
    setDisplayMessages([]);
    setIsPollingActive(false);
    setIsSendingUserInput(false);
    setIsLoadingSession(true);
    try {
      const newSess = await createRagSession();
      setActiveSessionId(newSess.id);
      mutateSessions();
    } catch (error) {
      console.error("Failed to create new session:", error);
      alert("新規セッションの作成に失敗しました。");
      setIsLoadingSession(false);
    }
  }, [mutateSessions]);

  const isAnyProcessing = isSendingUserInput;

  useEffect(() => {
    if (prevIsAnyProcessingRef.current === true && !isAnyProcessing) {
      inputRef.current?.focus();
    }
    prevIsAnyProcessingRef.current = isAnyProcessing;
  }, [isAnyProcessing]);

const handleSend = useCallback(async (messageContent: string) => {
    if (isAnyProcessing) {
      return;
    }

    const q = messageContent.trim();
    if (!q) {
      return;
    }

    setIsSendingUserInput(true);

    let sessionToUse = activeSessionId;

    if (sessionToUse === null) {
      try {
        const newSess = await createRagSession();
        sessionToUse = newSess.id;
        setActiveSessionId(newSess.id);
        await mutateSessions();
      } catch (error) {
        console.error("Failed to create new session automatically:", error);
        alert("新規セッションの自動作成に失敗しました。");
        setIsSendingUserInput(false);
        return;
      }
    }
    
    if (sessionToUse === null) {
        setIsSendingUserInput(false);
        return;
    }

    const tempUserMsgId = `user-${Date.now()}`;
    const userMessageToAdd: RagMessageDisplay = {
      id: tempUserMsgId,
      role: "user",
      content: q,
      created_at: new Date().toISOString(),
      session_id: sessionToUse,
      is_deep_research_step: false,
    };
    
    setDisplayMessages(prev => [...prev, userMessageToAdd]);

    try {
      if (executionMode === 'simple') {
        setIsPollingActive(true);
        await startSimpleRagTask(
          q,
          selectedTags,
          selectedSimpleTools,
          sessionToUse,
          modelCfg ?? undefined,
          selectedPrompt,
          useCharacterPrompt
        );
        await mutateSimpleRag();
      } else if (executionMode === 'Deep') {
        setIsPollingActive(true);
        const { session_id: returnedSessionId } = await startDeepResearchTask(q, sessionToUse, selectedPromptGroup, useCharacterPrompt);
        await mutateSessions();
        if (activeSessionId !== returnedSessionId) {
            setActiveSessionId(returnedSessionId);
        } else {
            await mutateDeepResearch();
        }
      } else if (executionMode === 'deepRag') {
        setIsPollingActive(true);
        const { session_id: returnedSessionId } = await startDeepRagTask(q, selectedTags, sessionToUse, selectedPromptGroup, useCharacterPrompt);
        await mutateSessions();
        if (activeSessionId !== returnedSessionId) {
            setActiveSessionId(returnedSessionId);
        } else {
            await mutateDeepRag();
        }
      }
    } catch (error: unknown) {
        console.error(`Error starting ${executionMode} task:`, error instanceof Error ? error.message : String(error));
        alert(`${executionMode}処理の開始に失敗: ${error instanceof Error ? error.message : String(error)}`);
        setIsSendingUserInput(false);
        setIsPollingActive(false);
        setDisplayMessages((prev) => [
          ...prev.filter(m => m.id !== tempUserMsgId),
          { id: `task-start-error-${Date.now()}`, role: 'assistant', content: `エラー: ${error instanceof Error ? error.message : String(error)}`, created_at: new Date().toISOString(), is_deep_research_step: false }
        ]);
        await mutateSessions();
    }
  }, [
    activeSessionId, executionMode, selectedSimpleTools, selectedTags, modelCfg,
    mutateSessions, isAnyProcessing, mutateDeepResearch, mutateDeepRag, mutateSimpleRag,
    selectedPrompt, selectedPromptGroup, useCharacterPrompt
  ]);

  let currentOverallStatus = "";
  if (executionMode === 'Deep' && deepResearchStatus?.session_id === activeSessionId) {
    currentOverallStatus = deepResearchStatus.status || "開始中";
  } else if (executionMode === 'deepRag' && deepRagStatus?.session_id === activeSessionId) {
    currentOverallStatus = deepRagStatus.status || "開始中";
  } else if (executionMode === 'simple' && simpleRagStatus?.session_id === activeSessionId) {
    currentOverallStatus = simpleRagStatus.status || (isSendingUserInput ? "処理開始中" : "");
  }

  useEffect(() => {
    const isAIThinkingVisible = 
      (isSendingUserInput && currentOverallStatus && currentOverallStatus !== "completed" && currentOverallStatus !== "failed");

    if (isAIThinkingVisible && aiThinkingRef.current) {
      setTimeout(() => {
        if (aiThinkingRef.current) {
          aiThinkingRef.current.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }
      }, 100);
    }
  }, [displayMessages, isSendingUserInput, currentOverallStatus]);

  const handleSimpleToolToggle = useCallback((toolId: string) => {
    setSelectedSimpleTools(prev => prev.includes(toolId) ? prev.filter(id => id !== toolId) : [...prev, toolId]);
  }, []);

  const onExecutionModeChange = useCallback((value: 'simple' | 'Deep' | 'deepRag') => {
    if (isAnyProcessing) {
      return;
    }
    
    setExecutionMode(value);
  }, [isAnyProcessing]);

  const setCategoricalSort = useCallback(() => setTagSortMode('categorical'), []);
  const setAlphabeticalSort = useCallback(() => setTagSortMode('alphabetical'), []);

  const onPromptGroupChange = useCallback((value: string) => {
    if (value === "none") {
      setSelectedPromptGroup(null);
    } else {
      const id = parseInt(value);
      if (!isNaN(id)) {
        setSelectedPromptGroup(id);
      }
    }
  }, []);

  const memoizedSettingsPanel = useMemo(() => {
    const isTagSelectionDisabled = (executionMode === 'simple' && !selectedSimpleTools.includes('local_rag_search_tool')) || executionMode === 'Deep' || (isAnyProcessing && executionMode === 'deepRag');
    const isModelSettingsDisabled = (executionMode === 'Deep' || executionMode === 'deepRag') || (isAnyProcessing && executionMode === 'simple');

    return (
      <>
        <div className="mb-6 space-y-2">
          <Label htmlFor="executionMode">モード</Label>
          <Select value={executionMode} onValueChange={onExecutionModeChange} disabled={isAnyProcessing}>
            <SelectTrigger id="executionMode" className="w-full"> <SelectValue placeholder="モードを選択" /> </SelectTrigger>
            <SelectContent>
              <SelectItem value="simple">Simple (RAG/Search)</SelectItem>
              <SelectItem value="Deep">Deep Research (Web)</SelectItem>
              <SelectItem value="deepRag">Deep RAG (DB)(β)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {executionMode === 'simple' && (
          <div className="mb-6 space-y-2">
            <Label>Simpleモードで使用するツール</Label>
            {AVAILABLE_SIMPLE_TOOLS.map(tool => (
              <div key={tool.id} className="flex items-center space-x-2">
                <Checkbox id={`tool-${tool.id}`} checked={selectedSimpleTools.includes(tool.id)} onCheckedChange={() => handleSimpleToolToggle(tool.id)} disabled={isAnyProcessing} />
                <label htmlFor={`tool-${tool.id}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"> {tool.label} </label>
              </div>
            ))}
          </div>
        )}

        <div className="mb-6 space-y-2">
          {executionMode === 'simple' ? (
            <>
              <Label>使用するプロンプト ({executionMode}モード)</Label>
              {promptsLoading ? (
                <div className="text-xs text-muted-foreground">読み込み中...</div>
              ) : promptsError ? (
                <div className="text-xs text-red-600">
                  プロンプトの読み込みに失敗しました
                </div>
              ) : (
                <Select
                  value={selectedPrompt && selectedPrompt.type === 'default'
                    ? 'default'
                    : selectedPrompt && selectedPrompt.type === 'custom' && selectedPrompt.id
                      ? `custom_${selectedPrompt.id}`
                      : 'default'}
                  onValueChange={(value) => {
                    if (value === 'default') {
                      setSelectedPrompt({ id: null, type: 'default' });
                    } else if (value.startsWith('custom_')) {
                      const id = parseInt(value.replace('custom_', ''));
                      if (!isNaN(id)) {
                        setSelectedPrompt({ id, type: 'custom' });
                      }
                    } else {
                      setSelectedPrompt({ id: null, type: 'default' });
                    }
                  }}
                  disabled={isAnyProcessing}
                >
                  <SelectTrigger className="w-full truncate">
                    <SelectValue placeholder="プロンプトを選択" />
                  </SelectTrigger>
                  <SelectContent className="max-w-[300px]">
                    {filteredPrompts && filteredPrompts
                      .filter(p => p.type === 'default')
                      .map((prompt, index) => (
                        <SelectItem key={`default_${index}`} value="default">
                          <span className="truncate block max-w-[250px]">
                            {prompt.name}
                          </span>
                        </SelectItem>
                      ))}
                    {filteredPrompts && filteredPrompts
                      .filter(p => p.type === 'custom')
                      .map(prompt => (
                        <SelectItem key={`custom_${prompt.id}`} value={`custom_${prompt.id}`}>
                          <span className="truncate block max-w-[250px]">
                            {prompt.name}
                          </span>
                        </SelectItem>
                      ))}
                    {(!filteredPrompts || filteredPrompts.length === 0) && (
                      <SelectItem value="default">デフォルト</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              )}
              {filteredPrompts && filteredPrompts.length > 0 && selectedPrompt.type === 'custom' && (
                <div className="text-xs text-muted-foreground">
                  {(() => {
                    const prompt = filteredPrompts.find(p => p.id === selectedPrompt.id);
                    return prompt ? prompt.description : '';
                  })()}
                </div>
              )}
              
              {/* キャラクタープロンプトトグル（Simple RAGモード） */}
              <CharacterPromptToggle
                enabled={useCharacterPrompt}
                onChange={setUseCharacterPrompt}
              />
            </>
          ) : (
            <>
              <Label>使用するプロンプトグループ ({executionMode}モード)</Label>
              {promptGroupsLoading ? (
                <div className="text-xs text-muted-foreground">読み込み中...</div>
              ) : promptGroupsError ? (
                <div className="text-xs text-red-600">
                  プロンプトグループの読み込みに失敗しました
                </div>
              ) : (
                <Select
                  value={selectedPromptGroup?.toString() || "none"}
                  onValueChange={onPromptGroupChange}
                  disabled={isAnyProcessing}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="プロンプトグループを選択" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">デフォルト（グループなし）</SelectItem>
                    {availablePromptGroups && availablePromptGroups.length > 0 ? (
                      availablePromptGroups.map(group => (
                        <SelectItem key={group.id} value={group.id.toString()}>
                          {group.name}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="empty" disabled>
                        利用可能なプロンプトグループがありません
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              )}
              {selectedPromptGroup && availablePromptGroups && (
                <div className="text-xs text-muted-foreground">
                  {(() => {
                    const group = availablePromptGroups.find(g => g.id === selectedPromptGroup);
                    return group ? group.description : '';
                  })()}
                </div>
              )}

              {/* キャラクタープロンプトトグル（Deep系モード） */}
              <CharacterPromptToggle
                enabled={useCharacterPrompt}
                onChange={setUseCharacterPrompt}
              />
            </>
          )}
        </div>

        <div className="mb-6">
          <div className="flex justify-between items-center mb-1">
              <h3 className="text-sm font-semibold">検索タグ (RAG系モードで使用)</h3>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="px-2 py-1 h-auto" disabled={isTagSelectionDisabled}>
                    <ListFilter className="h-4 w-4 mr-1" />
                    ソート
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>並び順</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem checked={tagSortMode === 'categorical'} onCheckedChange={setCategoricalSort}>
                    カテゴリ順
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={tagSortMode === 'alphabetical'} onCheckedChange={setAlphabeticalSort}>
                    アルファベット順
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
          </div>
          <Listbox value={selectedTags} onChange={setSelectedTags} multiple disabled={isTagSelectionDisabled}>
            <div className="relative">
              <Listbox.Button className="w-full rounded border border-border px-3 py-2 text-left text-sm disabled:bg-muted disabled:cursor-not-allowed">
                <span className="truncate pr-1">{selectedTags.length ? selectedTags.join(", ") : "論文DB検索時に使用"}</span>
                <span className="absolute inset-y-0 right-0 flex items-center pr-2"><ChevronDown className="h-4 w-4" /></span>
              </Listbox.Button>
              <Listbox.Options className="absolute z-20 mt-1 w-full max-h-60 overflow-auto rounded border border-border bg-popover shadow-sm">
                {allTags.map((tag) => (
                  <Listbox.Option key={tag} value={tag} className="cursor-pointer px-3 py-1 hover:bg-muted">
                    {({ selected }) => (
                      <div className="flex justify-between items-center">
                        <span>{tag} ({tagCounts[tag] || 0})</span>
                        {selected && <Check className="h-4 w-4" />}
                      </div>
                    )}
                  </Listbox.Option>
                ))}
              </Listbox.Options>
            </div>
          </Listbox>
        </div>

        <ModelSettings context="rag" onChange={setModelCfg} disabled={isModelSettingsDisabled} />

        <div className="mt-4"> <Button variant="destructive" className="w-full" onClick={() => router.push("/rag/rebuild")}>埋め込みモデル再構築</Button> </div>
      </>
    );
  }, [executionMode, onExecutionModeChange, isAnyProcessing, selectedSimpleTools, handleSimpleToolToggle, selectedTags, allTags, tagCounts, tagSortMode, setCategoricalSort, setAlphabeticalSort, setModelCfg, router, filteredPrompts, promptsLoading, promptsError, selectedPrompt, setSelectedPrompt, availablePromptGroups, promptGroupsLoading, promptGroupsError, selectedPromptGroup, onPromptGroupChange, useCharacterPrompt, setUseCharacterPrompt]);

  const deferredMessages = useDeferredValue(displayMessages);
  const memoizedMessages = useMemo(() =>
    deferredMessages.map((message, idx) => (
      <RagMessage
        key={message.id}
        message={message}
        isLastMessage={idx === deferredMessages.length - 1}
        onRemoveMessage={removeMessageById}
      />
    ))
  , [deferredMessages, removeMessageById]);

  const createSessionItem = useCallback((s: RagSessionData, onSelect: (id: number) => void, onDelete: (id: number) => void) => {
    let statusText = "";
    if (s.id === activeSessionId) {
        if (executionMode === 'Deep' && deepResearchStatus?.status && deepResearchStatus.status !== "completed" && deepResearchStatus.status !== "failed") {
            statusText = deepResearchStatus.status;
        } else if (executionMode === 'deepRag' && deepRagStatus?.status && deepRagStatus.status !== "completed" && deepRagStatus.status !== "failed") {
            statusText = deepRagStatus.status;
        } else if (executionMode === 'simple' && simpleRagStatus?.status && simpleRagStatus.status !== "completed" && simpleRagStatus.status !== "failed") {
            statusText = simpleRagStatus.status;
        } else if (isSendingUserInput && s.id === activeSessionId && !statusText) {
            statusText = "処理中";
        }
    }

    return (
        <div key={s.id} className={`group flex items-center justify-between p-2 cursor-pointer rounded-md hover:bg-muted ${s.id === activeSessionId ? "bg-accent" : ""}`}>
        <span onClick={() => onSelect(s.id)} className="truncate text-sm">
            {s.title || `Session #${s.id}`}
            {statusText && (
            <span className="ml-2 text-xs text-primary">({statusText})</span>
            )}
        </span>
        <button className="text-destructive opacity-0 group-hover:opacity-100" title="Delete Session"
            onClick={() => onDelete(s.id)}>×</button>
        </div>
    );
  }, [activeSessionId, executionMode, deepResearchStatus, deepRagStatus, simpleRagStatus, isSendingUserInput]);


  const onSessionSelect = useCallback(async (id: number) => {
    if (id === activeSessionId) {
        if (executionMode === 'simple') mutateSimpleRag();
        else if (executionMode === 'Deep') mutateDeepResearch();
        else if (executionMode === 'deepRag') mutateDeepRag();
        return;
    }
    
    setIsLoadingSession(true);
    try {
        const sessionType = await detectSessionType(id);
        setExecutionMode(sessionType);
        setActiveSessionId(id);
    } catch (error) {
        console.error(`Failed to detect session type for ${id}:`, error);
        setExecutionMode('simple');
        setActiveSessionId(id);
        setIsLoadingSession(false);
    }
  }, [activeSessionId, executionMode, mutateSimpleRag, mutateDeepResearch, mutateDeepRag]);

  const onMobileSessionSelect = useCallback(async (id: number) => {
    if (id === activeSessionId) {
        if (executionMode === 'simple') mutateSimpleRag();
        else if (executionMode === 'Deep') mutateDeepResearch();
        else if (executionMode === 'deepRag') mutateDeepRag();
        setIsLeftSheetOpen(false);
        return;
    }

    setIsLoadingSession(true);
    try {
        const sessionType = await detectSessionType(id);
        setExecutionMode(sessionType);
        setActiveSessionId(id);
        setIsLeftSheetOpen(false);
    } catch (error) {
        console.error(`Mobile failed to detect session type for ${id}:`, error);
        setExecutionMode('simple');
        setActiveSessionId(id);
        setIsLeftSheetOpen(false);
        setIsLoadingSession(false);
    }
  }, [activeSessionId, executionMode, mutateSimpleRag, mutateDeepResearch, mutateDeepRag]);

  const onDeleteSession = useCallback(async (id: number) => {
    if (confirm("このセッションを削除しますか？")) {
      if (id === activeSessionId) {
        setActiveSessionId(null);
        setDisplayMessages([]);
        setIsPollingActive(false);
        setIsSendingUserInput(false);
      }
      await deleteRagSession(id);
      mutateSessions();
    }
  }, [activeSessionId, mutateSessions]);

  if (authStatus === "loading" || isLoadingSessions || isLoadingTagCategories || isLoadingTagsSummary) {
    return <div className="flex h-screen items-center justify-center"><Loader2 className="h-12 w-12 animate-spin" /></div>;
  }

  if (isErrorTagCategories) {
    console.error('タグカテゴリーの読み込みに失敗しました');
  }

  if (isErrorTagsSummary) {
    console.error('タグ集計の読み込みに失敗しました');
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <style jsx global>{`
        .prose {
          max-width: min(90%, 1000px) !important;
          word-break: break-word !important;
          overflow-wrap: break-word !important;
        }
        .rag-message-wrapper {
          max-width: 100%;
          overflow: hidden;
        }
        .rag-message-content {
          overflow-x: auto;
          overflow-y: hidden;
          word-wrap: break-word;
          word-break: break-word;
          overflow-wrap: anywhere;
          hyphens: auto;
          will-change: transform;
          transform: translateZ(0);
          max-width: 100%;
          box-sizing: border-box;
        }
        .rag-message-content * {
          max-width: 100%;
          box-sizing: border-box;
        }
        .rag-message-content p,
        .rag-message-content div {
          word-break: break-word;
          overflow-wrap: anywhere;
          max-width: 100%;
          white-space: pre-wrap;
        }
        .rag-message-content .katex-display {
          overflow-x: auto;
          overflow-y: hidden;
          max-width: min(75vw, 100%);
          padding: 0.5rem 0;
          margin: 0.5rem 0;
          white-space: nowrap;
          scrollbar-width: thin;
          scrollbar-color: rgba(156, 163, 175, 0.5) transparent;
        }
        .rag-message-content .katex-display::-webkit-scrollbar { height: 6px; }
        .rag-message-content .katex-display::-webkit-scrollbar-track { background: transparent; }
        .rag-message-content .katex-display::-webkit-scrollbar-thumb { background-color: rgba(156, 163, 175, 0.5); border-radius: 3px; }
        @media (min-width: 768px) { .rag-message-content .katex-display { max-width: min(65vw, 100%); } }
        @media (min-width: 1024px) { .rag-message-content .katex-display { max-width: min(70vw, 100%); } }
        @media (min-width: 1440px) { .rag-message-content .katex-display { max-width: min(65vw, 100%); } }
        .rag-message-content pre {
          overflow-x: auto;
          overflow-y: hidden;
          max-width: min(75vw, 100%);
          white-space: pre;
          word-wrap: normal;
          word-break: normal;
          margin: 0.5rem 0;
          padding: 0.75rem;
          border-radius: 0.375rem;
          background-color: #1a1a1a;
          color: #f0f0f0;
          font-size: 0.875rem;
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          will-change: scroll-position;
          transform: translateZ(0);
          scrollbar-width: thin;
          scrollbar-color: rgba(156, 163, 175, 0.5) #1a1a1a;
        }
        .rag-message-content pre::-webkit-scrollbar { height: 6px; }
        .rag-message-content pre::-webkit-scrollbar-track { background: #1a1a1a; }
        .rag-message-content pre::-webkit-scrollbar-thumb { background-color: rgba(156, 163, 175, 0.5); border-radius: 3px; }
        @media (min-width: 768px) { .rag-message-content pre { max-width: min(45vw, 100%); } }
        @media (min-width: 1024px) { .rag-message-content pre { max-width: min(45vw, 100%); } }
        @media (min-width: 1440px) { .rag-message-content pre { max-width: min(65vw, 100%); } }
        .dark .rag-message-content pre { background-color: #0d1117; color: #f0f6fc; }
        .dark .rag-message-content pre::-webkit-scrollbar-track { background: #0d1117; }
        .rag-message-content code:not(pre code) {
          display: inline-block;
          max-width: 100%;
          overflow-x: auto;
          word-break: break-all;
          overflow-wrap: break-word;
          padding: 0.125rem 0.25rem;
          background-color: rgba(226, 232, 240, 0.4);
          color: #c71585;
          border-radius: 0.25rem;
          font-size: 0.75rem;
          font-weight: normal;
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          vertical-align: baseline;
          white-space: pre-wrap;
        }
        .dark .rag-message-content code:not(pre code) { background-color: rgba(226, 232, 240, 0.08); color: #ff7f50; }
        .rag-message-content a {
          word-break: break-all;
          overflow-wrap: anywhere;
          max-width: 100%;
          display: inline;
          text-decoration: underline;
          color: inherit;
          vertical-align: baseline;
          white-space: normal !important;
          overflow: visible !important;
          text-overflow: initial !important;
        }
        .rag-message-content table {
          display: block;
          overflow-x: auto;
          overflow-y: hidden;
          white-space: nowrap;
          max-width: min(75vw, 100%);
          border-collapse: collapse;
          margin: 0.5rem 0;
          scrollbar-width: thin;
          scrollbar-color: rgba(156, 163, 175, 0.5) transparent;
        }
        .rag-message-content table::-webkit-scrollbar { height: 6px; }
        .rag-message-content table::-webkit-scrollbar-track { background: transparent; }
        .rag-message-content table::-webkit-scrollbar-thumb { background-color: rgba(156, 163, 175, 0.5); border-radius: 3px; }
        @media (min-width: 768px) { .rag-message-content table { max-width: min(65vw, 100%); } }
        @media (min-width: 1024px) { .rag-message-content table { max-width: min(70vw, 100%); } }
        @media (min-width: 1440px) { .rag-message-content table { max-width: min(65vw, 100%); } }
        .rag-message-content td, .rag-message-content th {
          word-break: break-word;
          overflow-wrap: break-word;
          white-space: normal;
          min-width: 100px;
          max-width: 300px;
        }
        .rag-message-content img { max-width: 100%; height: auto; display: block; margin: 0.5rem 0; }
        .rag-message-content p { word-break: break-word; overflow-wrap: break-word; max-width: 100%; margin: 0.5rem 0; }
        .rag-message-content ul, .rag-message-content ol { word-break: break-word; overflow-wrap: break-word; max-width: 100%; padding-left: 1.5rem; }
        .rag-message-content li { word-break: break-word; overflow-wrap: break-word; max-width: 100%; margin: 0.25rem 0; }
        .rag-message-content blockquote {
          word-break: break-word;
          overflow-wrap: break-word;
          max-width: 100%;
          margin: 0.5rem 0;
          padding-left: 1rem;
          border-left: 4px solid #e5e7eb;
          font-style: italic;
        }
        .dark .rag-message-content blockquote { border-left-color: #374151; }
        .rag-message-content h1, .rag-message-content h2, .rag-message-content h3, .rag-message-content h4, .rag-message-content h5, .rag-message-content h6 {
          word-break: break-word;
          overflow-wrap: break-word;
          max-width: 100%;
          margin: 1rem 0 0.5rem 0;
        }
        .rag-message-force-width { max-width: 95vw !important; overflow-x: auto !important; word-break: break-all !important; }
        .force-wrap {
          word-break: break-all !important;
          overflow-wrap: anywhere !important;
          white-space: pre-wrap !important;
        }
        .rag-message-content::-webkit-scrollbar {
          height: 4px;
          width: 4px;
        }
        .rag-message-content::-webkit-scrollbar-track {
          background: transparent;
        }
        .rag-message-content::-webkit-scrollbar-thumb {
          background-color: rgba(156, 163, 175, 0.3);
          border-radius: 2px;
        }
        .rag-message-content::-webkit-scrollbar-thumb:hover {
          background-color: rgba(156, 163, 175, 0.5);
        }
        @media (max-width: 767px) {
          .prose {
            max-width: min(85vw, 350px) !important;
          }
          .rag-message-content { max-width: 85vw; }
          .rag-message-content .katex-display, .rag-message-content pre, .rag-message-content table { max-width: 85vw; }
          .rag-message-content a { max-width: 85vw; }
        }
        @media (min-width: 768px) and (max-width: 1023px) {
          .prose {
            max-width: min(80vw, 600px) !important;
          }
        }
        @media (min-width: 1440px) {
          .prose {
            max-width: min(70vw, 900px) !important;
          }
        }
        .rag-message-content {
            line-height: 1.2; /* この数値を調整します */
          }
        .rag-message-content p,
        .rag-message-content blockquote {
          margin-top: 0.25rem;
          margin-bottom: 0.25rem;
        }

        .rag-message-content ul,
        .rag-message-content ol {
          margin-top: 0.25rem;
          margin-bottom: 0.25rem;
          padding-left: 1.5rem;
        }

        .rag-message-content li {
          margin-top: 0.125rem;
          margin-bottom: 0.125rem;
          line-height: 1.4;
        }
        
        /* 箇条書きのネストした場合の調整 */
        .rag-message-content li > ul,
        .rag-message-content li > ol {
          margin-top: 0.125rem;
          margin-bottom: 0.125rem;
        }
        
        /* 段落と箇条書きの間隔調整 */
        .rag-message-content p + ul,
        .rag-message-content p + ol,
        .rag-message-content ul + p,
        .rag-message-content ol + p {
          margin-top: 0.25rem;
        }
        
        /* 水平線のカスタムスタイル */
        .rag-message-content hr,
        .prose hr {
          margin-top: 0.5rem !important;
          margin-bottom: 0.5rem !important;
          margin-left: 0 !important;
          margin-right: 0 !important;
          border: 0 !important;
          border-top: 1px solid rgba(128, 128, 128, 0.3) !important;
          height: 0 !important;
          padding: 0 !important;
        }
        
        /* 水平線の前後の要素の間隔を調整 */
        .rag-message-content p + hr,
        .rag-message-content hr + p,
        .prose p + hr,
        .prose hr + p {
          margin-top: 0.5rem !important;
        }
        
        /* proseクラス内のデフォルトマージンを上書き */
        .prose :where(hr):not(:where([class~="not-prose"] *)) {
          margin-top: 0.5rem !important;
          margin-bottom: 0.5rem !important;
        }
        
        /* Tailwind Typographyのhr要素のスタイルを完全に上書き */
        .prose :where(hr) {
          margin-top: 0.5rem !important;
          margin-bottom: 0.5rem !important;
        }
        
        /* 前後の要素との間隔を強制的に設定 */
        .prose > * + hr,
        .prose > hr + * {
          margin-top: 0.5rem !important;
        }
        
        /* 段落と水平線の間隔を明示的に指定 */
        .prose p:has(+ hr) {
          margin-bottom: 0.5rem !important;
        }
        
        .prose hr:has(+ p) {
          margin-bottom: 0.5rem !important;
        }
        
        /* 箇条書きのProseクラス用スタイル */
        .prose ul,
        .prose ol {
          margin-top: 0.25rem !important;
          margin-bottom: 0.25rem !important;
          padding-left: 1.5rem !important;
        }
        
        .prose li {
          margin-top: 0.125rem !important;
          margin-bottom: 0.125rem !important;
          line-height: 1.4 !important;
        }
        
        .prose :where(ul):not(:where([class~="not-prose"] *)),
        .prose :where(ol):not(:where([class~="not-prose"] *)) {
          margin-top: 0.25rem !important;
          margin-bottom: 0.25rem !important;
        }
        
        .prose :where(li):not(:where([class~="not-prose"] *)) {
          margin-top: 0.125rem !important;
          margin-bottom: 0.125rem !important;
        }
        
        /* 段落と箇条書きの間隔を明示的に指定 */
        .prose p + ul,
        .prose p + ol,
        .prose ul + p,
        .prose ol + p {
          margin-top: 0.25rem !important;
        }
        
        /* 箇条書き項目内の段落調整 */
        .prose li > p,
        .rag-message-content li > p {
          margin-top: 0 !important;
          margin-bottom: 0 !important;
          display: inline;
        }
        
        /* ネストした箇条書きの調整 */
        .prose li > ul,
        .prose li > ol,
        .rag-message-content li > ul,
        .rag-message-content li > ol {
          margin-top: 0.125rem !important;
          margin-bottom: 0.125rem !important;
        }
      `}</style>
      {!isMobile && isSidebarOpen && (
        <>
          <aside 
            className="border-r border-border bg-card flex flex-col flex-shrink-0"
            style={{ width: leftSidebarWidth }}
          >
            <div className="flex justify-start p-2 shrink-0"> <Button variant="ghost" size="sm" onClick={() => setIsSidebarOpen(false)}>会話履歴を隠す</Button> </div>
            <div className="p-4 overflow-auto flex-1">
              <Button className="w-full mb-4" onClick={handleNewSession} disabled={isLoadingSessions}> {isLoadingSessions ? "読込中..." : "New Session"} </Button>
              {sessions.map((s) => createSessionItem(s, onSessionSelect, onDeleteSession))}
            </div>
          </aside>
          <div
            className="w-1 bg-muted hover:bg-muted-foreground/20 cursor-ew-resize flex-shrink-0"
            onMouseDown={onMouseDownLeft}
          />
        </>
      )}

      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex justify-between items-center p-4 border-b border-border bg-card shrink-0">
          <div className="flex items-center gap-2">
            {isMobile ? (
              <Sheet open={isLeftSheetOpen} onOpenChange={setIsLeftSheetOpen}>
                <SheetTrigger asChild>
                  <Button size="sm" variant="outline" className="btn-nav">
                    <Menu className="mr-2 h-4 w-4" />
                    履歴
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-80 sm:w-96">
                  <SheetHeader>
                    <SheetTitle>会話履歴</SheetTitle>
                    <SheetDescription>
                      過去のRAGセッション一覧
                    </SheetDescription>
                  </SheetHeader>
                  <div className="mt-4 h-full overflow-y-auto">
                    <div className="p-4 overflow-auto flex-1">
                      <Button className="w-full mb-4" onClick={handleNewSession} disabled={isLoadingSessions}> {isLoadingSessions ? "読込中..." : "New Session"} </Button>
                      {sessions.map((s) => createSessionItem(s, onMobileSessionSelect, onDeleteSession))}
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            ) : (
              <Button size="sm" onClick={() => setIsSidebarOpen((v) => !v)}>
                {isMobile 
                  ? (isSidebarOpen ? "履歴" : "履歴") 
                  : (isSidebarOpen ? "履歴を隠す" : "履歴を表示")
                }
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild className="btn-nav">
                <Link href="/">
                    <Home className="mr-2 h-4 w-4" />
                    {isMobile ? "" : "ホーム"}
                </Link>
            </Button>
            <Button variant="outline" size="sm" asChild className="btn-nav">
                <Link href="/papers">
                    <List className="mr-2 h-4 w-4" />
                    {isMobile ? "" : "一覧"}
                </Link>
            </Button>
            <Button variant="outline" size="sm" asChild className="btn-nav">
                <Link href="/papers/add">
                    <FilePlus2 className="mr-2 h-4 w-4" />
                    {isMobile ? "" : "論文追加"}
                </Link>
            </Button>
            <ThemeToggle />
            {isMobile ? (
              <Sheet open={isRightSheetOpen} onOpenChange={setIsRightSheetOpen}>
                <SheetTrigger asChild>
                  <Button size="sm" variant="outline" className="btn-nav">
                    <Settings className="mr-2 h-4 w-4" />
                    設定
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-80 sm:w-96">
                  <SheetHeader>
                    <SheetTitle>モデル設定</SheetTitle>
                    <SheetDescription>
                      RAGモードとモデルの設定
                    </SheetDescription>
                  </SheetHeader>
                  <div className="mt-4 h-full overflow-y-auto">
                    <Card className="flex-1 flex flex-col overflow-hidden rounded-none border-0 border-t border-border">
                      <CardHeader className="flex justify-between items-center shrink-0"><CardTitle>設定</CardTitle></CardHeader>
                      <CardContent className="p-4 overflow-auto">
                        {memoizedSettingsPanel}
                      </CardContent>
                    </Card>
                  </div>
                </SheetContent>
              </Sheet>
            ) : (
              <Button size="sm" onClick={() => setIsModelOpen((v) => !v)}>{isModelOpen ? "設定を隠す" : "設定を表示"}</Button>
            )}
          </div>
        </div>
        
        <div className="flex-1 relative overflow-hidden m-4">
          <div
            className="absolute inset-0 bg-cover bg-center bg-no-repeat rounded-lg"
            style={{
              backgroundImage: `url('${backgroundImagePath}')`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
          <div className="absolute inset-0 bg-black/20 rounded-lg" />
          <Card className="h-full flex flex-col relative z-10 bg-background/10 backdrop-blur-none border-border/50 rounded-lg">
            <CardContent ref={refsContainerRef} className="flex-1 flex flex-col p-2 min-h-0 bg-transparent">
              {isLoadingSession ? (
                <SessionLoadingDisplay />
              ) : (
                <>
                <ScrollArea className="flex-1 overflow-auto mb-2">
                  <div className="space-y-2 p-1">
                    {(executionMode === 'Deep' && isLoadingDeepResearch && (!deepResearchStatus || deepResearchStatus.session_id !== activeSessionId)) && (<div className="text-center text-xs text-muted-foreground">DeepResearchデータ読み込み中...</div>)}
                    {(executionMode === 'deepRag' && isLoadingDeepRag && (!deepRagStatus || deepRagStatus.session_id !== activeSessionId)) && (<div className="text-center text-xs text-muted-foreground">DeepRAGデータ読み込み中...</div>)}
                    {(executionMode === 'simple' && isLoadingSimpleRag && (!simpleRagStatus || simpleRagStatus.session_id !== activeSessionId)) && (<div className="text-center text-xs text-muted-foreground">Simple RAGデータ読み込み中...</div>)}

                    {memoizedMessages}

                    {isAnyProcessing && (
                      <div ref={aiThinkingRef}>
                        <AIThinkingLoader />
                      </div>
                    )}
                  </div>
                </ScrollArea>

                <OptimizedInputArea 
                  ref={inputRef}
                  onSend={handleSend} 
                  isProcessing={isAnyProcessing}
                />
              </>
            )}
          </CardContent>
        </Card>
      </div>
      </main>

      {!isMobile && isModelOpen && (
        <>
          <div
            className="w-1 bg-muted hover:bg-muted-foreground/20 cursor-ew-resize flex-shrink-0"
            onMouseDown={onMouseDownRight}
          />
          <aside 
            className="border-l border-border bg-card flex flex-col overflow-hidden flex-shrink-0"
            style={{ width: rightSidebarWidth }}
          >
            <div className="flex justify-end p-2 shrink-0"> <Button variant="ghost" size="sm" onClick={() => setIsModelOpen(false)}>モデル設定を隠す</Button> </div>
            <Card className="flex-1 flex flex-col overflow-hidden rounded-none border-0 border-t border-border">
              <CardHeader className="flex justify-between items-center shrink-0"><CardTitle>設定</CardTitle></CardHeader>
              <CardContent className="p-4 overflow-auto">
                {memoizedSettingsPanel}
              </CardContent>
            </Card>
          </aside>
        </>
      )}
    </div>
  );
}