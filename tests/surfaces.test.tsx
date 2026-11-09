import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pathname: "/dashboard", authenticated: false }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status: "unauthenticated" }), signOut: vi.fn() }));
vi.mock("convex/react", () => ({ useConvexAuth: () => ({ isAuthenticated: state.authenticated }) }));
vi.mock("../src/components/FoundationWorkspace", () => ({ default: () => <div>Foundation workspace</div> }));
import FoundationGate, { isFoundationRoute } from "../src/components/FoundationGate";

describe("preserved legacy UI gate", () => {
  it.each(["/dashboard", "/onboarding/connect", "/pipeline", "/status", "/revenue", "/settings", "/profile"])("does not mount legacy children at %s", (pathname) => {
    state.pathname = pathname;
    function DangerousLegacyChild(): React.ReactNode { throw new Error("Legacy feature must not mount"); }
    const html = renderToStaticMarkup(<FoundationGate><DangerousLegacyChild /></FoundationGate>);
    expect(html).toContain("Sign in to your workspace");
  });
  it("preserves public pages without overmatching route prefixes", () => {
    state.pathname = "/login";
    expect(renderToStaticMarkup(<FoundationGate><div>Original login</div></FoundationGate>)).toContain("Original login");
    expect(isFoundationRoute("/status-public")).toBe(false);
  });
});
