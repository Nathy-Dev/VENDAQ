import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { ConvexHttpClient } from "convex/browser";
import { api } from "./convex/_generated/api";
import { mintConvexToken } from "./src/lib/convex-auth";

declare module "next-auth" {
  interface Session {
    convexUserId?: string;
  }
}

const convex = new ConvexHttpClient(
  process.env.NEXT_PUBLIC_CONVEX_URL || "https://dummy.convex.cloud"
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        try {
          const user = await convex.action(api.auth.verifyUser, {
            email: credentials.email as string,
            password: credentials.password as string,
          });

          if (user) {
            return user;
          }
          return null;
        } catch {
          // Provider errors may contain request metadata; never log credentials.
          console.error("Authentication service unavailable");
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, account, profile }) {
      if (user && account) {
        if (account.provider === "google") {
          if (profile?.email_verified !== true || !profile.email || !account.providerAccountId) throw new Error("UNVERIFIED_GOOGLE_IDENTITY");
          const subject = `google:${account.providerAccountId}`;
          const convexToken = await mintConvexToken(subject, {
            email: profile.email,
            emailVerified: true,
            name: user.name,
            image: user.image,
          });
          token.convexUserId = await new ConvexHttpClient(convex.url, { auth: convexToken }).mutation(api.users.upsertGoogleUser, {});
          token.id = subject;
        } else if (account.provider === "credentials" && user.id) {
          token.convexUserId = user.id;
          token.id = `credentials:${user.id}`;
        } else {
          return null;
        }
        return token;
      }

      if (typeof token.id !== "string" || !/^(google|credentials):.+$/.test(token.id) || typeof token.convexUserId !== "string" || !token.convexUserId) return null;
      try {
        const convexToken = await mintConvexToken(token.id, { userId: token.convexUserId });
        const client = new ConvexHttpClient(convex.url, {
          auth: convexToken,
          fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(5000) }),
        });
        return await client.query(api.users.sessionActive, {}) ? token : null;
      } catch {
        console.error("Session validation unavailable");
        return null;
      }
    },
    async session({ session, token }) {
      if (session.user && typeof token.id === "string" && /^(google|credentials):.+$/.test(token.id) && typeof token.convexUserId === "string") {
        session.user.id = token.id as string;
        session.convexUserId = token.convexUserId;
      } else if (session.user) {
        session.user.id = "";
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
