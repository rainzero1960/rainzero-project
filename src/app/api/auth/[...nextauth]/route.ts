// src/app/api/auth/[...nextauth]/route.ts
import NextAuth, { NextAuthOptions, User as NextAuthUser } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { jwtDecode } from "jwt-decode";

interface DecodedAccessToken {
  sub: string; // username
  user_id: number;
  exp: number; // expiration time (seconds since epoch)
}

// NextAuthのUser型を拡張
interface ExtendedUser extends NextAuthUser {
  accessToken?: string;
  accessTokenExpires?: number; // ミリ秒単位の有効期限
  userId?: number;
}

const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials): Promise<ExtendedUser | null> {
        if (!credentials?.username || !credentials?.password) {
          return null;
        }
        try {
          const res = await fetch(
            `${process.env.NEXT_PUBLIC_BACKEND_URL}/auth/token`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({
                username: credentials.username,
                password: credentials.password,
              }),
            }
          );

          if (!res.ok) {
            const errorText = await res.text();
            console.error("Auth API error:", res.status, errorText);
            // エラーメッセージをフロントに伝えるために、エラーオブジェクトをスローする
            // NextAuthはこれをキャッチして error パラメータとしてリダイレクトURLに付与する
            throw new Error(JSON.parse(errorText).detail || "Invalid credentials");
          }

          const tokenData = await res.json();

          if (tokenData && tokenData.access_token) {
            const decoded = jwtDecode<DecodedAccessToken>(tokenData.access_token);
            return {
              id: String(decoded.user_id), // NextAuthのidはstring型が一般的
              name: decoded.sub,
              // email: "", // 必要に応じてFastAPIから取得
              accessToken: tokenData.access_token,
              accessTokenExpires: decoded.exp * 1000, // expは秒なのでミリ秒に変換
              userId: decoded.user_id,
            };
          }
          return null;
        } catch (e: unknown) {
          console.error("Authorize error:", e);
          // エラーメッセージをスローしてNextAuthに処理させる
          throw new Error(e instanceof Error ? e.message : "Authorization failed");
        }
      },
    }),
  ],
  session: {
    strategy: "jwt",
    // maxAge: 60 * 60 * 8, // 8時間 (FastAPI側のトークン有効期限と合わせるか、それより短くする)
  },
  callbacks: {
    async jwt({ token, user, account }) {
      const extendedUser = user as ExtendedUser | undefined;

      if (account && extendedUser) {
        // 新規ログイン時
        token.accessToken = extendedUser.accessToken;
        token.accessTokenExpires = extendedUser.accessTokenExpires;
        token.userId = extendedUser.userId;
        token.name = extendedUser.name; // ユーザー名をトークンに含める
        // token.sub = extendedUser.id; // NextAuthのidをsubとして保存
      }

      // トークンの有効期限チェック
      // accessTokenExpires が number 型であることを確認
      if (typeof token.accessTokenExpires === 'number' && Date.now() > token.accessTokenExpires) {
        // バックエンドのアクセストークンが期限切れ
        console.log("Backend access token expired in JWT callback.");
        // セッションを無効化するためにエラーをセットするか、特定のプロパティを削除
        return { ...token, error: "AccessTokenExpiredError", accessToken: undefined, accessTokenExpires: undefined };
      }

      return token;
    },
    async session({ session, token }) {
      if (token.accessToken) {
        session.accessToken = token.accessToken as string;
      }
      if (token.userId) {
        session.userId = token.userId as number;
      }
      if (token.name) { // セッションにもユーザー名を渡す
        if (!session.user) session.user = {};
        session.user.name = token.name as string;
      }
      // if (token.sub && session.user) {
      //   session.user.id = token.sub as string;
      // }

      if (token.error === "AccessTokenExpiredError") {
        session.error = "AccessTokenExpiredError";
        // セッションオブジェクトからアクセストークン関連情報を削除することも検討
        delete session.accessToken;
      }
      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/signin", // エラー時もサインインページにリダイレクトさせる
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };