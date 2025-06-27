// src/app/(app)/layout.tsx
"use client";

import { useSession, signIn } from "next-auth/react";
import { useEffect } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeInitializer } from "@/components/ThemeInitializer";
import { SessionChecker } from "@/components/SessionChecker";
import { ServiceWorkerManager } from "@/components/ServiceWorkerManager";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { status } = useSession();

  useEffect(() => {
    // 認証されておらず、ロード中でもない場合、ログインページにリダイレクト
    if (status === "unauthenticated") {
      signIn(undefined, { callbackUrl: "/dashboard" }); // ログイン後、ダッシュボードに戻る
    }
  }, [status]);

  // ロード中または認証済みの場合はコンテンツを表示
  if (status === "loading") {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-lg">Loading application...</div>
      </div>
    );
  }

  if (status === "authenticated") {
    return (
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        enableSystem
        disableTransitionOnChange
      >
        <SessionChecker />
        <ServiceWorkerManager />
        <ThemeInitializer />
        {children}
      </ThemeProvider>
    );
  }

  // 未認証でリダイレクト待ちの間は何も表示しないか、ローディング表示
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
      <div className="text-lg">Redirecting to login...</div>
    </div>
  );
}