// src/components/AuthComponents.tsx
"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function AuthButton({ className, gameMode = false }: { className?: string; gameMode?: boolean }) {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <Button 
        variant="outline" 
        size="sm" 
        disabled
        className={gameMode 
          ? `bg-white/10 text-white border-white/50 backdrop-blur-sm ${className || ''}` 
          : className || ''
        }
      >
        Loading...
      </Button>
    );
  }

  if (session) {
    return (
      <div className="flex items-center gap-2">
        <span className={`text-sm ${gameMode ? 'text-white/90' : ''} font-medium`}>
          Welcome, {session.user?.name ?? "User"}!
        </span>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => signOut()}
          className={gameMode 
            ? `bg-white/10 hover:bg-white/20 text-white border-white/50 hover:border-white backdrop-blur-sm font-medium ${className || ''}` 
            : className || ''
          }
        >
          Logout
        </Button>
      </div>
    );
  }

  return (
    <Button 
      variant="outline" 
      size="sm" 
      onClick={() => signIn()}
      className={gameMode 
        ? `bg-white/20 hover:bg-white/30 text-white border-white/60 hover:border-white font-bold backdrop-blur-sm shadow-lg transform hover:scale-105 transition-all duration-300 ${className || ''}` 
        : className || ''
      }
    >
      Login
    </Button>
  );
}

// プロバイダーコンポーネント (app/layout.tsx で使用)
import { SessionProvider } from "next-auth/react";
import React from "react";

export function NextAuthProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}