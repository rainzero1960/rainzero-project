// src/app/(game)/layout.tsx
"use client";

import "./game.css";
import { useSession } from "next-auth/react";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeInitializer } from "@/components/ThemeInitializer";
import { SessionChecker } from "@/components/SessionChecker";
import { ServiceWorkerManager } from "@/components/ServiceWorkerManager";

export default function GameLayout({ children }: { children: React.ReactNode }) {
  const { status } = useSession();

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
    >
      {status === "authenticated" && (
        <>
          <SessionChecker />
          <ServiceWorkerManager />
          <ThemeInitializer />
        </>
      )}
      <div className="game-layout">
        <div className="game-background"></div>
        <div className="game-content">
          {children}
        </div>
      </div>
    </ThemeProvider>
  );
}