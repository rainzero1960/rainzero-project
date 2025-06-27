"use client";

import { useParams } from "next/navigation";
import DetailClient from "./DetailClient";

export default function PaperDetailPage() {
  const params = useParams();
  // params.id は user_paper_link_id として扱う
  const userPaperLinkId = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : "";

  if (!userPaperLinkId) return <div className="p-6 text-red-600">IDが無効です</div>;

  return <DetailClient userPaperLinkId={userPaperLinkId} />; // props名を変更
}