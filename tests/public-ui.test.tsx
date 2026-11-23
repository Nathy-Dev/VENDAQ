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
    expect(html).toContain("Buyer detected");
    expect(html).toContain("reply ready");
    expect(html).toContain("Follow-up scheduled");
  });

  it("describes the consent-gated Launch 1 assistant accurately", () => {
    const html = renderToStaticMarkup(<LandingPage />);
    expect(html).toContain("You control customer authorization and every enabled group");
    expect(html).toContain("Complete Teach Pipelixr");
    expect(html).toContain("Groups stay silent until enabled individually");
    expect(html).toContain("feature remains in the product code but is blocked for Launch 1");
    expect(html).toContain("an unofficial provider");
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
