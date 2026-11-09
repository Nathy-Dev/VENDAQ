export type WorkspaceScreen = "overview" | "inbox" | "actions" | "viewers" | "settings" | "profile" | "setup" | "connect";

export function workspaceScreen(pathname: string): WorkspaceScreen {
  if (pathname === "/onboarding/connect" || pathname.startsWith("/onboarding/connect/")) return "connect";
  const roots: [string, WorkspaceScreen][] = [
    ["/pipeline", "inbox"], ["/revenue", "actions"], ["/status", "viewers"],
    ["/settings", "settings"], ["/profile", "profile"], ["/onboarding", "setup"],
  ];
  return roots.find(([root]) => pathname === root || pathname.startsWith(`${root}/`))?.[1] ?? "overview";
}

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amount);
}

export function formatDate(timestamp: number, timezone = "Africa/Lagos"): string {
  return new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: timezone }).format(timestamp);
}

export function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function displayIdentity(identity: string): string {
  const phone = /^(\d+)@s\.whatsapp\.net$/.exec(identity)?.[1];
  return phone ? `+${phone}` : "Private WhatsApp identity";
}

export function whatsappLink(identity: string): string | null {
  const phone = /^(\d+)@s\.whatsapp\.net$/.exec(identity)?.[1];
  return phone ? `https://wa.me/${phone}` : null;
}

export function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase() || "?";
}
