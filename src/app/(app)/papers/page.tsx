// src/app/papers/page.tsx
"use client";

import { usePapers, PaperFilters, SortConfig } from "@/hooks/usePapers";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import React, { useState, useCallback, useEffect, useMemo, JSX, useRef, Suspense } from "react"; 
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
DropdownMenu,
DropdownMenuCheckboxItem,
DropdownMenuContent,
DropdownMenuLabel,
DropdownMenuSeparator,
DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
Table,
TableBody,
TableCell,
TableHead,
TableHeader,
TableRow,
} from "@/components/ui/table";
import {
Card,
CardContent
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ChevronDown, ArrowUpDown, ArrowUp, ArrowDown, Loader2, AlertTriangle, Info, ExternalLink, ListFilter, X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronUp } from 'lucide-react';
import { PaperSummaryItem } from "@/types/paper";
import { useSession } from "next-auth/react";
import { authenticatedFetch } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { usePaperTagsSummary } from "@/hooks/usePaperTagsSummary";
import { useTagCategories } from "@/hooks/useTagCategories";

const BACK = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";
const SESSION_STORAGE_KEY = "papersPageSessionState";

const LEVEL_TAGS = ["お気に入り","現時点はそんなに", "興味なし", "理解した", "概要は理解","目を通した", "後で読む","理解できてない", '理解度タグなし', 'Recommended'];
const ACTUAL_LEVEL_TAGS = LEVEL_TAGS.filter(tag => tag !== '理解度タグなし' && tag !== 'Recommended' && tag !== '興味なし');

// TAG_CATEGORIESは動的に取得するため、ここでは削除
// ORDERED_CATEGORY_TAGSとTAG_TO_CATEGORY_ORDER_INDEXは後で動的に生成

type SortKeyUi = 'user_paper_link_id' | 'title' | 'published_date' | 'created_at';
type DomainTagSortMode = 'alphabetical' | 'categorical';

interface PageState {
  currentPage: number;
  pageSize: number;
  selectedLevelTags: string[];
  selectedDomainTags: string[];
  filterMode: 'OR' | 'AND';
  showInterestNone: boolean;
  sortConfig: SortConfig;
  isFilterSectionVisible: boolean;
  searchKeyword: string;
}

const PaginationControls = ({ 
  currentPage, 
  totalPages, 
  isLoading, 
  setCurrentPage 
}: { 
  currentPage: number, 
  totalPages: number, 
  isLoading: boolean, 
  setCurrentPage: (page: number | ((prev: number) => number)) => void 
}) => {
  const [inputPage, setInputPage] = useState<string>(String(currentPage));

  useEffect(() => {
    setInputPage(String(currentPage));
  }, [currentPage]);

  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputPage(e.target.value);
  };

  const handlePageInputSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const page = parseInt(inputPage, 10);
    if (!isNaN(page) && page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    } else {
      setInputPage(String(currentPage)); 
    }
  };

  if (totalPages <= 0) return null;
  return (
    <div className="flex items-center space-x-1">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setCurrentPage(1)}
        disabled={currentPage === 1 || isLoading}
        className="h-6 px-1.5"
      >
        <ChevronsLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
        disabled={currentPage === 1 || isLoading}
        className="h-6 px-1.5"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      
      <form onSubmit={handlePageInputSubmit} className="flex items-center">
        <Input
          type="number"
          value={inputPage}
          onChange={handlePageInputChange}
          onBlur={() => { 
            const page = parseInt(inputPage, 10);
            if (isNaN(page) || page < 1 || page > totalPages) {
              setInputPage(String(currentPage));
            }
          }}
          className="h-6 w-12 text-xs px-1 text-center"
          min="1"
          max={totalPages}
          disabled={isLoading}
        />
      </form>
      <span className="text-xs px-0.5 whitespace-nowrap">
        / {totalPages}
      </span>

      <Button
        variant="outline"
        size="sm"
        onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
        disabled={currentPage === totalPages || isLoading}
        className="h-6 px-1.5"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setCurrentPage(totalPages)}
        disabled={currentPage === totalPages || isLoading}
        className="h-6 px-1.5"
      >
        <ChevronsRight className="h-4 w-4" />
      </Button>
    </div>
  );
};

const RowContent = ({
  paperItem,
  displayIndex,
  actualLevelTags,
  onRowClick,
  onRowAuxClick,
  onToggleInterestNone,
  onToggleRecommended,
  onDeletePaper,
}: {
  paperItem: PaperSummaryItem;
  displayIndex: number;
  actualLevelTags: string[];
  onRowClick: (e: React.MouseEvent<HTMLTableRowElement>) => void;
  onRowAuxClick: (e: React.MouseEvent<HTMLTableRowElement>) => void;
  onToggleInterestNone: () => Promise<void>;
  onToggleRecommended: () => Promise<void>;
  onDeletePaper: () => Promise<void>;
}) => {
  const p = paperItem;

  const allPaperTagsFromString = (p.user_specific_data.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  const understandingLevelTags = allPaperTagsFromString.filter(tag => actualLevelTags.includes(tag));
  const nonUnderstandingLevelTags = allPaperTagsFromString.filter(tag => !actualLevelTags.includes(tag));
  const tagsToDisplay = [...new Set([...understandingLevelTags, ...nonUnderstandingLevelTags])];
  const hasNone = allPaperTagsFromString.includes('興味なし');
  const isRecommended = allPaperTagsFromString.includes('Recommended');

  // ヘルパー関数
  const truncateText = (text: string | null | undefined, maxLength: number = 100): string => {
    if (!text) return '';
    return text.length > maxLength 
      ? text.substring(0, maxLength) + "..." 
      : text;
  };

  return (
    <TableRow
      onClick={onRowClick}
      onAuxClick={onRowAuxClick}
      className="cursor-pointer hover:bg-muted/50"
    >
      <TableCell className="p-2 align-top text-xs min-w-[20px] w-[20px] flex-shrink-0">{displayIndex}</TableCell>
      <TableCell className="p-2 align-top font-medium text-xs whitespace-pre-wrap break-words min-w-[150px] w-[200px]" title={p.paper_metadata.title}>
          {p.paper_metadata.title}
      </TableCell>
      <TableCell className="p-2 align-top text-xs min-w-[100px] w-[120px]">
      {p.paper_metadata.arxiv_url ? (
        <a
          href={p.paper_metadata.arxiv_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-blue-600 hover:underline inline-flex items-center"
        >
          {p.paper_metadata.arxiv_id?.length > 20 ? p.paper_metadata.arxiv_id?.substring(0,17) + "..." : p.paper_metadata.arxiv_id}
          <ExternalLink className="ml-1 h-3 w-3" />
        </a>
      ) : (
        <span className="text-muted-foreground">URLなし</span>
      )}
      </TableCell>
      <TableCell className="p-2 align-top text-xs min-w-[80px] w-[100px]">
        {p.paper_metadata.published_date ? new Date(p.paper_metadata.published_date).toLocaleDateString() : '-'}
      </TableCell>
      <TableCell className="p-2 align-top text-xs min-w-[80px] w-[100px]">
        {new Date(p.created_at).toLocaleDateString()}
      </TableCell>
      <TableCell className="p-2 align-top text-xs whitespace-pre-wrap break-words min-w-[150px] w-[350px]" title={p.selected_generated_summary_one_point || p.paper_metadata.abstract}>
        {truncateText(p.selected_generated_summary_one_point || p.paper_metadata.abstract)}
      </TableCell>
      <TableCell className="p-2 align-top text-xs whitespace-pre-wrap break-words min-w-[100px] w-[150px]" title={p.user_specific_data.memo}>
        {p.user_specific_data.memo.substring(0, 30) + (p.user_specific_data.memo.length > 30 ? "..." : "") || "\u00A0"}
      </TableCell>
      <TableCell className="p-2 align-top text-xs min-w-[200px] w-[450px]">
        <div className="flex flex-wrap gap-1 max-h-[100px] overflow-y-auto overflow-x-hidden">
          {tagsToDisplay.map(tag => {
            let badgeVariant: "default" | "destructive" | "outline" | "secondary" = "secondary";
            if (tag === 'Recommended') badgeVariant = 'destructive';
            else if (tag === '興味なし') badgeVariant = 'outline';
            else if (actualLevelTags.includes(tag)) badgeVariant = 'default';

            return (
              <Badge key={tag} variant={badgeVariant} className="text-xs whitespace-nowrap">
                {tag}
              </Badge>
            );
          })}
        </div>
      </TableCell>
      <TableCell className="p-2 align-top text-xs min-w-[120px] w-[120px] flex-shrink-0">
        <div className="flex flex-col gap-1">
          <Button
            size="sm"
            variant={hasNone ? 'secondary' : 'outline'}
            className="text-xs px-1.5 py-0.5 h-auto"
            onClick={async e => {
              e.stopPropagation();
              await onToggleInterestNone();
            }}
          >
            {hasNone ? '「興味なし」解除' : '興味なし'}
          </Button>
          <Button
            size="sm"
            variant={isRecommended ? 'secondary' : 'outline'}
            className="text-xs px-1.5 py-0.5 h-auto"
            onClick={async e => {
              e.stopPropagation();
              await onToggleRecommended();
            }}
          >
            {isRecommended ? 'Recommended解除' : 'Recommended'}
          </Button>
        </div>
      </TableCell>
      <TableCell className="p-2 align-top text-xs min-w-[60px] w-[60px] flex-shrink-0">
        <Button
          variant="destructive"
          size="sm"
          className="text-xs px-1.5 py-0.5 h-auto"
          onClick={e => {
            e.stopPropagation();
            onDeletePaper();
          }}
        >
          削除
        </Button>
      </TableCell>
    </TableRow>
  );
};
const Row = React.memo(RowContent);


function PapersPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const getInitialState = useCallback((): PageState => {
    const fromUrl = searchParams.get("page") !== null; 
    let storedState: PageState | null = null;
    if (typeof window !== "undefined") {
        const storedJson = sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (storedJson) {
            try {
                storedState = JSON.parse(storedJson);
            } catch (e) {
                console.error("Failed to parse stored page state:", e);
                sessionStorage.removeItem(SESSION_STORAGE_KEY);
            }
        }
    }

    const defaultState: PageState = {
      currentPage: 1,
      pageSize: 50,
      selectedLevelTags: [],
      selectedDomainTags: [],
      filterMode: "OR",
      showInterestNone: false,
      sortConfig: { key: "created_at", direction: "desc" },
      isFilterSectionVisible: true,
      searchKeyword: "",
    };

    if (fromUrl) {
      return {
        currentPage: parseInt(searchParams.get("page") || "1", 10),
        pageSize: parseInt(searchParams.get("size") || "50", 10),
        selectedLevelTags: searchParams.getAll("level_tags") || [],
        selectedDomainTags: searchParams.getAll("domain_tags") || [],
        filterMode: (searchParams.get("filter_mode") || "OR") as "OR" | "AND",
        showInterestNone: searchParams.get("show_interest_none") === "true",
        sortConfig: {
          key: (searchParams.get("sort_by") || "created_at") as SortKeyUi,
          direction: (searchParams.get("sort_dir") || "desc") as "asc" | "desc",
        },
        isFilterSectionVisible: searchParams.get("filter_visible") !== "false",
        searchKeyword: searchParams.get("search") || "",
      };
    } else if (storedState) {
      return storedState;
    }
    return defaultState;
  }, [searchParams]);

  const [initialState] = useState(getInitialState);

  const [currentPage, setCurrentPage] = useState(initialState.currentPage);
  const [pageSize] = useState(initialState.pageSize);
  const [selectedLevelTags, setSelectedLevelTags] = useState<string[]>(initialState.selectedLevelTags);
  const [selectedDomainTags, setSelectedDomainTags] = useState<string[]>(initialState.selectedDomainTags);
  const [domainTagSortMode, setDomainTagSortMode] = useState<DomainTagSortMode>('categorical');
  const [filterMode, setFilterMode] = useState<'OR' | 'AND'>(initialState.filterMode);
  const [showInterestNone, setShowInterestNone] = useState<boolean>(initialState.showInterestNone);
  const [sortConfig, setSortConfig] = useState<SortConfig>(initialState.sortConfig);
  const [isFilterSectionVisible, setIsFilterSectionVisible] = useState(initialState.isFilterSectionVisible);
  const [searchKeyword, setSearchKeyword] = useState<string>(initialState.searchKeyword);
  const [activeSearchKeyword, setActiveSearchKeyword] = useState<string>(initialState.searchKeyword);
  const [hasSearchExecuted, setHasSearchExecuted] = useState<boolean>(false);
  
  // 検索バーのref
  const searchInputRef = useRef<HTMLInputElement>(null);

  const debouncedCurrentPage = useDebounce(currentPage, 0); 
  const debouncedPageSize = useDebounce(pageSize, 0); 
  const debouncedSelectedLevelTags = useDebounce(selectedLevelTags, 300);
  const debouncedSelectedDomainTags = useDebounce(selectedDomainTags, 300);
  const debouncedFilterMode = useDebounce(filterMode, 300);
  const debouncedShowInterestNone = useDebounce(showInterestNone, 300);
  const debouncedSortConfig = useDebounce(sortConfig, 300);
  const debouncedIsFilterSectionVisible = useDebounce(isFilterSectionVisible, 300);
  const debouncedActiveSearchKeyword = useDebounce(activeSearchKeyword, 300);

  useEffect(() => {
    const currentState: PageState = {
      currentPage: debouncedCurrentPage,
      pageSize: debouncedPageSize,
      selectedLevelTags: debouncedSelectedLevelTags,
      selectedDomainTags: debouncedSelectedDomainTags,
      filterMode: debouncedFilterMode,
      showInterestNone: debouncedShowInterestNone,
      sortConfig: debouncedSortConfig,
      isFilterSectionVisible: debouncedIsFilterSectionVisible,
      searchKeyword: debouncedActiveSearchKeyword,
    };

    const params = new URLSearchParams();
    params.set("page", String(currentState.currentPage));
    params.set("size", String(currentState.pageSize));
    currentState.selectedLevelTags.forEach(tag => params.append("level_tags", tag));
    currentState.selectedDomainTags.forEach(tag => params.append("domain_tags", tag));
    params.set("filter_mode", currentState.filterMode);
    params.set("show_interest_none", String(currentState.showInterestNone));
    params.set("sort_by", currentState.sortConfig.key);
    params.set("sort_dir", currentState.sortConfig.direction);
    params.set("filter_visible", String(currentState.isFilterSectionVisible));
    if (currentState.searchKeyword) {
      params.set("search", currentState.searchKeyword);
    }
    
    const newSearch = params.toString();
    if (typeof window !== "undefined") {
        sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(currentState));
        const currentSearch = window.location.search;
        if (currentSearch.substring(1) !== newSearch) {
            router.replace(`${window.location.pathname}?${newSearch}`, { scroll: false });
        }
    }
  }, [
    debouncedCurrentPage,
    debouncedPageSize,
    debouncedSelectedLevelTags,
    debouncedSelectedDomainTags,
    debouncedFilterMode,
    debouncedShowInterestNone,
    debouncedSortConfig,
    debouncedIsFilterSectionVisible,
    debouncedActiveSearchKeyword,
    router,
  ]);
  
  const apiFilters: PaperFilters = useMemo(() => ({
    level_tags: selectedLevelTags,
    domain_tags: selectedDomainTags,
    filter_mode: filterMode,
    show_interest_none: showInterestNone,
    search_keyword: activeSearchKeyword,
  }), [selectedLevelTags, selectedDomainTags, filterMode, showInterestNone, activeSearchKeyword]);

  const { papersResponse, papers, totalItems, totalPages, isLoading, isError, mutate } = usePapers(
    currentPage,
    pageSize,
    apiFilters,
    sortConfig
  );
  const { tagsSummary, isLoadingTagsSummary, isErrorTagsSummary, mutateTagsSummary } = usePaperTagsSummary();
  const { tagCategories, isLoadingTagCategories, isErrorTagCategories } = useTagCategories();

  const filteredPapers = useMemo(() => {
    if (!papers) return [];
    return papers.filter(p => 
      !p.selected_generated_summary_one_point?.startsWith('[PROCESSING_')
    );
  }, [papers]);

  const [recommending, setRecommending] = useState(false);

  const { status: authStatus } = useSession();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const prevApiFiltersRef = useRef<PaperFilters | undefined>(undefined);
  const prevSortConfigRef = useRef<SortConfig | undefined>(undefined);

  useEffect(() => {
    if (authStatus === "loading" || isRedirecting) {
      return;
    }
    if (authStatus === "unauthenticated") {
      setIsRedirecting(true);
      router.push("/auth/signin?callbackUrl=/papers");
    }
  }, [authStatus, router, isRedirecting]);

  useEffect(() => {
    const filtersChanged = prevApiFiltersRef.current && JSON.stringify(prevApiFiltersRef.current) !== JSON.stringify(apiFilters);
    const sortChanged = prevSortConfigRef.current && JSON.stringify(prevSortConfigRef.current) !== JSON.stringify(sortConfig);

    if (filtersChanged || sortChanged) {
        if (currentPage !== 1) {
            setCurrentPage(1);
        }
    }
    prevApiFiltersRef.current = apiFilters;
    prevSortConfigRef.current = sortConfig;
  }, [apiFilters, sortConfig, currentPage]);

  // 検索実行後のフォーカス管理（ローディング完了後）
  useEffect(() => {
    if (hasSearchExecuted && !isLoading) {
      // ローディング完了後にフォーカスを復元
      setTimeout(() => {
        searchInputRef.current?.focus();
        setHasSearchExecuted(false);
      }, 100);
    }
  }, [hasSearchExecuted, isLoading]);

  const handleRecommend = useCallback(async () => {
    setRecommending(true);
    try {
      const res = await authenticatedFetch(`${BACK}/papers/recommend`, {
        method: "POST",
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({detail: "Unknown error"}));
        throw new Error(errorData.detail || `推薦APIエラー: ${res.status}`);
      }
      const recommendedIds: number[] = await res.json();
      alert(`推薦処理が完了しました。${recommendedIds.length}件の論文にRecommendedタグが付与されました。`);
      await mutate();
      await mutateTagsSummary();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      alert(`推薦処理に失敗しました: ${errorMessage}`);
    } finally {
      setRecommending(false);
    }
  }, [mutate, mutateTagsSummary]);

  const memoizedUpdatePaperTags = useCallback(async (userPaperLinkId: number, newTagsArray: string[]) => {
    const originalPapers = papersResponse ? [...papersResponse.items] : [];
    const optimisticUpdatedPapers = originalPapers.map(p =>
      p.user_paper_link_id === userPaperLinkId
        ? { ...p, user_specific_data: { ...p.user_specific_data, tags: newTagsArray.join(',') } }
        : p
    );
    if (papersResponse) {
      mutate({...papersResponse, items: optimisticUpdatedPapers}, { revalidate: false });
    }

    try {
        const res = await authenticatedFetch(`${BACK}/papers/${userPaperLinkId}`, {
            method: 'PUT',
            body: JSON.stringify({ tags: newTagsArray.join(',') }),
        });
        if (!res.ok) {
            const errorText = await res.text();
            if (papersResponse) {
                 mutate({...papersResponse, items: originalPapers}, { revalidate: false });
            }
            alert(`タグの更新に失敗しました: ${res.status} ${errorText}`);
            return;
        }
        await mutate();
        await mutateTagsSummary();
    } catch (error: unknown) {
        if (papersResponse) {
            mutate({...papersResponse, items: originalPapers}, { revalidate: false });
        }
        const errorMessage = error instanceof Error ? error.message : String(error);
        alert(`タグの更新に失敗しました: ${errorMessage}`);
    }
  }, [papersResponse, mutate, mutateTagsSummary]);
  
  // タグカテゴリーから順序インデックスを動的に生成
  const tagToOrderIndex = useMemo(() => {
    if (!tagCategories) return new Map<string, number>();
    const orderedTags = Object.values(tagCategories).flat();
    const map = new Map<string, number>();
    orderedTags.forEach((tag, index) => {
      map.set(tag, index);
    });
    return map;
  }, [tagCategories]);

  const domainTags = useMemo(() => {
    if (!tagsSummary) return [];
    const tags = Object.keys(tagsSummary)
      .filter(t => !ACTUAL_LEVEL_TAGS.includes(t) && t !== '興味なし' && t !== 'Recommended' && !LEVEL_TAGS.includes(t));

    if (domainTagSortMode === 'alphabetical') {
      tags.sort((a, b) => a.localeCompare(b, 'ja'));
    } else {
      tags.sort((a, b) => {
        const orderA = tagToOrderIndex.get(a);
        const orderB = tagToOrderIndex.get(b);

        if (orderA !== undefined && orderB !== undefined) {
          return orderA - orderB;
        }
        if (orderA !== undefined) return -1;
        if (orderB !== undefined) return 1;
        return a.localeCompare(b, 'ja');
      });
    }
    return tags;
  }, [tagsSummary, domainTagSortMode, tagToOrderIndex]);


  const handleSort = (key: SortKeyUi) => {
    setSortConfig(prevConfig => ({
      key,
      direction: prevConfig.key === key && prevConfig.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const renderSortIcon = (key: SortKeyUi): JSX.Element => {
    if (sortConfig.key === key) {
      return sortConfig.direction === 'asc' ? <ArrowUp className="ml-2 h-4 w-4" /> : <ArrowDown className="ml-2 h-4 w-4" />;
    }
    return <ArrowUpDown className="ml-2 h-4 w-4 opacity-50" />;
  };

  const memoizedHandleDelete = useCallback(async (userPaperLinkId: number) => {
    if (!confirm('本当に削除しますか？')) return;
    const originalPapers = papersResponse ? [...papersResponse.items] : [];
    const optimisticPapers = originalPapers.filter(p => p.user_paper_link_id !== userPaperLinkId);
    if (papersResponse) {
      mutate({...papersResponse, items: optimisticPapers, total: papersResponse.total -1 }, { revalidate: false });
    }

    try {
        const res = await authenticatedFetch(`${BACK}/papers/${userPaperLinkId}`, {
            method: 'DELETE',
        });
        if (!res.ok) {
            const errorText = await res.text();
            if (papersResponse) {
                mutate({...papersResponse, items: originalPapers, total: papersResponse.total}, { revalidate: false });
            }
            alert(`削除に失敗しました: ${res.status} ${errorText}`);
        } else {
            await mutate(); 
            await mutateTagsSummary();
        }
    } catch (error: unknown) {
        if (papersResponse) {
            mutate({...papersResponse, items: originalPapers, total: papersResponse.total}, { revalidate: false });
        }
        const errorMessage = error instanceof Error ? error.message : String(error);
        alert(`削除に失敗しました: ${errorMessage}`);
    }
  }, [papersResponse, mutate, mutateTagsSummary]);


  if (authStatus === "loading" || (isLoading && !papersResponse) || isLoadingTagsSummary || isLoadingTagCategories) {
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
  if (isError || isErrorTagsSummary || isErrorTagCategories) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-custom">
        <AlertTriangle className="h-12 w-12 text-red-600 mb-4" />
        <Alert variant="destructive" className="w-full max-w-md">
          <AlertTitle>エラー</AlertTitle>
          <AlertDescription>
            データの読み込みに失敗しました。
            {isError && <p>論文データエラー</p>}
            {isErrorTagsSummary && <p>タグ集計データエラー</p>}
            {isErrorTagCategories && <p>タグカテゴリーデータエラー</p>}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const getTriggerText = (selectedTags: string[], placeholder: string) => {
    if (selectedTags.length === 0) {
      return placeholder;
    }
    const tagString = selectedTags.join(', ');
    const maxLength = 25; 
    const truncatedTagString = tagString.length > maxLength ? tagString.substring(0, maxLength - 3) + "..." : tagString;
    return `${truncatedTagString} 【${selectedTags.length}件選択中】`;
  };

  return (
    <main className="p-4 md:p-3 space-y-3 flex flex-col h-screen">
      <div className="flex-shrink-0 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Paper List</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild className="btn-nav">
            <Link href="/">Home画面</Link>
          </Button>
          <Button asChild>
            <Link href="/papers/add">論文追加</Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link href="/rag">RAG論文検索</Link>
          </Button>
        </div>
      </div>

      <Card className="flex-shrink-0 gap-0 p-2" >
          <CardContent className="p-2 md:p-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={() => setIsFilterSectionVisible(!isFilterSectionVisible)} className="flex items-center px-2 py-1 h-auto -ml-2">
                  {isFilterSectionVisible ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                  <span className="ml-1 text-sm font-medium">フィルターオプション</span>
                </Button>
              </div>
              {!isFilterSectionVisible && (
                <div className="flex justify-center sm:justify-end">
                  <PaginationControls currentPage={currentPage} totalPages={totalPages} isLoading={isLoading} setCurrentPage={setCurrentPage} />
                </div>
              )}
            </div>

            {isFilterSectionVisible && (
              <div className="mt-1 pt-1 border-t space-y-1">
                {/* 検索バー */}
                <div className="w-full">
                  <div className="flex gap-2">
                    <form 
                      onSubmit={(e) => {
                        e.preventDefault();
                        setActiveSearchKeyword(searchKeyword);
                        setHasSearchExecuted(true);
                      }}
                      className="flex-1 flex gap-2"
                    >
                      <Input
                        ref={searchInputRef}
                        type="text"
                        placeholder="タイトル・要約を検索（スペース区切りでAND検索）"
                        value={searchKeyword}
                        onChange={(e) => setSearchKeyword(e.target.value)}
                        className="flex-1 h-7 text-xs px-2"
                      />
                      <Button
                        type="submit"
                        variant="default"
                        size="sm"
                        className="h-7 px-3 text-xs"
                      >
                        検索
                      </Button>
                    </form>
                    {activeSearchKeyword && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSearchKeyword("");
                          setActiveSearchKeyword("");
                        }}
                        className="h-7 px-2 text-xs"
                      >
                        <X className="h-3 w-3 mr-1" />
                        検索解除
                      </Button>
                    )}
                  </div>
                </div>

                {(selectedLevelTags.length > 0 || selectedDomainTags.length > 0) && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {selectedLevelTags.map(tag => (
                      <Badge key={tag} variant="secondary" className="flex items-center text-xs">
                        {tag}
                        <button
                          aria-label={`Remove ${tag} filter`}
                          className="ml-1 appearance-none cursor-pointer rounded-full hover:bg-muted-foreground/20 p-0.5"
                          onClick={() => setSelectedLevelTags(prev => prev.filter(t => t !== tag))}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                    {selectedDomainTags.map(tag => (
                      <Badge key={tag} variant="outline" className="flex items-center text-xs">
                        {tag}
                        <button
                          aria-label={`Remove ${tag} filter`}
                          className="ml-1 appearance-none cursor-pointer rounded-full hover:bg-muted-foreground/20 p-0.5"
                          onClick={() => setSelectedDomainTags(prev => prev.filter(t => t !== tag))}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-1 pt-1">
                  <div>
                    <label htmlFor="level-tags-trigger" className="block text-xs font-medium">理解度タグ</label>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button id="level-tags-trigger" variant="outline" className="w-full justify-between text-left h-7 text-xs px-1.5">
                          <span className="truncate pr-1">
                            {getTriggerText(selectedLevelTags, '選択')}
                          </span>
                          <ChevronDown className="h-3 w-3 opacity-50 flex-shrink-0" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width] max-h-60 overflow-auto">
                        <DropdownMenuLabel className="text-xs">理解度を選択</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {LEVEL_TAGS.map(tag => (
                          <DropdownMenuCheckboxItem
                            key={tag}
                            checked={selectedLevelTags.includes(tag)}
                            onCheckedChange={(checked) => {
                              setSelectedLevelTags(prev =>
                                checked ? [...prev, tag] : prev.filter(t => t !== tag)
                              );
                            }}
                            className="text-xs"
                          >
                            {tag} ({tagsSummary?.[tag] || 0})
                          </DropdownMenuCheckboxItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div>
                    <div className="flex justify-between items-center">
                      <label htmlFor="domain-tags-trigger" className="block text-xs font-medium">分野タグ</label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="px-1 py-0.5 h-auto text-xs">
                            <ListFilter className="h-3 w-3 mr-0.5" />
                            ソート
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel className="text-xs">並び順</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuCheckboxItem
                            checked={domainTagSortMode === 'categorical'}
                            onCheckedChange={() => setDomainTagSortMode('categorical')}
                            className="text-xs"
                          >
                            カテゴリ順
                          </DropdownMenuCheckboxItem>
                          <DropdownMenuCheckboxItem
                            checked={domainTagSortMode === 'alphabetical'}
                            onCheckedChange={() => setDomainTagSortMode('alphabetical')}
                            className="text-xs"
                          >
                            アルファベット順
                          </DropdownMenuCheckboxItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button id="domain-tags-trigger" variant="outline" className="w-full justify-between text-left h-7 text-xs px-1.5">
                          <span className="truncate pr-1">
                          {getTriggerText(selectedDomainTags, '選択')}
                          </span>
                          <ChevronDown className="h-3 w-3 opacity-50 flex-shrink-0" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width] max-h-60 overflow-auto">
                        <DropdownMenuLabel className="text-xs">分野を選択</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {domainTags.map(tag => (
                          <DropdownMenuCheckboxItem
                            key={tag}
                            checked={selectedDomainTags.includes(tag)}
                            onCheckedChange={(checked) => {
                              setSelectedDomainTags(prev =>
                                checked ? [...prev, tag] : prev.filter(t => t !== tag)
                              );
                            }}
                            className="text-xs"
                          >
                            {tag} ({tagsSummary?.[tag] || 0})
                          </DropdownMenuCheckboxItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 pt-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-medium">フィルター:</span>
                      <Button size="sm" variant={filterMode === 'OR' ? 'default' : 'outline'} onClick={() => setFilterMode('OR')} className="h-6 px-1.5 text-xs">OR</Button>
                      <Button size="sm" variant={filterMode === 'AND' ? 'default' : 'outline'} onClick={() => setFilterMode('AND')} className="h-6 px-1.5 text-xs">AND</Button>
                    </div>
                    <div className="flex items-center space-x-1">
                      <Checkbox
                        id="showInterestNone"
                        checked={showInterestNone}
                        onCheckedChange={(checked) => setShowInterestNone(Boolean(checked))}
                        className="h-3.5 w-3.5"
                      />
                      <label
                        htmlFor="showInterestNone"
                        className="text-xs font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        「興味なし」表示
                      </label>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <p className="text-xs text-muted-foreground whitespace-nowrap">
                        表示: {filteredPapers.length} / 全 {totalItems} 件
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleRecommend}
                      disabled={recommending}
                      className="h-6 px-1.5 text-xs"
                    >
                      {recommending ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />推薦中...</> : "リコメンド"}
                    </Button>
                    <PaginationControls currentPage={currentPage} totalPages={totalPages} isLoading={isLoading} setCurrentPage={setCurrentPage} />
                  </div>
                </div>
              </div>
            )}
          </CardContent>
      </Card>

      <Card className="flex-1 flex flex-col overflow-hidden">
        <CardContent className="p-0 flex-1 flex flex-col overflow-hidden">
          <div className="overflow-auto h-full">
            <div className="min-w-max">
              <Table className="w-full">
                <TableHeader className="sticky top-0 bg-background z-10 border-b-2">
                   <TableRow>
                    <TableHead className="p-2 text-xs min-w-[20px] w-[20px] flex-shrink-0">#</TableHead>
                    <TableHead onClick={() => handleSort('title')} className="p-2 text-xs cursor-pointer hover:bg-muted/50 group min-w-[150px] w-[200px]">
                      <span className="flex items-center">タイトル {renderSortIcon('title')}</span>
                    </TableHead>
                    <TableHead className="p-2 text-xs min-w-[100px] w-[120px]">URL</TableHead>
                    <TableHead onClick={() => handleSort('published_date')} className="p-2 text-xs cursor-pointer hover:bg-muted/50 group min-w-[80px] w-[100px]">
                      <span className="flex items-center">投稿日 {renderSortIcon('published_date')}</span>
                    </TableHead>
                    <TableHead onClick={() => handleSort('created_at')} className="p-2 text-xs cursor-pointer hover:bg-muted/50 group min-w-[80px] w-[100px]">
                      <span className="flex items-center">追加日 {renderSortIcon('created_at')}</span>
                    </TableHead>
                    <TableHead className="p-2 text-xs min-w-[150px] w-[350px]">一言要約</TableHead>
                    <TableHead className="p-2 text-xs min-w-[100px] w-[150px]">メモ</TableHead>
                    <TableHead className="p-2 text-xs min-w-[200px] w-[450px]">タグ</TableHead>
                    <TableHead className="p-2 text-xs min-w-[120px] w-[120px] flex-shrink-0">操作</TableHead>
                    <TableHead className="p-2 text-xs min-w-[60px] w-[60px] flex-shrink-0">削除</TableHead>
                  </TableRow>
                </TableHeader>
              {filteredPapers.length > 0 ? (
                <TableBody>
                  {filteredPapers.map((paperItem, index) => {
                    const p = paperItem;
                    const allPaperTagsFromString = (p.user_specific_data.tags || '').split(',').map(t => t.trim()).filter(Boolean);
                    
                    const handleRowClick = (e: React.MouseEvent<HTMLTableRowElement>) => {
                      if (e.ctrlKey || e.metaKey) {
                        window.open(`/papers/${p.user_paper_link_id}`, "_blank");
                        return;
                      }
                      router.push(`/papers/${p.user_paper_link_id}`);
                    };

                    const handleRowAuxClick = (e: React.MouseEvent<HTMLTableRowElement>) => {
                      if (e.button === 1) { 
                        e.preventDefault();
                        window.open(`/papers/${p.user_paper_link_id}`, "_blank");
                      }
                    };

                    const handleToggleInterestNone = async () => {
                        const hasNone = allPaperTagsFromString.includes('興味なし');
                        let updatedTagsArray;
                        if (hasNone) {
                            updatedTagsArray = allPaperTagsFromString.filter(t => t !== '興味なし');
                        } else {
                            updatedTagsArray = [...allPaperTagsFromString, '興味なし'];
                        }
                        await memoizedUpdatePaperTags(p.user_paper_link_id, updatedTagsArray);
                    };
    
                    const handleToggleRecommended = async () => {
                        const isRecommended = allPaperTagsFromString.includes('Recommended');
                        let updatedTagsArray;
                        if (isRecommended) {
                            updatedTagsArray = allPaperTagsFromString.filter(t => t !== 'Recommended');
                        } else {
                            updatedTagsArray = ['Recommended', ...allPaperTagsFromString.filter(t => t !== 'Recommended')];
                        }
                        await memoizedUpdatePaperTags(p.user_paper_link_id, updatedTagsArray);
                    };

                    const handleDeletePaper = async () => {
                        await memoizedHandleDelete(p.user_paper_link_id);
                    };

                    return (
                      <Row
                        key={p.user_paper_link_id}
                        paperItem={p}
                        displayIndex={papersResponse ? (papersResponse.page - 1) * papersResponse.size + index + 1 : index + 1}
                        actualLevelTags={ACTUAL_LEVEL_TAGS}
                        onRowClick={handleRowClick}
                        onRowAuxClick={handleRowAuxClick}
                        onToggleInterestNone={handleToggleInterestNone}
                        onToggleRecommended={handleToggleRecommended}
                        onDeletePaper={handleDeletePaper}
                      />
                    );
                  })}
                </TableBody>
              ) : (
                 <TableBody>
                  <TableRow>
                    <TableCell colSpan={10} className="h-24 text-center">
                      <div className="text-center text-muted-foreground flex flex-col items-center justify-center h-full">
                        {isLoading ? (
                            <Loader2 className="mx-auto h-10 w-10 text-gray-400 mb-3 animate-spin" />
                        ) : (
                            <Info className="mx-auto h-10 w-10 text-gray-400 mb-3" />
                        )}
                        <p className="text-md font-semibold">{isLoading ? "論文を読み込み中..." : "論文が見つかりません"}</p>
                        {!isLoading && <p className="text-sm">フィルター条件を変更するか、新しい論文を追加してください。</p>}
                      </div>
                    </TableCell>
                  </TableRow>
                </TableBody>
              )}
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

export default function PapersPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PapersPageContent />
    </Suspense>
  );
}