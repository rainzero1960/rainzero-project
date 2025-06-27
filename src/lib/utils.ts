import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { getSession } from "next-auth/react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * X-App-Authorizationヘッダーを含むAPI呼び出し用のヘッダーを作成
 */
export async function createApiHeaders(): Promise<HeadersInit> {
  const session = await getSession();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };
  
  if (session?.accessToken) {
    headers["X-App-Authorization"] = `Bearer ${session.accessToken}`;
  }
  
  return headers;
}

/**
 * 認証付きのfetch呼び出しを行う共通関数
 */
export async function authenticatedFetch(
  url: string, 
  options: RequestInit = {}
): Promise<Response> {
  const headers = await createApiHeaders();
  
  return fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...options.headers,
    },
  });
}
