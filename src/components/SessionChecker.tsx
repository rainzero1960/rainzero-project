// src/components/SessionChecker.tsx
"use client";

import { useSession, signOut } from "next-auth/react";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function SessionChecker() {
  const { data: session, status } = useSession();
  const pathname = usePathname();

  useEffect(() => {
    if (session?.error === "AccessTokenExpiredError" && status === "authenticated") {
      console.log("Session error detected (AccessTokenExpiredError), signing out.");
      // ログインページやエラーページ自体で無限ループしないようにする
      if (!pathname.startsWith("/auth/signin") && !pathname.startsWith("/auth/error")) {
        signOut({ callbackUrl: `/auth/signin?error=SessionExpired&callbackUrl=${pathname}` });
      }
    }
  }, [session, status, pathname]);

  return null; // このコンポーネントはUIを描画しない
}