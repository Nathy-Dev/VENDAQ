import type { Metadata } from "next";

export const siteName = "Pipelixr";
export const siteOrigin = new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://www.pipelixr.com").origin;
export const noIndex = { index: false, follow: false };

export const publicPages = {
  "/": {
    title: "AI Sales Assistant for WhatsApp",
    description: "Turn WhatsApp chats into sales with Pipelixr. Spot serious buyers, qualify leads, draft replies using your business details, follow up, and track sales.",
  },
  "/legal/terms": {
    title: "Terms of Service",
    description: "Read the Pipelixr terms for using the WhatsApp sales assistant, including account responsibilities, connected services, and subscriptions.",
  },
  "/legal/privacy": {
    title: "Privacy Notice",
    description: "Learn what data Pipelixr collects, how it handles account and workspace information, and how to exercise your privacy rights.",
  },
  "/legal/acceptable-use": {
    title: "Acceptable Use Policy",
    description: "Review Pipelixr's rules for lawful WhatsApp messaging, recipient consent, approved automation, and safe use of connected services.",
  },
  "/legal/billing": {
    title: "Billing and Refund Terms",
    description: "Learn how Pipelixr trials, subscription renewals, usage allowances, cancellation, failed payments, and refunds work.",
  },
  "/legal/dpa": {
    title: "Data Processing Agreement",
    description: "Read how Pipelixr processes personal data on behalf of businesses, including its obligations for security, subprocessors, and retention.",
  },
  "/legal/ai": {
    title: "AI Transparency Notice",
    description: "See how Pipelixr uses AI to identify buying intent and prepare WhatsApp replies, what its limits are, and when sellers should review its output.",
  },
  "/legal/subprocessors": {
    title: "Subprocessor Register",
    description: "See which providers may process data for Pipelixr and how they support hosting, authentication, messaging, AI, and payments.",
  },
} as const;

export function publicPageMetadata(path: keyof typeof publicPages): Metadata {
  const { title, description } = publicPages[path];
  const isHome = path === "/";
  const fullTitle = isHome ? `${siteName} | ${title}` : `${title} | ${siteName}`;
  const url = `${siteOrigin}${path}`;
  const image = {
    url: isHome ? "/share/pipelixr-sales.png" : "/share/pipelixr-legal.png",
    width: 1200,
    height: 630,
    type: "image/png",
    alt: isHome ? "Pipelixr: Turn WhatsApp chats into sales" : "Pipelixr Legal & Trust",
  };

  return {
    title: isHome ? { absolute: fullTitle } : title,
    description,
    alternates: { canonical: url },
    robots: process.env.VERCEL_ENV === "preview" ? noIndex : { index: true, follow: true },
    openGraph: { type: "website", siteName, url, title: fullTitle, description, images: [image] },
    twitter: { card: "summary_large_image", title: fullTitle, description, images: [image] },
  };
}
