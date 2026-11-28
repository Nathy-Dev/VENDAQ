import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-auth/react", () => ({
  signIn: vi.fn(),
  useSession: () => ({ status: "unauthenticated", data: null }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("convex/react", () => ({ useAction: () => vi.fn() }));

import AuthScreen from "../src/components/AuthScreen";
import LandingPage from "../src/components/LandingPage";

describe("public UI", () => {
  it("positions Pipelixr as a live AI sales assistant for WhatsApp businesses", () => {
    const html = renderToStaticMarkup(<LandingPage />);
    expect(html).toContain("Turn busy WhatsApp chats");
    expect(html).toContain("into sales.");
    expect(html).toContain("Pipelixr finds serious buyers in your WhatsApp conversations, qualifies leads, replies using your business details, follows up on opportunities, and tracks which conversations turn into sales.");
    expect(html).toContain('data-live-agent-demo="true"');
    expect(html).toContain('src="/pipelixr-agent-typing-still.webp"');
    expect(html).not.toContain('/pipelixr-agent-typing.webp');
    expect(html).toContain("Buyer detected");
    expect(html).toContain("reply ready");
    expect(html).toContain("Follow-up scheduled");
    expect(html).toContain("Start my free trial");
    expect(html).toContain("No card required");
  });

  it("describes seller-controlled automation and connection limits accurately", () => {
    const html = renderToStaticMarkup(<LandingPage />);
    expect(html).toContain("You control customer authorization and every enabled group");
    expect(html).toContain("Complete Teach Pipelixr");
    expect(html).toContain("groups stay silent until enabled individually");
    expect(html).toContain("official Meta Cloud API");
    expect(html).toContain("Evolution Go is an unofficial provider");
    expect(html).toContain("Unclear, unsupported, or sensitive cases can be held for review");
  });

  it("shows which WhatsApp-selling businesses Pipelixr is for", () => {
    const html = renderToStaticMarkup(<LandingPage />);
    expect(html).toContain("Built for chat-first selling");
    expect(html).toContain("Fashion, beauty &amp; personal care");
    expect(html).toContain("Food, cakes &amp; event vendors");
    expect(html).toContain("Home, gadgets &amp; specialty retail");
    expect(html).toContain("Wholesalers &amp; distributors");
    expect(html).toContain("WhatsApp is a key sales channel");
  });

  it("shows how Pipelixr turns a customer message into a grounded next action", () => {
    const html = renderToStaticMarkup(<LandingPage />);
    expect(html).toContain("From message to next move");
    expect(html).toContain("Pipelixr understands the sale hiding inside the chat.");
    expect(html).toContain("Brown linen set");
    expect(html).toContain("Checks your business details");
    expect(html).toContain("Reply prepared");
    expect(html).toContain("Next move protected");
  });

  it("renders accessible login fields and password visibility control", () => {
    const html = renderToStaticMarkup(<AuthScreen mode="login" />);
    expect(html).toContain('autoComplete="email"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain('aria-label="Show password"');
  });

  it("states the actual signup password minimum", () => {
    const html = renderToStaticMarkup(<AuthScreen mode="signup" />);
    expect(html).toContain('minLength="12"');
    expect(html).toContain("At least 12 characters. Maximum 72 bytes.");
  });
});
