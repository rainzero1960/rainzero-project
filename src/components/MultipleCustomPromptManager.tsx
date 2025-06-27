"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { authenticatedFetch } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { 
  Loader2, AlertTriangle, Edit3, Save, Trash2, Plus, 
  Copy, FileText, Search, RefreshCw, ChevronDown, ChevronRight,
  Shield, User, Eye, EyeOff
} from "lucide-react";

// 型定義
interface SystemPrompt {
  id?: number | null;
  prompt_type: string;
  name: string;
  description: string;
  prompt: string;
  category: string;
  user_id?: number | null;
  is_active: boolean;
  is_custom: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

interface PromptTypeInfo {
  type: string;
  name: string;
  description: string;
  category: string;
  has_custom: boolean;
  is_active: boolean;
}

interface SystemPromptListResponse {
  prompts: SystemPrompt[];
  total: number;
}

interface PromptTypesResponse {
  prompt_types: PromptTypeInfo[];
  categories: string[];
}

interface CreatePromptData {
  prompt_type: string;
  name: string;
  description: string;
  prompt: string;
  category: string;
  is_active: boolean;
}

interface CategoryGroup {
  category: string;
  displayName: string;
  prompts: SystemPrompt[];
}

// 表示対象のプロンプトタイプの定義
const DEFAULT_PROMPT_TYPES = [
  'paper_summary_initial',
  'tag_categories_config',
  'paper_chat_system_prompt',
  'rag_no_tool_system_template',
  'rag_base_system_template',
  'rag_tool_prompt_parts',
  'deepresearch_coordinator',
  'deepresearch_planner',
  'deepresearch_supervisor',
  'deepresearch_agent',
  'deepresearch_summary',
  'deeprag_coordinator',
  'deeprag_planner',
  'deeprag_supervisor',
  'deeprag_agent',
  'deeprag_summary',
];

// カテゴリ表示名のマッピング
const CATEGORY_DISPLAY_NAMES: { [key: string]: string } = {
  'paper_summary': 'AI論文要約プロンプト',
  'tag_management': '論文自動付与TAGリスト',
  'paper': '論文詳細質問プロンプト',
  'rag': 'ツール付LLMシステムプロンプト',
  'deepresearch': 'Deep Researchエージェント用プロンプト',
  'deeperag': 'Deep RAG（論文検索用）エージェント用プロンプト',
};

// カテゴリの表示順序
const CATEGORY_ORDER = [
  'paper_summary',
  'tag_management', 
  'paper',
  'rag',
  'deepresearch',
  'deeperag',
];

export default function MultipleCustomPromptManager() {
  const { data: session } = useSession();

  // State
  const [allPrompts, setAllPrompts] = useState<SystemPrompt[]>([]);
  const [promptsByCategory, setPromptsByCategory] = useState<CategoryGroup[]>([]);
  const [promptTypes, setPromptTypes] = useState<PromptTypeInfo[]>([]);
  // const [_categories, _setCategories] = useState<string[]>([]); // 未使用
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  
  // 全体表示関連
  const [showAllPrompts, setShowAllPrompts] = useState(false);
  const [showWarningDialog, setShowWarningDialog] = useState(false);
  
  // フィルター関連
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedPromptType, setSelectedPromptType] = useState<string>("all");
  const [filterByType, setFilterByType] = useState<"all" | "default" | "custom">("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  
  // ダイアログ関連
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<SystemPrompt | null>(null);
  
  // 作成フォーム
  const [createForm, setCreateForm] = useState<CreatePromptData>({
    prompt_type: "",
    name: "",
    description: "",
    prompt: "",
    category: "",
    is_active: true
  });
  
  // Loading states
  const [loading, setLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  
  // Error and success states
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // API関数
  const fetchAllPrompts = useCallback(async () => {
    if (!session?.accessToken) return;

    setLoading(true);
    setError(null);
    try {
      // 1. プロンプトタイプ情報を取得
      const typesRes = await authenticatedFetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/system_prompts/types`
      );
      
      if (!typesRes.ok) {
        throw new Error("Failed to fetch prompt types");
      }
      
      const typesData: PromptTypesResponse = await typesRes.json();
      setPromptTypes(typesData.prompt_types);
      // setCategories(["all", ...typesData.categories]); // 未使用のため削除
      
      // 2. カスタムプロンプトを取得
      const customRes = await authenticatedFetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/system_prompts/custom`
      );
      
      if (!customRes.ok) {
        throw new Error("Failed to fetch custom prompts");
      }
      
      const customData: SystemPromptListResponse = await customRes.json();
      const customPrompts: SystemPrompt[] = customData.prompts.map((p: SystemPrompt) => ({
        ...p,
        is_custom: true,
      }));
      
      // 3. デフォルトプロンプトを構築
      const defaultPrompts: SystemPrompt[] = typesData.prompt_types.map((typeInfo: PromptTypeInfo) => ({
        id: null,
        prompt_type: typeInfo.type,
        name: typeInfo.name,
        description: typeInfo.description,
        category: typeInfo.category,
        user_id: null,
        is_active: true,
        is_custom: false,
        created_at: null,
        updated_at: null,
        prompt: "", // 詳細は個別に取得する必要がある
      }));
      
      // 4. すべてのプロンプトを結合
      const allPromptsData = [...defaultPrompts, ...customPrompts];
      setAllPrompts(allPromptsData);
      
      // 5. カテゴリごとにグループ化
      groupPromptsByCategory(allPromptsData);
      
    } catch (err: unknown) {
      console.error("[ERROR] Failed to fetch prompts:", err);
      setError(err instanceof Error ? err.message : "プロンプトの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.accessToken]);

  // プロンプトをカテゴリごとにグループ化
  const groupPromptsByCategory = useCallback((prompts: SystemPrompt[]) => {
    // フィルタリング処理
    const filteredPrompts = showAllPrompts 
      ? prompts 
      : prompts.filter(prompt => 
          DEFAULT_PROMPT_TYPES.includes(prompt.prompt_type) || prompt.is_custom
        );

    const grouped = filteredPrompts.reduce((acc: Record<string, SystemPrompt[]>, prompt) => {
      const category = prompt.category;
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(prompt);
      return acc;
    }, {});
    
    // カテゴリ順にソート（指定された順序を使用）
    const categoryGroups: CategoryGroup[] = [];
    
    // まず指定された順序のカテゴリを処理
    CATEGORY_ORDER.forEach(category => {
      if (grouped[category]) {
        categoryGroups.push({
          category,
          displayName: CATEGORY_DISPLAY_NAMES[category] || category,
          prompts: grouped[category].sort((a, b) => {
            // デフォルトプロンプトを先に、その後カスタムプロンプト
            if (a.is_custom !== b.is_custom) {
              return a.is_custom ? 1 : -1;
            }
            return a.name.localeCompare(b.name);
          }),
        });
        delete grouped[category]; // 処理済みなので削除
      }
    });
    
    // その他のカテゴリ（全体表示時のみ）
    Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([category, prompts]) => {
        categoryGroups.push({
          category,
          displayName: CATEGORY_DISPLAY_NAMES[category] || category,
          prompts: prompts.sort((a, b) => {
            if (a.is_custom !== b.is_custom) {
              return a.is_custom ? 1 : -1;
            }
            return a.name.localeCompare(b.name);
          }),
        });
      });
    
    setPromptsByCategory(categoryGroups);
  }, [showAllPrompts]);

  // デフォルトプロンプトの詳細を取得
  const fetchDefaultPromptDetail = async (promptType: string): Promise<string> => {
    if (!session?.accessToken) return "";
    
    try {
      const res = await authenticatedFetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/system_prompts/${promptType}`
      );
      
      if (!res.ok) {
        throw new Error("Failed to fetch prompt detail");
      }
      
      const data = await res.json();
      return data.prompt;
      
    } catch (err) {
      console.error("[ERROR] Failed to fetch prompt detail:", err);
      return "";
    }
  };

  const createCustomPrompt = async () => {
    if (!session?.accessToken) return;

    setSaveLoading(true);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      const response = await authenticatedFetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/system_prompts/custom`,
        {
          method: "POST",
          body: JSON.stringify(createForm),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: "作成に失敗しました" }));
        throw new Error(errorData.detail || `Create failed: ${response.statusText}`);
      }

      setSaveSuccess("カスタムプロンプトが正常に作成されました");
      setIsCreateDialogOpen(false);
      resetCreateForm();
      
      // データを再取得
      await fetchAllPrompts();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "カスタムプロンプトの作成に失敗しました");
    } finally {
      setSaveLoading(false);
    }
  };

  const updateCustomPrompt = async () => {
    if (!session?.accessToken || !editingPrompt || !editingPrompt.id) return;

    setSaveLoading(true);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      const response = await authenticatedFetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/system_prompts/custom/${editingPrompt.id}`,
        {
          method: "PUT",
          body: JSON.stringify({
            name: editingPrompt.name,
            description: editingPrompt.description,
            prompt: editingPrompt.prompt,
            is_active: editingPrompt.is_active,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: "更新に失敗しました" }));
        throw new Error(errorData.detail || `Update failed: ${response.statusText}`);
      }

      setSaveSuccess("カスタムプロンプトが正常に更新されました");
      setIsEditDialogOpen(false);
      setEditingPrompt(null);
      
      // データを再取得
      await fetchAllPrompts();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "カスタムプロンプトの更新に失敗しました");
    } finally {
      setSaveLoading(false);
    }
  };

  const getRelatedSummariesCount = async (promptId: number): Promise<number> => {
    if (!session?.accessToken) throw new Error("認証情報がありません");

    const response = await authenticatedFetch(
      `${process.env.NEXT_PUBLIC_BACKEND_URL}/system_prompts/custom/${promptId}/related-summaries`
    );

    if (!response.ok) {
      throw new Error("関連要約の確認に失敗しました");
    }

    const data = await response.json();
    return data.related_summaries_count;
  };

  const deleteCustomPrompt = async (promptId: number) => {
    if (!session?.accessToken) return;

    setSaveLoading(true);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      // まず関連要約数を確認
      const relatedCount = await getRelatedSummariesCount(promptId);
      
      // プロンプト情報を取得
      const prompt = allPrompts.find((p: SystemPrompt) => p.id === promptId);
      const promptName = prompt?.name || "不明なプロンプト";

      // 詳細な確認ダイアログを表示
      let confirmMessage: string;
      if (relatedCount > 0) {
        confirmMessage = `このカスタムプロンプト「${promptName}」を削除しますか？\n\n⚠️ ${relatedCount}件の関連する要約も同時に削除されます。\n\nこの操作は取り消せません。`;
      } else {
        confirmMessage = `このカスタムプロンプト「${promptName}」を削除しますか？\n\nこの操作は取り消せません。`;
      }

      if (!confirm(confirmMessage)) {
        return;
      }

      // 確認済みで削除を実行
      const response = await authenticatedFetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/system_prompts/custom/${promptId}?confirm=true`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: "削除に失敗しました" }));
        throw new Error(errorData.detail || `Delete failed: ${response.statusText}`);
      }

      if (relatedCount > 0) {
        setSaveSuccess(`カスタムプロンプト「${promptName}」と関連する${relatedCount}件の要約が削除されました`);
      } else {
        setSaveSuccess(`カスタムプロンプト「${promptName}」が削除されました`);
      }
      
      // データを再取得
      await fetchAllPrompts();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "カスタムプロンプトの削除に失敗しました");
    } finally {
      setSaveLoading(false);
    }
  };

  const duplicatePrompt = async (prompt: SystemPrompt) => {
    // デフォルトプロンプトの場合は詳細を取得
    let promptContent = prompt.prompt;
    if (!prompt.is_custom && !prompt.prompt) {
      promptContent = await fetchDefaultPromptDetail(prompt.prompt_type);
    }
    
    setCreateForm({
      prompt_type: prompt.prompt_type,
      name: `${prompt.name} (コピー)`,
      description: prompt.description,
      prompt: promptContent,
      category: prompt.category,
      is_active: prompt.is_active || true,
    });
    setIsCreateDialogOpen(true);
  };

  const resetCreateForm = () => {
    setCreateForm({
      prompt_type: "",
      name: "",
      description: "",
      prompt: "",
      category: "",
      is_active: true
    });
  };

  // 全体表示チェックボックスの処理
  const handleShowAllPromptsToggle = (checked: boolean) => {
    if (checked && !showAllPrompts) {
      setShowWarningDialog(true);
    } else if (!checked) {
      setShowAllPrompts(false);
      // データを再グループ化
      fetchAllPrompts();
    }
  };

  const confirmShowAllPrompts = () => {
    setShowAllPrompts(true);
    setShowWarningDialog(false);
    // データを再グループ化
    fetchAllPrompts();
  };

  // カテゴリの展開/折りたたみトグル
  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(category)) {
        newSet.delete(category);
      } else {
        newSet.add(category);
      }
      return newSet;
    });
  };

  // Effects
  useEffect(() => {
    if (session?.accessToken) {
      fetchAllPrompts();
    }
  }, [session?.accessToken, fetchAllPrompts]);

  // showAllPromptsが変更されたときに再取得
  useEffect(() => {
    if (session?.accessToken && showAllPrompts !== undefined) {
      fetchAllPrompts();
    }
  }, [showAllPrompts, session?.accessToken, fetchAllPrompts]);

  // フィルタリング
  const getFilteredPromptsByCategory = (): CategoryGroup[] => {
    let filtered = promptsByCategory;
    
    // カテゴリフィルター
    if (selectedCategory !== "all") {
      filtered = filtered.filter(group => group.category === selectedCategory);
    }
    
    // プロンプトタイプフィルター
    if (selectedPromptType !== "all") {
      filtered = filtered.map(group => ({
        ...group,
        prompts: group.prompts.filter(p => p.prompt_type === selectedPromptType),
      })).filter(group => group.prompts.length > 0);
    }
    
    // デフォルト/カスタムフィルター
    if (filterByType !== "all") {
      filtered = filtered.map(group => ({
        ...group,
        prompts: group.prompts.filter(p => 
          filterByType === "custom" ? p.is_custom : !p.is_custom
        ),
      })).filter(group => group.prompts.length > 0);
    }
    
    // 検索フィルター
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.map(group => ({
        ...group,
        prompts: group.prompts.filter(p =>
          p.name.toLowerCase().includes(query) ||
          p.description.toLowerCase().includes(query) ||
          p.prompt.toLowerCase().includes(query)
        ),
      })).filter(group => group.prompts.length > 0);
    }
    
    return filtered;
  };

  const getCategoryBadgeColor = (category: string) => {
    const colors: { [key: string]: string } = {
      "paper_summary": "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
      "tag_management": "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
      "paper": "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200", 
      "rag": "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
      "deepresearch": "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
      "deeperag": "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
    };
    return colors[category] || "bg-gray-100 text-gray-800";
  };

  // フィルター用のプロンプトタイプを取得
  const getFilterPromptTypes = () => {
    if (showAllPrompts) {
      return promptTypes;
    }
    return promptTypes.filter(pt => DEFAULT_PROMPT_TYPES.includes(pt.type));
  };

  // カテゴリフィルターが適用されているときは該当カテゴリを自動展開
  useEffect(() => {
    if (selectedCategory !== "all") {
      setExpandedCategories(prev => {
        const newSet = new Set(prev);
        newSet.add(selectedCategory);
        return newSet;
      });
    }
  }, [selectedCategory]);

  // プロンプトタイプフィルターが適用されているときは該当カテゴリを自動展開
  useEffect(() => {
    if (selectedPromptType !== "all" && promptsByCategory.length > 0) {
      const categoriesToExpand: string[] = [];
      
      promptsByCategory.forEach(group => {
        const hasMatchingPrompt = group.prompts.some(prompt => 
          prompt.prompt_type === selectedPromptType
        );
        if (hasMatchingPrompt) {
          categoriesToExpand.push(group.category);
        }
      });
      
      if (categoriesToExpand.length > 0) {
        setExpandedCategories(prev => {
          const newSet = new Set(prev);
          categoriesToExpand.forEach(category => newSet.add(category));
          return newSet;
        });
      }
    }
  }, [selectedPromptType, promptsByCategory]);

  // フィルター用のカテゴリ選択肢を生成
  const getFilterCategories = () => {
    const displayCategories = promptsByCategory.map(group => ({
      value: group.category,
      label: group.displayName
    }));
    return [{ value: "all", label: "すべて" }, ...displayCategories];
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center">
            <FileText className="mr-2 h-5 w-5" />
            システムプロンプト管理
          </span>
          <Button onClick={() => setIsCreateDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            新規作成
          </Button>
        </CardTitle>
        <CardDescription>
          各機能で使用されるシステムプロンプトを管理します。
          デフォルトプロンプトをベースにカスタマイズすることができます。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>エラー</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {saveError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>保存エラー</AlertTitle>
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        )}

        {saveSuccess && (
          <Alert className="border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-800">
            <AlertTitle className="text-green-800 dark:text-green-200">成功</AlertTitle>
            <AlertDescription className="text-green-700 dark:text-green-300">{saveSuccess}</AlertDescription>
          </Alert>
        )}

        {/* 全体表示チェックボックス */}
        <div className="flex items-center space-x-2 p-4 bg-muted/30 rounded-lg">
          <Checkbox
            id="show-all-prompts"
            checked={showAllPrompts}
            onCheckedChange={handleShowAllPromptsToggle}
          />
          <Label htmlFor="show-all-prompts" className="flex items-center cursor-pointer">
            {showAllPrompts ? (
              <EyeOff className="mr-2 h-4 w-4" />
            ) : (
              <Eye className="mr-2 h-4 w-4" />
            )}
            すべてのプロンプトタイプを表示
          </Label>
          {showAllPrompts && (
            <Badge variant="outline" className="text-xs">
              全体表示中
            </Badge>
          )}
        </div>

        {/* フィルターとアクション */}
        <div className="space-y-4">
          <div className="flex flex-col space-y-4 md:flex-row md:space-y-0 md:space-x-4 md:items-end">
            <div className="flex-1 space-y-2">
              <Label>検索</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="プロンプト名、説明、内容で検索..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label>カテゴリ</Label>
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {getFilterCategories().map(category => (
                    <SelectItem key={category.value} value={category.value}>
                      {category.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>プロンプトタイプ</Label>
              <Select value={selectedPromptType} onValueChange={setSelectedPromptType}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">すべて</SelectItem>
                  {getFilterPromptTypes().map(pt => (
                    <SelectItem key={pt.type} value={pt.type}>
                      {pt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>表示タイプ</Label>
              <Select value={filterByType} onValueChange={(v: "all" | "custom" | "default") => setFilterByType(v)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">すべて</SelectItem>
                  <SelectItem value="default">デフォルトのみ</SelectItem>
                  <SelectItem value="custom">カスタムのみ</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button 
              onClick={fetchAllPrompts} 
              variant="outline" 
              size="icon"
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        <Separator />

        {/* プロンプト一覧（カテゴリごと） */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : getFilteredPromptsByCategory().length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            検索条件に一致するプロンプトが見つかりません。
          </div>
        ) : (
          <div className="space-y-4">
            {getFilteredPromptsByCategory().map((group) => (
              <Card key={group.category} className="overflow-hidden">
                <Collapsible 
                  open={expandedCategories.has(group.category)}
                  onOpenChange={() => toggleCategory(group.category)}
                >
                  <CollapsibleTrigger className="w-full">
                    <div className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors cursor-pointer">
                      <div className="flex items-center space-x-2">
                        {expandedCategories.has(group.category) ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                        <h3 className="text-lg font-semibold">{group.displayName}</h3>
                        <Badge variant="secondary">{group.prompts.length}</Badge>
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  
                  <CollapsibleContent>
                    <div className="border-t">
                      {group.prompts.map((prompt, index) => (
                        <div
                          key={`${prompt.prompt_type}-${prompt.id || 'default'}`}
                          className={`p-4 ${index !== group.prompts.length - 1 ? 'border-b' : ''}`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center space-x-2 mb-2">
                                <h4 className="font-medium">{prompt.name}</h4>
                                {prompt.is_custom ? (
                                  <Badge variant="outline" className="text-xs">
                                    <User className="mr-1 h-3 w-3" />
                                    カスタム
                                  </Badge>
                                ) : (
                                  <Badge variant="secondary" className="text-xs">
                                    <Shield className="mr-1 h-3 w-3" />
                                    デフォルト
                                  </Badge>
                                )}
                                <Badge className={getCategoryBadgeColor(prompt.category)}>
                                  {group.displayName}
                                </Badge>
                                {prompt.is_custom && (
                                  <Badge variant={prompt.is_active ? "default" : "secondary"}>
                                    {prompt.is_active ? "有効" : "無効"}
                                  </Badge>
                                )}
                              </div>
                              
                              <p className="text-sm text-muted-foreground mb-2">
                                {prompt.description || "説明なし"}
                              </p>
                              
                              <div className="flex items-center space-x-4 text-xs text-muted-foreground">
                                <span>タイプ: {prompt.prompt_type}</span>
                                {prompt.updated_at && (
                                  <span>
                                    更新: {new Date(prompt.updated_at).toLocaleDateString('ja-JP')}
                                  </span>
                                )}
                              </div>
                            </div>
                            
                            <div className="flex items-center space-x-2 ml-4">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => duplicatePrompt(prompt)}
                                title="複製"
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                              
                              {prompt.is_custom && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setEditingPrompt(prompt);
                                      setIsEditDialogOpen(true);
                                    }}
                                    title="編集"
                                  >
                                    <Edit3 className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    onClick={() => deleteCustomPrompt(prompt.id as number)}
                                    disabled={saveLoading}
                                    title="削除"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            ))}
          </div>
        )}

        {/* 警告ダイアログ */}
        <Dialog open={showWarningDialog} onOpenChange={setShowWarningDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center">
                <AlertTriangle className="mr-2 h-5 w-5 text-orange-500" />
                注意
              </DialogTitle>
              <DialogDescription>
                すべてのプロンプトタイプを表示すると、開発中や非推奨のプロンプトも含まれます。
                通常の利用では、デフォルト表示のままご利用いただくことを推奨します。
                本当にすべてのプロンプトタイプを表示しますか？
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button 
                variant="outline" 
                onClick={() => setShowWarningDialog(false)}
              >
                キャンセル
              </Button>
              <Button 
                onClick={confirmShowAllPrompts}
                className="bg-orange-600 hover:bg-orange-700"
              >
                表示する
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 新規作成ダイアログ */}
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogContent className="max-w-7xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>新しいカスタムプロンプトを作成</DialogTitle>
              <DialogDescription>
                新しいカスタムプロンプトを作成します。名前は他のプロンプトと重複しないようにしてください。
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>プロンプトタイプ *</Label>
                <Select 
                  value={createForm.prompt_type} 
                  onValueChange={(value) => {
                    const selectedType = promptTypes.find(pt => pt.type === value);
                    setCreateForm(prev => ({
                      ...prev,
                      prompt_type: value,
                      category: selectedType?.category || ""
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="プロンプトタイプを選択" />
                  </SelectTrigger>
                  <SelectContent className="w-[--radix-select-trigger-width]">
                    {getFilterPromptTypes().map(pt => (
                      <SelectItem key={pt.type} value={pt.type}>
                        {pt.name} ({CATEGORY_DISPLAY_NAMES[pt.category] || pt.category})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>プロンプト名 *</Label>
                <Input
                  value={createForm.name}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="わかりやすい名前を入力"
                />
              </div>
              
              <div className="space-y-2">
                <Label>説明</Label>
                <Input
                  value={createForm.description}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="プロンプトの用途や特徴を説明"
                />
              </div>
              
              <div className="space-y-2">
                <Label>プロンプト内容 *</Label>
                <Textarea
                  value={createForm.prompt}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, prompt: e.target.value }))}
                  placeholder="プロンプトの内容を入力"
                  className="min-h-64 break-all"
                />
              </div>
            </div>
            
            <DialogFooter>
              <Button 
                variant="outline" 
                onClick={() => {
                  setIsCreateDialogOpen(false);
                  resetCreateForm();
                }}
                disabled={saveLoading}
              >
                キャンセル
              </Button>
              <Button 
                onClick={createCustomPrompt}
                disabled={saveLoading || !createForm.prompt_type || !createForm.name || !createForm.prompt}
              >
                {saveLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    作成中...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    作成
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 編集ダイアログ */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-w-8xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>カスタムプロンプトを編集</DialogTitle>
              <DialogDescription>
                カスタムプロンプトの内容を編集します。
              </DialogDescription>
            </DialogHeader>
            
            {editingPrompt && (
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>プロンプト名 *</Label>
                  <Input
                    value={editingPrompt.name}
                    onChange={(e) => setEditingPrompt(prev => prev ? ({ ...prev, name: e.target.value }) : null)}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label>ステータス</Label>
                  <Select 
                    value={editingPrompt.is_active ? "active" : "inactive"}
                    onValueChange={(value) => setEditingPrompt(prev => prev ? ({ ...prev, is_active: value === "active" }) : null)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="w-[--radix-select-trigger-width]">
                      <SelectItem value="active">有効</SelectItem>
                      <SelectItem value="inactive">無効</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label>説明</Label>
                  <Input
                    value={editingPrompt.description}
                    onChange={(e) => setEditingPrompt(prev => prev ? ({ ...prev, description: e.target.value }) : null)}
                    placeholder="プロンプトの用途や特徴を説明"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label>プロンプト内容 *</Label>
                  <Textarea
                    value={editingPrompt.prompt}
                    onChange={(e) => setEditingPrompt(prev => prev ? ({ ...prev, prompt: e.target.value }) : null)}
                    className="min-h-64 break-all"
                  />
                </div>
              </div>
            )}
            
            <DialogFooter>
              <Button 
                variant="outline" 
                onClick={() => {
                  setIsEditDialogOpen(false);
                  setEditingPrompt(null);
                }}
                disabled={saveLoading}
              >
                キャンセル
              </Button>
              <Button 
                onClick={updateCustomPrompt}
                disabled={saveLoading || !editingPrompt?.name || !editingPrompt?.prompt}
              >
                {saveLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    更新中...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    更新
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}