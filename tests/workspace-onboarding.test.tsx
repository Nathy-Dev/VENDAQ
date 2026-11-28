import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { Workspace } from "../src/types/workspace";

type Providers = { meta: { appId: string; configId: string; version: string } | null; evolution: boolean };
const context = vi.hoisted(() => ({ pathname: "/onboarding/connect", workspace: null as Workspace | null | undefined, providers: undefined as Providers | undefined }));
vi.mock("convex/react", () => ({ useAction: () => vi.fn(), useMutation: () => vi.fn(), useQuery: (ref: FunctionReference<"query">) => getFunctionName(ref) === "connections:providers" ? context.providers : context.workspace }));
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
import { parseMetaSignupMessage } from "../src/components/MetaWhatsAppConnection";

const metaConfig = { appId: "12345", configId: "23456", version: "v27.0" };
beforeEach(() => { context.providers = { meta: metaConfig, evolution: true }; });

function workspace(state: Workspace["state"], hasBusinessSystemPrompt = false, aiEnabled = false) {
  return { state, hasBusinessSystemPrompt, aiEnabled, canChooseConnectionProvider: state === "disconnected", connectionProvider: state === "disconnected" ? undefined : "evolution" } as Workspace;
}

function render(data: Workspace | null) {
  return renderToStaticMarkup(<WorkspaceOnboarding workspace={data} onCreatingChange={() => {}} />);
}

describe("workspace onboarding card", () => {
  it.each([
    { data: null, heading: "A space for your business.", current: 1, content: "Business name" },
    { data: workspace("disconnected"), heading: "Connect WhatsApp", current: 2, content: "Choose a WhatsApp provider" },
    { data: workspace("connected"), heading: "Teach Pipelixr", current: 3, content: 'data-embedded="true">Business playbook' },
    { data: workspace("connected", true), heading: "Choose your groups", current: 4, content: 'data-embedded="true">Group permissions' },
  ])("shows step $current on the onboarding timeline", ({ data, heading, current, content }) => {
    const html = render(data);
    expect(html).toMatch(/^<section[^>]+aria-labelledby="onboarding-title">/);
    expect(html).toContain("pipelixr</span>");
    expect(html).toContain(`<h1 id="onboarding-title" tabindex="-1">${heading}</h1>`);
    expect(html).toContain(content);
    expect(html).toContain(`Step ${current} of 4`);
    const progress = html.match(/<ol[^>]+aria-label="Onboarding progress"[^>]*>.*?<\/ol>/)?.[0];
    const items = progress?.match(/<li[\s>][\s\S]*?<\/li>/g) ?? [];
    expect(items).toHaveLength(4);
    expect(items.filter((item) => item.includes('aria-current="step"'))).toHaveLength(1);
    expect(items.findIndex((item) => item.includes('aria-current="step"'))).toBe(current - 1);
    for (const [index, item] of items.entries()) {
      expect(item.includes('data-complete="true"')).toBe(index < current - 1);
      expect(item).toContain(index < current - 1 ? "Completed: " : `Step ${index + 1}: `);
      expect(item.includes('class="lucide lucide-check"')).toBe(index < current - 1);
    }
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

  it("offers both providers in onboarding and settings without starting either flow", () => {
    const fresh = workspace("disconnected");
    for (const html of [render(fresh), renderToStaticMarkup(<ConnectionPanel workspace={fresh} />)]) {
      expect(html).toContain("Choose a WhatsApp provider");
      expect(html).toContain("Meta Cloud API");
      expect(html).toContain("Recommended");
      expect(html).toContain("Evolution Go");
      expect(html).toContain("Unofficial");
      expect(html).not.toContain('disabled=""');
      expect(html).not.toContain("Connect WhatsApp Business");
      expect(html).not.toContain("Scan QR code");
    }
  });

  it.each([
    { meta: metaConfig, evolution: false, disabled: ["Evolution Go"] },
    { meta: null, evolution: true, disabled: ["Meta Cloud API"] },
    { meta: null, evolution: false, disabled: ["Meta Cloud API", "Evolution Go"] },
  ])("disables only unavailable providers ($disabled)", ({ disabled, ...providers }) => {
    context.providers = providers;
    const html = render(workspace("disconnected"));
    const buttons = html.match(/<button[^>]+disabled=""[^>]*>.*?<\/button>/g) ?? [];
    expect(buttons).toHaveLength(disabled.length);
    for (const [index, name] of disabled.entries()) expect(buttons[index]).toContain(name);
    expect(html.includes("No provider is ready yet")).toBe(disabled.length === 2);
  });

  it("waits for availability without defaulting to a provider", () => {
    context.providers = undefined;
    const html = render(workspace("disconnected"));
    expect(html).toContain("Checking available providers");
    expect(html).not.toContain("Evolution Go");
    expect(html).not.toContain("Meta Cloud API");
  });

  it.each([
    { state: "pending", provider: "meta", heading: "Meta Cloud API connection", action: "Cancel setup" },
    { state: "disconnected", provider: "meta", heading: "Meta Cloud API connection", action: "Connect WhatsApp Business" },
    { state: "pending", provider: "evolution", heading: "Evolution Go connection", action: "Show QR code" },
    { state: "revoked", provider: "evolution", heading: "Evolution Go connection", action: "Reset connection" },
    { state: "disconnected", provider: "evolution", heading: "Evolution Go connection", action: "Revoke connection" },
  ] as const)("preserves the $state $provider session instead of offering a replacement", ({ state, provider, heading, action }) => {
    const html = render({ ...workspace(state), connectionProvider: provider, canChooseConnectionProvider: false });
    expect(html).toContain(heading);
    expect(html).toContain(action);
    expect(html).not.toContain("Choose a WhatsApp provider");
    expect(html).not.toContain("Change provider");
  });

  it("does not ask Meta users to set up groups", () => {
    const html = render({ ...workspace("connected", true), connectionProvider: "meta" });
    expect(html).toContain("You’re ready to go");
    expect(html).toContain("Finish setup");
    expect(html).not.toContain("Group permissions");
  });

  it("accepts only a v4 Coexistence completion with valid assets from Meta", () => {
    const data = JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", data: { waba_id: "12345", phone_number_id: "23456", business_id: "34567" } });
    expect(parseMetaSignupMessage({ origin: "https://www.facebook.com", data })).toEqual({ wabaId: "12345", phoneId: "23456" });
    expect(parseMetaSignupMessage({ origin: "https://www.facebook.com.example.com", data })).toBeNull();
    expect(parseMetaSignupMessage({ origin: "https://www.facebook.com", data: data.replace("FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", "FINISH") })).toBe("error");
  });

  it.each([
    { waba_id: "12345" },
    { phone_number_id: "23456" },
    { waba_id: 12345, phone_number_id: "23456" },
    { waba_id: "12345", phone_number_id: "023456" },
  ])("rejects incomplete or invalid v4 assets: %j", (assets) => {
    const data = JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", data: assets });
    expect(parseMetaSignupMessage({ origin: "https://www.facebook.com", data })).toBe("error");
  });
});
