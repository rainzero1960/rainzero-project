// src/types/next-auth.d.ts
import { DefaultSession, DefaultUser } from "next-auth";
import { DefaultJWT } from "next-auth/jwt";

declare module "next-auth" {
  interface Session extends DefaultSession {
    accessToken?: string;
    userId?: number;
    error?: string; // エラー情報用
    user?: { // user オブジェクトを拡張
      id?: string | null; // NextAuthのUser.idはstringの場合がある
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }

  interface User extends DefaultUser {
    accessToken?: string;
    accessTokenExpires?: number; // アクセストークンの有効期限 (ミリ秒)
    userId?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    accessToken?: string;
    userId?: number;
    accessTokenExpires?: number;
    error?: string;
    // name?: string | null; // JWTにnameを含める場合
    // sub?: string | null; // JWTにidを含める場合
  }
}