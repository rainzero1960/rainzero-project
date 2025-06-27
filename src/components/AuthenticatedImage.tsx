"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/utils';

interface AuthenticatedImageProps {
  src: string;
  alt: string;
  className?: string;
  onError?: () => void;
  loading?: 'lazy' | 'eager';
}

export const AuthenticatedImage: React.FC<AuthenticatedImageProps> = ({
  src,
  alt,
  className = "",
  onError,
  loading = "lazy"
}) => {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  // onErrorコールバックをメモ化して依存関係を安定化
  const handleError = useCallback(() => {
    onError?.();
  }, [onError]);

  // loadImage関数をメモ化
  const loadImage = useCallback(async () => {
    try {
      setIsLoading(true);
      setHasError(false);

      // 認証付きで画像を取得
      console.log('Fetching authenticated image from:', src);
      const response = await authenticatedFetch(src);
      
      if (!response.ok) {
        console.error('Failed to load image:', response.statusText);
        throw new Error(`HTTP ${response.status}`);
      }

      // Blobとして取得
      const blob = await response.blob();
      console.log('Blob size:', blob.size, 'bytes');
      
      // Object URLを作成
      const objectUrl = URL.createObjectURL(blob);
      
      setImageSrc(objectUrl);
      setIsLoading(false);
    } catch (error) {
      console.error('Failed to load authenticated image:', error);
      setHasError(true);
      setIsLoading(false);
      handleError();
    }
  }, [src, handleError]);

  // 画像読み込み効果
  useEffect(() => {
    if (src) {
      loadImage();
    }
  }, [src, loadImage]);

  // クリーンアップ効果（imageSrcが変更された時のみ）
  useEffect(() => {
    return () => {
      if (imageSrc && imageSrc.startsWith('blob:')) {
        URL.revokeObjectURL(imageSrc);
      }
    };
  }, [imageSrc]);

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center bg-muted ${className}`}>
        <div className="text-xs text-muted-foreground">読み込み中...</div>
      </div>
    );
  }

  if (hasError || !imageSrc) {
    return (
      <div className={`flex items-center justify-center bg-muted ${className}`}>
        <div className="text-xs text-muted-foreground">画像を読み込めません</div>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageSrc}
      alt={alt}
      className={className}
      loading={loading}
      onError={() => {
        setHasError(true);
        handleError();
      }}
    />
  );
};