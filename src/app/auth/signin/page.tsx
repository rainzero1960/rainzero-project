// src/app/auth/signin/page.tsx
"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GraduationCap, LogIn, Sparkles, Home } from "lucide-react";
import Link from "next/link";



function SignInInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";
  const error = searchParams.get("error");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);


  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    const result = await signIn("credentials", {
      redirect: false, // エラーを自分でハンドルするため false
      username,
      password,
      callbackUrl, // 成功時のリダイレクト先
    });

    setLoading(false);
    if (result?.error) {
      // エラーメッセージは result.error に入る (NextAuthが設定)
      // ここではシンプルにアラート
      alert(`Login failed: ${result.error}`);
    } else if (result?.url) {
      router.push(result.url); // 成功時は指定されたURLへ
    } else {
      // 通常は result.url があるはずだが、念のため
      router.push(callbackUrl);
    }
  };

  return (
    <div className="min-h-screen bg-custom flex flex-col overflow-hidden">
      {/* Animated background particles */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-10 -left-10 w-40 h-40 bg-blue-300 dark:bg-blue-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-pulse"></div>
        <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-purple-300 dark:bg-purple-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-pulse [animation-delay:2s]"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-40 h-40 bg-pink-300 dark:bg-pink-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-pulse [animation-delay:4s]"></div>
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
              <LogIn className="h-16 w-16 text-purple-600 dark:text-purple-300 mx-auto animate-bounce" />
              <Sparkles className="absolute -top-2 -right-2 h-6 w-6 text-yellow-500 dark:text-yellow-300 animate-pulse" />
            </div>
            <h1 className="text-4xl font-black mb-2">
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-600 via-blue-500 to-purple-600 dark:from-purple-300 dark:via-blue-300 dark:to-purple-300">
                ログイン
              </span>
            </h1>
            <p className="text-lg text-gray-700 dark:text-white/90">
              研究の冒険を続けましょう！✨
            </p>
          </div>

          <Card className="group relative overflow-hidden bg-white/90 dark:bg-black/40 backdrop-blur-lg border-2 border-purple-200 dark:border-white/30 shadow-2xl">
            <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-purple-400 to-pink-400 rounded-full transform translate-x-12 -translate-y-12 group-hover:scale-150 transition-transform duration-500 opacity-70"></div>
            
            <CardHeader className="relative z-10 text-center">
              <CardTitle className="text-2xl font-black text-gray-800 dark:text-white">
                アカウントにサインイン
              </CardTitle>
              <CardDescription className="text-base text-gray-600 dark:text-white/80">
                ユーザー名とパスワードを入力してください
              </CardDescription>
            </CardHeader>

            <CardContent className="relative z-10">
              {error && (
                <div className="mb-6 p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg">
                  <p className="text-red-800 dark:text-red-200 text-sm">
                    ログインに失敗しました。認証情報を確認してください。(エラー: {error})
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
                  />
                </div>

                <Button 
                  type="submit" 
                  className="w-full group bg-gradient-to-r from-purple-500 to-blue-600 hover:from-purple-600 hover:to-blue-700 text-white border-2 border-purple-200 dark:border-white/30 shadow-xl transform hover:scale-105 transition-all duration-300 py-3"
                  disabled={loading}
                >
                  <LogIn className="mr-2 h-5 w-5 group-hover:rotate-12 transition-transform" />
                  <span className="font-bold text-lg">
                    {loading ? "ログイン中..." : "ログイン"}
                  </span>
                  <Sparkles className="ml-2 h-4 w-4 text-yellow-300 animate-pulse" />
                </Button>
              </form>

              <div className="mt-6 text-center">
                <p className="text-sm text-gray-600 dark:text-white/80">
                  アカウントをお持ちでない方は{" "}
                  <Link 
                    href="/auth/register" 
                    className="font-bold text-purple-600 dark:text-purple-300 hover:text-purple-800 dark:hover:text-purple-100 underline decoration-2 underline-offset-2 hover:decoration-purple-600 transition-colors"
                  >
                    こちらから登録
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

export default function SignInPage() {
   return (
     <Suspense fallback={null}>
       <SignInInner />
     </Suspense>
   );
 }