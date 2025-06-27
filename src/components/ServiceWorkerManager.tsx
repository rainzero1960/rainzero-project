"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { backgroundProcessor } from "@/lib/background-processor";
import type { LockDetail } from "@/types/task";

export function ServiceWorkerManager() {
  const { data: session, status } = useSession();
  const isInitialized = useRef(false);
  const recoveryInterval = useRef<NodeJS.Timeout | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [lastRecoveryAttempt, setLastRecoveryAttempt] = useState<string | null>(null);
  
  const [lockInfo, setLockInfo] = useState<LockDetail[] | null>(null);

  // ★★★ ロック情報の取得機能 ★★★
  const fetchLockInfo = useCallback(async () => {
    try {
      const tasks = await backgroundProcessor.getAllTasks();
      const lockDetails = tasks.map(task => {
        if (task && task.processingInfo) {
          const lastHeartbeat = new Date(task.processingInfo.lastHeartbeat);
          const timeSinceHeartbeat = Date.now() - lastHeartbeat.getTime();
          return {
            id: task.id,
            status: task.status,
            progress: `${task.progress?.current || 0}/${task.progress?.total || 0}`,
            owner: task.processingInfo.processId,
            heartbeatAge: Math.round(timeSinceHeartbeat / 1000),
            isStuck: timeSinceHeartbeat > 120000, // 2分以上
            lastHeartbeat: lastHeartbeat.toLocaleTimeString()
          };
        }
        return null;
      }).filter((detail): detail is LockDetail => detail !== null);
      
      setLockInfo(lockDetails);
      return lockDetails;
    } catch (error) {
      console.error('[ServiceWorkerManager] Failed to fetch lock info:', error);
      return [];
    }
  }, []);

  // ★★★ 強制復旧機能：デバッグ用の手動復旧 ★★★
  const performForceRecovery = useCallback(async () => {
    try {
      console.log('[ServiceWorkerManager] 🚨 FORCE RECOVERY: Manual recovery initiated...');
      setLastRecoveryAttempt(new Date().toISOString());
      
      // ロック情報を更新
      await fetchLockInfo();
      
      // 強制的に自動復旧を実行
      await backgroundProcessor.resumeTaskProcessing();
      
      console.log('[ServiceWorkerManager] 🚨 FORCE RECOVERY: Manual recovery completed');
    } catch (error) {
      console.error('[ServiceWorkerManager] 🚨 FORCE RECOVERY: Manual recovery failed:', error);
    }
  }, [fetchLockInfo]);

  // 即座復旧機能：アクティブタスクの検出と復旧
  const performImmediateRecovery = async () => {
    try {
      console.log('[ServiceWorkerManager] Performing immediate recovery check...');
      
      // Service Worker初期化確認
      await backgroundProcessor.waitForInitialization();
      
      // アクティブタスクの確認
      const tasks = await backgroundProcessor.getAllTasks();
      
      // ★★★ デバッグログ強化：全タスクの詳細情報を表示 ★★★
      console.log(`[ServiceWorkerManager] 🔍 DEBUG: Retrieved ${tasks.length} total tasks`);
      tasks.forEach((task, index) => {
        if (task) {
          console.log(`[ServiceWorkerManager] 🔍 Task ${index}: ID=${task.id}, Status=${task.status}, Progress=${task.progress?.current}/${task.progress?.total}, Created=${task.createdAt}`);
        } else {
          console.log(`[ServiceWorkerManager] 🔍 Task ${index}: null or undefined`);
        }
      });
      
      const activeTasks = tasks.filter(task => 
        task && task.status && (task.status === 'pending' || task.status === 'processing')
      );
      
      // ★★★ 拡張アクティブタスク検索：未完了タスクも含める ★★★
      const incompleteTask = tasks.filter(task => {
        if (!task || !task.progress) return false;
        const isIncomplete = task.progress.current < task.progress.total;
        const hasValidStatus = task.status && ['pending', 'processing', 'failed'].includes(task.status);
        return isIncomplete && hasValidStatus;
      });
      
      console.log(`[ServiceWorkerManager] 🔍 Filtering results: Active tasks (pending/processing)=${activeTasks.length}, Incomplete tasks=${incompleteTask.length}`);
      
      const targetTasks = activeTasks.length > 0 ? activeTasks : incompleteTask;
      
      if (targetTasks.length > 0) {
        const taskType = activeTasks.length > 0 ? 'active' : 'incomplete';
        console.log(`[ServiceWorkerManager] Found ${targetTasks.length} ${taskType} tasks during recovery`);
        
        // 最初のターゲットタスクを即座に復旧
        const firstTargetTask = targetTasks[0];
        console.log(`[ServiceWorkerManager] 🔍 Target task details: ID=${firstTargetTask.id}, Status=${firstTargetTask.status}, Progress=${firstTargetTask.progress?.current}/${firstTargetTask.progress?.total}`);
        
        if (firstTargetTask.id) {
          console.log(`[ServiceWorkerManager] Immediately resuming task: ${firstTargetTask.id}`);
          await backgroundProcessor.resumeTaskProcessing(firstTargetTask.id);
          console.log(`[ServiceWorkerManager] Immediate recovery completed successfully`);
        } else {
          // ★★★ フォールバック: IDが不明な場合は自動検索で復旧 ★★★
          console.log(`[ServiceWorkerManager] Task ID unknown, attempting auto-resume...`);
          await backgroundProcessor.resumeTaskProcessing();
          console.log(`[ServiceWorkerManager] Auto-resume completed successfully`);
        }
      } else {
        console.log('[ServiceWorkerManager] 🔍 No recoverable tasks found (no active or incomplete tasks)');
      }
    } catch (error) {
      console.error('[ServiceWorkerManager] Immediate recovery failed:', error);
    }
  };

  useEffect(() => {
    // 認証済みかつ初期化未完了の場合のみ実行
    if (status === "authenticated" && session?.accessToken && !isInitialized.current) {
      console.log('[ServiceWorkerManager] Initializing global Service Worker management...');
      
      const initializeServiceWorker = async () => {
        try {
          // Service Worker初期化を待機
          await backgroundProcessor.waitForInitialization();
          console.log('[ServiceWorkerManager] Service Worker initialization completed');
          
          // 初期復旧実行
          await performImmediateRecovery();
          
          isInitialized.current = true;
        } catch (error) {
          console.error('[ServiceWorkerManager] Failed to initialize Service Worker:', error);
        }
      };
      
      initializeServiceWorker();
    }
  }, [status, session]);

  // ページ復帰時の即座復旧機能
  useEffect(() => {
    if (status === "authenticated" && session?.accessToken) {
      // visibilitychange イベントでページ復帰を検出
      const handleVisibilityChange = () => {
        if (!document.hidden && isInitialized.current) {
          console.log('[ServiceWorkerManager] Page became visible, performing immediate recovery...');
          // 少し遅延を入れてService Workerの準備を待つ
          setTimeout(performImmediateRecovery, 500);
        }
      };

      // 定期的な復旧チェック（30秒間隔）
      const startPeriodicRecovery = () => {
        if (recoveryInterval.current) {
          clearInterval(recoveryInterval.current);
        }
        
        recoveryInterval.current = setInterval(() => {
          if (!document.hidden && isInitialized.current) {
            console.log('[ServiceWorkerManager] Performing periodic recovery check...');
            performImmediateRecovery();
          }
        }, 30000);
        
        console.log('[ServiceWorkerManager] Periodic recovery check started (30s interval)');
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);
      startPeriodicRecovery();

      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        if (recoveryInterval.current) {
          clearInterval(recoveryInterval.current);
          recoveryInterval.current = null;
        }
      };
    }
  }, [status, session]);

  // ★★★ 開発環境でのデバッグUI ★★★
  const isDevelopment = process.env.NODE_ENV === 'development';

  // デバッグモード切り替え（開発環境のみ）
  useEffect(() => {
    if (isDevelopment) {
      const handleKeyDown = (event: KeyboardEvent) => {
        // Ctrl+Shift+D でデバッグモード切り替え
        if (event.ctrlKey && event.shiftKey && event.key === 'D') {
          setDebugMode(!debugMode);
          console.log(`[ServiceWorkerManager] Debug mode: ${!debugMode ? 'ON' : 'OFF'}`);
        }
        // Ctrl+Shift+R で強制復旧
        if (event.ctrlKey && event.shiftKey && event.key === 'R') {
          performForceRecovery();
        }
        // Ctrl+Shift+L でロック情報取得
        if (event.ctrlKey && event.shiftKey && event.key === 'L') {
          fetchLockInfo();
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [debugMode, isDevelopment, performForceRecovery, fetchLockInfo]);

  // 開発環境でのデバッグUI表示
  if (isDevelopment && debugMode) {
    return (
      <div style={{
        position: 'fixed',
        top: '10px',
        right: '10px',
        background: 'rgba(0,0,0,0.8)',
        color: 'white',
        padding: '10px',
        borderRadius: '5px',
        fontSize: '12px',
        zIndex: 9999,
        maxWidth: '300px'
      }}>
        <div style={{ marginBottom: '10px', fontWeight: 'bold' }}>
          Service Worker Debug Panel
        </div>
        <div style={{ marginBottom: '5px' }}>
          Status: {status}, Initialized: {isInitialized.current ? 'Yes' : 'No'}
        </div>
        {lastRecoveryAttempt && (
          <div style={{ marginBottom: '5px', fontSize: '10px' }}>
            Last Recovery: {new Date(lastRecoveryAttempt).toLocaleTimeString()}
          </div>
        )}
        
        {/* ★★★ ロック情報表示 ★★★ */}
        {lockInfo && lockInfo.length > 0 && (
          <div style={{ marginBottom: '10px', fontSize: '10px', backgroundColor: 'rgba(255,255,255,0.1)', padding: '5px', borderRadius: '3px' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '3px' }}>Lock Status:</div>
            {lockInfo.map((lock: LockDetail, index: number) => (
              <div key={index} style={{ 
                marginBottom: '2px', 
                color: lock.isStuck ? '#ff6666' : '#66ff66',
                fontSize: '9px'
              }}>
                {lock.isStuck ? '🔴' : '🟢'} {lock.id.substring(0, 12)}... 
                {lock.progress} | {lock.heartbeatAge}s ago | {lock.owner.substring(0, 12)}...
              </div>
            ))}
          </div>
        )}
        
        <div style={{ marginBottom: '5px' }}>
          <button
            onClick={performForceRecovery}
            style={{
              background: '#ff4444',
              color: 'white',
              border: 'none',
              padding: '5px 10px',
              borderRadius: '3px',
              cursor: 'pointer',
              marginRight: '5px',
              fontSize: '10px'
            }}
          >
            Force Recovery
          </button>
          <button
            onClick={fetchLockInfo}
            style={{
              background: '#4444ff',
              color: 'white',
              border: 'none',
              padding: '5px 10px',
              borderRadius: '3px',
              cursor: 'pointer',
              marginRight: '5px',
              fontSize: '10px'
            }}
          >
            Check Locks
          </button>
          <button
            onClick={() => setDebugMode(false)}
            style={{
              background: '#666',
              color: 'white',
              border: 'none',
              padding: '5px 10px',
              borderRadius: '3px',
              cursor: 'pointer',
              fontSize: '10px'
            }}
          >
            Close
          </button>
        </div>
        <div style={{ fontSize: '9px', marginTop: '5px' }}>
          Hotkeys: Ctrl+Shift+D (toggle), Ctrl+Shift+R (recovery), Ctrl+Shift+L (locks)
        </div>
      </div>
    );
  }

  return null;
}