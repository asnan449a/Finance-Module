import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "./prisma";
import { compareSync } from "bcryptjs";

interface ExtendedUser {
  id: string;
  email: string;
  name: string;
  role: string;
  partnerId: string | null;
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
          include: { partner: true },
        });
        if (!user) return null;
        const isValid = compareSync(credentials.password, user.passwordHash);
        if (!isValid) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          partnerId: user.partnerId,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as ExtendedUser).role;
        token.partnerId = (user as ExtendedUser).partnerId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const extUser = session.user as ExtendedUser;
        extUser.id = token.sub as string;
        extUser.role = token.role as string;
        extUser.partnerId = token.partnerId as string | null;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
};
