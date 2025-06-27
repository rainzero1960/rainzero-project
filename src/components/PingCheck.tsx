"use client";
import { useEffect, useState } from "react";

export default function PingCheck() {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    // ★ ここで FastAPI にリクエスト ★
    fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/ping`)
      .then((res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        return res.json();
      })
      .then((data: { ok: boolean }) => {
        if (data.ok) setStatus("ok");
        else setStatus("error");
      })
      .catch(() => setStatus("error"));
  }, []);

  if (status === "loading") return <p className="text-gray-500">利用可能になるまで少々お待ちください</p>;
  if (status === "error") return <p className="text-red-600">現在利用不可です。リロードしても解決しない場合は問い合わせください</p>;
  return <p className="text-green-600">利用可能です</p>;
}
