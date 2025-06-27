// Background Processing Manager with Service Worker integration

// 型定義をインポート
import type { 
  TaskCancelledBroadcastData, 
  SendMessageData, 
  ApiResponse, 
  SummaryResponse,
  LLMModelConfig,
  PromptSelection
} from '@/types/api';

export interface PaperProcessingTask {
  id: string;
  type: 'arxiv' | 'huggingface';
  papers: string[];
  config: PaperProcessingConfig;
  status: 'pending' | 'processing' | 'completed' | 'cancelled' | 'failed';
  progress: {
    current: number;
    total: number;
    completed: Array<{
      url: string;
      result: SummaryResponse;
      index: number;
      timestamp: string;
      promptName?: string;  // ★ 進捗表示用プロンプト名追加
      promptType?: 'default' | 'custom';  // ★ 進捗表示用プロンプトタイプ追加
    }>;
    failed: Array<{
      url: string;
      error: string;
      index: number;
      timestamp: string;
      promptName?: string;  // ★ 進捗表示用プロンプト名追加
      promptType?: 'default' | 'custom';  // ★ 進捗表示用プロンプトタイプ追加
    }>;
    results: SummaryResponse[];
    // ★ 詳細進捗情報追加
    paperProgress: {
      currentPaperIndex: number;
      totalPapers: number;
      currentArxivId?: string;  // 現在処理中のarXiv ID
    };
    summaryProgress: {
      currentSummaryIndex: number;
      totalSummaries: number;
      currentPromptName?: string;  // 現在処理中のプロンプト名
    };
  };
  createdAt: string;
  updatedAt: string;
  error?: string;
  // ★ Process ID + Heartbeat方式のための処理情報
  processingInfo?: {
    processId: string;       // 処理中のService Workerインスタンス固有ID
    lastHeartbeat: string;   // 最後のハートビート送信時刻
    startedAt: string;       // 処理開始時刻
    heartbeatCount?: number; // ハートビート送信回数（デバッグ用）
  };
}

export interface PaperProcessingConfig {
  provider?: string;
  model?: string;
  temperature?: number;
  top_p?: number;
  prompt_mode: 'default' | 'prompt_selection';
  selected_prompts: Array<{
    type: 'default' | 'custom';
    system_prompt_id?: number;
  }>;
  create_embeddings: boolean; // ★ この行を追加
  embedding_target: 'default_only' | 'custom_only' | 'both';
  embedding_target_system_prompt_id?: number | null;
  backendUrl?: string; // ★ 追加
  // ★ 新しい1要約1API用の設定追加
  useNewApi?: boolean; // 新しい単一要約APIを使用するかどうか
  // ★ 並列処理用の設定追加
  useParallelProcessing?: boolean; // 並列要約生成APIを使用するかどうか
}

export interface TaskProgressCallback {
  (task: PaperProcessingTask): void;
}

class BackgroundProcessorManager {
  private serviceWorker: ServiceWorker | null = null;
  private isRegistered = false;
  private progressCallbacks = new Set<TaskProgressCallback>();
  private activeTaskId: string | null = null;
  private initPromise: Promise<void> | null = null;
  private isInitialized = false;
  // ★★★ Service Worker復旧機能のための状態管理 ★★★
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private lastTaskProgress: { taskId: string; currentIndex: number; timestamp: number } | null = null;
  private isRecovering = false;
  // Tab coordination properties
  private tabId: string;
  private isLeaderTab = false;
  private leadershipCheckInterval: NodeJS.Timeout | null = null;
  private readonly LEADERSHIP_KEY = 'bpm_leader_tab';
  private readonly LEADERSHIP_TIMEOUT = 60000; // 1 minute

  constructor() {
    console.log('[BPM] Constructor called');
    this.tabId = `tab_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    console.log(`[BPM] Tab ID: ${this.tabId}`);
    this.initPromise = this.init();
    console.log('[BPM] Constructor completed, init promise created');
  }

private async init() {
  console.log('[BPM:init] Starting initialization...');
  
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    console.warn('[BPM:init] Service Workers not supported.');
    this.isInitialized = true;
    return;
  }

  console.log('[BPM:init] Service Worker API is available');
  try {
    console.log('[BPM:init] Step 1: Registering Service Worker...');
    await this.registerServiceWorker();
    console.log('[BPM:init] Step 1 completed: Service Worker registered');
    
    console.log('[BPM:init] Step 2: Setting up message listener...');
    this.setupMessageListener();
    console.log('[BPM:init] Step 2 completed: Message listener setup');
    
    console.log('[BPM:init] Step 3: Requesting notification permission...');
    this.requestNotificationPermission();
    console.log('[BPM:init] Step 3 completed: Notification permission requested');

    // ★★★ 強化されたコントローラー待機ロジック ★★★
    console.log('[BPM:init] Step 4: Waiting for controller...');
    await this.waitForController();
    console.log('[BPM:init] Step 4 completed: Controller available');
    
    // ★★★ 初期化完了フラグを先にセット（循環依存を避けるため） ★★★
    this.isInitialized = true;
    console.log('[BPM:init] ✅ Core initialization completed! Service Worker is ready.');
    
    // ★★★ 既存タスクのチェックは初期化完了後に実行 ★★★
    console.log('[BPM:init] Step 5: Checking for existing tasks (post-init)...');
    try {
      await this.checkForExistingTasks();
      console.log('[BPM:init] Step 5 completed: Existing tasks checked');
    } catch (error) {
      console.error('[BPM:init] Step 5 failed, but initialization is still considered successful:', error);
      // 既存タスクチェックの失敗は初期化失敗とはしない
    }

    // ★★★ Service Worker復旧機能を開始 ★★★
    console.log('[BPM:init] Step 6: Starting Service Worker recovery monitoring...');
    this.startRecoveryMonitoring();
    console.log('[BPM:init] Step 6 completed: Recovery monitoring started');
    
    // ★★★ Tab leadership management ★★★
    console.log('[BPM:init] Step 7: Starting tab leadership management...');
    this.startLeadershipManagement();
    console.log('[BPM:init] Step 7 completed: Leadership management started');
  } catch (error) {
    console.error('[BPM:init] Failed during initialization:', error);
    console.error('[BPM:init] Error details:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      isRegistered: this.isRegistered,
      hasController: !!navigator.serviceWorker.controller
    });
    this.isInitialized = true; 
    console.log('[BPM:init] Marked as initialized despite error to allow UI operation');
  }
}

// ★★★ コントローラー待機の専用メソッド ★★★
private async waitForController(): Promise<void> {
  console.log('[BPM:waitForController] Starting controller wait process...');
  return new Promise(async (resolve) => {
    try {
      // Service Worker の準備完了を待つ
      console.log('[BPM:waitForController] Waiting for Service Worker ready state...');
      await navigator.serviceWorker.ready;
      console.log('[BPM:waitForController] Service Worker is ready');
      
      if (navigator.serviceWorker.controller) {
        console.log('[BPM:waitForController] Controller is already available immediately');
        resolve();
        return;
      }

      console.log('[BPM:waitForController] Controller not immediately available, setting up wait logic...');
      
      // コントローラーが設定されるまで待機（タイムアウト付き）
      const controllerTimeout = setTimeout(() => {
        console.warn('[BPM:waitForController] Controller wait timeout after 10 seconds, continuing without controller');
        console.warn('[BPM:waitForController] Final state: hasController =', !!navigator.serviceWorker.controller);
        resolve();
      }, 10000); // 10秒でタイムアウト

      const handleControllerChange = () => {
        console.log('[BPM:waitForController] Controller change event detected');
        if (navigator.serviceWorker.controller) {
          console.log('[BPM:waitForController] Controller is now available via change event');
          clearTimeout(controllerTimeout);
          navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
          resolve();
        } else {
          console.log('[BPM:waitForController] Controller change event fired but controller still not available');
        }
      };

      navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
      console.log('[BPM:waitForController] Controller change listener added');
      
      // 既にコントローラーが設定されている可能性を再チェック
      if (navigator.serviceWorker.controller) {
        console.log('[BPM:waitForController] Controller became available during setup (recheck)');
        clearTimeout(controllerTimeout);
        navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
        resolve();
      } else {
        console.log('[BPM:waitForController] Controller still not available after recheck, waiting for event...');
      }
    } catch (error) {
      console.error('[BPM:waitForController] Error during controller wait:', error);
      resolve(); // エラーでも継続
    }
  });
}

  private async registerServiceWorker(): Promise<void> {
    try {
      console.log('[BPM:registerServiceWorker] Attempting to register Service Worker...');
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
      });

      console.log('[BPM:registerServiceWorker] Service Worker registered successfully:', registration);
      
      console.log('[BPM:registerServiceWorker] Waiting for Service Worker to be ready...');
      await navigator.serviceWorker.ready;
      console.log('[BPM:registerServiceWorker] Service Worker is ready');
      
      this.serviceWorker = registration.active || registration.waiting || registration.installing;
      this.isRegistered = true;
      console.log('[BPM:registerServiceWorker] Service Worker state:', {
        active: !!registration.active,
        waiting: !!registration.waiting,
        installing: !!registration.installing,
        isRegistered: this.isRegistered
      });
      
      registration.addEventListener('updatefound', () => {
        console.log('[BPM:registerServiceWorker] Service Worker update found');
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('[BPM:registerServiceWorker] New Service Worker available, reloading...');
              window.location.reload();
            }
          });
        }
      });
      
    } catch (error) {
      console.error('[BPM:registerServiceWorker] Service Worker registration failed:', error);
      throw error;
    }
  }

  private async setupMessageListener(): Promise<void> {
    if (!navigator.serviceWorker) return;

    navigator.serviceWorker.addEventListener('message', (event) => {
      console.log(`[BPM:setupMessageListener:${this.tabId}] Received message from SW:`, event.data);
      const { type, task } = event.data;
      
      switch (type) {
        case 'TASK_PROGRESS':
          console.log(`[BPM:setupMessageListener:${this.tabId}] TASK_PROGRESS received:`, task);
          this.notifyProgressCallbacks(task);
          break;
          
        case 'REQUEST_AUTH_TOKEN':
          console.log(`[BPM:setupMessageListener:${this.tabId}] REQUEST_AUTH_TOKEN received:`, event.data);
          if (event.data.messageId !== undefined) {
            this.handleAuthTokenRequest(event.data.messageId);
          } else {
            console.error(`[BPM:setupMessageListener:${this.tabId}] Auth token request missing messageId:`, event.data);
          }
          break;
          
        case 'TASK_CANCELLED_BROADCAST':
          console.log(`[BPM:setupMessageListener:${this.tabId}] TASK_CANCELLED_BROADCAST received:`, event.data);
          this.handleTaskCancelledBroadcast(event.data);
          break;
          
        default:
          console.log(`[BPM:setupMessageListener:${this.tabId}] Unknown message from Service Worker:`, type, event.data);
      }
    });
  }

  private handleTaskCancelledBroadcast(data: TaskCancelledBroadcastData): void {
    const { taskId, fromInstance } = data;
    
    console.log(`[BPM:handleTaskCancelledBroadcast:${this.tabId}] Task ${taskId} cancelled by instance ${fromInstance}`);
    
    // Update local state if this was our active task
    if (this.activeTaskId === taskId) {
      console.log(`[BPM:handleTaskCancelledBroadcast:${this.tabId}] Clearing activeTaskId ${taskId}`);
      this.activeTaskId = null;
    }
    
    // Notify UI about the cancellation
    this.progressCallbacks.forEach(callback => {
      try {
        callback({
          id: taskId,
          type: 'arxiv',
          papers: [],
          config: {} as PaperProcessingConfig,
          status: 'cancelled',
          progress: { 
            current: 0, 
            total: 0, 
            completed: [], 
            failed: [], 
            results: [],
            paperProgress: {
              currentPaperIndex: 0,
              totalPapers: 0
            },
            summaryProgress: {
              currentSummaryIndex: 0,
              totalSummaries: 0
            }
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      } catch (error) {
        console.error(`[BPM:handleTaskCancelledBroadcast:${this.tabId}] Error in cancellation callback:`, error);
      }
    });
  }

  private async requestNotificationPermission(): Promise<void> {
    if ('Notification' in window && Notification.permission === 'default') {
      try {
        const permission = await Notification.requestPermission();
        console.log('[BPM:requestNotificationPermission] Notification permission:', permission);
      } catch (error) {
        console.error('[BPM:requestNotificationPermission] Failed to request notification permission:', error);
      }
    }
  }

  private async handleAuthTokenRequest(messageId: number): Promise<void> {
    try {
      console.log(`[BPM:handleAuthTokenRequest] Handling auth token request for messageId: ${messageId}`);
      
      const authToken = await this.getAuthToken();
      console.log(`[BPM:handleAuthTokenRequest] Got auth token for messageId ${messageId}. Length: ${authToken ? authToken.length : 'null'}`);
      
      if (navigator.serviceWorker.controller) {
        const response = {
          type: 'AUTH_TOKEN_RESPONSE',
          messageId: messageId,
          token: authToken
        };
        console.log(`[BPM:handleAuthTokenRequest] Sending auth token response for messageId ${messageId}:`, response);
        navigator.serviceWorker.controller.postMessage(response);
      } else {
        console.error(`[BPM:handleAuthTokenRequest] No service worker controller available for messageId ${messageId}`);
      }
    } catch (error) {
      console.error(`[BPM:handleAuthTokenRequest] Failed to provide auth token for messageId ${messageId}:`, error);
    }
  }

  private async getAuthToken(): Promise<string> {
    console.log('[BPM:getAuthToken] Attempting to get auth token...');
    try {
      const { getSession } = await import('next-auth/react');
      const session = await getSession();
      
      if (session?.accessToken) {
        console.log('[BPM:getAuthToken] Auth token found in session.');
        return session.accessToken as string;
      }
    } catch (error) {
      console.error('[BPM:getAuthToken] Failed to get session:', error);
    }
    
    console.error('[BPM:getAuthToken] No auth token available.');
    throw new Error('No auth token available');
  }

  private async checkForExistingTasks(): Promise<void> {
    console.log(`[BPM:checkForExistingTasks:${this.tabId}] Starting existing tasks check...`);
    
    // Only the leader tab should check and potentially resume tasks
    if (!this.isLeaderTab) {
      console.log(`[BPM:checkForExistingTasks:${this.tabId}] Not leader tab, skipping task resumption`);
      // Follower tabs still need to get tasks for progress display
      try {
        const tasks = await this.getAllTasks();
        const activeTasks = tasks.filter(task => 
          task && task.status && (task.status === 'pending' || task.status === 'processing')
        );
        
        if (activeTasks.length > 0) {
          console.log(`[BPM:checkForExistingTasks:${this.tabId}] Found ${activeTasks.length} active tasks (follower mode)`);
          activeTasks.forEach((task, index) => {
            try {
              console.log(`[BPM:checkForExistingTasks:${this.tabId}] Notifying progress for task ${index}:`, task.id);
              this.notifyProgressCallbacks(task);
            } catch (callbackError) {
              console.error(`[BPM:checkForExistingTasks:${this.tabId}] Error in progress callback for task ${index}:`, callbackError);
            }
          });
        }
      } catch (error) {
        console.error(`[BPM:checkForExistingTasks:${this.tabId}] Failed to get tasks in follower mode:`, error);
      }
      return;
    }
    
    console.log(`[BPM:checkForExistingTasks:${this.tabId}] Leader tab checking for existing tasks...`);
    
    try {
      console.log(`[BPM:checkForExistingTasks:${this.tabId}] Calling getAllTasks...`);
      
      // タイムアウト付きでgetAllTasks()を実行
      const tasksPromise = this.getAllTasks();
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('getAllTasks timeout')), 10000)
      );
      
      const tasks = await Promise.race([tasksPromise, timeoutPromise]);
      console.log(`[BPM:checkForExistingTasks:${this.tabId}] Retrieved tasks count:`, tasks?.length || 0);
      console.log(`[BPM:checkForExistingTasks:${this.tabId}] Tasks details:`, tasks);
      
      if (!Array.isArray(tasks)) {
        console.warn(`[BPM:checkForExistingTasks:${this.tabId}] Tasks is not an array, skipping processing`);
        return;
      }
      
      const activeTasks = tasks.filter(task => 
        task && task.status && (task.status === 'pending' || task.status === 'processing')
      );
      
      console.log(`[BPM:checkForExistingTasks:${this.tabId}] Active tasks count:`, activeTasks.length);
      
      if (activeTasks.length > 0) {
        console.log(`[BPM:checkForExistingTasks:${this.tabId}] Found ${activeTasks.length} active tasks, details:`, activeTasks);
        activeTasks.forEach((task, index) => {
          try {
            console.log(`[BPM:checkForExistingTasks:${this.tabId}] Notifying progress for task ${index}:`, task.id);
            this.notifyProgressCallbacks(task);
          } catch (callbackError) {
            console.error(`[BPM:checkForExistingTasks:${this.tabId}] Error in progress callback for task ${index}:`, callbackError);
          }
        });
        
        if (activeTasks[0] && activeTasks[0].id) {
          this.activeTaskId = activeTasks[0].id;
          console.log(`[BPM:checkForExistingTasks:${this.tabId}] Set activeTaskId to: ${this.activeTaskId}`);
          
          // Only leader tab should attempt to resume processing
          console.log(`[BPM:checkForExistingTasks:${this.tabId}] Leader tab attempting to resume task processing...`);
          try {
            await this.resumeTaskProcessing(this.activeTaskId);
            console.log(`[BPM:checkForExistingTasks:${this.tabId}] Task processing resume request sent`);
          } catch (resumeError) {
            console.error(`[BPM:checkForExistingTasks:${this.tabId}] Failed to resume task processing:`, resumeError);
          }
        }
      } else {
        console.log(`[BPM:checkForExistingTasks:${this.tabId}] No active tasks found`);
      }
      
      console.log(`[BPM:checkForExistingTasks:${this.tabId}] Existing tasks check completed successfully`);
    } catch (error) {
      console.error(`[BPM:checkForExistingTasks:${this.tabId}] Failed to check for existing tasks:`, error);
      console.error(`[BPM:checkForExistingTasks:${this.tabId}] Error details:`, {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        isRegistered: this.isRegistered,
        isInitialized: this.isInitialized,
        hasController: !!navigator.serviceWorker.controller
      });
      
      // エラーでも処理を継続（既存タスクチェックは必須ではない）
      console.log(`[BPM:checkForExistingTasks:${this.tabId}] Continuing despite error - existing task check is not critical`);
    }
  }

  private notifyProgressCallbacks(task: PaperProcessingTask): void {
    console.log('[BPM:notifyProgressCallbacks] Notifying progress callbacks for task:', task.id, 'Status:', task.status, 'Progress:', task.progress.current, '/', task.progress.total);
    this.progressCallbacks.forEach(callback => {
      try {
        callback(task);
      } catch (error) {
        console.error('[BPM:notifyProgressCallbacks] Progress callback error:', error);
      }
    });
  }

private async sendMessage<T = unknown>(type: string, data?: SendMessageData, timeout: number = 30000): Promise<ApiResponse<T>> {
  console.log(`[BPM:sendMessage] Sending message to SW. Type: ${type}, Data:`, data);
  console.log(`[BPM:sendMessage] Current state: isInitialized=${this.isInitialized}, isRegistered=${this.isRegistered}`);
  
  // ★★★ 循環依存を避けて、Service Workerの基本的な可用性のみチェック ★★★
  // 初期化完了まで待機する代わりに、Service Workerが利用可能かのみチェック
  try {
    // Service Worker の準備完了を待つ
    await navigator.serviceWorker.ready;
    console.log(`[BPM:sendMessage] Service Worker ready state confirmed`);
    
    if (!this.isRegistered) {
      console.error('[BPM:sendMessage] Service Worker is not registered');
      throw new Error('Service Worker not registered');
    }
    
    if (!navigator.serviceWorker.controller) {
      console.error('[BPM:sendMessage] Service Worker controller not available');
      throw new Error('Service Worker controller not available');
    }
    
    console.log(`[BPM:sendMessage] Service Worker is available, proceeding with message`);
  } catch (error) {
    console.error(`[BPM:sendMessage] Service Worker availability check failed:`, error);
    throw new Error(`Service Worker not available: ${error}`);
  }

  return new Promise((resolve, reject) => {
    const messageChannel = new MessageChannel();
    
    // タイムアウト処理
    const timeoutId = setTimeout(() => {
      console.error(`[BPM:sendMessage] Message timeout for type: ${type} after ${timeout}ms`);
      reject(new Error(`Message timeout after ${timeout}ms for type: ${type}`));
    }, timeout);
    
    messageChannel.port1.onmessage = (event) => {
      clearTimeout(timeoutId);
      console.log(`[BPM:sendMessage] Received response from SW for type ${type}:`, event.data);
      if (event.data.success === false) {
        reject(new Error(event.data.error || 'Unknown error from Service Worker'));
      } else {
        resolve(event.data);
      }
    };

    const controller = navigator.serviceWorker.controller;
    if (controller) {
      try {
        controller.postMessage(
          { type, data },
          [messageChannel.port2]
        );
        console.log(`[BPM:sendMessage] Message posted successfully for type: ${type}`);
      } catch (error) {
        clearTimeout(timeoutId);
        console.error(`[BPM:sendMessage] Failed to post message for type ${type}:`, error);
        reject(new Error(`Failed to post message: ${error}`));
      }
    } else {
      clearTimeout(timeoutId);
      console.error('[BPM:sendMessage] Service Worker controller not available at time of postMessage.');
      reject(new Error('Service Worker controller not available'));
    }
  });
}
  
  async startPaperProcessing(
    type: 'arxiv' | 'huggingface',
    papers: string[],
    config: Omit<PaperProcessingConfig, 'backendUrl'> // backendUrlはここで自動的に付与
  ): Promise<string> {
    console.log(`[BPM:startPaperProcessing:${this.tabId}] Starting paper processing. Type: ${type}, Papers count: ${papers.length}, Config:`, config);
    
    // Ensure this tab becomes leader when starting new processing
    if (!this.isLeaderTab) {
      console.log(`[BPM:startPaperProcessing:${this.tabId}] Taking leadership for new processing task`);
      await this.becomeLeader();
    }
    
    if (!this.isRegistered) {
      console.error(`[BPM:startPaperProcessing:${this.tabId}] Background processor not available.`);
      throw new Error('Background processor not available');
    }

    // ★ ここで環境変数からバックエンドURLを取得してconfigに追加
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
    if (!backendUrl) {
      const errorMsg = "Backend URL is not configured in environment variables (NEXT_PUBLIC_BACKEND_URL).";
      console.error(`[BPM:startPaperProcessing] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    const fullConfig: PaperProcessingConfig = {
      ...config,
      backendUrl: backendUrl,
    };

    const taskData = { type, papers, config: fullConfig };
    console.log(`[BPM:startPaperProcessing] Task data prepared:`, taskData);
    const response = await this.sendMessage('START_PAPER_PROCESSING', taskData);
    
    this.activeTaskId = response.taskId || null;
    console.log(`[BPM:startPaperProcessing] Paper processing started. Task ID: ${this.activeTaskId}`);
    return response.taskId || '';
  }

  async cancelCurrentTask(): Promise<void> {
    console.log('[BPM:cancelCurrentTask] Attempting to cancel current task. Active Task ID:', this.activeTaskId);
    if (this.activeTaskId) {
      await this.cancelTask(this.activeTaskId);
      this.activeTaskId = null;
      console.log('[BPM:cancelCurrentTask] Current task cancelled and activeTaskId reset.');
    } else {
      console.log('[BPM:cancelCurrentTask] No active task to cancel.');
    }
  }

  async cancelTask(taskId: string): Promise<void> {
    console.log(`[BPM:cancelTask] Cancelling task with ID: ${taskId}`);
    await this.sendMessage('CANCEL_TASK', { taskId });
    console.log(`[BPM:cancelTask] Cancel request sent for task ID: ${taskId}`);
  }

  async getTaskStatus(taskId: string): Promise<PaperProcessingTask | null> {
    console.log(`[BPM:getTaskStatus] Getting status for task ID: ${taskId}`);
    const response = await this.sendMessage('GET_TASK_STATUS', { taskId });
    console.log(`[BPM:getTaskStatus] Status received for task ID ${taskId}:`, response.task);
    return (response.task as PaperProcessingTask) || null;
  }

  async getAllTasks(): Promise<PaperProcessingTask[]> {
    console.log('[BPM:getAllTasks] Getting all tasks.');
    const response = await this.sendMessage('GET_ALL_TASKS');
    console.log('[BPM:getAllTasks] All tasks received:', response.tasks);
    return (response.tasks as PaperProcessingTask[]) || [];
  }

  async getCurrentTask(): Promise<PaperProcessingTask | null> {
    console.log('[BPM:getCurrentTask] Getting current task. Active Task ID:', this.activeTaskId);
    if (!this.activeTaskId) {
      console.log('[BPM:getCurrentTask] No active task ID.');
      return null;
    }
    return await this.getTaskStatus(this.activeTaskId);
  }

  // ★★★ タスク処理の再開メソッド（強化版：自動タスク検索対応） ★★★
  async resumeTaskProcessing(taskId?: string): Promise<void> {
    if (taskId) {
      console.log(`[BPM:resumeTaskProcessing] Resuming task processing for specific task ID: ${taskId}`);
      try {
        await this.sendMessage('RESUME_TASK_PROCESSING', { taskId });
        console.log(`[BPM:resumeTaskProcessing] Resume request sent for task ID: ${taskId}`);
      } catch (error) {
        console.error(`[BPM:resumeTaskProcessing] Failed to resume task processing for ${taskId}:`, error);
        throw error;
      }
    } else {
      // ★★★ 即座復旧: taskIdが未指定の場合、自動的にアクティブタスクを検索 ★★★
      console.log(`[BPM:resumeTaskProcessing] ⚡ Auto-resuming: Searching for active tasks...`);
      try {
        const tasks = await this.getAllTasks();
        const activeTasks = tasks.filter(task => 
          task && task.status && (task.status === 'pending' || task.status === 'processing')
        );
        
        if (activeTasks.length > 0) {
          const firstActiveTask = activeTasks[0];
          console.log(`[BPM:resumeTaskProcessing] ⚡ Found active task: ${firstActiveTask.id}, resuming...`);
          await this.sendMessage('RESUME_TASK_PROCESSING', { taskId: firstActiveTask.id });
          console.log(`[BPM:resumeTaskProcessing] ⚡ Auto-resume request sent for task ID: ${firstActiveTask.id}`);
        } else {
          console.log(`[BPM:resumeTaskProcessing] No active tasks found for auto-resume`);
        }
      } catch (error) {
        console.error(`[BPM:resumeTaskProcessing] Failed to auto-resume task processing:`, error);
        throw error;
      }
    }
  }

  // ★★★ Service Worker復旧監視機能 ★★★
  private startRecoveryMonitoring(): void {
    console.log('[BPM:startRecoveryMonitoring] Starting Service Worker recovery monitoring');
    
    // 既存の監視を停止
    if (this.healthCheckInterval) {
      console.log('[BPM:startRecoveryMonitoring] Clearing existing health check interval.');
      clearInterval(this.healthCheckInterval);
    }
    
    this.healthCheckInterval = setInterval(async () => {
      // ★★★ このログが30秒ごとに出力されるか確認 ★★★
      console.log('[BPM:healthCheck] Interval fired. Performing health check...');
      try {
        await this.performHealthCheck();
      } catch (error) {
        console.error('[BPM:healthCheck] Health check failed:', error);
      }
    }, 30000); // 30秒間隔
    
    console.log('[BPM:startRecoveryMonitoring] ✅ Recovery monitoring started successfully with 30s interval.');
  }

  private async performHealthCheck(): Promise<void> {
    // Service Workerがサポートされていない場合はスキップ
    if (!this.isServiceWorkerSupported() || !this.isInitialized) {
      return;
    }

    console.log('[BPM:performHealthCheck] Performing Service Worker health check with Process ID + Heartbeat...');
    
    try {
      // 現在のアクティブタスクを確認
      const currentTask = await this.getCurrentTask();
      
      if (!currentTask || currentTask.status === 'completed' || currentTask.status === 'cancelled' || currentTask.status === 'failed') {
        // ★ 停止ボタン対応: cancelledタスクは監視対象外
        if (currentTask?.status === 'cancelled') {
          console.log('[BPM:performHealthCheck] Task is cancelled, stopping health monitoring');
        } else {
          console.log('[BPM:performHealthCheck] No active task found, health check passed');
        }
        this.lastTaskProgress = null;
        return;
      }

      console.log(`[BPM:performHealthCheck] Checking task ${currentTask.id} with processing info:`, currentTask.processingInfo);

      // ★ 新しいハートビートベースのヘルスチェック
      if (currentTask.processingInfo && currentTask.processingInfo.lastHeartbeat) {
        const now = new Date();
        const lastHeartbeat = new Date(currentTask.processingInfo.lastHeartbeat);
        const timeSinceHeartbeat = now.getTime() - lastHeartbeat.getTime();
        
        // 6分間ハートビートがない場合をスタック判定（ハートビート間隔15秒 × 24回分）
        const HEARTBEAT_STALL_THRESHOLD = 6 * 60 * 1000;
        
        console.log(`[BPM:performHealthCheck] Task ${currentTask.id} last heartbeat: ${Math.round(timeSinceHeartbeat / 1000)}s ago, threshold: ${HEARTBEAT_STALL_THRESHOLD / 1000}s`);
        
        if (timeSinceHeartbeat > HEARTBEAT_STALL_THRESHOLD && !this.isRecovering) {
          console.warn(`[BPM:performHealthCheck] Task ${currentTask.id} heartbeat stalled for ${Math.round(timeSinceHeartbeat / 1000)}s. Attempting recovery...`);
          await this.attemptTaskRecovery(currentTask.id);
        } else if (timeSinceHeartbeat > HEARTBEAT_STALL_THRESHOLD / 2) {
          console.warn(`[BPM:performHealthCheck] Task ${currentTask.id} heartbeat warning: ${Math.round(timeSinceHeartbeat / 1000)}s since last heartbeat`);
        }
      } else {
        // processingInfoがない場合は従来のロジックをフォールバック
        console.log(`[BPM:performHealthCheck] No processing info for task ${currentTask.id}, using fallback progress check`);
        
        const currentProgress = {
          taskId: currentTask.id,
          currentIndex: currentTask.progress.current,
          timestamp: Date.now()
        };

        // 従来の進捗ベースチェック（フォールバック）
        if (this.lastTaskProgress && 
            this.lastTaskProgress.taskId === currentProgress.taskId &&
            this.lastTaskProgress.currentIndex === currentProgress.currentIndex) {
          
          const timeDiff = currentProgress.timestamp - this.lastTaskProgress.timestamp;
          const STALL_THRESHOLD = 5 * 60 * 1000; // 5分間進捗がない場合をスタック判定
          
          if (timeDiff > STALL_THRESHOLD && !this.isRecovering) {
            console.warn(`[BPM:performHealthCheck] Task ${currentTask.id} appears to be stalled for ${Math.round(timeDiff / 1000)}s. Attempting recovery...`);
            await this.attemptTaskRecovery(currentTask.id);
          }
        } else {
          // 進捗があった場合は記録を更新
          this.lastTaskProgress = currentProgress;
          console.log(`[BPM:performHealthCheck] Task progress detected: ${currentProgress.currentIndex}/${currentTask.progress.total}`);
        }
      }
      
  } catch (error) {
    console.error('[BPM:performHealthCheck] Error during health check:', error);
    
    // ★★★ ここから修正 ★★★
    // 'error'がどんな型か分からないため、安全にエラーメッセージを取得する
    let errorMessage = '';
    if (error instanceof Error) {
      // errorがErrorオブジェクトのインスタンスであれば、安全に.messageにアクセスできる
      errorMessage = error.message;
    } else if (typeof error === 'string') {
      // 文字列がスローされた場合
      errorMessage = error;
    } else {
      // その他の型（オブジェクトなど）の場合、とりあえず文字列化してみる
      errorMessage = String(error);
    }

    // Service Workerとの通信に失敗した場合の復旧試行
    // 安全に取得したerrorMessage変数を使って判定する
    if (errorMessage.includes('Service Worker') && !this.isRecovering) {
      console.warn('[BPM:performHealthCheck] Service Worker communication failed, attempting recovery...');
      await this.attemptServiceWorkerRecovery();
    }
    // ★★★ ここまで修正 ★★★
  }
}

  private async attemptTaskRecovery(taskId: string): Promise<void> {
    if (this.isRecovering) {
      console.log('[BPM:attemptTaskRecovery] Recovery already in progress, skipping');
      return;
    }

    this.isRecovering = true;
    console.log(`[BPM:attemptTaskRecovery] Attempting to recover stalled task: ${taskId}`);
    
    try {
      // Service Workerの状態をチェック
      if (!navigator.serviceWorker.controller) {
        console.log('[BPM:attemptTaskRecovery] No Service Worker controller, attempting to restart...');
        await this.attemptServiceWorkerRecovery();
      }
      
      // タスクの処理を再開
      console.log('[BPM:attemptTaskRecovery] Sending resume task processing request...');
      await this.resumeTaskProcessing(taskId);
      
      // 進捗記録をリセット（新しい進捗を待つため）
      this.lastTaskProgress = null;
      
      console.log(`[BPM:attemptTaskRecovery] Recovery attempt completed for task: ${taskId}`);
      
      // 復旧通知（ユーザーに見える形で）
      this.notifyRecoveryAttempt(taskId);
      
    } catch (error) {
      console.error(`[BPM:attemptTaskRecovery] Failed to recover task ${taskId}:`, error);
      
      // 復旧失敗の通知
      this.notifyRecoveryFailure(taskId, error);
    } finally {
      // 復旧フラグをリセット（重い処理対応で長めの間隔）
      setTimeout(() => {
        this.isRecovering = false;
        console.log('[BPM:attemptTaskRecovery] Recovery flag reset after heavy processing period');
      }, 30000); // 30秒後にリセット（重い処理中の連続復旧試行を防ぐ）
    }
  }

  private async attemptServiceWorkerRecovery(): Promise<void> {
    console.log('[BPM:attemptServiceWorkerRecovery] Attempting Service Worker recovery...');
    
    try {
      // Service Workerの再登録を試行
      await this.registerServiceWorker();
      
      // コントローラーの取得を待機
      await this.waitForController();
      
      console.log('[BPM:attemptServiceWorkerRecovery] Service Worker recovery completed');
      
    } catch (error) {
      console.error('[BPM:attemptServiceWorkerRecovery] Service Worker recovery failed:', error);
      throw error;
    }
  }

  private notifyRecoveryAttempt(taskId: string): void {
    console.log(`[BPM:notifyRecoveryAttempt] Broadcasting recovery attempt for task: ${taskId}`);
    
    // プログレスコールバックを通じて復旧試行を通知
    this.progressCallbacks.forEach(callback => {
      try {
        // 仮想的な進捗更新として復旧情報を送信
        callback({
          id: taskId,
          type: 'arxiv',
          papers: [],
          config: {} as PaperProcessingConfig,
          status: 'processing',
          progress: { 
            current: 0, 
            total: 0, 
            completed: [], 
            failed: [], 
            results: [],
            paperProgress: {
              currentPaperIndex: 0,
              totalPapers: 0
            },
            summaryProgress: {
              currentSummaryIndex: 0,
              totalSummaries: 0
            }
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          error: '🔄 バックグラウンド処理の復旧を試行中...'
        });
      } catch (error) {
        console.error('[BPM:notifyRecoveryAttempt] Error in recovery notification callback:', error);
      }
    });
  }

  private notifyRecoveryFailure(taskId: string, error: unknown): void {
    console.log(`[BPM:notifyRecoveryFailure] Broadcasting recovery failure for task: ${taskId}`);
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    this.progressCallbacks.forEach(callback => {
      try {
        callback({
          id: taskId,
          type: 'arxiv',
          papers: [],
          config: {} as PaperProcessingConfig,
          status: 'failed',
          progress: { 
            current: 0, 
            total: 0, 
            completed: [], 
            failed: [], 
            results: [],
            paperProgress: {
              currentPaperIndex: 0,
              totalPapers: 0
            },
            summaryProgress: {
              currentSummaryIndex: 0,
              totalSummaries: 0
            }
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          error: `❌ 復旧に失敗しました: ${errorMessage}`
        });
      } catch (callbackError) {
        console.error('[BPM:notifyRecoveryFailure] Error in recovery failure notification callback:', callbackError);
      }
    });
  }

  // ★★★ Tab Leadership Management ★★★
  private async startLeadershipManagement(): Promise<void> {
    console.log(`[BPM:startLeadershipManagement:${this.tabId}] Starting leadership management`);
    
    // Try to become leader
    await this.tryBecomeLeader();
    
    // Start periodic leadership checks
    this.leadershipCheckInterval = setInterval(async () => {
      try {
        await this.checkLeadership();
      } catch (error) {
        console.error(`[BPM:leadershipCheck:${this.tabId}] Leadership check error:`, error);
      }
    }, 30000); // Check every 30 seconds
    
    // Listen for beforeunload to release leadership
    window.addEventListener('beforeunload', () => {
      if (this.isLeaderTab) {
        this.releaseLeadership();
      }
    });
  }
  
  private async tryBecomeLeader(): Promise<void> {
    try {
      const currentLeader = localStorage.getItem(this.LEADERSHIP_KEY);
      const now = Date.now();
      
      if (!currentLeader) {
        // No leader, become leader
        await this.becomeLeader();
        return;
      }
      
      const leaderData = JSON.parse(currentLeader);
      const leaderAge = now - leaderData.timestamp;
      
      if (leaderAge > this.LEADERSHIP_TIMEOUT) {
        // Current leader is stale, take over
        console.log(`[BPM:tryBecomeLeader:${this.tabId}] Taking over from stale leader ${leaderData.tabId}`);
        await this.becomeLeader();
        return;
      }
      
      if (leaderData.tabId === this.tabId) {
        // Already leader
        this.isLeaderTab = true;
        console.log(`[BPM:tryBecomeLeader:${this.tabId}] Already leader`);
        return;
      }
      
      // Another tab is leader
      this.isLeaderTab = false;
      console.log(`[BPM:tryBecomeLeader:${this.tabId}] Another tab ${leaderData.tabId} is leader`);
      
    } catch (error) {
      console.error(`[BPM:tryBecomeLeader:${this.tabId}] Error in leadership check:`, error);
      // On error, try to become leader
      await this.becomeLeader();
    }
  }
  
  private async becomeLeader(): Promise<void> {
    const leaderData = {
      tabId: this.tabId,
      timestamp: Date.now()
    };
    
    localStorage.setItem(this.LEADERSHIP_KEY, JSON.stringify(leaderData));
    this.isLeaderTab = true;
    console.log(`[BPM:becomeLeader:${this.tabId}] Became leader tab`);
    
    // Broadcast leadership change
    this.broadcastLeadershipChange(true);
  }
  
  private async checkLeadership(): Promise<void> {
    if (!this.isLeaderTab) {
      // Check if we should become leader
      await this.tryBecomeLeader();
      return;
    }
    
    // Refresh leadership timestamp
    const leaderData = {
      tabId: this.tabId,
      timestamp: Date.now()
    };
    
    localStorage.setItem(this.LEADERSHIP_KEY, JSON.stringify(leaderData));
  }
  
  private releaseLeadership(): void {
    if (this.isLeaderTab) {
      localStorage.removeItem(this.LEADERSHIP_KEY);
      this.isLeaderTab = false;
      console.log(`[BPM:releaseLeadership:${this.tabId}] Released leadership`);
      
      // Broadcast leadership change
      this.broadcastLeadershipChange(false);
    }
  }
  
  private broadcastLeadershipChange(isLeader: boolean): void {
    // Use localStorage event to notify other tabs
    const event = {
      type: 'leadership_change',
      tabId: this.tabId,
      isLeader: isLeader,
      timestamp: Date.now()
    };
    
    localStorage.setItem('bpm_leadership_event', JSON.stringify(event));
    localStorage.removeItem('bpm_leadership_event'); // Trigger storage event
  }

  // ★★★ クリーンアップ機能 ★★★
  public stopRecoveryMonitoring(): void {
    console.log(`[BPM:stopRecoveryMonitoring:${this.tabId}] Stopping Service Worker recovery monitoring`);
    
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    if (this.leadershipCheckInterval) {
      clearInterval(this.leadershipCheckInterval);
      this.leadershipCheckInterval = null;
    }
    
    this.releaseLeadership();
    
    this.lastTaskProgress = null;
    this.isRecovering = false;
    
    console.log(`[BPM:stopRecoveryMonitoring:${this.tabId}] Recovery monitoring stopped`);
  }

  onProgress(callback: TaskProgressCallback): () => void {
    console.log('[BPM:onProgress] Registering progress callback.');
    this.progressCallbacks.add(callback);
    
    return () => {
      console.log('[BPM:onProgress] Unregistering progress callback.');
      this.progressCallbacks.delete(callback);
    };
  }

  async waitForInitialization(): Promise<void> {
    console.log('[BPM:waitForInitialization] Called. initPromise exists:', !!this.initPromise);
    if (this.initPromise) {
      console.log('[BPM:waitForInitialization] Waiting for init promise to resolve...');
      await this.initPromise;
      console.log('[BPM:waitForInitialization] Init promise resolved.');
    } else {
      console.log('[BPM:waitForInitialization] No init promise found, assuming already initialized or init failed.');
    }
  }

  isServiceWorkerSupported(): boolean {
    const hasServiceWorker = typeof window !== 'undefined' && 'serviceWorker' in navigator;
    console.log('[BPM:isServiceWorkerSupported] Check:', {
      hasWindow: typeof window !== 'undefined',
      hasServiceWorker: 'serviceWorker' in (typeof navigator !== 'undefined' ? navigator : {}),
      isInitialized: this.isInitialized,
      result: hasServiceWorker
    });
    return hasServiceWorker;
  }

  isReady(): boolean {
    const readyState = this.isInitialized && this.isRegistered && !!navigator.serviceWorker.controller;
    console.log('[BPM:isReady] Check. State:', { isInitialized: this.isInitialized, isRegistered: this.isRegistered, hasController: !!navigator.serviceWorker.controller, result: readyState });
    return readyState;
  }

  getActiveTaskId(): string | null {
    return this.activeTaskId;
  }

  static parseUrlsInput(urlsInput: string): string[] {
    return urlsInput
      .split('\n')
      .map(url => url.trim())
      .filter(url => url.length > 0);
  }

  static createConfigFromLegacy(
    modelCfg: LLMModelConfig,
    promptMode: string,
    selectedPrompts: PromptSelection[],
    createEmbeddings: boolean, // ★ 引数を追加
    embeddingTarget: string,
    embeddingTargetSystemPromptId?: number | null
  ): PaperProcessingConfig {
    // デフォルトプロンプトを最初に配置するよう並び替え
    const sortedPrompts = selectedPrompts ? [...selectedPrompts].sort((a, b) => {
      if (a.type === 'default' && b.type !== 'default') return -1;
      if (a.type !== 'default' && b.type === 'default') return 1;
      return 0; // 同じタイプの場合は元の順序を維持
    }) : [{ type: 'default' }];

    return {
      provider: modelCfg?.provider,
      model: modelCfg?.model,
      temperature: modelCfg?.temperature,
      top_p: modelCfg?.top_p,
      prompt_mode: promptMode as 'default' | 'prompt_selection',
      selected_prompts: sortedPrompts as PromptSelection[],
      create_embeddings: createEmbeddings,
      embedding_target: embeddingTarget as 'default_only' | 'custom_only' | 'both',
      embedding_target_system_prompt_id: embeddingTargetSystemPromptId
    };
  }
}

console.log('[BPM] Creating singleton instance...');
export const backgroundProcessor = new BackgroundProcessorManager();
console.log('[BPM] Singleton instance created.');

export function useBackgroundProcessor() {
  return backgroundProcessor;
}

export { BackgroundProcessorManager };