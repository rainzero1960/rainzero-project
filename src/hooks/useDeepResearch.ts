// src/hooks/useDeepResearch.ts
export interface DeepResearchEventData {
    content?: string; // interim content
    summary?: string; // final summary
  }
  
  export type OnChunkCallback = (content: string) => void;
  export type OnFinishCallback = (summary: string) => void;
  export type OnErrorCallback = (error: string | unknown) => void;
  
  export function deepResearchStream(
    query: string,
    onChunk: OnChunkCallback,
    onFinish: OnFinishCallback,
    onError: OnErrorCallback
  ): () => void {
    const urlObj = new URL(
      "/deepresearch", // GETエンドポイントを指す
      process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000"
    );
    urlObj.searchParams.set("q", query);
    const url = urlObj.toString();
  
    const ev = new EventSource(url);
  
    const handleMessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as DeepResearchEventData;
        if (data.summary) {
          onFinish(data.summary);
          ev.close(); // 最終サマリー受信後にクライアント側で閉じる
        } else if (data.content) {
          onChunk(data.content);
        }
      } catch (err) {
        console.error("SSE data parse error:", err, "Data:", e.data);
        // エラー発生時にも onError を呼ぶか検討 (重複呼び出しの可能性あり)
        // onError(err); 
      }
    };
  
    const handleError = (e: Event) => {
      // readyState が CLOSED であれば、サーバーが正常にストリームを終了した可能性が高い
      if (ev.readyState === EventSource.CLOSED) {
        console.log("EventSource closed, possibly after stream completion.");
      } else {
        console.error("EventSource error:", e);
        onError("ストリーム通信中にエラーが発生しました。");
      }
      ev.close(); // エラー時も確実に閉じる
    };
  
    ev.addEventListener("chunk", handleMessage);
    ev.addEventListener("error", handleError);
  
    // Disposer function
    return () => {
      console.log("Disposing EventSource connection.");
      ev.removeEventListener("chunk", handleMessage);
      ev.removeEventListener("error", handleError);
      ev.close();
    };
  }