// src/app/rag/rebuild/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { signIn, useSession } from "next-auth/react"; // useSession と signIn をインポート
import { createApiHeaders } from "@/lib/utils";
import { useAvailablePrompts } from "@/hooks/useAvailablePrompts";


export default function RebuildEmbeddingsPage() {
  const router = useRouter();
  const { data: authSession, status: authStatus } = useSession(); // NextAuthのセッションを取得
  const [currentModel, setCurrentModel] = useState<string>("");
  const [modelName, setModelName] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // プロンプト選択関連の状態
  const { prompts: availablePrompts, isLoading: isPromptsLoading } = useAvailablePrompts();
  const [promptPreference, setPromptPreference] = useState<"auto" | "default" | "custom">("default");
  const [selectedSystemPromptId, setSelectedSystemPromptId] = useState<number | null>(null);

  // 認証状態の確認とリダイレクト
  useEffect(() => {
    if (authStatus === "unauthenticated") {
      alert("この機能を利用するにはログインが必要です。ログインページにリダイレクトします。");
      signIn(undefined, { callbackUrl: "/rag/rebuild" }); // ログインページへリダイレクト
    }
  }, [authStatus, router]);

  // 現在の設定を取得
  useEffect(() => {
    if (authStatus === "authenticated") { // 認証済みの場合のみAPIを叩く
      fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/embeddings/config`)
        .then((r) => {
          if (!r.ok) throw new Error(`Failed to fetch config: ${r.status}`);
          return r.json();
        })
        .then((data) => {
          setCurrentModel(data.model_name);
          setModelName(data.model_name);
        })
        .catch(err => {
          console.error("Error fetching embedding config:", err);
          setError("設定の読み込みに失敗しました。");
        });
    }
  }, [authStatus]); // authStatus を依存配列に追加

  const handleRebuild = async () => {
    setError(null);
    if (authStatus !== "authenticated" || !authSession?.accessToken) {
      alert("認証が必要です。ログインしてください。");
      signIn(undefined, { callbackUrl: "/rag/rebuild" });
      return;
    }

    // カスタムプロンプトが選択されているが、具体的なプロンプトIDが設定されていない場合のバリデーション
    if (promptPreference === "custom" && !selectedSystemPromptId) {
      alert("カスタム要約を優先する場合は、具体的なカスタムプロンプトを選択してください。");
      return;
    }

    if (modelName === currentModel) {
      if (!confirm("選択されたモデルは現在使用中です。再構築しますか？ (あなたのベクトルのみが対象です)")) {
        return;
      }
    } else {
      if (!confirm(`埋め込みモデルを "${modelName}" にして再構築しますか？ (あなたのベクトルのみが対象です)`)) {
        return;
      }
    }

    setLoading(true);
    
    const headers = await createApiHeaders();

    try {
      // プリファレンス設定を準備
      const requestBody: {
        model_name: string;
        preferred_summary_type?: string;
        preferred_system_prompt_id?: number;
      } = { model_name: modelName };
      
      if (promptPreference === "default") {
        requestBody.preferred_summary_type = "default";
      } else if (promptPreference === "custom" && selectedSystemPromptId) {
        requestBody.preferred_summary_type = "custom";
        requestBody.preferred_system_prompt_id = selectedSystemPromptId;
      }
      // "auto"の場合は何も設定しない（既存の優先度ロジックを使用）
      
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/embeddings/rebuild`,
        {
          method: "POST",
          headers: headers,
          body: JSON.stringify(requestBody),
        }
      );
      
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || `リビルドAPIエラー: ${res.statusText}`);
      }
      
      alert(data.message || "ベクトル再構築が完了しました。");
      router.push("/rag"); // RAGページへ遷移

    } catch (err: unknown) {
      console.error("Rebuild error:", err);
      const errorMessage = err instanceof Error ? err.message : "再構築中にエラーが発生しました。";
      setError(errorMessage);
      alert(`エラー: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  if (authStatus === "loading") {
    return <p className="p-6 text-center text-gray-500">認証情報を確認中...</p>;
  }
  if (authStatus !== "authenticated") {
    // useEffect でリダイレクトされるはずだが、念のため表示
    return <p className="p-6 text-center text-orange-500">ログインしていません。リダイレクトします...</p>;
  }

  return (
    <main className="p-6 max-w-lg mx-auto space-y-6">
      <h1 className="text-2xl font-bold">埋め込みベクトル再構築</h1>
      <p className="text-sm text-gray-600">
        この操作は、あなたがライブラリに追加した論文の埋め込みベクトルを全て削除し、再生成します。
        <br />
        RAG機能や推薦機能の調子が悪い場合にお試しください。<br />
      </p>
      {error && <p className="text-red-500 bg-red-100 p-2 rounded">{error}</p>}
      <div className="space-y-2">
        <Label htmlFor="modelNameInput">使用する埋め込みモデル名 (情報表示用)</Label>
        <Input
          id="modelNameInput"
          value={modelName}
          onChange={(e) => setModelName(e.target.value)}
          placeholder="例: models/text-embedding-004"
          disabled // バックエンドで固定されているため、編集不可にするのが適切
        />
        <p className="text-sm text-gray-500">
          現在システム全体で使用されているモデル: {currentModel || "読み込み中..."}
        </p>
        <p className="text-xs text-orange-500">
          注意: 現状埋め込みモデル変更機能はサポートしていません。
        </p>
      </div>
      
      {/* プロンプト選択設定 */}
      <div className="space-y-2">
        <Label htmlFor="promptPreference">要約プロンプト選択（優先度設定）</Label>
        <Select value={promptPreference} onValueChange={(value: "auto" | "default" | "custom") => setPromptPreference(value)} disabled={loading}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">デフォルト要約を優先</SelectItem>
            <SelectItem value="custom">カスタム要約を優先</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-gray-500">
          デフォルト要約は、本サービスにデフォルトで設定されているプロンプトを利用した論文要約を埋め込み作成に利用します。<br />
          カスタム要約は、あなたが作成したカスタムプロンプトを利用した論文要約を埋め込み作成に利用します。<br />
          ただし、どちらを選択しても、論文によっては指定したプロンプトでの要約が存在しない場合があります。<br />
          その場合は、他の利用可能な要約で代替されます。
        </p>
        
        {/* カスタム要約選択時の詳細設定 */}
        {promptPreference === "custom" && (
          <div className="ml-4 space-y-2">
            <Label htmlFor="customPromptSelect">カスタムプロンプト選択</Label>
            {isPromptsLoading ? (
              <div className="text-sm text-gray-500">プロンプト一覧を読み込み中...</div>
            ) : !availablePrompts || availablePrompts.length === 0 ? (
              <div className="text-sm text-red-500">利用可能なプロンプトがありません。</div>
            ) : (
              <Select 
                value={selectedSystemPromptId?.toString() || ""} 
                onValueChange={(value) => setSelectedSystemPromptId(value ? parseInt(value) : null)}
                disabled={loading}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="カスタムプロンプトを選択してください" />
                </SelectTrigger>
                <SelectContent>
                  {availablePrompts
                    .filter(prompt => prompt.type === 'custom' && prompt.id !== null)
                    .map((prompt) => (
                      <SelectItem key={prompt.id} value={prompt.id!.toString()}>
                        {prompt.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-xs text-gray-500">
              指定されたカスタムプロンプトで作成された要約がない場合は、他の利用可能な要約で代替されます。
            </p>
          </div>
        )}
      </div>
      <Button
        variant="destructive"
        className="w-full"
        onClick={handleRebuild}
        disabled={loading || !currentModel || (promptPreference === "custom" && !selectedSystemPromptId)}
      >
        {loading ? "再構築中…" : "埋め込みベクトルを再構築"}
      </Button>
      <Button
        variant="outline"
        className="w-full"
        onClick={() => router.back()}
      >
        キャンセル
      </Button>
    </main>
  );
}