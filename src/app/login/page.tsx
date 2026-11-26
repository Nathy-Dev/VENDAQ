import type { Metadata } from "next";
import AuthScreen from "@/components/AuthScreen";

export const metadata: Metadata = {
  title: "Log In",
  description: "Sign in to your Pipelixr workspace to manage WhatsApp leads, follow-ups, and sales.",
};

export default function LoginPage() {
  return <AuthScreen mode="login" />;
}
