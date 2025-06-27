// src/types/paper.ts
export interface PaperMetadata {
  id: number;
  arxiv_id: string;
  arxiv_url?: string;
  title: string;
  authors: string;
  published_date?: string;
  abstract: string;
}

export interface GeneratedSummary {
  id: number;
  paper_metadata_id: number;
  llm_provider: string;
  llm_model_name: string;
  llm_abst: string;
  one_point?: string;
  character_role?: string;
  affinity_level?: number;
  created_at: string;
  updated_at: string;
  has_user_edited_summary?: boolean;
}

export interface CustomGeneratedSummary {
  id: number;
  user_id: number;
  paper_metadata_id: number;
  system_prompt_id: number;
  llm_provider: string;
  llm_model_name: string;
  llm_abst: string;
  one_point?: string;
  character_role?: string;
  affinity_level?: number;
  created_at: string;
  updated_at: string;
  has_user_edited_summary?: boolean;
  system_prompt_name?: string;
}

export interface EditedSummary {
  id: number;
  user_id: number;
  generated_summary_id?: number;
  custom_generated_summary_id?: number;
  edited_llm_abst: string;
  created_at: string;
  updated_at: string;
}

export interface UserSpecificPaperData {
  tags: string;
  memo: string;
}

export interface Paper {
  user_paper_link_id: number;
  paper_metadata: PaperMetadata;
  selected_generated_summary?: GeneratedSummary;
  selected_custom_generated_summary?: CustomGeneratedSummary;
  user_edited_summary?: EditedSummary;
  selected_generated_summary_id?: number;
  selected_custom_generated_summary_id?: number;
  available_summaries: GeneratedSummary[];
  available_custom_summaries: CustomGeneratedSummary[];
  user_specific_data: UserSpecificPaperData;
  created_at: string;
  last_accessed_at?: string;
}

export interface PaperSummaryItem {
  user_paper_link_id: number;
  paper_metadata: PaperMetadata;
  selected_generated_summary_one_point?: string | null;
  selected_generated_summary_llm_info?: string | null;
  user_specific_data: UserSpecificPaperData;
  created_at: string;
  last_accessed_at?: string | null;
}

export interface PapersPageResponse {
  items: PaperSummaryItem[];
  total: number;
  page: number;
  size: number;
  pages: number;
}