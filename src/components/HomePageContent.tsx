"use client";

import PingCheck from "@/components/PingCheck";
import Link from "next/link";
import { AuthButton } from "@/components/AuthComponents";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { FilePlus2, List, SearchCode, GraduationCap, Settings, Sparkles, BookOpen, Heart, Star, Zap, Layers, Target, Rocket, Lock } from "lucide-react"; 
import { Session } from "next-auth";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useColorTheme } from "@/hooks/useColorTheme";

interface HomePageContentProps {
  session: Session | null;
}

export default function HomePageContent({ session }: HomePageContentProps) {
  const { user, isLoading } = useColorTheme();
  
  // キャラクター選択状態を判定
  const hasSelectedCharacter = user?.selected_character !== null && user?.selected_character !== undefined;

  return (
    <div className="min-h-screen bg-custom flex flex-col overflow-hidden">
      {/* Animated background particles */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-10 -left-10 w-40 h-40 bg-yellow-300 dark:bg-yellow-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-pulse"></div>
        <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-pink-300 dark:bg-pink-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-pulse [animation-delay:2s]"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-40 h-40 bg-purple-300 dark:bg-purple-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-pulse [animation-delay:4s]"></div>
      </div>

      <header className="sticky top-0 z-50 w-full backdrop-blur-lg bg-white/80 dark:bg-white/10 border-b border-gray-200 dark:border-white/20">
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <div className="mx-auto flex h-16 max-w-screen-2xl items-center justify-between">
            <Link href="/dashboard" className="flex items-center space-x-3 group">
              <div className="relative">
                <GraduationCap className="h-8 w-8 text-purple-600 dark:text-white transform group-hover:rotate-12 transition-transform" />
                <Sparkles className="absolute -top-1 -right-1 h-4 w-4 text-yellow-500 dark:text-yellow-300 animate-pulse" />
              </div>
              <span className="font-black text-xl sm:inline-block text-gray-900 dark:text-white">
                KP
              </span>
            </Link>
            <div className="flex items-center space-x-3">
              <Button variant="ghost" size="sm" asChild className="text-gray-700 dark:text-white hover:bg-gray-100 dark:hover:bg-white/20">
                <Link href="/">
                  <span className="text-sm">ゲームに戻る</span>
                </Link>
              </Button>
              <ThemeToggle />
              {session && ( 
                <Button variant="ghost" size="sm" asChild className="text-gray-700 dark:text-white hover:bg-gray-100 dark:hover:bg-white/20">
                  <Link href="/settings">
                    <Settings className="h-5 w-5" />
                    <span className="sr-only">設定</span>
                  </Link>
                </Button>
              )}
              <AuthButton />
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 relative z-10">
        <section className="w-full py-10 md:py-16 lg:py-20">
          <div className="container mx-auto px-4 md:px-6">
            <div className="mx-auto max-w-4xl text-center space-y-8">
              <div className="relative inline-block">
                <Rocket className="absolute -top-8 left-1/2 transform -translate-x-1/2 h-12 w-12 text-orange-500 dark:text-yellow-400 animate-bounce" />
                <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-black">
                  <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-600 via-pink-500 to-orange-500 dark:from-purple-300 dark:via-pink-300 dark:to-orange-300">
                    Knowledge
                  </span>
                  <span className="bg-clip-text text-transparent bg-gradient-to-r from-orange-500 via-pink-500 to-purple-600 dark:from-orange-300 dark:via-pink-300 dark:to-purple-300">
                    Paper
                  </span>
                  <span className="text-gray-800 dark:text-white text-4xl sm:text-5xl ml-2">🎓</span>
                </h1>
              </div>
              
              <div className="space-y-4">
                <p className="text-xl sm:text-2xl text-gray-800 dark:text-white font-bold">
                  研究の冒険をもっと楽しく！✨
                </p>
                <p className="text-lg sm:text-xl text-gray-700 dark:text-white/90 max-w-2xl mx-auto">
                  論文の管理、検索、そして新しい知見の発見を、よりスマートに。
                  あなたの研究活動を加速させるプラットフォームです。
                </p>
                <div className="flex flex-wrap gap-4 justify-center text-gray-700 dark:text-white/80">
                  <span className="flex items-center gap-2 bg-gray-200/80 dark:bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full">
                    <BookOpen className="h-5 w-5 text-blue-600 dark:text-blue-300" />
                    <span>スマート管理・高速検索</span>
                  </span>
                  <span className="flex items-center gap-2 bg-gray-200/80 dark:bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full">
                    <Zap className="h-5 w-5 text-yellow-600 dark:text-yellow-300" />
                    <span>パーソナルAI要約</span>
                  </span>
                  <span className="flex items-center gap-2 bg-gray-200/80 dark:bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full">
                    <Layers className="h-5 w-5 text-purple-600 dark:text-purple-300" />
                    <span>自動TAG管理</span>
                  </span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-6 justify-center pt-8">
                <Button asChild size="lg" className="group bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white border-2 border-pink-200 dark:border-white/30 shadow-2xl transform hover:scale-105 transition-all duration-300">
                  <Link href="/papers/add">
                    <FilePlus2 className="mr-2 h-6 w-6 group-hover:rotate-12 transition-transform" />
                    <span className="font-bold text-lg">論文を追加する</span>
                    <Star className="ml-2 h-5 w-5 text-yellow-300 animate-pulse" />
                  </Link>
                </Button>
                
                {/* キャラクター選択状態に基づく条件付きボタン */}
                {!isLoading && hasSelectedCharacter ? (
                  <Button asChild variant="outline" size="lg" className="group bg-gray-100/80 dark:bg-white/20 backdrop-blur-md hover:bg-gray-200 dark:hover:bg-white/30 text-gray-800 dark:text-white border-2 border-gray-300 dark:border-white/50 shadow-xl transform hover:scale-105 transition-all duration-300">
                    <Link href="/papers">
                      <List className="mr-2 h-6 w-6 group-hover:animate-bounce" />
                      <span className="font-bold text-lg">論文一覧を見る</span>
                      <Sparkles className="ml-2 h-5 w-5 text-yellow-600 dark:text-yellow-300" />
                    </Link>
                  </Button>
                ) : (
                  <Button 
                    variant="outline" 
                    size="lg" 
                    disabled={!isLoading}
                    className="group bg-gray-100/50 dark:bg-white/10 backdrop-blur-md text-gray-400 dark:text-gray-500 border-2 border-gray-200 dark:border-white/20 shadow-xl cursor-not-allowed"
                    title={isLoading ? "読み込み中..." : "論文DBを利用するには、まずキャラクターを選択してください"}
                  >
                    <Lock className="mr-2 h-6 w-6" />
                    <span className="font-bold text-lg">論文一覧を見る</span>
                    <span className="ml-2 text-xs bg-orange-500 text-white px-2 py-1 rounded-full">キャラクター選択必要</span>
                  </Button>
                )}
              </div>

              {!isLoading && !hasSelectedCharacter && (
                <div className="mt-4 p-4 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-lg">
                  <p className="text-orange-800 dark:text-orange-200 text-sm">
                    📝 論文DBを利用するには、まず<Link href="/" className="underline font-semibold hover:text-orange-600">ゲームページ</Link>でキャラクターを選択してください
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>
        
        <section className="w-full py-0 text-center">
          <div className="container mx-auto px-0 md:px-0">
            <div className="mx-auto max-w-xs">
              <PingCheck />
            </div>
          </div>
        </section>

        <Separator className="my-8 md:my-12 max-w-5xl mx-auto opacity-30" />

        <section className="w-full py-8 md:py-12">
          <div className="container mx-auto px-4 md:px-6">
            <div className="mx-auto max-w-4xl text-center mb-12">
              <h2 className="text-4xl sm:text-5xl font-black text-gray-800 dark:text-white mb-4">
                <Target className="inline-block mr-3 h-10 w-10 text-orange-500 dark:text-yellow-300 animate-bounce" />
                主な機能
              </h2>
              <p className="text-xl text-gray-700 dark:text-white/90">
                KnowledgePaperが提供する便利な機能をご覧ください。
              </p>
            </div>

            <div className="mx-auto grid gap-8 md:grid-cols-2 lg:grid-cols-3 max-w-6xl">
              <Card className="group relative overflow-hidden bg-gradient-to-br from-blue-500 to-purple-600 border-2 border-blue-200 dark:border-white/30 shadow-2xl hover:shadow-3xl transform hover:scale-105 transition-all duration-300">
                <div className="absolute top-0 right-0 w-24 h-24 bg-yellow-400 rounded-full transform translate-x-12 -translate-y-12 group-hover:scale-150 transition-transform duration-500"></div>
                <CardHeader className="relative z-10">
                  <div className="flex items-center justify-between mb-4">
                    <FilePlus2 className="h-12 w-12 text-white" />
                    <span className="bg-yellow-400 text-purple-900 text-sm font-bold px-3 py-1 rounded-full">
                      Add
                    </span>
                  </div>
                  <CardTitle className="text-2xl font-black text-white">論文の追加</CardTitle>
                  <CardDescription className="text-white/90 text-base">
                    新しい論文情報を簡単に追加・登録できます。
                    Arxiv URLもしくはHuggingFace Paperから取得が可能です。
                    
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex-grow relative z-10">
                  <div className="flex gap-2 mt-4">
                    <span className="text-white/80 text-sm">📚 複数登録・HuggingFace Paper対応</span>
                  </div>
                </CardContent>
                <CardFooter className="relative z-10">
                  <Button asChild className="w-full bg-white/20 backdrop-blur-md hover:bg-white/30 text-white font-bold text-lg border-2 border-white/50">
                    <Link href="/papers/add">
                      追加ページへ
                      <Zap className="ml-2 h-5 w-5 text-yellow-300" />
                    </Link>
                  </Button>
                </CardFooter>
              </Card>

              <Card className={`group relative overflow-hidden bg-gradient-to-br border-2 shadow-2xl transform transition-all duration-300 ${
                !isLoading && hasSelectedCharacter 
                  ? "from-green-500 to-teal-600 border-green-200 dark:border-white/30 hover:shadow-3xl hover:scale-105" 
                  : "from-gray-400 to-gray-500 border-gray-300 dark:border-gray-600"
              }`}>
                <div className={`absolute top-0 right-0 w-24 h-24 rounded-full transform translate-x-12 -translate-y-12 transition-transform duration-500 ${
                  !isLoading && hasSelectedCharacter 
                    ? "bg-pink-400 group-hover:scale-150" 
                    : "bg-gray-300"
                }`}></div>
                <CardHeader className="relative z-10">
                  <div className="flex items-center justify-between mb-4">
                    {!isLoading && hasSelectedCharacter ? (
                      <List className="h-12 w-12 text-white" />
                    ) : (
                      <Lock className="h-12 w-12 text-white" />
                    )}
                    <span className={`text-sm font-bold px-3 py-1 rounded-full ${
                      !isLoading && hasSelectedCharacter 
                        ? "bg-pink-400 text-green-900" 
                        : "bg-gray-300 text-gray-700"
                    }`}>
                      {!isLoading && hasSelectedCharacter ? "List" : "Locked"}
                    </span>
                  </div>
                  <CardTitle className="text-2xl font-black text-white">論文一覧</CardTitle>
                  <CardDescription className="text-white/90 text-base">
                    登録された論文を一覧で確認・管理できます。
                    ソートやフィルタリングも可能です。
                    {!isLoading && hasSelectedCharacter ? (
                      "あなたの好みに合わせて論文を推薦します。"
                    ) : (
                      "キャラクター選択後にご利用いただけます。"
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex-grow relative z-10">
                  <div className="flex gap-2 mt-4">
                    <span className="text-white/80 text-sm">
                      {!isLoading && hasSelectedCharacter ? "🔍 高度なRecomend機能" : "🔒 キャラクター選択が必要"}
                    </span>
                  </div>
                </CardContent>
                <CardFooter className="relative z-10">
                  {!isLoading && hasSelectedCharacter ? (
                    <Button asChild className="w-full bg-white/20 backdrop-blur-md hover:bg-white/30 text-white font-bold text-lg border-2 border-white/50">
                      <Link href="/papers">
                        一覧を見る
                        <BookOpen className="ml-2 h-5 w-5 text-yellow-300" />
                      </Link>
                    </Button>
                  ) : (
                    <Button asChild className="w-full bg-white/20 backdrop-blur-md hover:bg-white/30 text-white font-bold text-lg border-2 border-white/50">
                      <Link href="/">
                        キャラクター選択
                        <Settings className="ml-2 h-5 w-5 text-yellow-300" />
                      </Link>
                    </Button>
                  )}
                </CardFooter>
              </Card>

              <Card className="group relative overflow-hidden bg-gradient-to-br from-purple-600 to-pink-600 border-2 border-purple-200 dark:border-white/30 shadow-2xl hover:shadow-3xl transform hover:scale-105 transition-all duration-300">
                <div className="absolute top-0 right-0 w-24 h-24 bg-orange-400 rounded-full transform translate-x-12 -translate-y-12 group-hover:scale-150 transition-transform duration-500"></div>
                <div className="absolute top-4 right-4 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full animate-pulse">
                  ADVANCED
                </div>
                <CardHeader className="relative z-10">
                  <div className="flex items-center justify-between mb-4">
                    <SearchCode className="h-12 w-12 text-white" />
                    <span className="bg-orange-400 text-purple-900 text-sm font-bold px-3 py-1 rounded-full">
                      AI
                    </span>
                  </div>
                  <CardTitle className="text-2xl font-black text-white">Agentによる調査</CardTitle>
                  <CardDescription className="text-white/90 text-base">
                    Deep Research, Deep RAGなどのエージェントシステムを利用して
                    取得した論文の検索や情報収集が可能です。
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex-grow relative z-10">
                  <div className="flex gap-2 mt-4">
                    <span className="text-white/80 text-sm">🤖 高度なエージェントシステム</span>
                  </div>
                </CardContent>
                <CardFooter className="relative z-10">
                  <Button asChild className="w-full bg-white/20 backdrop-blur-md hover:bg-white/30 text-white font-bold text-lg border-2 border-white/50">
                    <Link href="/rag">
                      RAG検索へ
                      <Target className="ml-2 h-5 w-5 text-yellow-300" />
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            </div>

            <div className="mt-16 text-center">
              <div className="inline-flex items-center gap-4 bg-gray-100/80 dark:bg-white/20 backdrop-blur-md rounded-full px-8 py-4">
                <Heart className="h-6 w-6 text-red-500 dark:text-red-400 fill-red-500 dark:fill-red-400 animate-pulse" />
                <div className="text-gray-800 dark:text-white text-lg">
                  研究をもっと楽しく、もっと効率的に！
                </div>
                <Heart className="h-6 w-6 text-red-500 dark:text-red-400 fill-red-500 dark:fill-red-400 animate-pulse" />
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="w-full py-8 md:px-8 relative z-10 bg-gray-50/80 dark:bg-black/20 backdrop-blur-md border-t border-gray-200 dark:border-white/20">
        <div className="container mx-auto px-4 md:px-6">
          <div className="mx-auto flex max-w-screen-2xl flex-col items-center justify-between gap-4 md:flex-row">
            <p className="text-center text-sm text-gray-600 dark:text-white/80 md:text-left">
              © {new Date().getFullYear()} KnowledgePaper. All rights reserved.
            </p>
            <div className="flex items-center gap-4">
              <span className="text-gray-600 dark:text-white/80 text-sm">研究の新しい形を、一緒に。</span>
              <Sparkles className="h-5 w-5 text-yellow-600 dark:text-yellow-300 animate-pulse" />
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}