"use client";

import React, { useState, useEffect, forwardRef, useImperativeHandle, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle, Images, Star, Lock } from 'lucide-react';
import { useBackgroundImages, useUserBackgroundSettings } from '@/hooks/useBackgroundImages';
import { AuthenticatedImage } from '@/components/AuthenticatedImage';

interface ImageTypeConfig {
  key: 'chat-background-dark' | 'chat-background-light' | 'rag-background-dark' | 'rag-background-light';
  label: string;
  dbField: 'chat_background_dark_set' | 'chat_background_light_set' | 'rag_background_dark_set' | 'rag_background_light_set';
}

const IMAGE_TYPE_CONFIGS: ImageTypeConfig[] = [
  { key: 'chat-background-dark', label: 'チャット (ダークモード)', dbField: 'chat_background_dark_set' },
  { key: 'chat-background-light', label: 'チャット (ライトモード)', dbField: 'chat_background_light_set' },
  { key: 'rag-background-dark', label: 'RAG (ダークモード)', dbField: 'rag_background_dark_set' },
  { key: 'rag-background-light', label: 'RAG (ライトモード)', dbField: 'rag_background_light_set' },
];

interface ImageSelectorProps {
  config: ImageTypeConfig;
  availableImages: Array<{
    set_number: string;
    image_path: string;
    required_points: number;
  }>;
  selectedValue: string;
  userPoints: number;
  onSelect: (setNumber: string) => void;
}

const ImageSelector: React.FC<ImageSelectorProps> = ({
  config,
  availableImages,
  selectedValue,
  userPoints,
  onSelect
}) => {
  // const [imageError, setImageError] = useState(false); // 未使用
  console.log('ImageSelector rendered with config:', config);
  console.log('Available images:', availableImages);
  console.log('Selected value:', selectedValue);
  console.log('User points:', userPoints);

  const selectedImage = availableImages.find(img => img.set_number === selectedValue);
  console.log('Selected image:', selectedImage);

  const canAfford = selectedImage ? userPoints >= selectedImage.required_points : true;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{config.label}</Label>
        {selectedImage && (
          <div className="flex items-center space-x-2">
            {selectedImage.required_points > 0 && (
              <Badge variant={canAfford ? "default" : "destructive"} className="text-xs">
                <Star className="w-3 h-3 mr-1" />
                {selectedImage.required_points}pt
              </Badge>
            )}
          </div>
        )}
      </div>
      
      <Select value={selectedValue} onValueChange={onSelect}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="画像を選択" />
        </SelectTrigger>
        <SelectContent>
          {availableImages.map((image) => {
            const isAffordable = userPoints >= image.required_points;
            return (
              <SelectItem 
                key={image.set_number} 
                value={image.set_number}
                disabled={!isAffordable}
                className={!isAffordable ? "opacity-50" : ""}
              >
                <div className="flex items-center justify-between w-full">
                  <span>セット {image.set_number}</span>
                  <div className="flex items-center space-x-1 ml-2">
                    {image.required_points > 0 && (
                      <Badge variant={isAffordable ? "outline" : "destructive"} className="text-xs">
                        {!isAffordable && <Lock className="w-3 h-3 mr-1" />}
                        <Star className="w-3 h-3 mr-1" />
                        {image.required_points}pt
                      </Badge>
                    )}
                  </div>
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      
      {/* プレビュー画像 */}
      {selectedImage && (
        <div className="mt-2">
          <div className="aspect-video bg-muted rounded border overflow-hidden">
            <AuthenticatedImage
              //src={`${process.env.NEXT_PUBLIC_BACKEND_URL}${selectedImage.image_path}`}
              src={`${process.env.NEXT_PUBLIC_BACKEND_URL}${selectedImage.image_path}`}
              alt={`${config.label} プレビュー`}
              className="w-full h-full object-cover"
              onError={() => console.error('Failed to load preview image')}
              loading="lazy"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export interface BackgroundImageSelectorRef {
  refresh: () => void;
}

export const BackgroundImageSelector = forwardRef<BackgroundImageSelectorRef, object>((_, ref) => {
  const { backgroundImages, isLoading: backgroundImagesLoading, updateBackgroundImages, refetch } = useBackgroundImages();
  const { user, isLoading: userLoading, refetch: refetchUser } = useUserBackgroundSettings();
  
  const [selections, setSelections] = useState<{
    [K in ImageTypeConfig['dbField']]: string;
  }>({} as { [K in ImageTypeConfig['dbField']]: string });
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateSuccess, setUpdateSuccess] = useState<string | null>(null);

  // ユーザーの現在の設定を反映
  useEffect(() => {
    if (user) {
      setSelections({
        chat_background_dark_set: user.chat_background_dark_set || '01-01',
        chat_background_light_set: user.chat_background_light_set || '01-01',
        rag_background_dark_set: user.rag_background_dark_set || '01-01',
        rag_background_light_set: user.rag_background_light_set || '01-01',
      });
    }
  }, [user]);

  const handleSelectionChange = (dbField: ImageTypeConfig['dbField'], setNumber: string) => {
    setSelections(prev => ({ ...prev, [dbField]: setNumber }));
  };

  const hasChanges = () => {
    if (!user) return false;
    return (
      selections.chat_background_dark_set !== (user.chat_background_dark_set || '01-01') ||
      selections.chat_background_light_set !== (user.chat_background_light_set || '01-01') ||
      selections.rag_background_dark_set !== (user.rag_background_dark_set || '01-01') ||
      selections.rag_background_light_set !== (user.rag_background_light_set || '01-01')
    );
  };

  const handleUpdate = async () => {
    setIsUpdating(true);
    setUpdateError(null);
    setUpdateSuccess(null);

    try {
      await updateBackgroundImages({
        chat_background_dark_set: selections.chat_background_dark_set,
        chat_background_light_set: selections.chat_background_light_set,
        rag_background_dark_set: selections.rag_background_dark_set,
        rag_background_light_set: selections.rag_background_light_set,
      });

      setUpdateSuccess('背景画像設定が正常に更新されました。');
      
      // ユーザー情報を再取得
      await refetchUser();
    } catch (err: unknown) {
      setUpdateError(err instanceof Error ? err.message : '予期せぬエラーが発生しました。');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleRefresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  useImperativeHandle(ref, () => ({
    refresh: handleRefresh,
  }), [handleRefresh]);

  if (userLoading || backgroundImagesLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Images className="mr-2 h-5 w-5" />
            背景画像設定
          </CardTitle>
          <CardDescription>読み込み中...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!backgroundImages || !user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Images className="mr-2 h-5 w-5" />
            背景画像設定
          </CardTitle>
          <CardDescription>
            各ページとモードで個別に背景画像を選択できます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>エラー</AlertTitle>
            <AlertDescription>背景画像情報を取得できませんでした。</AlertDescription>
          </Alert>
          <Button onClick={handleRefresh} className="mt-4">
            再試行
          </Button>
        </CardContent>
      </Card>
    );
  }

  const hasAnyImages = IMAGE_TYPE_CONFIGS.some(config => 
    backgroundImages.available_images[config.key] && 
    backgroundImages.available_images[config.key].length > 0
  );

  if (!hasAnyImages) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Images className="mr-2 h-5 w-5" />
            背景画像設定
          </CardTitle>
          <CardDescription>
            各ページとモードで個別に背景画像を選択できます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>利用可能な画像がありません</AlertTitle>
            <AlertDescription>
              現在のテーマ設定で利用可能な背景画像が見つかりません。
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
          <Images className="mr-2 h-5 w-5" />
          背景画像設定
        </CardTitle>
        <CardDescription>
          各ページとモードで個別に背景画像を選択できます。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {updateError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>エラー</AlertTitle>
            <AlertDescription>{updateError}</AlertDescription>
          </Alert>
        )}
        
        {updateSuccess && (
          <Alert variant="default" className="bg-green-50 dark:bg-green-950 border-green-300 dark:border-green-700">
            <AlertTitle className="text-green-700 dark:text-green-300">成功</AlertTitle>
            <AlertDescription className="text-green-600 dark:text-green-400">
              {updateSuccess}
            </AlertDescription>
          </Alert>
        )}

        {/* ユーザーポイント表示　しばらく使わないので隠しておくが、そのうち利用するため消去はNG */}
        {/*
        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center space-x-2">
            <Star className="h-4 w-4 text-yellow-500" />
            <span className="text-sm font-medium">保有ポイント</span>
          </div>
          <Badge variant="outline" className="font-bold">
            {backgroundImages.user_points} pt
          </Badge>
        </div>
        */}

        {/* 各画像タイプの選択 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {IMAGE_TYPE_CONFIGS.map((config) => {
            const availableImages = backgroundImages.available_images[config.key] || [];
            if (availableImages.length === 0) return null;
            
            return (
              <ImageSelector
                key={config.key}
                config={config}
                availableImages={availableImages}
                selectedValue={selections[config.dbField]}
                userPoints={backgroundImages.user_points}
                onSelect={(setNumber) => handleSelectionChange(config.dbField, setNumber)}
              />
            );
          })}
        </div>

        {/* 更新ボタン */}
        <div className="pt-4">
          <Button 
            onClick={handleUpdate} 
            disabled={isUpdating || !hasChanges()}
            className="w-full"
          >
            {isUpdating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                更新中...
              </>
            ) : (
              '背景画像設定を変更'
            )}
          </Button>
          {!hasChanges() && (
            <p className="text-xs text-muted-foreground mt-2 text-center">
              変更がありません
            </p>
          )}
        </div>

        {/* テーマ情報 */}
        <div className="text-xs text-muted-foreground space-y-1 p-3 bg-muted/30 rounded-lg">
          <p>💡 <strong>現在のテーマ設定:</strong></p>
          <p>・ライトモード: {backgroundImages.light_theme.theme_name} (thema{backgroundImages.light_theme.theme_number})</p>
          <p>・ダークモード: {backgroundImages.dark_theme.theme_name} (thema{backgroundImages.dark_theme.theme_number})</p>
          <p>・保有ポイント: {backgroundImages.user_points} pt</p>
        </div>
      </CardContent>
    </Card>
  );
});

BackgroundImageSelector.displayName = "BackgroundImageSelector";