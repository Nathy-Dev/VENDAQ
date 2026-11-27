import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Workspace } from "../src/types/workspace";

const context = vi.hoisted(() => ({ pathname: "/onboarding/connect", workspace: null as Workspace | null | undefined }));
vi.mock("convex/react", () => ({ useAction: () => vi.fn(), useMutation: () => vi.fn(), useQuery: () => context.workspace }));
vi.mock("next/navigation", () => ({ usePathname: () => context.pathname, useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("../src/components/DashboardShell", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-dashboard-shell="true">Workspace navigation{children}</div> }));
vi.mock("../src/components/WorkspaceOverview", () => ({ default: () => <div>Dashboard overview</div> }));
vi.mock("../src/components/WorkspaceInbox", () => ({ default: () => null }));
vi.mock("../src/components/SellerWorkspacePanels", () => ({ default: () => null }));
vi.mock("../src/components/WorkspaceSettings", () => ({ default: () => null, ProfilePanel: () => null }));
vi.mock("../src/components/BillingWorkspace", () => ({ default: () => null }));
vi.mock("../src/components/BusinessAssistantSettings", () => ({ default: ({ compact }: { compact: boolean }) => <div data-embedded={compact}>Business playbook</div> }));
vi.mock("../src/components/WorkspaceGroups", () => ({ default: ({ embedded }: { embedded: boolean }) => <div data-embedded={embedded}>Group permissions</div> }));

import WorkspaceOnboarding from "../src/components/WorkspaceOnboarding";
import ConnectionPanel from "../src/components/WorkspaceConnection";
import FoundationWorkspace from "../src/components/FoundationWorkspace";

function workspace(state: Workspace["state"], hasBusinessSystemPrompt = false, aiEnabled = false) {
  return { state, hasBusinessSystemPrompt, aiEnabled } as Workspace;
}

function render(data: Workspace | null) {
  return renderToStaticMarkup(<WorkspaceOnboarding workspace={data} onCreatingChange={() => {}} />);
}

describe("workspace onboarding card", () => {
  it.each([
    { data: null, heading: "A space for your business.", current: 1, content: "Business name" },
    { data: workspace("pending"), heading: "Connect WhatsApp", current: 2, content: "Pairing method" },
    { data: workspace("connected"), heading: "Teach Pipelixr", current: 3, content: 'data-embedded="true">Business playbook' },
    { data: workspace("connected", true), heading: "Choose your groups", current: 4, content: 'data-embedded="true">Group permissions' },
  ])("keeps step $current inside the branded card", ({ data, heading, current, content }) => {
    const html = render(data);
    expect(html).toMatch(/^<section[^>]+aria-labelledby="onboarding-title">/);
    expect(html).toContain("pipelixr</span>");
    expect(html).toContain(`<h1 id="onboarding-title" tabindex="-1">${heading}</h1>`);
    expect(html).toContain(content);
    const items = html.match(/<li[\s>][\s\S]*?<\/li>/g) ?? [];
    expect(items).toHaveLength(4);
    expect(items.findIndex((item) => item.includes('aria-current="step"'))).toBe(current - 1);
    expect(items.filter((item) => item.includes('data-complete="true"'))).toHaveLength(current - 1);
  });

  it("requires a workspace name before offering the dashboard shortcut", () => {
    expect(render(null)).not.toContain("Skip for now");
    for (const data of [workspace("pending"), workspace("connected"), workspace("connected", false, true)]) {
      expect(render(data)).toMatch(/<a[^>]+href="\/dashboard"[^>]*>Skip for now<\/a>/);
    }
    const final = render(workspace("connected", true));
    expect(final).toContain('href="/dashboard"');
    expect(final).toContain("Finish setup");
    expect(final).not.toContain("Skip for now");
  });

  it.each([
    { path: "/dashboard", data: undefined, content: "Loading your workspace" },
    { path: "/dashboard", data: null, content: "A space for your business." },
    { path: "/onboarding/connect", data: workspace("pending"), content: "Skip for now" },
    { path: "/onboarding/connect", data: workspace("connected", true), content: "Finish setup" },
  ])("keeps navigation out of onboarding at $path ($content)", ({ path, data, content }) => {
    context.pathname = path;
    context.workspace = data;
    const markup = renderToStaticMarkup(<FoundationWorkspace />);
    expect(markup).toContain(content);
    expect(markup).not.toContain('data-dashboard-shell="true"');
  });

  it("opens the actual dashboard with navigation even if WhatsApp is not connected", () => {
    context.pathname = "/dashboard";
    context.workspace = workspace("pending");
    const markup = renderToStaticMarkup(<FoundationWorkspace />);
    expect(markup).toContain('data-dashboard-shell="true"');
    expect(markup).toContain("Dashboard overview");
    expect(markup).not.toContain("Skip for now");
  });

  it("offers both methods in the connection step and gates pairing on consent", () => {
    const html = render(workspace("pending"));
    expect(html).toContain("Scan QR code");
    expect(html).toContain("Use pairing code");
    expect(html).not.toContain('type="tel"');
    expect(html).toMatch(/<button[^>]+disabled=""[^>]*>Show QR code<\/button>/);
    expect(render(workspace("connected"))).not.toContain("Pairing method");
  });

  it("does not offer manual status refresh in onboarding or settings", () => {
    const pending = workspace("pending");
    expect(render(pending)).not.toContain("Refresh status");
    expect(renderToStaticMarkup(<ConnectionPanel workspace={pending} />)).not.toContain("Refresh status");
  });
});
