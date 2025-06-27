// src/hooks/usePapers.ts
import useSWR from "swr";
import { PapersPageResponse } from "@/types/paper";
import { getSession, signOut } from "next-auth/react";
import { authenticatedFetch } from "@/lib/utils";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

export interface PaperFilters {
  level_tags?: string[];
  domain_tags?: string[];
  filter_mode?: 'OR' | 'AND';
  show_interest_none?: boolean;
  search_keyword?: string;
}

export interface SortConfig {
  key: string;
  direction: 'asc' | 'desc';
}

const fetcher = async (url: string): Promise<PapersPageResponse> => {
  const session = await getSession();
  
  if (!session?.accessToken) {
    if (typeof window !== "undefined") {
      signOut({ callbackUrl: '/auth/signin?error=NoAccessToken', redirect: false }).then(() => {
        window.location.href = '/auth/signin?error=NoAccessToken';
      });
    }
    throw new Error("No access token available. Redirecting to login.");
  }

  const res = await authenticatedFetch(url);

  if (!res.ok) {
    const errorBody = await res.text();
    if (res.status === 401) {
      if (typeof window !== "undefined") {
        signOut({ callbackUrl: '/auth/signin?error=SessionExpired', redirect: false }).then(() => {
          window.location.href = '/auth/signin?error=SessionExpired';
        });
      }
      throw new Error(`Authentication failed (401): ${errorBody}. Redirecting to login.`);
    }
    throw new Error(`API Error (status ${res.status}): ${errorBody}`);
  }
  return res.json();
};

export function usePapers(
  page: number = 1,
  size: number = 50,
  filters?: PaperFilters,
  sort?: SortConfig
) {
  const params = new URLSearchParams();
  params.append("page", String(page));
  params.append("size", String(size));

  if (filters) {
    if (filters.level_tags && filters.level_tags.length > 0) {
      filters.level_tags.forEach(tag => params.append("level_tags", tag));
    }
    if (filters.domain_tags && filters.domain_tags.length > 0) {
      filters.domain_tags.forEach(tag => params.append("domain_tags", tag));
    }
    if (filters.filter_mode) {
      params.append("filter_mode", filters.filter_mode);
    }
    if (filters.show_interest_none !== undefined) {
      params.append("show_interest_none", String(filters.show_interest_none));
    }
    if (filters.search_keyword && filters.search_keyword.trim()) {
      params.append("search_keyword", filters.search_keyword.trim());
    }
  }

  if (sort) {
    params.append("sort_by", sort.key);
    params.append("sort_dir", sort.direction);
  }

  const url = `${BACKEND}/papers?${params.toString()}`;

  const { data, error, isLoading, mutate } = useSWR<PapersPageResponse>(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: (err) => {
      if (err.message.includes("401")) return false;
      return true;
    }
  });

  return {
    papersResponse: data,
    papers: data?.items ?? [],
    totalItems: data?.total ?? 0,
    totalPages: data?.pages ?? 0,
    currentPage: data?.page ?? 1,
    pageSize: data?.size ?? 0,
    isLoading,
    isError: !!error,
    mutate,
  };
}