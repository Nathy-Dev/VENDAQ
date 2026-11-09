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
  it("describes the manual-first product without automation claims", () => {
    const html = renderToStaticMarkup(<LandingPage />);
    expect(html).toContain("You stay in control of every reply");
    expect(html).toContain("Draft first. Send yourself.");
    expect(html).toContain("Automated sending remains disabled");
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
