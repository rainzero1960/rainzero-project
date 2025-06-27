// src/app/(game)/page.tsx
"use client";

import { useSession } from "next-auth/react";
import { AuthButton } from "@/components/AuthComponents";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, FilePlus2, List, SearchCode, Settings } from "lucide-react";
import { useColorTheme } from "@/hooks/useColorTheme";
import { useUserInfo } from "@/hooks/useUserInfo";
import DisplayNamePopup from "@/components/DisplayNamePopup";

// キャラクター情報の定義
const characterData = {
  sakura: {
    name: "天野 咲良",
    title: "たとえAIがあっても・・・私は知りたいの！",
    description: "明るく素直な性格の女の子で、勉強は苦手だけど誰よりも一生懸命。最初は「AIがある時代に勉強なんて意味あるの？」と思っていたけれど、主人公たちと出会って学ぶことの楽しさに目覚める。初対面の時から主人公のことをなぜか知っているみたいで……。",
    theme: "from-pink-500 to-rose-600",
    borderColor: "border-pink-300/50"
  },
  miyuki: {
    name: "白瀬 深雪", 
    title: "そうね。あなたの論文、私が手伝うわ",
    description: "クールで知的な先輩で、圧倒的な頭脳と論理的思考力を持つ天才少女。一見近寄りがたい雰囲気だけど、内心は非常に後輩思い。論文を読み解く姿は美しく、難しい内容も分かりやすく説明してくれる頼れる存在。でも、その完璧に見える彼女には、誰も知らない秘密があって……。",
    theme: "from-cyan-500 to-blue-600",
    borderColor: "border-cyan-300/50"
  }
};

type CharacterKey = keyof typeof characterData;

export default function GameHomePage() {
  const { data: session } = useSession();
  const router = useRouter();
  const { user, isLoading: isUserLoading, updateColorTheme, mutate } = useColorTheme();
  const { 
    updateCharacterSelectionWithBackgroundUpdate,
    checkBulkUpdateProgress,
    clearPapersCache
  } = useUserInfo();
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterKey | null>(null);
  const [isSelectingCharacter, setIsSelectingCharacter] = useState(false);
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);
  const [showDisplayNamePopup, setShowDisplayNamePopup] = useState(false);
  const [hasShownDisplayNamePopup, setHasShownDisplayNamePopup] = useState(false);
  const [isCharacterModalClosing, setIsCharacterModalClosing] = useState(false);
  const [isNavigating, setIsNavigating] = useState<string | null>(null);
  
  // モバイル対応用のstate
  const [currentCharacterIndex, setCurrentCharacterIndex] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [screenWidth, setScreenWidth] = useState(0);

  // 一括更新進捗管理用のstate
  const [bulkUpdateProgress, setBulkUpdateProgress] = useState<{
    is_running: boolean;
    total_papers: number;
    processed_papers: number;
    estimated_remaining_seconds?: number;
    error_message?: string;
  } | null>(null);
  const [showProgressToast, setShowProgressToast] = useState(false);
  const [progressInterval, setProgressInterval] = useState<NodeJS.Timeout | null>(null);

  // キャラクター選択状態を判定
  const hasSelectedCharacter = user?.selected_character !== null && user?.selected_character !== undefined;
  
  // キャラクターキーの配列
  const characterKeys: CharacterKey[] = ['sakura', 'miyuki'];
  
  // 背景画像のフォーカス位置を決定
  const getBackgroundPosition = () => {
    // 900px以上の場合は中央表示
    if (screenWidth >= 900) {
      return 'center center';
    }
    
    // 900px未満の場合はキャラクターに応じてフォーカス
    const selectedChar = user?.selected_character;
    if (selectedChar === 'miyuki') {
      return '80% center'; // 右側（みゆき）にフォーカス
    } else {
      return '20% center'; // 左側（咲良）にフォーカス（デフォルト）
    }
  };

  // 画面サイズ判定
  useEffect(() => {
    const checkScreenSize = () => {
      const width = window.innerWidth;
      setScreenWidth(width);
      setIsMobile(width < 768);
    };
    
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  // 表示名が未設定かどうかを判定してポップアップを表示
  useEffect(() => {
    if (session && !isUserLoading && user && 
        (!user.display_name || user.display_name.trim() === "") && 
        !hasShownDisplayNamePopup) {
      setShowDisplayNamePopup(true);
      setHasShownDisplayNamePopup(true);
    }
  }, [session, isUserLoading, user, hasShownDisplayNamePopup]);

  // タッチイベントハンドラー
  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > 50;
    const isRightSwipe = distance < -50;

    if (isLeftSwipe && currentCharacterIndex < characterKeys.length - 1) {
      setCurrentCharacterIndex(prev => prev + 1);
    }
    if (isRightSwipe && currentCharacterIndex > 0) {
      setCurrentCharacterIndex(prev => prev - 1);
    }
  };

  const handleDisplayNameComplete = async (/* _displayName: string */) => {
    setShowDisplayNamePopup(false);
    // ユーザーデータを再取得
    await mutate();
  };

  // キャラクターに対応するテーマの定義
  const getCharacterTheme = (characterKey: CharacterKey): { light: string; dark: string } => {
    switch (characterKey) {
      case "sakura":
        return { light: "pink", dark: "pink" }; // テーマ3: ピンク/レッド
      case "miyuki":
        return { light: "lightblue", dark: "lightblue" }; // テーマ2: ライトブルー/ネイビー
      default:
        return { light: "white", dark: "white" }; // テーマ1: ホワイト/ブラック
    }
  };

  // 進捗状況をポーリングで確認する関数
  const startProgressPolling = () => {
    const pollProgress = async () => {
      try {
        const progress = await checkBulkUpdateProgress();
        if (progress) {
          setBulkUpdateProgress(progress);
          
          if (!progress.is_running) {
            // 処理完了時の処理
            setProgressInterval(null);
            setShowProgressToast(false);
            
            if (progress.error_message) {
              console.error("Bulk update failed:", progress.error_message);
            } else {
              console.log("Bulk update completed successfully");
              // 完了時にキャッシュをクリア
              await clearPapersCache();
            }
          }
        }
      } catch (error) {
        console.error("Failed to check progress:", error);
      }
    };

    // 最初の確認を即座実行
    pollProgress();

    // 1秒間隔でポーリング
    const interval = setInterval(pollProgress, 1000);
    setProgressInterval(interval);
    
    return interval;
  };

  // コンポーネントアンマウント時のクリーンアップ
  useEffect(() => {
    return () => {
      if (progressInterval) {
        clearInterval(progressInterval);
      }
    };
  }, [progressInterval]);

  const handleCharacterSelection = async (characterKey: CharacterKey) => {
    if (!session?.accessToken) {
      setSelectionMessage("ログインが必要です。");
      return;
    }

    setIsSelectingCharacter(true);
    setSelectionMessage(null);

    try {
      // 新しいバックグラウンド更新関数を使用（即座に完了）
      const result = await updateCharacterSelectionWithBackgroundUpdate(characterKey);

      const characterName = characterData[characterKey].name;
      
      if (result.bulkUpdateStarted) {
        setSelectionMessage(`${characterName}と一緒に学ぶことになりました！\n要約を更新中...`);
        setShowProgressToast(true);
        // 進捗ポーリングを開始
        startProgressPolling();
      } else {
        setSelectionMessage(`${characterName}と一緒に学ぶことになりました！`);
        console.warn("Bulk update did not start, but character selection succeeded");
      }
      
      // キャラクターに対応するテーマを自動設定
      try {
        const characterTheme = getCharacterTheme(characterKey);
        await updateColorTheme(characterTheme.light, characterTheme.dark);
        console.log(`テーマを${characterKey}用に設定しました: ${characterTheme.light}/${characterTheme.dark}`);
      } catch (themeError) {
        console.warn("テーマ設定に失敗しましたが、キャラクター選択は成功しました:", themeError);
        // テーマ設定の失敗はキャラクター選択の成功を妨げない
      }
      
      // 1秒後にフェードアウト開始、その後ポップアップを閉じる
      setTimeout(() => {
        setIsCharacterModalClosing(true);
        // フェードアウトアニメーション完了後にポップアップを閉じる
        setTimeout(() => {
          setSelectedCharacter(null);
          setIsCharacterModalClosing(false);
        }, 800); // 0.8秒のフェードアウト時間
      }, 1000);

    } catch (err: unknown) {
      setSelectionMessage(err instanceof Error ? err.message : "予期せぬエラーが発生しました。");
    } finally {
      setIsSelectingCharacter(false);
    }
  };

  return (
    <div className="relative">
      {/* 右上のログイン/設定エリア（固定位置） */}
      <div className="fixed top-6 right-6 z-30 flex items-center gap-2">
        {session && hasSelectedCharacter && !isUserLoading && (
          <>
            {/* 論文の追加 */}
            <Button 
              variant="outline" 
              size="sm" 
              className="bg-white/10 hover:bg-white/20 text-white border-white/50 hover:border-white font-medium backdrop-blur-sm"
              onClick={() => {
                setIsNavigating('papers-add');
                router.push('/papers/add');
              }}
              disabled={isNavigating === 'papers-add'}
            >
              {isNavigating === 'papers-add' ? (
                <Loader2 className={`animate-spin ${isMobile ? 'h-4 w-4' : 'mr-2 h-4 w-4'}`} />
              ) : (
                <FilePlus2 className={`${isMobile ? 'h-4 w-4' : 'mr-2 h-4 w-4'}`} />
              )}
              {!isMobile && '論文の追加'}
            </Button>

            {/* 論文の一覧 */}
            <Button 
              variant="outline" 
              size="sm" 
              className="bg-white/10 hover:bg-white/20 text-white border-white/50 hover:border-white font-medium backdrop-blur-sm"
              onClick={() => {
                setIsNavigating('papers-list');
                router.push('/papers');
              }}
              disabled={isNavigating === 'papers-list'}
            >
              {isNavigating === 'papers-list' ? (
                <Loader2 className={`animate-spin ${isMobile ? 'h-4 w-4' : 'mr-2 h-4 w-4'}`} />
              ) : (
                <List className={`${isMobile ? 'h-4 w-4' : 'mr-2 h-4 w-4'}`} />
              )}
              {!isMobile && '論文の一覧'}
            </Button>

            {/* Agentによる調査 */}
            <Button 
              variant="outline" 
              size="sm" 
              className="bg-white/10 hover:bg-white/20 text-white border-white/50 hover:border-white font-medium backdrop-blur-sm"
              onClick={() => {
                setIsNavigating('rag');
                router.push('/rag');
              }}
              disabled={isNavigating === 'rag'}
            >
              {isNavigating === 'rag' ? (
                <Loader2 className={`animate-spin ${isMobile ? 'h-4 w-4' : 'mr-2 h-4 w-4'}`} />
              ) : (
                <SearchCode className={`${isMobile ? 'h-4 w-4' : 'mr-2 h-4 w-4'}`} />
              )}
              {!isMobile && 'Agentによる調査'}
            </Button>

            {/* 設定 */}
            <Button 
              variant="outline" 
              size="sm" 
              className="bg-white/10 hover:bg-white/20 text-white border-white/50 hover:border-white font-medium backdrop-blur-sm"
              onClick={() => {
                setIsNavigating('settings');
                router.push('/settings');
              }}
              disabled={isNavigating === 'settings'}
            >
              {isNavigating === 'settings' ? (
                <Loader2 className={`animate-spin ${isMobile ? 'h-4 w-4' : 'mr-2 h-4 w-4'}`} />
              ) : (
                <Settings className={`${isMobile ? 'h-4 w-4' : 'mr-2 h-4 w-4'}`} />
              )}
              {!isMobile && 'SETTINGS'}
            </Button>
          </>
        )}
        {session && (
          <AuthButton gameMode={true} />
        )}
        {!session && (
          <AuthButton gameMode={true} />
        )}
      </div>

      {/* 第1セクション：キービジュアル + タイトルロゴ */}
      <section 
        className="relative h-screen w-full bg-cover bg-no-repeat flex items-end justify-center transition-all duration-1000"
        style={{
          backgroundImage: 'url(/home/home-key.png)',
          backgroundSize: 'cover',
          backgroundPosition: getBackgroundPosition()
        }}
      >
        {/* オーバーレイ */}
        <div className="absolute inset-0 bg-black/40"></div>
        
        {/* タイトルロゴ（下から10%の位置） */}
        <div className="relative z-10 text-center animate-fade-in pb-[15vh]">
          <h1 className="text-3xl sm:text-4xl md:text-6xl lg:text-8xl xl:text-9xl font-bold text-white mb-6 tracking-wider drop-shadow-2xl px-4">
            KnowledgePaper
          </h1>
          <p className="text-lg sm:text-xl md:text-2xl lg:text-3xl xl:text-4xl font-serif italic font-medium tracking-wide leading-relaxed drop-shadow-2xl animate-fade-in-slow px-4">
            <span className="block bg-gradient-to-r from-amber-200 via-white to-cyan-200 bg-clip-text text-transparent filter drop-shadow-lg">
              知識の価値がゼロになった世界で
            </span>
            <span className="block bg-gradient-to-r from-cyan-200 via-white to-pink-200 bg-clip-text text-transparent filter drop-shadow-lg mt-2">
              それでも学び続けるあなたに捧ぐ
            </span>
          </p>
          <div className="w-48 h-2 bg-gradient-to-r from-pink-400 to-cyan-400 mx-auto mt-8 rounded-full drop-shadow-lg"></div>
        </div>

        {/* スクロールインジケーター */}
        <div 
          className="absolute bottom-8 left-1/2 transform -translate-x-1/2 animate-bounce cursor-pointer group"
          onClick={() => {
            document.getElementById('character-section')?.scrollIntoView({ 
              behavior: 'smooth' 
            });
          }}
        >
          <div className="flex flex-col items-center text-white/80 group-hover:text-white transition-colors duration-300">
            <span className="text-sm mb-2 font-medium">スクロールして続きを見る</span>
            <div className="w-6 h-10 border-2 border-white/60 group-hover:border-white rounded-full flex justify-center transition-colors duration-300">
              <div className="w-1 h-3 bg-white/80 group-hover:bg-white rounded-full mt-2 animate-pulse transition-colors duration-300"></div>
            </div>
          </div>
        </div>
      </section>

      {/* 第2セクション：キャラクター立ち絵 + メニュー */}
      <section id="character-section" className="relative w-full overflow-hidden min-h-screen">
        {/* 動的背景エフェクト */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {/* パーティクルエフェクト - 桜の花びら */}
          <div className="absolute top-10 left-10 w-3 h-3 bg-pink-300 rounded-full opacity-60 animate-pulse" style={{animationDelay: '0s'}}></div>
          <div className="absolute top-32 left-32 w-2 h-2 bg-pink-200 rounded-full opacity-50 animate-pulse" style={{animationDelay: '1s'}}></div>
          <div className="absolute top-20 right-20 w-4 h-4 bg-pink-300 rounded-full opacity-40 animate-pulse" style={{animationDelay: '2s'}}></div>
          <div className="absolute top-60 right-40 w-3 h-3 bg-pink-200 rounded-full opacity-60 animate-pulse" style={{animationDelay: '3s'}}></div>
          <div className="absolute bottom-40 left-20 w-2 h-2 bg-pink-300 rounded-full opacity-50 animate-pulse" style={{animationDelay: '4s'}}></div>
          <div className="absolute bottom-20 right-60 w-3 h-3 bg-pink-200 rounded-full opacity-40 animate-pulse" style={{animationDelay: '5s'}}></div>
          
          {/* デジタルグリッチエフェクト */}
          <div className="absolute top-40 right-10 w-1 h-8 bg-cyan-300 opacity-30 animate-pulse" style={{animationDelay: '1.5s'}}></div>
          <div className="absolute bottom-60 left-40 w-1 h-6 bg-blue-300 opacity-25 animate-pulse" style={{animationDelay: '2.5s'}}></div>
          <div className="absolute top-80 left-60 w-1 h-4 bg-cyan-400 opacity-35 animate-pulse" style={{animationDelay: '3.5s'}}></div>
        </div>


        {/* メインコンテンツ */}
        <div className={`relative z-10 flex flex-col items-center justify-start px-4 pb-8 min-h-screen ${
          isMobile ? 'pt-16' : 'pt-8'
        }`}>

        {/* キャラクター選択説明セクション */}
        <div className="text-center mb-8 lg:mb-6 max-w-xl mx-auto">
          <h2 className="text-2xl sm:text-3xl md:text-3xl font-bold text-white drop-shadow-2xl mb-3">
            あなたの相棒を選んでください
          </h2>
        </div>

        {/* キャラクター配置 */}
        {!isMobile ? (
          // デスクトップ表示：2人並列
          <div className="flex justify-center items-end mb-12 lg:mb-20 w-full max-w-6xl relative">
            {/* 咲良（左側） */}
            <div 
              className="relative group cursor-pointer"
              onClick={() => setSelectedCharacter('sakura')}
            >
              <div className="absolute inset-0 bg-gradient-to-t from-pink-400/20 to-transparent rounded-full blur-xl transform scale-110 group-hover:scale-125 transition-transform duration-500"></div>
              <Image
                src="/home/sakura-home1.png"
                alt="天野咲良"
                width={400}
                height={520}
                className="relative z-10 transform hover:scale-105 transition-transform duration-300 animate-breathing"
                style={{animationDelay: '0s'}}
              />
              <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-pink-500/80 backdrop-blur-sm text-white px-4 py-2 rounded-full text-sm font-bold opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-20">
                咲良をクリック
              </div>
            </div>
            
            {/* 深雪（右側） */}
            <div 
              className="relative group ml-8 cursor-pointer"
              onClick={() => setSelectedCharacter('miyuki')}
            >
              <div className="absolute inset-0 bg-gradient-to-t from-cyan-400/20 to-transparent rounded-full blur-xl transform scale-110 group-hover:scale-125 transition-transform duration-500"></div>
              <Image
                src="/home/miyuki-home1.png"
                alt="白瀬深雪"
                width={400}
                height={520}
                className="relative z-10 transform hover:scale-105 transition-transform duration-300 animate-breathing"
                style={{animationDelay: '1s'}}
              />
              <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-cyan-500/80 backdrop-blur-sm text-white px-4 py-2 rounded-full text-sm font-bold opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-20">
                深雪をクリック
              </div>
            </div>
          </div>
        ) : (
          // モバイル表示：カルーセル
          <div className="w-full max-w-sm mx-auto my-16">
            <div 
              className="relative h-96 overflow-visible flex justify-center items-center mb-24"
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
            >
              {characterKeys.map((characterKey, index) => {
                const character = characterData[characterKey];
                const isActive = index === currentCharacterIndex;
                
                return (
                  <div
                    key={characterKey}
                    className={`absolute transition-all duration-500 ease-in-out cursor-pointer ${
                      isActive 
                        ? 'translate-x-0 opacity-100 z-20' 
                        : index < currentCharacterIndex 
                          ? '-translate-x-full opacity-0 z-10' 
                          : 'translate-x-full opacity-0 z-10'
                    }`}
                    onClick={() => setSelectedCharacter(characterKey)}
                  >
                    <div className={`absolute inset-0 bg-gradient-to-t ${
                      characterKey === 'sakura' 
                        ? 'from-pink-400/20' 
                        : 'from-cyan-400/20'
                    } to-transparent rounded-full blur-xl transform scale-110 transition-transform duration-500`}></div>
                    
                    <Image
                      src={`/home/${characterKey}-home1.png`}
                      alt={character.name}
                      width={320}
                      height={416}
                      className="relative z-10 transform transition-transform duration-300 animate-breathing"
                    />
                    
                    <div className={`absolute bottom-4 left-1/2 transform -translate-x-1/2 ${
                      characterKey === 'sakura' 
                        ? 'bg-pink-500/80' 
                        : 'bg-cyan-500/80'
                    } backdrop-blur-sm text-white px-4 py-2 rounded-full text-sm font-bold z-20`}>
                      {character.name}をタップ
                    </div>
                  </div>
                );
              })}
            </div>
            
            {/* ドットインジケーター */}
            <div className="flex justify-center gap-4 py-4">
              {characterKeys.map((_, index) => (
                <button
                  key={index}
                  onClick={() => setCurrentCharacterIndex(index)}
                  className={`rounded-full transition-all duration-300 ${
                    index === currentCharacterIndex
                      ? 'w-5 h-5 bg-white shadow-lg'
                      : 'w-4 h-4 bg-white/50 hover:bg-white/80'
                  }`}
                />
              ))}
            </div>
          </div>
        )}

        {/* メニュー */}
        {session ? (
          // ログイン済みの場合：メインメニューを表示
          <div className="text-center px-4">
            <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 justify-center max-w-5xl mx-auto">
              {/* 論文の追加 - キャラクター選択状態に基づく条件付きボタン */}
              {!isUserLoading && hasSelectedCharacter ? (
                <div className="flex-1">
                  <Button 
                    size="lg" 
                    className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-bold px-4 sm:px-8 py-6 sm:py-8 text-lg sm:text-2xl rounded-xl shadow-xl transform hover:scale-105 transition-all duration-300 border border-blue-300/50"
                    onClick={() => {
                      setIsNavigating('papers-add');
                      router.push('/papers/add');
                    }}
                    disabled={isNavigating === 'papers-add'}
                  >
                    {isNavigating === 'papers-add' ? (
                      <Loader2 className="mr-2 sm:mr-3 h-6 sm:h-8 w-6 sm:w-8 animate-spin" />
                    ) : (
                      <FilePlus2 className="mr-2 sm:mr-3 h-6 sm:h-8 w-6 sm:w-8" />
                    )}
                    論文の追加
                  </Button>
                </div>
              ) : (
                <div className="flex-1">
                  <Button 
                    size="lg" 
                    disabled={!isUserLoading}
                    className="w-full bg-gradient-to-r from-gray-400 to-gray-500 text-white font-bold px-4 sm:px-8 py-6 sm:py-8 text-lg sm:text-2xl rounded-xl shadow-xl border border-gray-300/50 cursor-not-allowed relative"
                    title={isUserLoading ? "読み込み中..." : "まずキャラクターを選択してください"}
                  >
                    {!isUserLoading && (
                      <Lock className="absolute top-2 right-2 h-5 sm:h-6 w-5 sm:w-6 text-white/70" />
                    )}
                    <FilePlus2 className="mr-2 sm:mr-3 h-6 sm:h-8 w-6 sm:w-8" />
                    論文の追加
                    {!isUserLoading && (
                      <span className="absolute bottom-1 right-1 text-xs bg-orange-500 text-white px-1 sm:px-2 py-1 rounded-full">
                        要選択
                      </span>
                    )}
                  </Button>
                </div>
              )}
              
              {/* 論文の一覧 - キャラクター選択状態に基づく条件付きボタン */}
              {!isUserLoading && hasSelectedCharacter ? (
                <div className="flex-1">
                  <Button 
                    size="lg" 
                    className="w-full bg-gradient-to-r from-green-500 to-teal-600 hover:from-green-600 hover:to-teal-700 text-white font-bold px-4 sm:px-8 py-6 sm:py-8 text-lg sm:text-2xl rounded-xl shadow-xl transform hover:scale-105 transition-all duration-300 border border-green-300/50"
                    onClick={() => {
                      setIsNavigating('papers-list');
                      router.push('/papers');
                    }}
                    disabled={isNavigating === 'papers-list'}
                  >
                    {isNavigating === 'papers-list' ? (
                      <Loader2 className="mr-2 sm:mr-3 h-6 sm:h-8 w-6 sm:w-8 animate-spin" />
                    ) : (
                      <List className="mr-2 sm:mr-3 h-6 sm:h-8 w-6 sm:w-8" />
                    )}
                    論文の一覧
                  </Button>
                </div>
              ) : (
                <div className="flex-1">
                  <Button 
                    size="lg" 
                    disabled={!isUserLoading}
                    className="w-full bg-gradient-to-r from-gray-400 to-gray-500 text-white font-bold px-4 sm:px-8 py-6 sm:py-8 text-lg sm:text-2xl rounded-xl shadow-xl border border-gray-300/50 cursor-not-allowed relative"
                    title={isUserLoading ? "読み込み中..." : "まずキャラクターを選択してください"}
                  >
                    {!isUserLoading && (
                      <Lock className="absolute top-2 right-2 h-5 sm:h-6 w-5 sm:w-6 text-white/70" />
                    )}
                    <List className="mr-2 sm:mr-3 h-6 sm:h-8 w-6 sm:w-8" />
                    論文の一覧
                    {!isUserLoading && (
                      <span className="absolute bottom-1 right-1 text-xs bg-orange-500 text-white px-1 sm:px-2 py-1 rounded-full">
                        要選択
                      </span>
                    )}
                  </Button>
                </div>
              )}
              
              {/* Agentによる調査 - キャラクター選択状態に基づく条件付きボタン */}
              {!isUserLoading && hasSelectedCharacter ? (
                <div className="flex-1">
                  <Button 
                    size="lg" 
                    className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-bold px-4 sm:px-8 py-6 sm:py-8 text-lg sm:text-2xl rounded-xl shadow-xl transform hover:scale-105 transition-all duration-300 border border-purple-300/50"
                    onClick={() => {
                      setIsNavigating('rag');
                      router.push('/rag');
                    }}
                    disabled={isNavigating === 'rag'}
                  >
                    {isNavigating === 'rag' ? (
                      <Loader2 className="mr-2 sm:mr-3 h-6 sm:h-8 w-6 sm:w-8 animate-spin" />
                    ) : (
                      <SearchCode className="mr-2 sm:mr-3 h-6 sm:h-8 w-6 sm:w-8" />
                    )}
                    Agentによる調査
                  </Button>
                </div>
              ) : (
                <div className="flex-1">
                  <Button 
                    size="lg" 
                    disabled={!isUserLoading}
                    className="w-full bg-gradient-to-r from-gray-400 to-gray-500 text-white font-bold px-4 sm:px-8 py-6 sm:py-8 text-lg sm:text-2xl rounded-xl shadow-xl border border-gray-300/50 cursor-not-allowed relative"
                    title={isUserLoading ? "読み込み中..." : "まずキャラクターを選択してください"}
                  >
                    {!isUserLoading && (
                      <Lock className="absolute top-2 right-2 h-5 sm:h-6 w-5 sm:w-6 text-white/70" />
                    )}
                    <SearchCode className="mr-2 sm:mr-3 h-6 sm:h-8 w-6 sm:w-8" />
                    Agentによる調査
                    {!isUserLoading && (
                      <span className="absolute bottom-1 right-1 text-xs bg-orange-500 text-white px-1 sm:px-2 py-1 rounded-full">
                        要選択
                      </span>
                    )}
                  </Button>
                </div>
              )}
            </div>
            
            {/* キャラクター選択が必要なことを示すメッセージ */}
            {session && !isUserLoading && !hasSelectedCharacter && (
              <div className="mt-8 p-4 bg-orange-50/80 dark:bg-orange-950/30 backdrop-blur-md border border-orange-200 dark:border-orange-800 rounded-lg max-w-md mx-auto">
                <p className="text-orange-800 dark:text-orange-200 text-sm text-center">
                  📝 すべての機能を利用するには、上のキャラクターをクリックして選択してください
                </p>
              </div>
            )}
          </div>
        ) : (
          // 未ログインの場合：説明文のみ表示（ログインボタンは右上に移動済み）
          <div className="text-center space-y-6">
            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 lg:p-8 max-w-md mx-auto border border-white/20">
              <p className="text-white/90 text-lg lg:text-xl mb-4 font-medium">
                始めるにはログインしてください
              </p>
              <div className="mt-6 text-white/60 text-xs">
                右上の「Login」ボタンからログインできます
              </div>
            </div>
          </div>
        )}

        {/* フッター */}
        <div className="left-0 right-0 text-center relative mt-12 pb-8">
          <p className="text-white/50 text-sm">
            © 2024 KnowledgePaper. All rights reserved.
          </p>
        </div>
        </div>
      </section>

      {/* キャラクター紹介モーダル */}
      {selectedCharacter && (
        <div className={`fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4 transition-opacity duration-800 ${
          isCharacterModalClosing ? 'opacity-0' : 'opacity-100 animate-fade-in'
        }`}>
          <div className={`w-full bg-white/10 backdrop-blur-md border border-white/20 rounded-3xl shadow-2xl ${
            isMobile 
              ? 'max-h-[95vh] overflow-y-auto my-4' 
              : 'max-w-5xl overflow-hidden'
          }`}>
            <div className="flex flex-col lg:flex-row">
              {/* キャラクター画像部分 */}
              <div className="lg:w-1/2 relative bg-gradient-to-br from-white/5 to-transparent">
                <div className={`absolute inset-0 bg-gradient-to-t ${characterData[selectedCharacter].theme} opacity-20`}></div>
                <div className={`relative flex items-center justify-center ${isMobile ? 'p-4' : 'p-8'}`}>
                  <Image
                    src={`/home/${selectedCharacter}-home2.png`}
                    alt={characterData[selectedCharacter].name}
                    width={isMobile ? 300 : 400}
                    height={isMobile ? 375 : 500}
                    className="transform transition-all duration-700 animate-fade-in"
                  />
                </div>
              </div>

              {/* キャラクター情報部分 */}
              <div className={`lg:w-1/2 text-white ${isMobile ? 'p-4 pb-6' : 'p-8 lg:p-12'}`}>
                <div className="space-y-4 lg:space-y-6">
                  <div>
                    <h2 className={`font-bold mb-2 ${isMobile ? 'text-2xl' : 'text-4xl'}`}>
                      {characterData[selectedCharacter].name}
                    </h2>
                    <p className={`font-medium bg-gradient-to-r ${characterData[selectedCharacter].theme} bg-clip-text text-transparent ${
                      isMobile ? 'text-base' : 'text-lg'
                    }`}>
                      {characterData[selectedCharacter].title}
                    </p>
                  </div>
                  
                  <div className="h-px bg-gradient-to-r from-white/20 to-transparent"></div>
                  
                  <p className={`text-white/90 leading-relaxed ${isMobile ? 'text-sm' : 'text-lg'}`}>
                    {characterData[selectedCharacter].description}
                  </p>
                  
                  {/* メッセージ表示領域 */}
                  {selectionMessage && (
                    <div className={`p-3 lg:p-4 rounded-lg border ${selectionMessage.includes("失敗") || selectionMessage.includes("エラー") 
                      ? "bg-red-500/20 border-red-300/50 text-red-100" 
                      : "bg-green-500/20 border-green-300/50 text-green-100"
                    }`}>
                      <p className={`text-center font-medium ${isMobile ? 'text-sm' : 'text-base'}`}>
                        {selectionMessage}
                      </p>
                    </div>
                  )}
                  
                  <div className={`flex gap-3 lg:gap-4 ${isMobile ? 'pt-4' : 'pt-6'} ${isMobile ? 'flex-col sm:flex-row' : ''}`}>
                    <Button
                      onClick={() => {
                        setIsCharacterModalClosing(true);
                        setTimeout(() => {
                          setSelectedCharacter(null);
                          setIsCharacterModalClosing(false);
                        }, 800);
                      }}
                      className={`bg-gradient-to-r ${characterData[selectedCharacter].theme} hover:opacity-80 text-white font-bold rounded-full shadow-lg transform hover:scale-105 transition-all duration-300 border ${characterData[selectedCharacter].borderColor} ${
                        isMobile ? 'px-6 py-2 text-sm' : 'px-8 py-3'
                      }`}
                      disabled={isSelectingCharacter}
                    >
                      閉じる
                    </Button>
                    {session && (
                      <Button
                        onClick={() => handleCharacterSelection(selectedCharacter)}
                        className={`font-bold rounded-full backdrop-blur-sm transform transition-all duration-300 ${
                          user?.selected_character === selectedCharacter
                            ? 'bg-gray-500/50 border-gray-400/50 text-gray-300 cursor-not-allowed'
                            : 'bg-white/20 hover:bg-white/30 text-white border border-white/50 hover:scale-105'
                        } ${isMobile ? 'px-6 py-2 text-sm' : 'px-8 py-3'}`}
                        disabled={isSelectingCharacter || user?.selected_character === selectedCharacter}
                      >
                        {isSelectingCharacter ? (
                          <>
                            <Loader2 className={`mr-2 animate-spin ${isMobile ? 'h-3 w-3' : 'h-4 w-4'}`} />
                            選択中...
                          </>
                        ) : user?.selected_character === selectedCharacter ? (
                          "すでに選んでいます"
                        ) : (
                          "この子と学ぶ"
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 閉じるボタン（右上） */}
            <button
              onClick={() => {
                setIsCharacterModalClosing(true);
                setTimeout(() => {
                  setSelectedCharacter(null);
                  setIsCharacterModalClosing(false);
                }, 800);
              }}
              className={`absolute rounded-full flex items-center justify-center text-white font-bold transition-all duration-300 backdrop-blur-sm bg-white/20 hover:bg-white/30 ${
                isMobile 
                  ? 'top-2 right-2 w-8 h-8 text-lg' 
                  : 'top-4 right-4 w-10 h-10 text-xl'
              }`}
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* 表示名設定ポップアップ */}
      {showDisplayNamePopup && (
        <DisplayNamePopup 
          onComplete={handleDisplayNameComplete} 
          defaultName={user?.username || ""}
        />
      )}

      {/* 一括更新進捗表示トースト */}
      {showProgressToast && bulkUpdateProgress && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm w-full">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                論文要約を更新中...
              </h3>
              <button
                onClick={() => setShowProgressToast(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                ×
              </button>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400">
                <span>{bulkUpdateProgress.processed_papers} / {bulkUpdateProgress.total_papers} 件</span>
                {bulkUpdateProgress.estimated_remaining_seconds && (
                  <span>あと約 {Math.ceil(bulkUpdateProgress.estimated_remaining_seconds)} 秒</span>
                )}
              </div>
              
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.round((bulkUpdateProgress.processed_papers / bulkUpdateProgress.total_papers) * 100)}%`
                  }}
                ></div>
              </div>
              
              <p className="text-xs text-gray-500 dark:text-gray-400">
                バックグラウンドで処理中です。このページを閉じても構いません。
              </p>
              
              {bulkUpdateProgress.error_message && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  エラー: {bulkUpdateProgress.error_message}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}