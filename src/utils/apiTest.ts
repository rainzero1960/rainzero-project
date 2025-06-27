import { authenticatedFetch } from '@/lib/utils';

const BACK = process.env.NEXT_PUBLIC_BACKEND_URL;

export async function testBackendConnection() {
  try {
    console.log('[API Test] Testing backend connection...');
    console.log('[API Test] BACK URL:', BACK);
    
    // 1. Basic ping test
    const pingResponse = await fetch(`${BACK}/ping`);
    console.log('[API Test] Ping response:', pingResponse.status, pingResponse.ok);
    
    if (pingResponse.ok) {
      const pingData = await pingResponse.json();
      console.log('[API Test] Ping data:', pingData);
    }
    
    // 2. System prompts router test
    const testResponse = await authenticatedFetch(`${BACK}/system_prompts/test`);
    console.log('[API Test] System prompts test response:', testResponse.status, testResponse.ok);
    
    if (testResponse.ok) {
      const testData = await testResponse.json();
      console.log('[API Test] System prompts test data:', testData);
    } else {
      const errorText = await testResponse.text();
      console.log('[API Test] System prompts test error:', errorText);
    }
    
    // 3. Available prompts test
    const promptsResponse = await authenticatedFetch(`${BACK}/system_prompts/available-for-summary`);
    console.log('[API Test] Available prompts response:', promptsResponse.status, promptsResponse.ok);
    
    if (promptsResponse.ok) {
      const promptsData = await promptsResponse.json();
      console.log('[API Test] Available prompts data:', promptsData);
    } else {
      const errorText = await promptsResponse.text();
      console.log('[API Test] Available prompts error:', errorText);
    }
    
  } catch (error) {
    console.error('[API Test] Connection test failed:', error);
  }
}

// Global function for manual testing
if (typeof window !== 'undefined') {
  (window as Window & { testBackendConnection?: typeof testBackendConnection }).testBackendConnection = testBackendConnection;
}