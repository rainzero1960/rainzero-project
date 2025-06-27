// Service Worker for background paper processing
// public/sw.js
const SW_VERSION = '1.8.2'; // バージョンを更新して重複実行修正を明確化
const CACHE_NAME = `paper-processor-v${SW_VERSION}`; // キャッシュ名も更新

// ヘルパースクリプトをインポート
importScripts('task-manager.js');

console.log(`[SW:${SW_VERSION}] Script loaded and evaluating.`);

// Global SW instance management
const SW_INSTANCE_ID = `sw_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
const SW_INSTANCE_KEY = 'active_sw_instance';
let isThisInstanceActive = false;
let instanceCheckInterval = null;

console.log(`[SW:${SW_VERSION}:${SW_INSTANCE_ID}] Service Worker instance created`);

const taskManager = new BackgroundTaskManager();

// Instance management functions
async function setActiveInstance() {
  try {
    await self.caches.open(CACHE_NAME).then(cache => {
      const response = new Response(JSON.stringify({
        instanceId: SW_INSTANCE_ID,
        timestamp: Date.now(),
        version: SW_VERSION
      }));
      return cache.put(SW_INSTANCE_KEY, response);
    });
    isThisInstanceActive = true;
    console.log(`[SW:${SW_VERSION}:${SW_INSTANCE_ID}] Set as active instance`);
  } catch (error) {
    console.error(`[SW:${SW_VERSION}:${SW_INSTANCE_ID}] Failed to set active instance:`, error);
  }
}

async function checkIfActiveInstance() {
  try {
    const cache = await self.caches.open(CACHE_NAME);
    const response = await cache.match(SW_INSTANCE_KEY);
    
    if (!response) {
      return false;
    }
    
    const data = await response.json();
    const isActive = data.instanceId === SW_INSTANCE_ID;
    
    // Check for stale instance (older than 5 minutes)
    const isStale = Date.now() - data.timestamp > 5 * 60 * 1000;
    
    if (isStale && !isActive) {
      console.warn(`[SW:${SW_VERSION}:${SW_INSTANCE_ID}] Detected stale instance ${data.instanceId}, taking over`);
      await setActiveInstance();
      return true;
    }
    
    return isActive;
  } catch (error) {
    console.error(`[SW:${SW_VERSION}:${SW_INSTANCE_ID}] Failed to check active instance:`, error);
    return false;
  }
}

async function refreshInstanceTimestamp() {
  if (isThisInstanceActive) {
    await setActiveInstance();
  }
}

// Start instance monitoring
function startInstanceMonitoring() {
  if (instanceCheckInterval) {
    clearInterval(instanceCheckInterval);
  }
  
  instanceCheckInterval = setInterval(async () => {
    try {
      const stillActive = await checkIfActiveInstance();
      if (!stillActive && isThisInstanceActive) {
        console.warn(`[SW:${SW_VERSION}:${SW_INSTANCE_ID}] Lost active instance status, stopping tasks`);
        isThisInstanceActive = false;
        taskManager.stopAutoTaskCheck();
      } else if (stillActive) {
        await refreshInstanceTimestamp();
      }
    } catch (error) {
      console.error(`[SW:${SW_VERSION}:${SW_INSTANCE_ID}] Instance monitoring error:`, error);
    }
  }, 30000); // Check every 30 seconds
}

self.addEventListener('install', (event) => {
  console.log(`[SW:${SW_VERSION}:${SW_INSTANCE_ID}:event:install] Service Worker installing...`);
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  console.log(`[SW:${SW_VERSION}:${SW_INSTANCE_ID}:event:activate] Service Worker activating...`);
  event.waitUntil(
    self.clients.claim().then(async () => {
      console.log(`[SW:${SW_VERSION}:${SW_INSTANCE_ID}:event:activate] Clients claimed.`);
      
      // Force this instance to become active (overriding any existing instance)
      await setActiveInstance();
      isThisInstanceActive = true;
      startInstanceMonitoring();
      
      console.log(`[SW:${SW_VERSION}:${SW_INSTANCE_ID}:event:activate] Forced to become active instance, starting task processing`);
      
      // Start task processing after a small delay
      setTimeout(() => {
        if (isThisInstanceActive) {
          taskManager.processNextTask().catch(error => {
            console.error(`[SW:${SW_VERSION}:${SW_INSTANCE_ID}] Failed to start task processing:`, error);
          });
        }
      }, 1000); // Small delay to ensure stability
    })
  );
});



self.addEventListener('message', async (event) => {
  console.log(`[SW:${SW_VERSION}:${SW_INSTANCE_ID}:event:message] Received message from client:`, event.data);
  
  let type, data;
  if (event.data && typeof event.data === 'object') {
    type = event.data.type;
    data = event.data.data || event.data; // Handle both {type, data} and {type, ...data}
  }
  
  if (!type) {
    console.warn(`[SW:${SW_VERSION}:event:message] Message received without a 'type' field:`, event.data);
    if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({ success: false, error: "Message type not specified" });
    }
    return;
  }
  
  console.log(`[SW:${SW_VERSION}:event:message] Processing message type: ${type}`);

  try {
    switch (type) {
      case 'START_PAPER_PROCESSING':
        console.log(`[SW:${SW_VERSION}:event:message] Handling START_PAPER_PROCESSING with data:`, data);
        
        // ★★★ Service Workerの生存期間を延長してバックグラウンド処理を保証 ★★★
        const taskStartPromise = taskManager.startTask(data);
        
        // waitUntilで処理の完了を保証（Service Workerが勝手に停止しないように）
        event.waitUntil(taskStartPromise.then(taskId => {
          console.log(`[SW:${SW_VERSION}:event:message] Long-running background task guaranteed: ${taskId}`);
          // タスクが開始された後も継続的に監視
          return new Promise(resolve => {
            const taskMonitor = setInterval(async () => {
              try {
                const task = await taskManager.getTask(taskId);
                if (!task || task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
                  clearInterval(taskMonitor);
                  resolve();
                }
              } catch (error) {
                console.error(`[SW:${SW_VERSION}:taskMonitor] Error monitoring task ${taskId}:`, error);
                clearInterval(taskMonitor);
                resolve();
              }
            }, 120000); // 2分間隔で監視（重い処理対応）
          });
        }));
        
        const taskId = await taskStartPromise;
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({ success: true, taskId });
        }
        break;
        
      case 'CANCEL_TASK':
        console.log(`[SW:${SW_VERSION}:event:message] Handling CANCEL_TASK for taskId: ${data.taskId}`);
        await taskManager.cancelTask(data.taskId);
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({ success: true });
        }
        break;
        
      case 'GET_TASK_STATUS':
        console.log(`[SW:${SW_VERSION}:event:message] Handling GET_TASK_STATUS for taskId: ${data.taskId}`);
        const task = await taskManager.getTask(data.taskId);
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({ task });
        }
        break;
        
      case 'GET_ALL_TASKS':
        console.log(`[SW:${SW_VERSION}:event:message] Handling GET_ALL_TASKS.`);
        try {
          const tasks = await taskManager.getAllTasks();
          console.log(`[SW:${SW_VERSION}:event:message] GET_ALL_TASKS successful, returning ${tasks?.length || 0} tasks`);
          if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ tasks: tasks || [] });
          }
        } catch (error) {
          console.error(`[SW:${SW_VERSION}:event:message] Error in GET_ALL_TASKS:`, error);
          if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ tasks: [], error: error.message });
          }
        }
        break;
        
      case 'RESUME_TASK_PROCESSING':
        console.log(`[SW:${SW_VERSION}:event:message] Handling RESUME_TASK_PROCESSING for taskId: ${data.taskId}`);
        try {
          await taskManager.resumeTaskProcessing(data.taskId);
          if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ success: true });
          }
        } catch (error) {
          console.error(`[SW:${SW_VERSION}:event:message] Error resuming task processing:`, error);
          if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ success: false, error: error.message });
          }
        }
        break;

      case 'AUTH_TOKEN_RESPONSE':
        console.log(`[SW:${SW_VERSION}:event:message] Handling AUTH_TOKEN_RESPONSE for messageId: ${data.messageId}`);
        if (data && data.messageId !== undefined && data.token !== undefined) {
          taskManager.handleAuthTokenResponse(data.messageId, data.token);
          // This message type usually doesn't need a response back via event.ports[0]
        } else {
          console.error(`[SW:${SW_VERSION}:event:message] Invalid AUTH_TOKEN_RESPONSE format:`, data);
        }
        break;
        
      default:
        console.warn(`[SW:${SW_VERSION}:event:message] Unknown message type received: ${type}`, data);
        if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ success: false, error: `Unknown message type: ${type}` });
        }
    }
  } catch (error) {
    console.error(`[SW:${SW_VERSION}:event:message] Error processing message type ${type}:`, error);
    if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({ success: false, error: error.message || 'Internal Server Worker error' });
    }
  }
});

self.addEventListener('notificationclick', (event) => {
  console.log(`[SW:${SW_VERSION}:event:notificationclick] Notification clicked. Tag: ${event.notification.tag}, Action: ${event.action}`);
  event.notification.close();
  
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const urlToOpen = new URL('/', self.location.origin).href; // ルートを開く
      
      // 既に開いているタブがあればそれをフォーカス
      for (const client of clients) {
        if (client.url === urlToOpen && 'focus' in client) {
          console.log(`[SW:${SW_VERSION}:event:notificationclick] Focusing existing client: ${client.id}`);
          return client.focus();
        }
      }
      // なければ新しいタブを開く
      if (self.clients.openWindow) {
        console.log(`[SW:${SW_VERSION}:event:notificationclick] Opening new window to: ${urlToOpen}`);
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});

console.log(`[SW:${SW_VERSION}] Service Worker script fully loaded and event listeners attached.`);