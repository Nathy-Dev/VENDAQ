import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { ConvexHttpClient } from "convex/browser";
import { api } from "./convex/_generated/api";

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
          if (!profile?.email_verified || !account.providerAccountId) throw new Error("UNVERIFIED_GOOGLE_IDENTITY");
          token.id = `google:${account.providerAccountId}`;
        } else if (account.provider === "credentials" && user.id) {
          token.id = `credentials:${user.id}`;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.id === "string" && /^(google|credentials):.+$/.test(token.id)) {
        session.user.id = token.id as string;
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
