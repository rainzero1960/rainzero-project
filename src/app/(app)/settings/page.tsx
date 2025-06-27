// src/app/settings/page.tsx
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession, signOut, signIn } from "next-auth/react";
import { authenticatedFetch } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, AlertTriangle, UserX, KeyRound, LogOut, Home, User } from "lucide-react";
import Link from "next/link";
import MultipleCustomPromptManager from "@/components/MultipleCustomPromptManager";
import SystemPromptGroupManager from "@/components/SystemPromptGroupManager";
import { ColorThemeSelector } from "@/components/ColorThemeSelector";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BackgroundImageSelector, BackgroundImageSelectorRef } from "@/components/BackgroundImageSelector";

export default function SettingsPage() {
  // アカウント削除機能の有効/無効フラグ（基本はfalse）
  const ENABLE_ACCOUNT_DELETION = true;
  // 背景色テーマ設定の表示フラグ（基本はfalse）
  const SHOW_COLOR_THEME_SETTING = true;
  
  const router = useRouter();
  const { data: session, status } = useSession();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordChangeLoading, setPasswordChangeLoading] = useState(false);
  const [passwordChangeError, setPasswordChangeError] = useState<string | null>(null);
  const [passwordChangeSuccess, setPasswordChangeSuccess] = useState<string | null>(null);

  const [deleteAccountLoading, setDeleteAccountLoading] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);

  // 表示名変更用の状態
  const [displayName, setDisplayName] = useState("");
  const [displayNameLoading, setDisplayNameLoading] = useState(false);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [displayNameSuccess, setDisplayNameSuccess] = useState<string | null>(null);
  
  
  // ページ切り替え用 - タブの順序を変更（アカウント設定を最後に）
  const [activeTab, setActiveTab] = useState<"prompts" | "prompt-groups" | "themes" | "account">("prompts");

  // 背景画像選択のref
  const backgroundImageSelectorRef = useRef<BackgroundImageSelectorRef>(null);


  useEffect(() => {
    if (status === "unauthenticated") {
      signIn(undefined, { callbackUrl: "/settings" });
    }
  }, [status, router]);

  // ユーザー情報を取得して表示名の初期値を設定
  useEffect(() => {
    const fetchUserInfo = async () => {
      if (session?.accessToken) {
        try {
          const res = await authenticatedFetch(
            `${process.env.NEXT_PUBLIC_BACKEND_URL}/auth/me`,
            { method: "GET" }
          );
          if (res.ok) {
            const userData = await res.json();
            setDisplayName(userData.display_name || "");
          }
        } catch (err) {
          console.error("Failed to fetch user info:", err);
        }
      }
    };

    fetchUserInfo();
  }, [session?.accessToken]);

  // テーマ変更時に背景画像設定を更新
  const handleThemeUpdate = useCallback(() => {
    if (backgroundImageSelectorRef.current) {
      backgroundImageSelectorRef.current.refresh();
    }
  }, []);

  const handleChangePassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPasswordChangeError(null);
    setPasswordChangeSuccess(null);

    if (newPassword !== confirmNewPassword) {
      setPasswordChangeError("新しいパスワードが一致しません。");
      return;
    }
    if (!session?.accessToken) {
      setPasswordChangeError("認証トークンがありません。再度ログインしてください。");
      return;
    }

    setPasswordChangeLoading(true);
    try {
      const res = await authenticatedFetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/auth/change-password`,
        {
          method: "POST",
          body: JSON.stringify({
            current_password: currentPassword,
            new_password: newPassword,
          }),
        }
      );

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || `パスワード変更に失敗しました: ${res.statusText}`);
      }
      setPasswordChangeSuccess("パスワードが正常に変更されました。");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      // 必要であればセッションを更新 (NextAuthのセッションはパスワード変更では自動更新されない)
      // updateSession(); // この呼び出しは通常、JWTの内容が変わる場合に有効
    } catch (err: unknown) {
      setPasswordChangeError(err instanceof Error ? err.message : "予期せぬエラーが発生しました。");
    } finally {
      setPasswordChangeLoading(false);
    }
  };

  const handleChangeDisplayName = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setDisplayNameError(null);
    setDisplayNameSuccess(null);

    if (!session?.accessToken) {
      setDisplayNameError("認証トークンがありません。再度ログインしてください。");
      return;
    }

    setDisplayNameLoading(true);
    try {
      const res = await authenticatedFetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/auth/display-name`,
        {
          method: "PUT",
          body: JSON.stringify({
            display_name: displayName.trim() || null,
          }),
        }
      );

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || `表示名変更に失敗しました: ${res.statusText}`);
      }
      setDisplayNameSuccess("表示名が正常に変更されました。");
    } catch (err: unknown) {
      setDisplayNameError(err instanceof Error ? err.message : "予期せぬエラーが発生しました。");
    } finally {
      setDisplayNameLoading(false);
    }
  };


  const handleDeleteAccount = async () => {
    setDeleteAccountError(null);
    if (!session?.accessToken) {
      setDeleteAccountError("認証トークンがありません。再度ログインしてください。");
      return;
    }

    setDeleteAccountLoading(true);
    try {
      const res = await authenticatedFetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/auth/delete-account`,
        {
          method: "DELETE",
        }
      );

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ detail: "アカウント削除に失敗しました。" }));
        throw new Error(errorData.detail || `アカウント削除に失敗しました: ${res.statusText}`);
      }
      
      // アカウント削除成功後、ログアウトしてホームページへ
      await signOut({ redirect: false });
      router.push("/?message=AccountDeleted"); 

    } catch (err: unknown) {
      setDeleteAccountError(err instanceof Error ? err.message : "予期せぬエラーが発生しました。");
    } finally {
      setDeleteAccountLoading(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-custom">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-lg text-muted-foreground">読み込み中...</p>
      </div>
    );
  }

  if (status === "unauthenticated") {
    // useEffectでリダイレクトされるはずだが、念のため
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-custom">
        <AlertTriangle className="h-12 w-12 text-orange-500 mb-4" />
        <Alert variant="default" className="w-full max-w-md bg-orange-50 border-orange-300">
          <AlertTitle className="text-orange-700">認証が必要です</AlertTitle>
          <AlertDescription className="text-orange-600">
            このページを表示するにはログインが必要です。ログインページへリダイレクトします...
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  
  // OAuthユーザーなど、パスワードを持たないユーザーの場合の表示
  const hasPasswordAuth = session?.user?.name; // Credentialsプロバイダ経由のユーザーは通常nameを持つ

  return (
    <div className="container mx-auto py-8 px-4 md:px-6 max-w-4xl">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">設定</h1>
        <Button variant="outline" asChild className="btn-nav">
          <Link href="/">
            <Home className="mr-2 h-4 w-4" />
            ホームへ戻る
          </Link>
        </Button>
      </div>

      {/* タブナビゲーション - 順序を変更してアカウント設定を最後に */}
      <div className="mb-8">
        <div className="relative border-b border-border">
          {/* 左右のフェードエフェクト */}
          <div className="absolute left-0 top-0 bottom-0 w-4 bg-gradient-to-r from-background to-transparent z-10 pointer-events-none md:hidden" />
          <div className="absolute right-0 top-0 bottom-0 w-4 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none md:hidden" />
          
          <div className="overflow-x-auto scrollbar-hide">
            <nav className="-mb-px flex space-x-2 md:space-x-8 min-w-fit px-2 md:px-0" aria-label="Tabs">
              <button
                className={`whitespace-nowrap py-2 px-2 md:px-1 border-b-2 font-medium text-xs md:text-sm transition-colors ${
                  activeTab === "prompts"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground"
                }`}
                onClick={() => setActiveTab("prompts")}
              >
                <span className="md:hidden">プロンプト</span>
                <span className="hidden md:inline">システムプロンプト管理</span>
              </button>
              <button
                className={`whitespace-nowrap py-2 px-2 md:px-1 border-b-2 font-medium text-xs md:text-sm transition-colors ${
                  activeTab === "prompt-groups"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground"
                }`}
                onClick={() => setActiveTab("prompt-groups")}
              >
                <span className="md:hidden">グループ</span>
                <span className="hidden md:inline">プロンプトグループ管理</span>
              </button>
              <button
                className={`whitespace-nowrap py-2 px-2 md:px-1 border-b-2 font-medium text-xs md:text-sm transition-colors ${
                  activeTab === "themes"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground"
                }`}
                onClick={() => setActiveTab("themes")}
              >
                <span className="md:hidden">テーマ</span>
                <span className="hidden md:inline">テーマ設定</span>
              </button>
              <button
                className={`whitespace-nowrap py-2 px-2 md:px-1 border-b-2 font-medium text-xs md:text-sm transition-colors ${
                  activeTab === "account"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground"
                }`}
                onClick={() => setActiveTab("account")}
              >
                <span className="md:hidden">アカウント</span>
                <span className="hidden md:inline">アカウント設定</span>
              </button>
            </nav>
          </div>
        </div>
      </div>

      {/* システムプロンプト管理タブ */}
      {activeTab === "prompts" && (
        <div>
          <MultipleCustomPromptManager />
        </div>
      )}
      
      {/* プロンプトグループ管理タブ */}
      {activeTab === "prompt-groups" && (
        <div>
          <SystemPromptGroupManager />
        </div>
      )}

      {/* テーマ設定タブ */}
      {activeTab === "themes" && (
        <div className="space-y-6">
          {/* ライト/ダークモード切り替え */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>ライト/ダークモード切り替え</span>
                <ThemeToggle />
              </CardTitle>
              <CardDescription>
                ライトモード・ダークモード・システム設定に従うの3つから選択できます。
                下の背景色設定と組み合わせて、お好みの表示に調整してください。
              </CardDescription>
            </CardHeader>
          </Card>
          
          {/* 背景色テーマ設定 */}
          {SHOW_COLOR_THEME_SETTING && (
            <ColorThemeSelector onThemeUpdate={handleThemeUpdate} />
          )}
          
          {/* 背景画像設定 */}
          <BackgroundImageSelector ref={backgroundImageSelectorRef} />
        </div>
      )}

      {/* アカウント設定タブ */}
      {activeTab === "account" && (
        <div className="space-y-6">

      {/* パスワード変更セクション */}
      {hasPasswordAuth && ( // パスワード認証ユーザーのみ表示
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center">
              <KeyRound className="mr-2 h-5 w-5" />
              パスワード変更
            </CardTitle>
            <CardDescription>
              セキュリティのため、定期的なパスワードの変更を推奨します。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {passwordChangeError && (
              <Alert variant="destructive" className="mb-4">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>エラー</AlertTitle>
                <AlertDescription>{passwordChangeError}</AlertDescription>
              </Alert>
            )}
            {passwordChangeSuccess && (
              <Alert variant="default" className="mb-4 bg-green-50 dark:bg-green-950 border-green-300 dark:border-green-700">
                <AlertTitle className="text-green-700 dark:text-green-300">成功</AlertTitle>
                <AlertDescription className="text-green-600 dark:text-green-400">{passwordChangeSuccess}</AlertDescription>
              </Alert>
            )}
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <Label htmlFor="currentPassword">現在のパスワード</Label>
                <Input
                  id="currentPassword"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  className="mt-1"
                  disabled={passwordChangeLoading}
                />
              </div>
              <div>
                <Label htmlFor="newPassword">新しいパスワード</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={6}
                  className="mt-1"
                  disabled={passwordChangeLoading}
                />
              </div>
              <div>
                <Label htmlFor="confirmNewPassword">新しいパスワード（確認）</Label>
                <Input
                  id="confirmNewPassword"
                  type="password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  required
                  minLength={6}
                  className="mt-1"
                  disabled={passwordChangeLoading}
                />
              </div>
              <Button type="submit" className="w-full" disabled={passwordChangeLoading}>
                {passwordChangeLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {passwordChangeLoading ? "変更中..." : "パスワードを変更"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* 表示名設定セクション */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center">
            <User className="mr-2 h-5 w-5" />
            表示名設定
          </CardTitle>
          <CardDescription>
            プロンプト内で使用される呼び名を設定できます。設定しない場合はユーザーIDが使用されます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {displayNameError && (
            <Alert variant="destructive" className="mb-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>エラー</AlertTitle>
              <AlertDescription>{displayNameError}</AlertDescription>
            </Alert>
          )}
          {displayNameSuccess && (
            <Alert variant="default" className="mb-4 bg-green-50 dark:bg-green-950 border-green-300 dark:border-green-700">
              <AlertTitle className="text-green-700 dark:text-green-300">成功</AlertTitle>
              <AlertDescription className="text-green-600 dark:text-green-400">{displayNameSuccess}</AlertDescription>
            </Alert>
          )}
          <form onSubmit={handleChangeDisplayName} className="space-y-4">
            <div>
              <Label htmlFor="displayName">表示名</Label>
              <Input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="例: 田中太郎"
                maxLength={100}
                className="mt-1"
                disabled={displayNameLoading}
              />
              <p className="text-xs text-muted-foreground mt-1">
                この名前はプロンプト内で {"{name}"} 変数として使用されます。空白の場合はユーザーIDが使用されます。
              </p>
            </div>
            <Button type="submit" className="w-full" disabled={displayNameLoading}>
              {displayNameLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {displayNameLoading ? "変更中..." : "表示名を変更"}
            </Button>
          </form>
        </CardContent>
      </Card>


      {ENABLE_ACCOUNT_DELETION && (
        <>
          <Separator className="my-8" />

          {/* アカウント削除セクション */}
          <Card className="border-destructive">
            <CardHeader>
              <CardTitle className="flex items-center text-destructive">
                <UserX className="mr-2 h-5 w-5" />
                アカウント削除
              </CardTitle>
              <CardDescription className="text-destructive">
                この操作は元に戻せません。アカウントを削除すると、関連する全てのデータ（論文リンク、チャット履歴など）が完全に削除されます。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {deleteAccountError && (
                <Alert variant="destructive" className="mb-4">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>エラー</AlertTitle>
                  <AlertDescription>{deleteAccountError}</AlertDescription>
                </Alert>
              )}
            </CardContent>
            <CardFooter>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="w-full" disabled={deleteAccountLoading}>
                    {deleteAccountLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    {deleteAccountLoading ? "削除処理中..." : "アカウントを削除する"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>本当にアカウントを削除しますか？</AlertDialogTitle>
                    <AlertDialogDescription>
                      この操作は取り消すことができません。あなたのアカウントと関連する全てのデータが永久に削除されます。
                      続行する前に、重要なデータがないかご確認ください。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={deleteAccountLoading}>キャンセル</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteAccount}
                      disabled={deleteAccountLoading}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {deleteAccountLoading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      削除を実行
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardFooter>
          </Card>
        </>
      )}

      <Separator className="my-8" />
      
          <div className="text-center">
            <Button variant="outline" onClick={() => signOut({ callbackUrl: "/" })} className="btn-nav">
              <LogOut className="mr-2 h-4 w-4" />
              ログアウト
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}