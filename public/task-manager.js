// Helper for background paper processing
// public/task-manager.js
let dbPromise;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('PaperProcessorDB', 2);
      
      request.onerror = (event) => {
        reject(request.error);
      };
      request.onsuccess = (event) => {
        resolve(request.result);
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        if (!db.objectStoreNames.contains('tasks')) {
          const taskStore = db.createObjectStore('tasks', { keyPath: 'id' });
          taskStore.createIndex('status', 'status', { unique: false });
          taskStore.createIndex('createdAt', 'createdAt', { unique: false });
        }
        
        if (!db.objectStoreNames.contains('progress')) {
          const progressStore = db.createObjectStore('progress', { keyPath: 'taskId' });
        }
        
        if (!db.objectStoreNames.contains('tokenCache')) {
          const tokenStore = db.createObjectStore('tokenCache', { keyPath: 'id' });
        }
      };
    });
  }
  return dbPromise;
}

class BackgroundTaskManager {
  constructor() {
    this.activeTasks = new Map();
    this.isProcessing = false;
    this.authTokenPromises = new Map();
    this.instanceId = `sw_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    this.heartbeatInterval = null;
    this.heartbeatCount = 0;
    this.currentlyProcessingTaskId = null;
    this.autoTaskCheckInterval = null;
    
    this.startAutoTaskCheck();
  }

  startAutoTaskCheck() {
    if (this.autoTaskCheckInterval) {
      clearInterval(this.autoTaskCheckInterval);
    }
    
    this.autoTaskCheckInterval = setInterval(async () => {
      try {
        // Clean up stale duplicate prevention locks (older than 5 minutes)
        const now = Date.now();
        const lockTimeout = 5 * 60 * 1000; // 5 minutes
        for (const [key, timestamp] of this.duplicatePreventionLock.entries()) {
          if (now - timestamp > lockTimeout) {
            console.warn(`[TaskManager:${this.instanceId}] Cleaning up stale duplicate prevention lock: ${key}`);
            this.duplicatePreventionLock.delete(key);
          }
        }
        
        const tasks = await this.getAllTasks();
        
        const activeTasks = tasks.filter(task => 
          task && (task.status === 'pending' || task.status === 'processing')
        );
        
        const incompleteTask = tasks.filter(task => {
          if (!task || !task.progress) return false;
          // Exclude cancelled tasks from auto-recovery
          if (task.status === 'cancelled') return false;
          const isIncomplete = task.progress.current < task.progress.total;
          const hasValidStatus = task.status && ['pending', 'processing', 'failed'].includes(task.status);
          return isIncomplete && hasValidStatus;
        });
        
        const targetTasks = activeTasks.length > 0 ? activeTasks : incompleteTask;
        
        if (targetTasks.length > 0) {
          let forceRecoveredAny = false;
          for (const task of targetTasks) {
            if (task.processingInfo) {
              const lastHeartbeat = new Date(task.processingInfo.lastHeartbeat);
              const timeSinceHeartbeat = Date.now() - lastHeartbeat.getTime();
              
              if (timeSinceHeartbeat > 120000) {
                try {
                  task.processingInfo = null;
                  if (task.status !== 'failed') {
                    task.status = 'pending';
                  }
                  await this.saveTask(task);
                  forceRecoveredAny = true;
                } catch (error) {
                }
              }
            }
          }
          
          if (forceRecoveredAny) {
            await this.processNextTask();
            return;
          }
          
          if (!this.isProcessing) {
            await this.processNextTask();
          } else {
            const currentTask = targetTasks.find(task => task.id === this.currentlyProcessingTaskId);
            if (currentTask && currentTask.processingInfo) {
              const lastHeartbeat = new Date(currentTask.processingInfo.lastHeartbeat);
              const timeSinceHeartbeat = Date.now() - lastHeartbeat.getTime();
              
              if (timeSinceHeartbeat > 120000) {
                this.isProcessing = false;
                this.currentlyProcessingTaskId = null;
                await this.processNextTask();
              }
            } else if (currentTask) {
              this.isProcessing = false;
              this.currentlyProcessingTaskId = null;
              await this.processNextTask();
            }
          }
        }
      } catch (error) {
      }
    }, 30000);
  }

  stopAutoTaskCheck() {
    if (this.autoTaskCheckInterval) {
      clearInterval(this.autoTaskCheckInterval);
      this.autoTaskCheckInterval = null;
    }
  }

  async startTask(taskData) {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

    let sortedPrompts;
    if (taskData.config.selected_prompts && Array.isArray(taskData.config.selected_prompts) && taskData.config.selected_prompts.length > 0) {
      sortedPrompts = [...taskData.config.selected_prompts].sort((a, b) => {
        if (a.type === 'default' && b.type !== 'default') return -1;
        if (a.type !== 'default' && b.type === 'default') return 1;
        return 0;
      });
    } else {
      sortedPrompts = [{ type: 'default' }];
    }

    if (!sortedPrompts || !Array.isArray(sortedPrompts) || sortedPrompts.length === 0) {
      throw new Error("Failed to initialize prompts array - cannot proceed with task");
    }

    const newConfig = { ...taskData.config, selected_prompts: sortedPrompts };

    const totalTasks = newConfig.useNewApi 
      ? taskData.papers.length * newConfig.selected_prompts.length
      : taskData.papers.length;
    
    const task = {
      id: taskId,
      type: taskData.type,
      papers: taskData.papers,
      config: newConfig, 
      status: 'pending',
      progress: {
        current: 0,
        total: totalTasks,
        completed: [],
        failed: [],
        results: [],
        paperProgress: {
          currentPaperIndex: 0,
          totalPapers: taskData.papers.length
        },
        summaryProgress: {
          currentSummaryIndex: 0,
          totalSummaries: newConfig.useNewApi ? newConfig.selected_prompts.length : 1
        }
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await this.saveTask(task);
    
    this.activeTasks.set(taskId, task);
    
    const processingPromise = (async () => {
      try {
        await this.processTask(taskId);
      } catch (error) {
      }
    })();
    
    this.processTask(taskId).catch(error => {
    });
    
    return taskId;
  }

  async processTask(taskId) {
    if (this.currentlyProcessingTaskId === taskId) {
      return;
    }
    
    const task = this.activeTasks.get(taskId) || await this.getTask(taskId);
    if (!task) {
      this.isProcessing = false;
      this.processNextTask();
      return;
    }
    if (task.status === 'cancelled') {
      this.isProcessing = false;
      this.activeTasks.delete(taskId);
      this.processNextTask();
      return;
    }

    if (this.isProcessing && this.activeTasks.get(taskId)?.id !== taskId) {
      return;
    }
    
    this.currentlyProcessingTaskId = taskId;
    this.isProcessing = true;
    this.activeTasks.set(taskId, task);

    const heartbeatInterval = setInterval(() => {
      this.broadcastProgress(task);
    }, 60000);

    const keepAlivePromise = new Promise(resolve => {
      const keepAliveTimer = setInterval(() => {
        if (!this.isProcessing) {
          clearInterval(keepAliveTimer);
          resolve();
        }
      }, 30000);
    });

    try {
      if (task.status === 'pending') {
        task.status = 'processing';
        await this.saveTask(task);
        this.broadcastProgress(task);
      }

      if (task.config.useNewApi) {
        while (true) {
          const currentTaskState = await this.getTask(taskId);
          if (!currentTaskState || currentTaskState.status === 'cancelled') {
            break;
          }

          const hasMoreTasks = await this.processNextSummaryTask(currentTaskState);
          
          if (!hasMoreTasks) {
            await this.finalizeTask(taskId);
            break;
          }
          
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } else {
        while (true) {
          const currentTaskState = await this.getTask(taskId);
          if (!currentTaskState || currentTaskState.status === 'cancelled') {
            break;
          }

          const currentPaperIndex = currentTaskState.progress.current;
          
          if (currentPaperIndex >= currentTaskState.papers.length) {
            await this.finalizeTask(taskId);
            break;
          }

          const authToken = await this.getAuthTokenWithRetry();
          if (!authToken) {
            throw new Error('Authentication token could not be obtained after retries.');
          }

          const paperUrl = currentTaskState.papers[currentPaperIndex];

          try {
            const result = await this.processPaper(paperUrl, currentTaskState.config, authToken);
            currentTaskState.progress.completed.push({
              url: paperUrl,
              result: { message: result.message, user_paper_link_id: result.user_paper_link_id },
              index: currentPaperIndex,
              timestamp: new Date().toISOString()
            });
          } catch (error) {
            currentTaskState.progress.failed.push({
              url: paperUrl,
              error: error.message || 'Unknown error',
              index: currentPaperIndex,
              timestamp: new Date().toISOString()
            });
          }

          currentTaskState.progress.current = currentPaperIndex + 1;
          currentTaskState.updatedAt = new Date().toISOString();
          await this.saveTask(currentTaskState);
          this.broadcastProgress(currentTaskState);

          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

    } catch (error) {
      this.stopHeartbeat();
      
      const currentTask = await this.getTask(taskId);
      if (currentTask) {
        // Handle cancellation differently from other errors
        if (error.name === 'TaskCancelledError' || currentTask.status === 'cancelled') {
          console.log(`[TaskManager:${this.instanceId}] Task ${taskId} was cancelled, finishing gracefully`);
          currentTask.status = 'cancelled';
          currentTask.error = 'Task cancelled by user';
          currentTask.processingInfo = null;
          await this.saveTask(currentTask);
          this.broadcastProgress(currentTask);
          // No error notification for cancellation
        } else {
          currentTask.status = 'failed';
          currentTask.error = error.message;
          currentTask.processingInfo = null;
          await this.saveTask(currentTask);
          this.broadcastProgress(currentTask);
          
          this.showNotification('論文処理エラー', {
            body: `タスクID ${taskId.substring(0,8)}: ${error.message}`,
            icon: '/favicon.ico',
            tag: `task-error-${taskId}`,
            requireInteraction: true
          });
        }
      }
      
      if (this.currentlyProcessingTaskId === taskId) {
        this.currentlyProcessingTaskId = null;
      }
      
      this.isProcessing = false;
      this.activeTasks.delete(taskId);
      this.processNextTask();
    } finally {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      
      this.stopHeartbeat();
      
      if (this.currentlyProcessingTaskId === taskId) {
        this.currentlyProcessingTaskId = null;
      }
    }
  }

  async checkExistingSummary(paperUrl, selectedPrompt, authToken, backendUrl, config) {
    const arxivId = this.extractArxivId(paperUrl);
    const promptInfo = selectedPrompt.type === 'default' ? 'default' : `custom:${selectedPrompt.system_prompt_id}`;
    const modelInfo = `${config.provider}::${config.model}`;
    
    console.log(`[TaskManager:${this.instanceId}] Checking existing summary for ${arxivId} with prompt ${promptInfo} and model ${modelInfo}`);
    
    try {
      const checkUrl = `${backendUrl}/papers/check_existing_summary`;
      
      // Include all necessary parameters for proper skip condition checking
      const body = {
        url: paperUrl,
        system_prompt_id: selectedPrompt.type === 'custom' ? selectedPrompt.system_prompt_id : null,
        llm_provider: config.provider,
        llm_model_name: config.model,
        // Add missing parameters for complete skip condition checking
        config_overrides: {
          llm_name: config.provider,
          llm_model_name: config.model,
          rag_llm_temperature: config.temperature,
          rag_llm_top_p: config.top_p
        }
      };
      
      console.log(`[TaskManager:${this.instanceId}] Sending check request with body:`, body);
      
      const response = await this.authenticatedFetch(checkUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-App-Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        console.warn(`[TaskManager:${this.instanceId}] Check existing summary failed with status ${response.status}`);
        return { shouldSkip: false, reason: 'check_failed' };
      }

      const result = await response.json();
      console.log(`[TaskManager:${this.instanceId}] Check existing summary result:`, result);
      
      const exists = result.exists || false;
      const requiresRegeneration = result.requires_regeneration || false;
      
      // バックエンドで既存要約チェックと適切な処理を行うため、Service Workerでは常に処理を実行
      console.log(`[TaskManager:${this.instanceId}] Delegating to backend for ${arxivId} - existing summary check will be handled in generate_single_summary`);
      return { shouldSkip: false, reason: 'backend_handles_duplicates' };
      
    } catch (error) {
      console.error(`[TaskManager:${this.instanceId}] Error checking existing summary for ${arxivId}:`, error);
      return { shouldSkip: false, reason: 'error' };
    }
  }

  async processNextSummaryTask(task) {
    const totalPapers = task.papers.length;
    const totalPromptsPerPaper = task.config.selected_prompts.length;
    let currentTaskIndex = task.progress.current;
    
    const useParallelProcessing = task.config.useParallelProcessing && totalPromptsPerPaper > 1;
    const calculatedTotal = totalPapers * totalPromptsPerPaper;
    
    if (totalPromptsPerPaper === 0) {
      throw new Error("Selected prompts array is empty - task cannot proceed");
    }
    
    if (totalPapers === 0) {
      throw new Error("Papers array is empty - task cannot proceed");
    }
    
    const savedTask = await this.getTask(task.id);
    if (savedTask && savedTask.progress.current !== task.progress.current) {
      task.progress.current = savedTask.progress.current;
      currentTaskIndex = savedTask.progress.current;
    }
    
    const maxTasks = calculatedTotal;
    let foundTaskToProcess = false;
    let attempts = 0;
    const maxAttempts = maxTasks - currentTaskIndex;
    
    while (currentTaskIndex < maxTasks && attempts < maxAttempts) {
      let paperIndex, promptIndex;
      
      if (useParallelProcessing) {
        const completedPapers = Math.floor(currentTaskIndex / totalPromptsPerPaper);
        paperIndex = completedPapers;
        promptIndex = 0;
        
        if (paperIndex >= totalPapers) {
          break;
        }
      } else {
        paperIndex = Math.floor(currentTaskIndex / totalPromptsPerPaper);
        promptIndex = currentTaskIndex % totalPromptsPerPaper;
      }
      
      const paperUrl = task.papers[paperIndex];
      
      const authToken = await this.getAuthTokenWithRetry();
      if (!authToken) {
        throw new Error('Authentication token could not be obtained for existence check');
      }
      
      if (useParallelProcessing) {
        let hasIncompletePrompt = false;
        const promptCheckResults = [];
        
        for (let i = 0; i < totalPromptsPerPaper; i++) {
          const prompt = task.config.selected_prompts[i];
          console.log(`[TaskManager:${this.instanceId}] Checking prompt ${i} for paper ${paperUrl}:`, prompt);
          const checkResult = await this.checkExistingSummary(paperUrl, prompt, authToken, task.config.backendUrl, task.config);
          console.log(`[TaskManager:${this.instanceId}] Check result for prompt ${i}:`, checkResult);
          promptCheckResults.push({ prompt, checkResult, index: i });
          
          if (!checkResult.shouldSkip) {
            hasIncompletePrompt = true;
            console.log(`[TaskManager:${this.instanceId}] Found incomplete prompt for ${paperUrl}, will process`);
          }
        }
        
        if (hasIncompletePrompt) {
          foundTaskToProcess = true;
          break;
        } else {
          for (let i = 0; i < totalPromptsPerPaper; i++) {
            const { prompt, checkResult } = promptCheckResults[i];
            task.progress.completed.push({
              url: paperUrl,
              result: { message: `Summary already exists and up-to-date - skipped (${checkResult.reason})`, user_paper_link_id: null },
              index: currentTaskIndex + i,
              timestamp: new Date().toISOString(),
              promptName: prompt.type === 'default' ? 'デフォルトプロンプト' : `カスタムプロンプト (ID: ${prompt.system_prompt_id})`,
              promptType: prompt.type,
              skipped: true
            });
          }
          
          currentTaskIndex += totalPromptsPerPaper;
          attempts++;
          task.progress.current = currentTaskIndex;
        }
      } else {
        const selectedPrompt = task.config.selected_prompts[promptIndex];
        console.log(`[TaskManager:${this.instanceId}] Non-parallel: Checking prompt for paper ${paperUrl}:`, selectedPrompt);
        const checkResult = await this.checkExistingSummary(paperUrl, selectedPrompt, authToken, task.config.backendUrl, task.config);
        console.log(`[TaskManager:${this.instanceId}] Non-parallel: Check result:`, checkResult);
        
        if (!checkResult.shouldSkip) {
          foundTaskToProcess = true;
          console.log(`[TaskManager:${this.instanceId}] Non-parallel: Found task to process for ${paperUrl}`);
          break;
        } else {
          console.log(`[TaskManager:${this.instanceId}] Non-parallel: Skipping ${paperUrl} due to ${checkResult.reason}`);
          currentTaskIndex++;
          attempts++;
          
          task.progress.current = currentTaskIndex;
          task.progress.completed.push({
            url: paperUrl,
            result: { message: `Summary already exists and up-to-date - skipped (${checkResult.reason})`, user_paper_link_id: null },
            index: currentTaskIndex - 1,
            timestamp: new Date().toISOString(),
            promptName: selectedPrompt.type === 'default' ? 'デフォルトプロンプト' : `カスタムプロンプト (ID: ${selectedPrompt.system_prompt_id})`,
            promptType: selectedPrompt.type,
            skipped: true
          });
        }
      }
    }
    
    if (!foundTaskToProcess || currentTaskIndex >= maxTasks) {
      task.progress.current = maxTasks;
      await this.saveTask(task);
      this.broadcastProgress(task);
      return false;
    }
    
    let paperIndex, promptIndex;
    
    if (useParallelProcessing) {
      const completedPapers = Math.floor(currentTaskIndex / totalPromptsPerPaper);
      paperIndex = completedPapers;
      promptIndex = 0;
    } else {
      paperIndex = Math.floor(currentTaskIndex / totalPromptsPerPaper);
      promptIndex = currentTaskIndex % totalPromptsPerPaper;
    }
    
    const paperUrl = task.papers[paperIndex];
    const selectedPrompt = task.config.selected_prompts[promptIndex];
    
    const arxivId = this.extractArxivId(paperUrl);
    
    task.progress.paperProgress.currentPaperIndex = paperIndex;
    task.progress.summaryProgress.currentSummaryIndex = promptIndex;
    
    let promptName = 'デフォルトプロンプト';
    if (selectedPrompt.type === 'custom' && selectedPrompt.system_prompt_id) {
      promptName = `カスタムプロンプト (ID: ${selectedPrompt.system_prompt_id})`;
    }
    task.progress.summaryProgress.currentPromptName = promptName;
    task.progress.paperProgress.currentArxivId = arxivId;
    
    await this.saveTask(task);
    this.broadcastProgress(task);
    
    try {
      let currentTaskState = await this.getTask(task.id);
      if (!currentTaskState || currentTaskState.status === 'cancelled') {
        this.stopHeartbeat();
        return false;
      }

      const authToken = await this.getAuthTokenWithRetry();
      if (!authToken) {
        throw new Error('Authentication token could not be obtained');
      }
      
      let result;
      if (task.config.useParallelProcessing && task.config.selected_prompts.length > 1 && promptIndex === 0) {
        result = await this.processMultipleSummariesParallel(authToken, paperUrl, task.config, paperIndex);
        
        for (let i = 0; i < task.config.selected_prompts.length; i++) {
          const promptResult = result.summary_results[i];
          if (promptResult && !promptResult.error) {
            task.progress.completed.push({
              url: paperUrl,
              result: { 
                message: `Parallel summary generated: ${promptResult.prompt_name}`, 
                user_paper_link_id: result.user_paper_link_id 
              },
              index: currentTaskIndex + i,
              timestamp: new Date().toISOString(),
              promptName: promptResult.prompt_name,
              promptType: promptResult.prompt_type
            });
          } else {
            task.progress.failed.push({
              url: paperUrl,
              error: promptResult?.error || 'Unknown error in parallel processing',
              index: currentTaskIndex + i,
              timestamp: new Date().toISOString(),
              promptName: promptResult?.prompt_name || 'Unknown prompt',
              promptType: promptResult?.prompt_type || 'unknown'
            });
          }
        }
        
        task.progress.current = currentTaskIndex + totalPromptsPerPaper;
        
      } else if (!task.config.useParallelProcessing || task.config.selected_prompts.length === 1) {
        result = await this.processSingleSummary(paperUrl, selectedPrompt, task.config, authToken, paperIndex, promptIndex, task);
        
        task.progress.completed.push({
          url: paperUrl,
          result: { message: result.message, user_paper_link_id: result.user_paper_link_id },
          index: currentTaskIndex,
          timestamp: new Date().toISOString(),
          promptName: result.prompt_name,
          promptType: result.prompt_type
        });
        
        task.progress.current = currentTaskIndex + 1;
        
      } else {
        task.progress.current = currentTaskIndex + 1;
        task.updatedAt = new Date().toISOString();
        await this.saveTask(task);
        this.broadcastProgress(task);
        return task.progress.current < calculatedTotal;
      }
      
      currentTaskState = await this.getTask(task.id);
      if (!currentTaskState || currentTaskState.status === 'cancelled') {
        this.stopHeartbeat();
        return false;
      }
      
    } catch (error) {
      // Check if this is a cancellation error or if task was cancelled
      if (error.name === 'TaskCancelledError') {
        console.log(`[TaskManager:${this.instanceId}] Task was cancelled during API processing, stopping completely`);
        this.stopHeartbeat();
        return false;
      }
      
      const taskAfterError = await this.getTask(task.id);
      if (!taskAfterError || taskAfterError.status === 'cancelled') {
        console.log(`[TaskManager:${this.instanceId}] Task was cancelled, stopping processing completely`);
        this.stopHeartbeat();
        return false;
      }
      
      if (!task.config.useParallelProcessing || task.config.selected_prompts.length === 1) {
        task.progress.failed.push({
          url: paperUrl,
          error: error.message || 'Unknown error',
          index: currentTaskIndex,
          timestamp: new Date().toISOString(),
          promptName: task.progress.summaryProgress.currentPromptName,
          promptType: selectedPrompt.type
        });
        task.progress.current = currentTaskIndex + 1;
      } else {
        for (let i = 0; i < task.config.selected_prompts.length; i++) {
          task.progress.failed.push({
            url: paperUrl,
            error: error.message || 'Unknown error in parallel processing',
            index: currentTaskIndex + i,
            timestamp: new Date().toISOString(),
            promptName: task.config.selected_prompts[i]?.type === 'default' ? 'デフォルトプロンプト' : 'カスタムプロンプト',
            promptType: task.config.selected_prompts[i]?.type || 'unknown'
          });
        }
        task.progress.current = currentTaskIndex + task.config.selected_prompts.length;
      }
    }
    
    if (task.progress.total !== calculatedTotal) {
      task.progress.total = calculatedTotal;
    }
    
    if (!task.updatedAt || task.updatedAt < new Date(Date.now() - 1000).toISOString()) {
      task.updatedAt = new Date().toISOString();
      await this.saveTask(task);
      this.broadcastProgress(task);
    }
    
    const finalCheckTask = await this.getTask(task.id);
    if (!finalCheckTask || finalCheckTask.status === 'cancelled') {
      this.stopHeartbeat();
      return false;
    }

    const hasMoreTasks = task.progress.current < calculatedTotal;
    return hasMoreTasks;
  }
  extractArxivId(url) {
    const match = url.match(/arxiv\.org\/abs\/([^\/\?]+)/);
    return match ? match[1] : url;
  }

  async processSingleSummary(paperUrl, selectedPrompt, config, authToken, paperIndex, promptIndex, task) {
    const isFirstDefaultPrompt = promptIndex === 0 && selectedPrompt.type === 'default';
    
    const body = {
      url: paperUrl,
      system_prompt_id: selectedPrompt.type === 'custom' ? selectedPrompt.system_prompt_id : null,
      create_embedding: config.create_embeddings,
      config_overrides: {
        llm_name: config.provider,
        llm_model_name: config.model,
        rag_llm_temperature: config.temperature,
        rag_llm_top_p: config.top_p
      },
      current_paper_index: paperIndex,
      total_papers: task.papers.length,
      current_summary_index: promptIndex,
      total_summaries: config.selected_prompts.length,
      is_first_summary_for_paper: isFirstDefaultPrompt
    };

    const backendBaseUrl = config.backendUrl;
    if (!backendBaseUrl) {
      throw new Error(`backendUrl not found in task config for ${paperUrl}.`);
    }
    const apiUrl = `${backendBaseUrl}/papers/generate_single_summary`;

    const response = await this.authenticatedFetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      let errorDetail = 'Unknown error from backend';
      try {
        const errorData = await response.json();
        errorDetail = errorData.detail || JSON.stringify(errorData);
      } catch (e) {
        errorDetail = await response.text();
      }
      throw new Error(`Backend API Error (${response.status}): ${errorDetail}`);
    }

    const responseText = await response.text();
    if (!responseText) {
      return { message: "Success with empty response", user_paper_link_id: null };
    }
    
    try {
      const result = JSON.parse(responseText);
      
      // Check if task is still active after API completion
      const taskAfterAPI = await this.getTask(this.currentlyProcessingTaskId);
      if (!taskAfterAPI || taskAfterAPI.status === 'cancelled') {
        console.log(`[TaskManager:${this.instanceId}] Task was cancelled during single summary API call, discarding result`);
        const cancelError = new Error('Task was cancelled during processing');
        cancelError.name = 'TaskCancelledError';
        throw cancelError;
      }
      
      return result;
    } catch (e) {
      throw new Error(`Failed to parse JSON response from backend. Response: ${responseText}`);
    }
  }

  async processMultipleSummariesParallel(authToken, paperUrl, config, paperIndex) {
    console.log(`[TaskManager:${this.instanceId}] Processing multiple summaries for ${paperUrl} (paper index: ${paperIndex})`);
    
    // Temporarily disable duplicate prevention to debug checkExistingSummary
    console.log(`[TaskManager:${this.instanceId}] Duplicate prevention temporarily disabled for debugging`);
    
    try {
      let embeddingTargetString = "default_only";
      if (config.embedding_target === "custom_only") {
        embeddingTargetString = "custom_only";
      } else if (config.embedding_target === "both") {
        embeddingTargetString = "both";
      }

      const body = {
        url: paperUrl,
        selected_prompts: config.selected_prompts || [{ type: "default" }],
        create_embeddings: config.create_embeddings !== false,
        embedding_target: embeddingTargetString,
        config_overrides: {
          llm_name: config.provider,
          llm_model_name: config.model,
          rag_llm_temperature: config.temperature,
          rag_llm_top_p: config.top_p
        },
        current_paper_index: paperIndex,
        total_papers: this.activeTasks.get(this.currentlyProcessingTaskId)?.papers?.length || 1,
        instance_id: this.instanceId  // Add instance ID for backend tracking
      };

      const backendBaseUrl = config.backendUrl;
      if (!backendBaseUrl) {
        throw new Error(`backendUrl not found in task config for ${paperUrl}.`);
      }
      const apiUrl = `${backendBaseUrl}/papers/generate_multiple_summaries_parallel`;

      console.log(`[TaskManager:${this.instanceId}] Sending parallel request to ${apiUrl}`);
      const response = await this.authenticatedFetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-App-Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        let errorDetail = 'Unknown error from backend';
        try {
          const errorData = await response.json();
          errorDetail = errorData.detail || JSON.stringify(errorData);
        } catch (e) {
          errorDetail = await response.text();
        }
        throw new Error(`Backend API Error (${response.status}): ${errorDetail}`);
      }

      const responseText = await response.text();
      if (!responseText) {
        return { message: "Success with empty response", user_paper_link_id: null };
      }
      
      try {
        const result = JSON.parse(responseText);
        
        // Check if task is still active after API completion
        const taskAfterAPI = await this.getTask(this.currentlyProcessingTaskId);
        if (!taskAfterAPI || taskAfterAPI.status === 'cancelled') {
          console.log(`[TaskManager:${this.instanceId}] Task was cancelled during API call, discarding result`);
          const cancelError = new Error('Task was cancelled during processing');
          cancelError.name = 'TaskCancelledError';
          throw cancelError;
        }
        
        console.log(`[TaskManager:${this.instanceId}] Parallel processing completed for ${paperUrl}`);
        return result;
      } catch (e) {
        throw new Error(`Failed to parse JSON response from backend. Response: ${responseText}`);
      }
    } finally {
      // Duplicate prevention temporarily disabled for debugging
      console.log(`[TaskManager:${this.instanceId}] Processing completed for ${paperUrl}`);
    }
  }
  
  startHeartbeat(taskId) {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    this.heartbeatInterval = setInterval(async () => {
      try {
        const task = await this.getTask(taskId);
        if (task && task.status === 'processing' && task.processingInfo?.processId === this.instanceId) {
          this.heartbeatCount++;
          task.processingInfo.lastHeartbeat = new Date().toISOString();
          task.processingInfo.heartbeatCount = this.heartbeatCount;
          await this.saveTask(task);
        } else {
          this.stopHeartbeat();
        }
      } catch (error) {
      }
    }, 15000);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      this.heartbeatCount = 0;
    }
  }

  async acquireTaskLock(taskId, timeoutMs = 5000) {
    const startTime = Date.now();
    const maxRetries = 3;
    
    for (let retry = 0; retry < maxRetries; retry++) {
      try {
        const lockResult = await this.attemptAtomicLockAcquisition(taskId);
        if (lockResult.success) {
          console.log(`[TaskManager:${this.instanceId}] Successfully acquired lock for task ${taskId} (attempt ${retry + 1})`);
          return true;
        }
        
        if (lockResult.reason === 'already_processing_by_self') {
          console.log(`[TaskManager:${this.instanceId}] Already processing task ${taskId}`);
          return true;
        }
        
        if (lockResult.reason === 'invalid_task') {
          console.log(`[TaskManager:${this.instanceId}] Task ${taskId} is not eligible for processing`);
          return false;
        }
        
        // Check for timeout
        if (Date.now() - startTime > timeoutMs) {
          console.warn(`[TaskManager:${this.instanceId}] Lock acquisition timeout for task ${taskId}`);
          return false;
        }
        
        // Wait before retry with exponential backoff
        const waitTime = Math.min(100 * Math.pow(2, retry), 1000);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
      } catch (error) {
        console.error(`[TaskManager:${this.instanceId}] Lock acquisition error for task ${taskId} (attempt ${retry + 1}):`, error);
        if (retry === maxRetries - 1) {
          return false;
        }
      }
    }
    
    return false;
  }

  async attemptAtomicLockAcquisition(taskId) {
    const db = await openDB();
    
    return new Promise((resolve) => {
      const transaction = db.transaction(['tasks'], 'readwrite');
      const store = transaction.objectStore('tasks');
      
      transaction.oncomplete = () => {
        resolve({ success: true });
      };
      
      transaction.onerror = () => {
        resolve({ success: false, reason: 'transaction_error' });
      };
      
      transaction.onabort = () => {
        resolve({ success: false, reason: 'transaction_aborted' });
      };
      
      const getRequest = store.get(taskId);
      
      getRequest.onsuccess = () => {
        const task = getRequest.result;
        
        if (!task) {
          resolve({ success: false, reason: 'task_not_found' });
          return;
        }
        
        if (task.status === 'cancelled' || task.status === 'completed' || task.status === 'failed') {
          resolve({ success: false, reason: 'invalid_task' });
          return;
        }
        
        const now = new Date();
        const forceThreshold = new Date(now.getTime() - 2 * 60 * 1000); // 2 minutes
        const heartbeatThreshold = new Date(now.getTime() - 4 * 60 * 1000); // 4 minutes
        
        // Check if already processing by this instance
        if (task.processingInfo?.processId === this.instanceId) {
          resolve({ success: false, reason: 'already_processing_by_self' });
          return;
        }
        
        let canAcquireLock = false;
        let forceAcquisition = false;
        
        if (!task.processingInfo || !task.processingInfo.processId) {
          canAcquireLock = true;
        } else {
          const lastHeartbeat = new Date(task.processingInfo.lastHeartbeat);
          
          if (lastHeartbeat < forceThreshold) {
            canAcquireLock = true;
            forceAcquisition = true;
            console.warn(`[TaskManager:${this.instanceId}] Force acquiring lock for task ${taskId} - heartbeat too old (${Math.round((now - lastHeartbeat) / 1000)}s)`);
          } else if (lastHeartbeat < heartbeatThreshold) {
            canAcquireLock = true;
            console.log(`[TaskManager:${this.instanceId}] Acquiring lock for task ${taskId} - heartbeat stale (${Math.round((now - lastHeartbeat) / 1000)}s)`);
          } else {
            // Check for duplicate instance IDs (safety check)
            if (task.processingInfo.processId !== this.instanceId) {
              resolve({ success: false, reason: 'locked_by_other' });
              return;
            }
          }
        }
        
        if (canAcquireLock) {
          // Update task with new processing info
          task.processingInfo = {
            processId: this.instanceId,
            lastHeartbeat: now.toISOString(),
            startedAt: now.toISOString(),
            heartbeatCount: 0,
            forceAcquired: forceAcquisition
          };
          task.status = 'processing';
          task.updatedAt = now.toISOString();
          
          const putRequest = store.put(task);
          putRequest.onerror = () => {
            resolve({ success: false, reason: 'put_error' });
          };
          // Success will be handled by transaction.oncomplete
        } else {
          resolve({ success: false, reason: 'cannot_acquire' });
        }
      };
      
      getRequest.onerror = () => {
        resolve({ success: false, reason: 'get_error' });
      };
    });
  }
  
  async processNextTask() {
    if (this.isProcessing){
      return;
    }
    
    const tasks = await this.getAllTasks();
    
    const validTasks = tasks.filter(t => t.status === 'pending' || t.status === 'processing');
    const cancelledTasks = tasks.filter(t => t.status === 'cancelled');
    
    const processingTasks = validTasks.filter(t => t.status === 'processing');
    for (const task of processingTasks) {
      const lockAcquired = await this.acquireTaskLock(task.id);
      if (lockAcquired) {
        this.activeTasks.set(task.id, task);
        this.isProcessing = true;
        
        this.startHeartbeat(task.id);
        
        this.processTask(task.id).catch(err => {
          this.stopHeartbeat();
          this.isProcessing = false;
          // Don't retry if task was cancelled
          if (err.name !== 'TaskCancelledError') {
            setTimeout(() => this.processNextTask(), 2000);
          }
        });
        return;
      }
    }
    
    const pendingTask = validTasks.find(t => t.status === 'pending');
    if (pendingTask) {
      const lockAcquired = await this.acquireTaskLock(pendingTask.id);
      if (lockAcquired) {
        this.activeTasks.set(pendingTask.id, pendingTask);
        this.isProcessing = true;
        
        this.startHeartbeat(pendingTask.id);
        
        this.processTask(pendingTask.id).catch(err => {
          this.stopHeartbeat();
          this.isProcessing = false;
          // Don't retry if task was cancelled
          if (err.name !== 'TaskCancelledError') {
            setTimeout(() => this.processNextTask(), 2000);
          }
        });
        return;
      }
    }
  }


  async finalizeTask(taskId) {
    const task = await this.getTask(taskId);
    if (!task) {
      return;
    }

    // Don't change status if task is already cancelled
    if (task.status === 'cancelled') {
      console.log(`[TaskManager:${this.instanceId}] Task ${taskId} was cancelled, keeping cancelled status`);
      // Keep existing cancelled status and error message
    } else if (task.progress.current < task.progress.total) {
      task.status = 'failed';
      task.error = 'Task finalized prematurely without completing all items.';
    } else {
      task.status = 'completed';
    }

    this.stopHeartbeat();

    task.updatedAt = new Date().toISOString();
    task.processingInfo = null;
    await this.saveTask(task);
    this.broadcastProgress(task);

    if (task.status === 'completed') {
      this.showNotification('論文処理完了', {
        body: `タスクID ${taskId.substring(0,8)}: ${task.progress.completed.length}件成功, ${task.progress.failed.length}件失敗。`,
        icon: '/favicon.ico',
        tag: `task-completed-${taskId}`,
        requireInteraction: true
      });
    } else if (task.status === 'failed') {
      this.showNotification('論文処理失敗', {
        body: `タスクID ${taskId.substring(0,8)}: 処理が途中で失敗しました。詳細はアプリで確認してください。`,
        icon: '/favicon.ico',
        tag: `task-failed-${taskId}`,
        requireInteraction: true
      });
    }
    // No notification for cancelled tasks

    if (this.currentlyProcessingTaskId === taskId) {
      this.currentlyProcessingTaskId = null;
    }
    
    this.isProcessing = false;
    this.activeTasks.delete(taskId);
    
    this.processNextTask();
  }



  async processPaper(paperUrl, config, authToken) {
    const body = {
      url: paperUrl,
      config_overrides: {
        llm_name: config.provider,
        llm_model_name: config.model,
        rag_llm_temperature: config.temperature,
        rag_llm_top_p: config.top_p
      },
      prompt_mode: config.prompt_mode,
      selected_prompts: config.selected_prompts,
      create_embeddings: config.create_embeddings,
      embedding_target: config.embedding_target,
      embedding_target_system_prompt_id: config.embedding_target_system_prompt_id
    };

    if (!authToken) {
        throw new Error('Authentication token not provided for processing paper.');
    }

    const backendBaseUrl = config.backendUrl;
    if (!backendBaseUrl) {
        throw new Error(`backendUrl not found in task config for ${paperUrl}.`);
    }
    const apiUrl = `${backendBaseUrl}/papers/import_from_arxiv`;

    const response = await this.authenticatedFetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      let errorDetail = 'Unknown error from backend';
      try {
        const errorData = await response.json();
        errorDetail = errorData.detail || JSON.stringify(errorData);
      } catch (e) {
        errorDetail = await response.text();
      }
      throw new Error(`Backend API Error (${response.status}): ${errorDetail}`);
    }

    const responseText = await response.text();
    if (!responseText) {
        return { message: "Success with empty response", user_paper_link_id: null };
    }
    try {
        return JSON.parse(responseText);
    } catch (e) {
        throw new Error(`Failed to parse JSON response from backend. Response: ${responseText}`);
    }
  }
  async getAuthTokenWithRetry(maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const token = await this.getAuthToken();
        if (token) {
          return token;
        }
      } catch (error) {
        if (attempt === maxRetries) {
          throw new Error(`Failed to obtain auth token after ${maxRetries} attempts: ${error.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  async getCachedAuthToken() {
    try {
      const db = await openDB();
      const transaction = db.transaction(['tokenCache'], 'readonly');
      const store = transaction.objectStore('tokenCache');
      const result = await new Promise((resolve, reject) => {
        const request = store.get('authToken');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      
      if (!result) {
        return null;
      }
      
      if (!this.isTokenValid(result.token)) {
        await this.clearCachedAuthToken();
        return null;
      }
      
      return result.token;
    } catch (error) {
      return null;
    }
  }
  
  async setCachedAuthToken(token, expiresAt) {
    try {
      const db = await openDB();
      const transaction = db.transaction(['tokenCache'], 'readwrite');
      const store = transaction.objectStore('tokenCache');
      
      await new Promise((resolve, reject) => {
        const request = store.put({
          id: 'authToken',
          token: token,
          expiresAt: expiresAt,
          cachedAt: Date.now()
        });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      
    } catch (error) {
    }
  }
  
  async clearCachedAuthToken() {
    try {
      const db = await openDB();
      const transaction = db.transaction(['tokenCache'], 'readwrite');
      const store = transaction.objectStore('tokenCache');
      
      await new Promise((resolve, reject) => {
        const request = store.delete('authToken');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      
    } catch (error) {
    }
  }
  
  async authenticatedFetch(url, options, maxRetries = 2) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, options);
        
        if (response.status === 401 && attempt < maxRetries) {
          await this.clearCachedAuthToken();
          
          const newToken = await this.getAuthTokenWithRetry();
          if (!newToken) {
            throw new Error('Failed to obtain new auth token after 401 error');
          }
          
          const newOptions = {
            ...options,
            headers: {
              ...options.headers,
              'X-App-Authorization': `Bearer ${newToken}`
            }
          };
          
          continue;
        }
        
        if (response.status >= 500 && response.status < 600 && attempt < maxRetries) {
          const retryDelay = Math.min(1000 * Math.pow(2, attempt), 10000);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }
        
        return response;
      } catch (error) {
        if (attempt < maxRetries && this.isRetryableError(error)) {
          const retryDelay = Math.min(1000 * Math.pow(2, attempt), 10000);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }
        
        if (attempt === maxRetries) {
          throw error;
        }
      }
    }
  }

  isRetryableError(error) {
    return error.name === 'TypeError' || 
           error.message.includes('Failed to fetch') ||
           error.message.includes('NetworkError') ||
           error.message.includes('network') ||
           error.code === 'NETWORK_ERROR';
  }

  getValidTaskStates() {
    return ['pending', 'processing', 'completed', 'failed', 'cancelled'];
  }
  
  isValidStateTransition(currentState, newState) {
    const validTransitions = {
      'pending': ['processing', 'cancelled'],
      'processing': ['completed', 'failed', 'cancelled'],
      'completed': ['cancelled'],
      'failed': ['pending', 'cancelled'],
      'cancelled': []
    };
    
    return validTransitions[currentState]?.includes(newState) || false;
  }
  
  async updateTaskState(taskId, newState, additionalData = {}) {
    try {
      const task = await this.getTask(taskId);
      if (!task) {
        return false;
      }
      
      if (!this.isValidStateTransition(task.status, newState)) {
        return false;
      }
      
      const previousState = task.status;
      task.status = newState;
      task.updatedAt = new Date().toISOString();
      
      Object.assign(task, additionalData);
      
      switch (newState) {
        case 'processing':
          task.processingInfo = {
            processId: this.instanceId,
            startedAt: new Date().toISOString(),
            lastHeartbeat: new Date().toISOString()
          };
          this.currentlyProcessingTaskId = taskId;
          break;
          
        case 'completed':
        case 'failed':
        case 'cancelled':
          task.processingInfo = null;
          if (this.currentlyProcessingTaskId === taskId) {
            this.currentlyProcessingTaskId = null;
          }
          break;
      }
      
      await this.saveTask(task);
      this.broadcastProgress(task);
      
      return true;
    } catch (error) {
      return false;
    }
  }
  
  validateTaskIntegrity(task) {
    const errors = [];
    
    if (!task.id) {
      errors.push('Missing task ID');
    }
    
    if (!this.getValidTaskStates().includes(task.status)) {
      errors.push(`Invalid task status: ${task.status}`);
    }
    
    if (!task.progress || typeof task.progress.current !== 'number' || typeof task.progress.total !== 'number') {
      errors.push('Invalid progress data');
    }
    
    if (task.progress.current < 0 || task.progress.current > task.progress.total) {
      errors.push(`Invalid progress values: ${task.progress.current}/${task.progress.total}`);
    }
    
    if (!task.createdAt || !task.updatedAt) {
      errors.push('Missing timestamp data');
    }
    
    return {
      isValid: errors.length === 0,
      errors: errors
    };
  }

  getTokenExpiry(token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp * 1000;
    } catch (error) {
      return null;
    }
  }

  isTokenValid(token) {
    if (!token) {
      return false;
    }
    
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return false;
      }
      
      const expiresAt = this.getTokenExpiry(token);
      if (!expiresAt) {
        return false;
      }
      
      const bufferTime = 5 * 60 * 1000;
      const now = Date.now();
      const isValid = now < (expiresAt - bufferTime);
      
      return isValid;
    } catch (error) {
      return false;
    }
  }

  async getAuthToken() {
    const messageId = Date.now() + Math.random();
    
    const cachedToken = await this.getCachedAuthToken();
    if (cachedToken) {
      return cachedToken;
    }
    
    return new Promise((resolve, reject) => {
      const timeoutDuration = 60000;
      const timeoutId = setTimeout(async () => {
        this.authTokenPromises.delete(messageId);
        
        const fallbackToken = await this.getCachedAuthToken();
        if (fallbackToken) {
          resolve(fallbackToken);
        } else {
          reject(new Error('Auth token request timeout during heavy processing and no cached token available'));
        }
      }, timeoutDuration);
      
      this.authTokenPromises.set(messageId, { resolve, reject, timeoutId });
      
      self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(async clients => {
        if (clients.length === 0) {
          this.authTokenPromises.delete(messageId);
          clearTimeout(timeoutId);
          
          const fallbackToken = await this.getCachedAuthToken();
          if (fallbackToken) {
            resolve(fallbackToken);
          } else {
            reject(new Error('No clients available for auth token and no cached token available'));
          }
          return;
        }
        
        let requestSent = false;
        clients.forEach(client => {
          client.postMessage({
            type: 'REQUEST_AUTH_TOKEN',
            messageId: messageId
          });
          requestSent = true;
        });
        if (!requestSent) {
            this.authTokenPromises.delete(messageId);
            clearTimeout(timeoutId);
            
            const fallbackToken = await this.getCachedAuthToken();
            if (fallbackToken) {
              resolve(fallbackToken);
            } else {
              reject(new Error('Failed to send message to any client for auth token and no cached token available'));
            }
        }
      }).catch(async err => {
        this.authTokenPromises.delete(messageId);
        clearTimeout(timeoutId);
        
        const fallbackToken = await this.getCachedAuthToken();
        if (fallbackToken) {
          resolve(fallbackToken);
        } else {
          reject(new Error('Error finding clients for auth token request and no cached token available'));
        }
      });
    });
  }

  async handleAuthTokenResponse(messageId, token) {
    if (token) {
      try {
        const expiresAt = this.getTokenExpiry(token);
        if (expiresAt) {
          await this.setCachedAuthToken(token, expiresAt);
        } else {
          const fallbackExpiry = Date.now() + (24 * 60 * 60 * 1000);
          await this.setCachedAuthToken(token, fallbackExpiry);
        }
      } catch (error) {
      }
    }
    
    const pending = this.authTokenPromises.get(messageId);
    if (pending) {
      clearTimeout(pending.timeoutId);
      this.authTokenPromises.delete(messageId);
      pending.resolve(token);
    }
  }

  async cancelTask(taskId) {
    console.log(`[TaskManager:${this.instanceId}] Cancelling task ${taskId}`);
    
    const task = await this.getTask(taskId);
    
    if (!task) {
      console.log(`[TaskManager:${this.instanceId}] Task ${taskId} not found for cancellation`);
      return;
    }
    
    if (task.status === 'cancelled') {
      console.log(`[TaskManager:${this.instanceId}] Task ${taskId} already cancelled`);
      return;
    }
    
    if (task && (task.status === 'pending' || task.status === 'processing')) {
      // Force release lock regardless of who owns it
      await this.forceReleaseLock(taskId);
      
      // Clean up local state if this instance was processing
      if (task.processingInfo?.processId === this.instanceId) {
        this.stopHeartbeat();
        this.isProcessing = false;
        this.activeTasks.delete(taskId);
        
        if (this.currentlyProcessingTaskId === taskId) {
          this.currentlyProcessingTaskId = null;
        }
      }
      
      // Update task status
      task.status = 'cancelled';
      task.updatedAt = new Date().toISOString();
      task.processingInfo = null;
      
      await this.saveTask(task);
      this.broadcastProgress(task);
      
      console.log(`[TaskManager:${this.instanceId}] Task ${taskId} cancelled successfully`);
      
      // Broadcast cancellation to all instances
      this.broadcastTaskCancellation(taskId);
    }
  }

  async forceReleaseLock(taskId) {
    try {
      const db = await openDB();
      const transaction = db.transaction(['tasks'], 'readwrite');
      const store = transaction.objectStore('tasks');
      
      const task = await new Promise((resolve, reject) => {
        const request = store.get(taskId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      
      if (task && task.processingInfo) {
        console.log(`[TaskManager:${this.instanceId}] Force releasing lock for task ${taskId} from instance ${task.processingInfo.processId}`);
        task.processingInfo = null;
        
        await new Promise((resolve, reject) => {
          const request = store.put(task);
          request.onsuccess = resolve;
          request.onerror = () => reject(request.error);
        });
      }
    } catch (error) {
      console.error(`[TaskManager:${this.instanceId}] Failed to force release lock for task ${taskId}:`, error);
    }
  }

  broadcastTaskCancellation(taskId) {
    // Broadcast to all Service Worker instances
    self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(clients => {
      clients.forEach(client => {
        client.postMessage({
          type: 'TASK_CANCELLED_BROADCAST',
          taskId: taskId,
          fromInstance: this.instanceId
        });
      });
    });
  }

  async saveTask(task, retryCount = 0) {
    try {
      const db = await openDB();
      const transaction = db.transaction(['tasks'], 'readwrite');
      const store = transaction.objectStore('tasks');
      const plainTask = JSON.parse(JSON.stringify(task));
      await new Promise((resolve, reject) => {
        const request = store.put(plainTask);
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      if (retryCount < 2) {
        const retryDelay = 1000 * (retryCount + 1);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        return this.saveTask(task, retryCount + 1);
      }
      
      this.activeTasks.set(task.id, task);
      
      throw new Error(`IndexedDB save failed for task ${task.id}, using memory fallback`);
    }
  }

  async getTask(taskId) {
    try {
      const db = await openDB();
      const transaction = db.transaction(['tasks'], 'readonly');
      const store = transaction.objectStore('tasks');
      
      return new Promise((resolve, reject) => {
        const request = store.get(taskId);
        request.onsuccess = () => {
          const result = request.result;
          resolve(result ? JSON.parse(JSON.stringify(result)) : null);
        };
        request.onerror = (event) => {
          reject(request.error);
        };
      });
    } catch (error) {
      const memoryTask = this.activeTasks.get(taskId);
      if (memoryTask) {
        return JSON.parse(JSON.stringify(memoryTask));
      }
      
      return null;
    }
  }

  async getAllTasks() {
    try {
      const db = await openDB();
      const transaction = db.transaction(['tasks'], 'readonly');
      const store = transaction.objectStore('tasks');
      
      return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => {
          const results = request.result || [];
          resolve(results.map(task => JSON.parse(JSON.stringify(task))));
        };
        request.onerror = (event) => {
          reject(request.error);
        };
      });
    } catch (error) {
      return [];
    }
  }

  broadcastProgress(task) {
    const skippedCount = task.progress.completed.filter(c => c.skipped).length;
    const actuallyProcessedCount = task.progress.completed.filter(c => !c.skipped).length;
    
    if (skippedCount > 0) {
      const skipReasons = {};
      task.progress.completed.filter(c => c.skipped).forEach(c => {
        const message = c.result?.message || 'unknown';
        if (message.includes('up_to_date')) skipReasons.up_to_date = (skipReasons.up_to_date || 0) + 1;
        else if (message.includes('prompt_updated')) skipReasons.prompt_updated = (skipReasons.prompt_updated || 0) + 1;
        else skipReasons.other = (skipReasons.other || 0) + 1;
      });
    }
    
    self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(clients => {
      clients.forEach(client => {
        client.postMessage({
          type: 'TASK_PROGRESS',
          task: JSON.parse(JSON.stringify(task))
        });
      });
    });
  }

  showNotification(title, options) {
    if (Notification.permission === 'granted') {
      self.registration.showNotification(title, options)
        .then(() => {})
        .catch(err => {});
    }
  }

  async generateTaskSummary(taskId) {
    try {
      const task = await this.getTask(taskId);
      if (!task) {
        return `Task ${taskId} not found`;
      }

      const totalTasks = task.papers.length * task.config.selected_prompts.length;
      const skippedCount = task.progress.completed.filter(c => c.skipped).length;
      const processedCount = task.progress.completed.filter(c => !c.skipped).length;
      const failedCount = task.progress.failed.length;
      
      const summary = [
        `📋 Task Summary: ${taskId.substring(0, 8)}...`,
        `📊 Status: ${task.status}`,
        `📈 Progress: ${task.progress.current}/${totalTasks} (${Math.round(task.progress.current / totalTasks * 100)}%)`,
        `✅ Processed: ${processedCount}`,
        `⏭️ Skipped: ${skippedCount}`,
        `❌ Failed: ${failedCount}`,
        `📄 Papers: ${task.papers.length}`,
        `🎯 Prompts per paper: ${task.config.selected_prompts.length}`,
        `⚙️ Use New API: ${task.config.useNewApi ? 'Yes' : 'No'}`,
        `🔒 Processing: ${this.isProcessing ? 'Yes' : 'No'}`,
        `🆔 Current Processing Task: ${this.currentlyProcessingTaskId || 'None'}`
      ];

      return summary.join('\n');
    } catch (error) {
      return `Error generating summary: ${error.message}`;
    }
  }


  async resumeTaskProcessing(taskId) {
    try {
      if (!taskId) {
        const allTasks = await this.getAllTasks();
        const activeTasks = allTasks.filter(task => 
          task && (task.status === 'pending' || task.status === 'processing')
        );
        
        if (activeTasks.length > 0) {
          const firstActiveTask = activeTasks[0];
          return await this.resumeTaskProcessing(firstActiveTask.id);
        } else {
          return;
        }
      }
      
      const task = await this.getTask(taskId);
      
      if (!task) {
        throw new Error(`Task ${taskId} not found`);
      }

      if (task.status === 'cancelled') {
        return;
      }

      if (task.status !== 'pending' && task.status !== 'processing' && task.status !== 'failed') {
        return;
      }

      if (task.status === 'failed') {
        task.status = 'pending';
        task.error = null;
        await this.saveTask(task);
      }

      const lockAcquired = await this.acquireTaskLock(taskId);
      if (lockAcquired) {
        this.activeTasks.set(taskId, task);
        this.isProcessing = true;
        
        this.startHeartbeat(taskId);
        
        setTimeout(() => {
          this.processTask(taskId).catch(error => {
            this.stopHeartbeat();
            this.isProcessing = false;
            setTimeout(() => this.processNextTask(), 1000);
          });
        }, 100);
        
      } else {
        setTimeout(() => {
          if (!this.isProcessing) {
            this.processNextTask();
          }
        }, 500);
      }
      
    } catch (error) {
      setTimeout(() => {
        if (!this.isProcessing) {
          this.processNextTask();
        }
      }, 1000);
      
      throw error;
    }
  }
}