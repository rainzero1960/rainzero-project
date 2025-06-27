import { Paper } from "@/types/paper"; // 更新されたPaper型

interface CurrentSummaryInfo {
  llm_provider: string;
  llm_model_name: string;
  one_point: string | null;
  isEdited: boolean;
}

interface Props {
  paper: Paper; // 型を更新
  currentSummaryInfo?: CurrentSummaryInfo | null;
}

export default function InfoCard({ paper, currentSummaryInfo }: Props) {
  const formatAuthors = (authors: string | null | undefined): string => {
    if (!authors) return "不明";
    const authorList = authors.split(",").map((a) => a.trim());
    if (authorList.length <= 2) return authors;
    return `${authorList.slice(0, 2).join(", ")} 他`;
  };

  // paper.paper_metadata や paper.user_specific_data から情報を取得
  const metadata = paper.paper_metadata;
  const user_data = paper.user_specific_data;
  
  // currentSummaryInfoがある場合はそれを使用、なければ元のsummaryを使用
  const displaySummaryInfo = currentSummaryInfo || {
    llm_provider: paper.selected_generated_summary?.llm_provider,
    llm_model_name: paper.selected_generated_summary?.llm_model_name,
    one_point: paper.selected_generated_summary?.one_point,
    isEdited: false
  };

  return (
    <div className="rounded-lg border p-4 shadow-sm bg-white dark:bg-card">
      <h2 className="mb-2 text-xl font-bold">{metadata.title}</h2>

      <p className="text-sm text-gray-600 dark:text-gray-400">
        URL:{" "}
        <a
          href={metadata.arxiv_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 dark:text-blue-400 underline"
        >
          {metadata.arxiv_url}
        </a>
      </p>

      <p className="text-sm text-gray-600 dark:text-gray-400">著者: {formatAuthors(metadata.authors)}</p>

      {metadata.published_date && (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          投稿日: {metadata.published_date}
        </p>
      )}

      <p className="mt-4 whitespace-pre-line">
        <span className="font-semibold">Abstract:</span> {metadata.abstract.replace(/\r?\n/g, ' ') ?? "（なし）"}
      </p>

      {displaySummaryInfo.llm_provider && displaySummaryInfo.one_point && (
        <p className="mt-2 whitespace-pre-line">
            <span className="font-semibold">
              LLMによる一言要約 ({displaySummaryInfo.llm_provider}/{displaySummaryInfo.llm_model_name})
              {displaySummaryInfo.isEdited && <span className="text-blue-600 dark:text-blue-400 ml-1">[編集済み]</span>}:
            </span> {displaySummaryInfo.one_point}
        </p>
      )}

      {user_data.tags && (
        <p className="mt-2 text-sm text-blue-600 dark:text-blue-400">あなたのタグ: {user_data.tags}</p>
      )}


      <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
        ライブラリ追加日時: {paper.created_at ? new Date(paper.created_at).toLocaleString() : "不明"}
      </p>
      {paper.last_accessed_at && (
         <p className="text-xs text-gray-400 dark:text-gray-500">
            最終アクセス日時: {new Date(paper.last_accessed_at).toLocaleString()}
         </p>
      )}
      <p className="text-sm text-gray-600 dark:text-gray-400">
        alphaXiv:{" "}
        <a
          href={"https://alphaxiv.org/abs/"+metadata.arxiv_id}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 dark:text-blue-400 underline"
        >
          {"https://alphaxiv.org/abs/"+metadata.arxiv_id}
        </a>
      </p>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        BibTex:{" "}
        <a
          href={"https://arxiv.org/bibtex/"+metadata.arxiv_id}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 dark:text-blue-400 underline"
        >
          {"https://arxiv.org/bibtex/"+metadata.arxiv_id}
        </a>
      </p>

    </div>
  );
}