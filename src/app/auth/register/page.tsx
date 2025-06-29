// src/app/auth/register/page.tsx
"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GraduationCap, UserPlus, Sparkles, Home, AlertTriangle } from "lucide-react";
import Link from "next/link";

export default function RegisterPage() {

  // ▼▼▼ 追加: ユーザー登録機能の有効/無効を切り替えるフラグ ▼▼▼
  // falseに設定すると、登録フォームが無効になります。
const registrationEnabled = false; // ここをfalseにすると登録機能が無効になります
  // ▲▲▲ ▲▲▲ ▲▲▲

  const router = useRouter();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // 機能が無効な場合は処理を中断
    if (!registrationEnabled) {
      return;
    }

    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/auth/register`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, email, password }),
        }
      );

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || `Registration failed: ${res.statusText}`);
      }

      // 登録成功後、自動でログインさせる
      const signInResult = await signIn("credentials", { 
        redirect: false,
        username,
        password,
      });

      if (signInResult?.error) {
        setError(`Registration successful, but auto-login failed: ${signInResult.error}. Please login manually.`);
      } else {
        router.push("/"); // 登録とログイン成功後、ホームページへ
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-custom flex flex-col overflow-hidden">
      {/* Animated background particles */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-10 -left-10 w-40 h-40 bg-green-300 dark:bg-green-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-pulse"></div>
        <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-blue-300 dark:bg-blue-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-pulse [animation-delay:2s]"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-40 h-40 bg-orange-300 dark:bg-orange-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-pulse [animation-delay:4s]"></div>
      </div>

      {/* Header */}
      <header className="sticky top-0 z-50 w-full backdrop-blur-lg bg-white/80 dark:bg-white/10 border-b border-gray-200 dark:border-white/20">
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <div className="mx-auto flex h-16 max-w-screen-2xl items-center justify-between">
            <Link href="/" className="flex items-center space-x-3 group">
              <div className="relative">
                <GraduationCap className="h-8 w-8 text-purple-600 dark:text-white transform group-hover:rotate-12 transition-transform" />
                <Sparkles className="absolute -top-1 -right-1 h-4 w-4 text-yellow-500 dark:text-yellow-300 animate-pulse" />
              </div>
              <span className="font-black text-xl sm:inline-block text-gray-900 dark:text-white">
                KnowledgePaper
              </span>
            </Link>
            <div className="flex items-center space-x-3">
              <Button variant="ghost" size="sm" asChild className="text-gray-700 dark:text-white hover:bg-gray-100 dark:hover:bg-white/20">
                <Link href="/">
                  <Home className="h-4 w-4 mr-2" />
                  <span className="text-sm">ホームページへ</span>
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 relative z-10 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="relative inline-block mb-4">
              <UserPlus className="h-16 w-16 text-green-600 dark:text-green-300 mx-auto animate-bounce" />
              <Sparkles className="absolute -top-2 -right-2 h-6 w-6 text-yellow-500 dark:text-yellow-300 animate-pulse" />
            </div>
            <h1 className="text-4xl font-black mb-2">
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-green-600 via-blue-500 to-green-600 dark:from-green-300 dark:via-blue-300 dark:to-green-300">
                新規登録
              </span>
            </h1>
            <p className="text-lg text-gray-700 dark:text-white/90">
              研究の冒険を始めましょう！✨
            </p>
          </div>

          <Card className="group relative overflow-hidden bg-white/90 dark:bg-black/40 backdrop-blur-lg border-2 border-green-200 dark:border-white/30 shadow-2xl">
            <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-green-400 to-blue-400 rounded-full transform translate-x-12 -translate-y-12 group-hover:scale-150 transition-transform duration-500 opacity-70"></div>
            
            <CardHeader className="relative z-10 text-center">
              <CardTitle className="text-2xl font-black text-gray-800 dark:text-white">
                新しいアカウントを作成
              </CardTitle>
              <CardDescription className="text-base text-gray-600 dark:text-white/80">
                必要な情報を入力してアカウントを作成してください
              </CardDescription>
            </CardHeader>

            <CardContent className="relative z-10">
              {error && (
                <div className="mb-6 p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg">
                  <p className="text-red-800 dark:text-red-200 text-sm">
                    {error}
                  </p>
                </div>
              )}

              {!registrationEnabled && (
                <div className="mb-6 p-4 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded-lg flex items-center gap-3">
                  <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-300 flex-shrink-0" />
                  <p className="text-yellow-800 dark:text-yellow-200 text-sm">
                    ユーザー追加機能は現在利用できません。
                  </p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="username" className="text-sm font-medium text-gray-700 dark:text-white">
                    ユーザー名
                  </Label>
                  <Input
                    id="username"
                    name="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    className="w-full bg-white/70 dark:bg-white/10 backdrop-blur-sm border-gray-300 dark:border-white/30"
                    placeholder="ユーザー名を入力"
                    disabled={!registrationEnabled || loading}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium text-gray-700 dark:text-white">
                    メールアドレス（任意）
                  </Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-white/70 dark:bg-white/10 backdrop-blur-sm border-gray-300 dark:border-white/30"
                    placeholder="メールアドレスを入力（任意）"
                    disabled={!registrationEnabled || loading}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-sm font-medium text-gray-700 dark:text-white">
                    パスワード
                  </Label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full bg-white/70 dark:bg-white/10 backdrop-blur-sm border-gray-300 dark:border-white/30"
                    placeholder="パスワードを入力"
                    disabled={!registrationEnabled || loading}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="text-sm font-medium text-gray-700 dark:text-white">
                    パスワード（確認）
                  </Label>
                  <Input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className="w-full bg-white/70 dark:bg-white/10 backdrop-blur-sm border-gray-300 dark:border-white/30"
                    placeholder="パスワードを再入力"
                    disabled={!registrationEnabled || loading}
                  />
                </div>

                <Button 
                  type="submit" 
                  className="w-full group bg-gradient-to-r from-green-500 to-blue-600 hover:from-green-600 hover:to-blue-700 text-white border-2 border-green-200 dark:border-white/30 shadow-xl transform hover:scale-105 transition-all duration-300 py-3"
                  disabled={!registrationEnabled || loading}
                >
                  <UserPlus className="mr-2 h-5 w-5 group-hover:rotate-12 transition-transform" />
                  <span className="font-bold text-lg">
                    {loading ? "登録中..." : "アカウント作成"}
                  </span>
                  <Sparkles className="ml-2 h-4 w-4 text-yellow-300 animate-pulse" />
                </Button>
              </form>

              <div className="mt-6 text-center">
                <p className="text-sm text-gray-600 dark:text-white/80">
                  既にアカウントをお持ちの方は{" "}
                  <Link 
                    href="/auth/signin" 
                    className="font-bold text-green-600 dark:text-green-300 hover:text-green-800 dark:hover:text-green-100 underline decoration-2 underline-offset-2 hover:decoration-green-600 transition-colors"
                  >
                    こちらからログイン
                  </Link>
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full py-6 relative z-10 bg-gray-50/80 dark:bg-black/20 backdrop-blur-md border-t border-gray-200 dark:border-white/20">
        <div className="container mx-auto px-4">
          <div className="flex flex-col items-center justify-center gap-2">
            <p className="text-center text-sm text-gray-600 dark:text-white/80">
              © {new Date().getFullYear()} KnowledgePaper. All rights reserved.
            </p>
            <div className="flex items-center gap-2">
              <span className="text-gray-600 dark:text-white/80 text-sm">研究の新しい形を、一緒に。</span>
              <Sparkles className="h-4 w-4 text-yellow-600 dark:text-yellow-300 animate-pulse" />
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}