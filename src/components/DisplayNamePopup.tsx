"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Heart, Sparkles } from "lucide-react";
import { authenticatedFetch } from "@/lib/utils";

interface DisplayNamePopupProps {
  onComplete: (displayName: string) => void;
  defaultName?: string;
}

export default function DisplayNamePopup({ onComplete, defaultName = "" }: DisplayNamePopupProps) {
  const [displayName, setDisplayName] = useState(defaultName);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    if (!displayName.trim()) {
      setError("お名前を入力してください");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await authenticatedFetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/auth/display-name`,
        {
          method: "PUT",
          body: JSON.stringify({
            display_name: displayName.trim(),
          }),
        }
      );

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || `表示名設定に失敗しました: ${res.statusText}`);
      }

      onComplete(displayName.trim());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "予期せぬエラーが発生しました。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="w-full max-w-md">
        <Card className="bg-gradient-to-br from-pink-50 to-purple-50 dark:from-pink-950/30 dark:to-purple-950/30 border-2 border-pink-200 dark:border-pink-800 shadow-2xl">
          <CardHeader className="text-center space-y-4">
            <div className="flex justify-center items-center gap-2">
              <Heart className="h-6 w-6 text-pink-500 fill-pink-500 animate-pulse" />
              <Sparkles className="h-8 w-8 text-purple-500" />
              <Heart className="h-6 w-6 text-pink-500 fill-pink-500 animate-pulse" />
            </div>
            <CardTitle className="text-2xl font-bold bg-gradient-to-r from-pink-600 to-purple-600 bg-clip-text text-transparent">
              はじめまして！
            </CardTitle>
            <CardDescription className="text-lg text-gray-700 dark:text-gray-300">
              あなたのお名前を教えてください💫
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="displayName" className="text-base font-medium">
                  お名前
                </Label>
                <Input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="例: 田中太郎"
                  maxLength={100}
                  className="text-base py-6 bg-white/80 dark:bg-gray-800/80 border-pink-200 dark:border-pink-700 focus:border-purple-400 dark:focus:border-purple-500"
                  disabled={loading}
                  autoFocus
                />
                <p className="text-sm text-muted-foreground">
                  この名前は論文要約やチャットで使用されます ✨
                </p>
              </div>
              
              <Button 
                type="submit" 
                className="w-full bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white font-bold py-6 text-lg shadow-lg transform hover:scale-105 transition-all duration-300"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    設定中...
                  </>
                ) : (
                  <>
                    <Heart className="mr-2 h-5 w-5 fill-white" />
                    よろしくお願いします！
                  </>
                )}
              </Button>
            </form>
            
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                後で設定画面から変更できます
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}