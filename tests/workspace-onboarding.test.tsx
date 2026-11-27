import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Workspace } from "../src/types/workspace";

vi.mock("convex/react", () => ({ useAction: () => vi.fn(), useMutation: () => vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/onboarding/connect", useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("../src/components/BusinessAssistantSettings", () => ({ default: ({ compact }: { compact: boolean }) => <div data-embedded={compact}>Business playbook</div> }));
vi.mock("../src/components/WorkspaceGroups", () => ({ default: ({ embedded }: { embedded: boolean }) => <div data-embedded={embedded}>Group permissions</div> }));

import WorkspaceOnboarding from "../src/components/WorkspaceOnboarding";
import ConnectionPanel from "../src/components/WorkspaceConnection";

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

  it("leaves the human-only inbox option in step three and offers setup completion in step four", () => {
    expect(render(workspace("connected"))).toContain("Go to inbox without AI");
    expect(render(workspace("connected", false, true))).not.toContain("Go to inbox without AI");
    const final = render(workspace("connected", true));
    expect(final).toContain('href="/dashboard"');
    expect(final).toContain("Finish setup");
    expect(final).not.toContain("Go to inbox without AI");
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
