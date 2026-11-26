import type { Metadata } from "next";
import AuthScreen from "@/components/AuthScreen";

export const metadata: Metadata = {
  title: "Create an Account",
  description: "Start a Pipelixr trial and set up your AI sales assistant for WhatsApp.",
};

export default function SignupPage() {
  return <AuthScreen mode="signup" />;
}
