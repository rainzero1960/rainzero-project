// src/hooks/usePageVisibility.ts
import { useEffect, useState, useCallback, useRef } from 'react';

/**
 * Page Visibility APIを使用してページのvisibility状態を監視するフック
 * 
 * @returns {Object} ページのvisibility状態とイベントハンドラー
 */
export function usePageVisibility() {
  const [isVisible, setIsVisible] = useState(
    typeof document !== 'undefined' ? !document.hidden : true
  );
  const [lastHiddenAt, setLastHiddenAt] = useState<number | null>(null);
  const [lastVisibleAt, setLastVisibleAt] = useState<number | null>(null);
  
  // フォーカス復帰時のコールバック管理
  const onVisibilityChangeCallbacks = useRef<Set<() => void>>(new Set());

  const handleVisibilityChange = useCallback(() => {
    const now = Date.now();
    const visible = !document.hidden;
    
    console.log(`[PageVisibility] Visibility changed: ${visible ? 'visible' : 'hidden'} at ${now}`);
    
    setIsVisible(visible);
    
    if (visible) {
      setLastVisibleAt(now);
      // フォーカス復帰時のコールバックを実行
      onVisibilityChangeCallbacks.current.forEach(callback => {
        try {
          callback();
        } catch (error) {
          console.error('[PageVisibility] Error in visibility change callback:', error);
        }
      });
    } else {
      setLastHiddenAt(now);
    }
  }, []);

  useEffect(() => {
    // ブラウザ環境でのみ実行
    if (typeof document === 'undefined') return;

    // 初期状態を設定
    setIsVisible(!document.hidden);
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [handleVisibilityChange]);

  /**
   * ページがフォアグラウンドに復帰した時に実行されるコールバックを登録
   * @param callback - フォーカス復帰時に実行される関数
   * @returns クリーンアップ関数
   */
  const onFocusRestore = useCallback((callback: () => void) => {
    onVisibilityChangeCallbacks.current.add(callback);
    
    return () => {
      onVisibilityChangeCallbacks.current.delete(callback);
    };
  }, []);

  /**
   * ページがどれくらいの時間バックグラウンドにあったかを取得
   * @returns バックグラウンド時間（ミリ秒）、またはnull
   */
  const getBackgroundDuration = useCallback((): number | null => {
    if (!lastHiddenAt || !lastVisibleAt) {
      console.log(`[PageVisibility] getBackgroundDuration: missing timestamps. Hidden: ${lastHiddenAt}, Visible: ${lastVisibleAt}`);
      return null;
    }
    if (lastVisibleAt <= lastHiddenAt) {
      console.log(`[PageVisibility] getBackgroundDuration: invalid order. Hidden: ${lastHiddenAt}, Visible: ${lastVisibleAt}`);
      return null;
    }
    const duration = lastVisibleAt - lastHiddenAt;
    console.log(`[PageVisibility] getBackgroundDuration: ${duration}ms (Hidden: ${lastHiddenAt}, Visible: ${lastVisibleAt})`);
    return duration;
  }, [lastHiddenAt, lastVisibleAt]);

  return {
    isVisible,
    lastHiddenAt,
    lastVisibleAt,
    onFocusRestore,
    getBackgroundDuration,
  };
}

/**
 * Deep系処理用の特化されたPage Visibilityフック
 * バックグラウンド時間に応じて自動更新の頻度を調整
 */
export function useDeepProcessVisibility() {
  const { isVisible, onFocusRestore, getBackgroundDuration } = usePageVisibility();
  const [shouldForceUpdate, setShouldForceUpdate] = useState(false);

  /**
   * Deep処理用の自動更新コールバックを登録
   * @param updateCallback - フォーカス復帰時に実行される更新関数
   * @param options - 更新オプション
   */
  const registerDeepProcessUpdate = useCallback((
    updateCallback: () => void,
    options: {
      minBackgroundTime?: number; // 最小バックグラウンド時間（ms）
      forceUpdate?: boolean; // 強制更新フラグ
    } = {}
  ) => {
    const { minBackgroundTime = 1000, forceUpdate = false } = options;

    return onFocusRestore(() => {
      const backgroundDuration = getBackgroundDuration();
      
      // バックグラウンド時間が短い場合は更新をスキップ（無駄なAPI呼び出しを防ぐ）
      if (backgroundDuration !== null && backgroundDuration < minBackgroundTime && !forceUpdate) {
        console.log(`[DeepProcessVisibility] Background time too short (${backgroundDuration}ms), skipping update`);
        return;
      }

      console.log(`[DeepProcessVisibility] Triggering update after ${backgroundDuration}ms background time`);
      setShouldForceUpdate(true);
      updateCallback();
      
      // フラグをリセット
      setTimeout(() => setShouldForceUpdate(false), 100);
    });
  }, [onFocusRestore, getBackgroundDuration]);

  return {
    isVisible,
    shouldForceUpdate,
    registerDeepProcessUpdate,
    getBackgroundDuration,
  };
}