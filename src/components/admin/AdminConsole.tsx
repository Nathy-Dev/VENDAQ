"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useAction, useQuery } from "convex/react";
import { useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Bell,
  Bot,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Download,
  ExternalLink,
  Gauge,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  MessageCircleMore,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingUp,
  Trash2,
  UsersRound,
  WalletCards,
  Wifi,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import styles from "./AdminConsole.module.css";

type RangeDays = 7 | 30 | 90;
type Section = "overview" | "businesses" | "operations" | "billing";

const navItems: Array<{ section: Section; label: string; icon: LucideIcon }> = [
  { section: "overview", label: "Overview", icon: LayoutDashboard },
  { section: "businesses", label: "Businesses", icon: Building2 },
  { section: "operations", label: "Operations", icon: Activity },
  { section: "billing", label: "Billing", icon: WalletCards },
];

function currentSection(pathname: string): Section {
  const value = pathname.split("/")[2];
  return navItems.some((item) => item.section === value) ? value as Section : "overview";
}

export default function AdminConsole() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const access = useQuery(api.admin.access, {});
  const section = currentSection(pathname);
  const [mobileOpen, setMobileOpen] = useState(false);

  if (access === undefined) return <AdminLoading label="Verifying admin access" />;
  if (!access.configured) return <AccessState title="Admin access is not configured" description="Add one or more authenticated user subjects to ADMIN_USER_IDS in the Convex deployment environment, then redeploy." />;
  if (!access.isAdmin) return <AccessState title="You don’t have admin access" description="This console is restricted to explicitly authorized Pipelixr operators." />;

  return (
    <div className={styles.shell}>
      <aside className={`${styles.sidebar} ${mobileOpen ? styles.sidebarOpen : ""}`}>
        <div className={styles.brandRow}>
          <Link href="/admin" className={styles.brand}><span className={styles.brandMark}>P</span><span>Pipelixr</span><em>ADMIN</em></Link>
          <button className={styles.mobileClose} onClick={() => setMobileOpen(false)} aria-label="Close menu"><X size={20} /></button>
        </div>
        <nav className={styles.nav} aria-label="Admin navigation">
          <p className={styles.navLabel}>Workspace</p>
          {navItems.map(({ section: itemSection, label, icon: Icon }) => (
            <Link key={itemSection} href={itemSection === "overview" ? "/admin" : `/admin/${itemSection}`} onClick={() => setMobileOpen(false)} className={`${styles.navItem} ${section === itemSection ? styles.navItemActive : ""}`}>
              <Icon size={18} /><span>{label}</span>{itemSection === "operations" && <i />}
            </Link>
          ))}
          <p className={styles.navLabel}>Product</p>
          <Link href="/dashboard" className={styles.navItem}><ExternalLink size={18} /><span>Seller workspace</span></Link>
          <a href="mailto:support@pipelixr.com" className={styles.navItem}><LifeBuoy size={18} /><span>Support</span></a>
        </nav>
        <div className={styles.operator}>
          <span className={styles.avatar}>{initials(session?.user?.name ?? session?.user?.email ?? "Admin")}</span>
          <div><strong>{session?.user?.name ?? "Administrator"}</strong><span>{session?.user?.email ?? "Authorized operator"}</span></div>
          <button onClick={() => void signOut({ callbackUrl: "/login" })} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button>
        </div>
      </aside>
      {mobileOpen && <button className={styles.backdrop} onClick={() => setMobileOpen(false)} aria-label="Close menu" />}
      <main className={styles.main}>
        <header className={styles.topbar}>
          <button className={styles.menuButton} onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu size={21} /></button>
          <div><span className={styles.eyebrow}>Pipelixr Control Center</span><strong>{navItems.find((item) => item.section === section)?.label}</strong></div>
          <div className={styles.topActions}>
            <span className={styles.live}><i /> Live</span>
            <button aria-label="Notifications"><Bell size={18} /></button>
            <span className={styles.topAvatar}>{initials(session?.user?.name ?? "Admin")}</span>
          </div>
        </header>
        <div className={styles.content}>
          {section === "overview" && <Overview />}
          {section === "businesses" && <Businesses />}
          {section === "operations" && <Operations />}
          {section === "billing" && <Billing />}
        </div>
      </main>
    </div>
  );
}

function Overview() {
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);
  const data = useQuery(api.admin.overview, { rangeDays });
  if (data === undefined) return <AdminLoading label="Loading platform overview" embedded />;
  const connectedRate = data.businesses.total ? Math.round((data.businesses.connected / data.businesses.total) * 100) : 0;
  const activeSubscriptions = data.subscriptions.active + data.subscriptions.trialing;
  const maxTrend = Math.max(1, ...data.revenueTrend.map((item) => item.grossKobo));
  return (
    <div className={styles.page}>
      <PageHeading title="Good morning, Admin" description="Here’s what’s happening across Pipelixr today." controls={<RangeControl value={rangeDays} onChange={setRangeDays} />} />
      {!data.dataComplete && <DataNotice />}
      <section className={styles.metricsGrid}>
        <MetricCard label="Monthly recurring revenue" value={money(data.subscriptions.mrrKobo)} helper={`${activeSubscriptions} paying or trialing`} icon={CircleDollarSign} tone="green" />
        <MetricCard label="Total businesses" value={number(data.businesses.total)} helper={`+${data.businesses.newInRange} in this period`} icon={Building2} tone="blue" />
        <MetricCard label="Connected workspaces" value={`${connectedRate}%`} helper={`${data.businesses.connected} healthy connections`} icon={Wifi} tone="violet" />
        <MetricCard label="Net payment volume" value={money(data.revenue.netKobo)} helper={`${data.revenue.successfulPayments} successful payments`} icon={TrendingUp} tone="amber" />
      </section>
      <section className={styles.dashboardGrid}>
        <article className={`${styles.card} ${styles.chartCard}`}>
          <CardHeader title="Payment volume" description={`Successful Paystack payments · Last ${rangeDays} days`} icon={Banknote} />
          <div className={styles.chartTotal}><strong>{money(data.revenue.grossKobo)}</strong><span><ArrowUpRight size={14} /> gross volume</span></div>
          <div className={styles.barChart} aria-label="Daily payment volume chart">
            {data.revenueTrend.map((item, index) => <div key={item.day} className={styles.barColumn} title={`${date(item.day)}: ${money(item.grossKobo)}`}><span style={{ height: `${Math.max(3, (item.grossKobo / maxTrend) * 100)}%` }} /><i>{index % Math.max(1, Math.floor(rangeDays / 6)) === 0 ? shortDate(item.day) : ""}</i></div>)}
          </div>
        </article>
        <article className={styles.card}>
          <CardHeader title="Workspace health" description="Live connection distribution" icon={Gauge} />
          <div className={styles.healthRing} style={{ "--health": `${connectedRate * 3.6}deg` } as React.CSSProperties}><div><strong>{connectedRate}%</strong><span>connected</span></div></div>
          <div className={styles.legend}>
            <LegendItem label="Connected" value={data.businesses.connected} tone="green" />
            <LegendItem label="Disconnected" value={data.businesses.disconnected} tone="gray" />
            <LegendItem label="Pending" value={data.businesses.pending} tone="amber" />
            <LegendItem label="Error" value={data.businesses.error} tone="red" />
          </div>
        </article>
        <article className={styles.card}>
          <CardHeader title="Subscriptions" description="Current account state" icon={WalletCards} />
          <div className={styles.statusRows}>
            <StatusRow label="Active" value={data.subscriptions.active} total={Math.max(1, activeSubscriptions + data.subscriptions.pastDue + data.subscriptions.cancelling)} tone="green" />
            <StatusRow label="Trialing" value={data.subscriptions.trialing} total={Math.max(1, activeSubscriptions + data.subscriptions.pastDue + data.subscriptions.cancelling)} tone="blue" />
            <StatusRow label="Past due" value={data.subscriptions.pastDue} total={Math.max(1, activeSubscriptions + data.subscriptions.pastDue + data.subscriptions.cancelling)} tone="red" />
            <StatusRow label="Cancelling" value={data.subscriptions.cancelling} total={Math.max(1, activeSubscriptions + data.subscriptions.pastDue + data.subscriptions.cancelling)} tone="amber" />
          </div>
          <Link className={styles.cardLink} href="/admin/billing">View billing details <ChevronRight size={15} /></Link>
        </article>
        <article className={styles.card}>
          <CardHeader title="Operations queue" description="Items that may need attention" icon={AlertCircle} />
          <div className={styles.attentionList}>
            <AttentionItem icon={WifiOff} label="Connection errors" value={data.businesses.error} tone="red" />
            <AttentionItem icon={RefreshCw} label="Dead-letter events" value={data.operations.deadLetters} tone="amber" />
            <AttentionItem icon={WalletCards} label="Failed billing webhooks" value={data.operations.failedWebhooks} tone="red" />
            <AttentionItem icon={UsersRound} label="Qualified outcomes" value={data.operations.qualifiedOutcomes} tone="blue" />
          </div>
          <Link className={styles.cardLink} href="/admin/operations">Open operations <ChevronRight size={15} /></Link>
        </article>
      </section>
    </div>
  );
}

function Businesses() {
  const data = useQuery(api.admin.businesses, {});
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<Id<"businesses"> | null>(null);
  const filtered = useMemo(() => {
    if (!data) return [];
    const normalized = query.trim().toLowerCase();
    return data.businesses.filter((business) => (status === "all" || business.whatsappStatus === status) && (!normalized || business.name.toLowerCase().includes(normalized) || business.ownerId.toLowerCase().includes(normalized) || business.plan.toLowerCase().includes(normalized)));
  }, [data, query, status]);
  if (data === undefined) return <AdminLoading label="Loading businesses" embedded />;
  function exportCsv() {
    const rows = [["Business", "Owner ID", "Connection", "Plan", "Subscription", "Created"], ...filtered.map((item) => [item.name, item.ownerId, item.whatsappStatus, item.plan, item.subscriptionStatus, new Date(item.createdAt).toISOString()])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a"); link.href = url; link.download = `pipelixr-businesses-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  return (
    <div className={styles.page}>
      <PageHeading title="Businesses" description="Monitor onboarding, subscriptions, and WhatsApp health across every workspace." controls={<button className={styles.secondaryButton} onClick={exportCsv}><Download size={16} /> Export CSV</button>} />
      {!data.dataComplete && <DataNotice />}
      <section className={styles.listStats}>
        <MiniStat label="All businesses" value={data.businesses.length} icon={Building2} />
        <MiniStat label="Connected" value={data.businesses.filter((item) => item.whatsappStatus === "connected").length} icon={Wifi} />
        <MiniStat label="Needs attention" value={data.businesses.filter((item) => item.whatsappStatus === "error" || item.whatsappStatus === "disconnected").length} icon={AlertCircle} />
        <MiniStat label="Assistant enabled" value={data.businesses.filter((item) => item.assistantEnabled).length} icon={Bot} />
      </section>
      <section className={styles.card}>
        <div className={styles.tableToolbar}>
          <label className={styles.search}><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, owner, or plan" /></label>
          <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter connection status"><option value="all">All connections</option><option value="connected">Connected</option><option value="disconnected">Disconnected</option><option value="pending">Pending</option><option value="error">Error</option></select>
          <span className={styles.resultCount}>{filtered.length} results</span>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}><thead><tr><th>Business</th><th>Connection</th><th>Plan</th><th>Assistant</th><th>Last health</th><th>Created</th><th /></tr></thead><tbody>
            {filtered.map((business) => <tr key={business.id} onClick={() => setSelectedId(business.id)}>
              <td><div className={styles.entity}><span>{initials(business.name)}</span><div><strong>{business.name}</strong><small>{business.industry ?? compactId(business.ownerId)}</small></div></div></td>
              <td><Badge value={business.whatsappStatus} /></td><td><div className={styles.planCell}><strong>{title(business.plan)}</strong><small>{title(business.subscriptionStatus)}</small></div></td>
              <td>{business.assistantEnabled ? <span className={styles.enabled}><CheckCircle2 size={14} /> Enabled</span> : <span className={styles.muted}>Off</span>}</td>
              <td>{business.sessionLastHealthAt ? relative(business.sessionLastHealthAt) : "Never"}</td><td>{date(business.createdAt)}</td><td><button aria-label={`Open ${business.name}`}><ChevronRight size={17} /></button></td>
            </tr>)}
          </tbody></table>
          {!filtered.length && <EmptyState title="No businesses found" description="Try a different search term or connection filter." />}
        </div>
      </section>
      {selectedId && <BusinessDrawer id={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function BusinessDrawer({ id, onClose }: { id: Id<"businesses">; onClose: () => void }) {
  const data = useQuery(api.admin.businessDetail, { businessId: id });
  const deletion = useQuery(api.admin.deletionStatus, { businessId: id });
  const requestDeletion = useAction(api.admin.requestAccountDeletion);
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  async function deleteAccount() {
    if (!data || confirmation !== data.business.name || deleting) return;
    setDeleting(true); setDeleteError(null);
    try { await requestDeletion({ businessId: id, confirmation }); }
    catch { setDeleteError("Account deletion could not be started. If this is a paid account, verify the Paystack subscription can be disabled, then try again."); }
    finally { setDeleting(false); }
  }
  return <div className={styles.drawerLayer}><button className={styles.drawerBackdrop} onClick={onClose} aria-label="Close details" /><aside className={styles.drawer} aria-label="Business details">
    <div className={styles.drawerHeader}><div><span className={styles.eyebrow}>Business profile</span><h2>{data?.business.name ?? "Loading…"}</h2></div><button onClick={onClose} aria-label="Close"><X size={20} /></button></div>
    {data === undefined ? <AdminLoading label="Loading business details" embedded /> : !data ? <EmptyState title="Business unavailable" description="This workspace may have been removed." /> : <>
      <div className={styles.drawerHero}><span className={styles.largeAvatar}>{initials(data.business.name)}</span><div><Badge value={data.business.whatsappStatus} /><p>{data.business.industry ?? "Industry not specified"}</p></div></div>
      <dl className={styles.details}><div><dt>Owner ID</dt><dd>{data.business.ownerId}</dd></div><div><dt>Plan</dt><dd>{title(data.business.plan)} · {title(data.business.subscriptionStatus)}</dd></div><div><dt>Session</dt><dd>{title(data.business.sessionState ?? "not created")}</dd></div><div><dt>Created</dt><dd>{dateTime(data.business.createdAt)}</dd></div><div><dt>Last sync</dt><dd>{data.business.lastHistorySyncAt ? relative(data.business.lastHistorySyncAt) : "Never"}</dd></div></dl>
      <div className={styles.drawerMetrics}><MiniStat label="Customers" value={data.counts.customers} icon={UsersRound} /><MiniStat label="Conversations" value={data.counts.conversations} icon={MessageCircleMore} /><MiniStat label="Orders" value={data.counts.orders} icon={WalletCards} /><MiniStat label="Open issues" value={data.counts.openExceptions + data.counts.openRescues} icon={AlertCircle} /></div>
      <h3 className={styles.subheading}>Latest orders</h3>
      <div className={styles.orderList}>{data.latestOrders.map((order) => <div key={order.id}><span><strong>{money(order.totalAmount * 100)}</strong><small>{dateTime(order.createdAt)}</small></span><Badge value={order.status} /></div>)}{!data.latestOrders.length && <p className={styles.muted}>No orders recorded yet.</p>}</div>
      <section className={styles.dangerZone}>
        <div><span><Trash2 size={17} /></span><div><h3>Delete account</h3><p>Permanently removes the business, workspace data, and credential-login account. Google identities remain with Google but lose their Pipelixr workspace.</p></div></div>
        {deletion && deletion.state !== "done" ? <div className={styles.deletionProgress}><RefreshCw size={15} /><span><strong>{deletion.state === "dead_letter" ? "Deletion needs operator review" : "Deletion in progress"}</strong><small>{deletion.state === "dead_letter" ? deletion.errorCode ?? "Cleanup stopped safely." : `${deletion.deletedRecords} records removed. The account is already disabled.`}</small></span></div> : !confirming ? <button className={styles.dangerButton} onClick={() => setConfirming(true)}><Trash2 size={15} /> Delete business and user</button> : <div className={styles.confirmDelete}>
          <p>Type <strong>{data.business.name}</strong> to confirm. This action cannot be undone.</p>
          <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={data.business.name} autoComplete="off" />
          {deleteError && <span className={styles.deleteError}>{deleteError}</span>}
          <div><button className={styles.secondaryButton} onClick={() => { setConfirming(false); setConfirmation(""); setDeleteError(null); }} disabled={deleting}>Cancel</button><button className={styles.dangerButton} onClick={() => void deleteAccount()} disabled={confirmation !== data.business.name || deleting}>{deleting ? "Starting deletion…" : "Permanently delete"}</button></div>
        </div>}
      </section>
    </>}
  </aside></div>;
}

function Operations() {
  const data = useQuery(api.admin.operations, {});
  if (data === undefined) return <AdminLoading label="Loading operations" embedded />;
  return <div className={styles.page}>
    <PageHeading title="Operations" description="Connection health, ingestion failures, and payment webhook diagnostics." controls={<span className={styles.liveLarge}><i /> Realtime monitoring</span>} />
    <section className={styles.metricsGridThree}>
      <MetricCard label="Unhealthy workspaces" value={number(data.unhealthyBusinesses.length)} helper="Disconnected, pending, or errored" icon={WifiOff} tone="red" />
      <MetricCard label="Dead-letter events" value={number(data.deadLetters.length)} helper="Exhausted ingestion retries" icon={RefreshCw} tone="amber" />
      <MetricCard label="Failed webhooks" value={number(data.failedWebhooks.length)} helper="Paystack events requiring review" icon={AlertCircle} tone="violet" />
    </section>
    <section className={styles.opsGrid}>
      <article className={styles.card}><CardHeader title="Connection incidents" description="Workspaces outside a connected state" icon={WifiOff} />
        <div className={styles.incidentList}>{data.unhealthyBusinesses.map((item) => <Link href={`/admin/businesses`} key={item.id} className={styles.incident}><span className={styles.incidentIcon}><WifiOff size={17} /></span><div><strong>{item.name}</strong><small>{item.lastError ?? `${title(item.sessionState ?? item.status)} session`}</small></div><span><Badge value={item.status} /><small>{item.updatedAt ? relative(item.updatedAt) : "No session"}</small></span></Link>)}{!data.unhealthyBusinesses.length && <HealthyState label="All workspaces are connected" />}</div>
      </article>
      <article className={styles.card}><CardHeader title="Dead-letter queue" description="Events that exhausted processing retries" icon={RefreshCw} />
        <div className={styles.compactTable}>{data.deadLetters.map((item) => <div key={item.id}><span><strong>{item.businessName}</strong><small>{item.errorCode ?? "Unclassified failure"}</small></span><span><b>{item.attempts} attempts</b><small>{relative(item.receivedAt)}</small></span></div>)}{!data.deadLetters.length && <HealthyState label="No dead-letter events" />}</div>
      </article>
      <article className={`${styles.card} ${styles.fullWidth}`}><CardHeader title="Failed billing webhooks" description="Sanitized provider event metadata; payment secrets are never exposed" icon={ShieldCheck} />
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Business</th><th>Event</th><th>Error code</th><th>Received</th></tr></thead><tbody>{data.failedWebhooks.map((item) => <tr key={item.id}><td>{item.businessName}</td><td><code>{item.eventType}</code></td><td><Badge value={item.code ?? "unknown"} /></td><td>{dateTime(item.receivedAt)}</td></tr>)}</tbody></table>{!data.failedWebhooks.length && <HealthyState label="No failed webhooks" />}</div>
      </article>
    </section>
  </div>;
}

function Billing() {
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);
  const data = useQuery(api.admin.billing, { rangeDays });
  if (data === undefined) return <AdminLoading label="Loading billing" embedded />;
  const maxPlanMrr = Math.max(1, ...data.planMix.map((item) => item.mrrKobo));
  return <div className={styles.page}>
    <PageHeading title="Billing & revenue" description="Subscription health and verified Paystack payment activity." controls={<RangeControl value={rangeDays} onChange={setRangeDays} />} />
    <section className={styles.metricsGrid}>
      <MetricCard label="MRR" value={money(data.summary.mrrKobo)} helper={`${data.summary.active} active subscriptions`} icon={CircleDollarSign} tone="green" />
      <MetricCard label="Gross volume" value={money(data.summary.grossKobo)} helper={`Last ${rangeDays} days`} icon={ArrowUpRight} tone="blue" />
      <MetricCard label="Net volume" value={money(data.summary.netKobo)} helper="After recorded refunds" icon={Banknote} tone="violet" />
      <MetricCard label="At risk" value={number(data.summary.pastDue + data.summary.cancelling)} helper={`${data.summary.pastDue} past due · ${data.summary.cancelling} cancelling`} icon={ArrowDownRight} tone="red" />
    </section>
    <section className={styles.billingGrid}>
      <article className={styles.card}><CardHeader title="Revenue by plan" description="Monthly recurring revenue contribution" icon={TrendingUp} /><div className={styles.planBars}>{data.planMix.map((item) => <div key={item.plan}><span><strong>{title(item.plan)}</strong><small>{item.subscriptions} subscriptions</small></span><div><i style={{ width: `${(item.mrrKobo / maxPlanMrr) * 100}%` }} /></div><b>{money(item.mrrKobo)}</b></div>)}{!data.planMix.length && <EmptyState title="No subscriptions yet" description="Plan revenue will appear after the first subscription is created." />}</div></article>
      <article className={styles.card}><CardHeader title="Subscription health" description="Accounts requiring commercial follow-up" icon={AlertCircle} /><div className={styles.attentionAccounts}>{data.attention.map((item) => <div key={item.id}><span className={styles.entityMini}>{initials(item.businessName)}</span><div><strong>{item.businessName}</strong><small>{title(item.plan)} · {item.periodEnd ? `renews ${date(item.periodEnd)}` : "No period end"}</small></div><Badge value={item.status} /></div>)}{!data.attention.length && <HealthyState label="No at-risk subscriptions" />}</div></article>
      <article className={`${styles.card} ${styles.fullWidth}`}><CardHeader title="Recent payments" description="Latest verified and recorded transactions" icon={WalletCards} /><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Business</th><th>Amount</th><th>Status</th><th>Channel</th><th>Paid</th></tr></thead><tbody>{data.recentPayments.map((payment) => <tr key={payment.id}><td><strong>{payment.businessName}</strong></td><td className={styles.moneyCell}>{money(payment.amountKobo)}</td><td><Badge value={payment.status} /></td><td>{title(payment.channel ?? "unknown")}</td><td>{dateTime(payment.paidAt)}</td></tr>)}</tbody></table>{!data.recentPayments.length && <EmptyState title="No payments in this period" description="Try a longer date range." />}</div></article>
    </section>
  </div>;
}

function PageHeading({ title: heading, description, controls }: { title: string; description: string; controls?: ReactNode }) { return <div className={styles.pageHeading}><div><h1>{heading}</h1><p>{description}</p></div>{controls && <div className={styles.headingControls}>{controls}</div>}</div>; }
function RangeControl({ value, onChange }: { value: RangeDays; onChange: (value: RangeDays) => void }) { return <div className={styles.rangeControl}>{([7, 30, 90] as RangeDays[]).map((days) => <button key={days} onClick={() => onChange(days)} className={value === days ? styles.rangeActive : ""}>{days}D</button>)}</div>; }
function MetricCard({ label, value, helper, icon: Icon, tone }: { label: string; value: string; helper: string; icon: LucideIcon; tone: string }) { return <article className={styles.metricCard} data-tone={tone}><div className={styles.metricIcon}><Icon size={20} /></div><span>{label}</span><strong>{value}</strong><small>{helper}</small></article>; }
function MiniStat({ label, value, icon: Icon }: { label: string; value: number; icon: LucideIcon }) { return <article className={styles.miniStat}><Icon size={18} /><div><strong>{number(value)}</strong><span>{label}</span></div></article>; }
function CardHeader({ title: heading, description, icon: Icon }: { title: string; description: string; icon: LucideIcon }) { return <div className={styles.cardHeader}><div><span className={styles.cardIcon}><Icon size={17} /></span><div><h2>{heading}</h2><p>{description}</p></div></div><button aria-label={`More options for ${heading}`}>•••</button></div>; }
function LegendItem({ label, value, tone }: { label: string; value: number; tone: string }) { return <div className={styles.legendItem} data-tone={tone}><span><i />{label}</span><strong>{number(value)}</strong></div>; }
function StatusRow({ label, value, total, tone }: { label: string; value: number; total: number; tone: string }) { return <div className={styles.statusRow} data-tone={tone}><span><i />{label}</span><div><b style={{ width: `${(value / total) * 100}%` }} /></div><strong>{value}</strong></div>; }
function AttentionItem({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: number; tone: string }) { return <div className={styles.attentionItem} data-tone={tone}><span><Icon size={16} /></span><strong>{label}</strong><b>{value}</b></div>; }
function Badge({ value }: { value: string }) { const normalized = value.toLowerCase(); return <span className={styles.badge} data-status={normalized}>{title(value)}</span>; }
function HealthyState({ label }: { label: string }) { return <div className={styles.healthy}><CheckCircle2 size={19} /><span>{label}</span></div>; }
function EmptyState({ title: heading, description }: { title: string; description: string }) { return <div className={styles.empty}><Search size={21} /><strong>{heading}</strong><p>{description}</p></div>; }
function DataNotice() { return <div className={styles.dataNotice}><AlertCircle size={16} /><span>This view reached its safety limit. Totals are a bounded operational snapshot, not a full export.</span></div>; }
function AdminLoading({ label, embedded = false }: { label: string; embedded?: boolean }) { return <div className={`${styles.loading} ${embedded ? styles.loadingEmbedded : ""}`}><span /><strong>{label}</strong></div>; }
function AccessState({ title: heading, description }: { title: string; description: string }) { return <main className={styles.accessState}><div className={styles.accessIcon}><ShieldCheck size={30} /></div><span className={styles.eyebrow}>Pipelixr Admin</span><h1>{heading}</h1><p>{description}</p><div><Link href="/dashboard" className={styles.primaryButton}>Return to workspace</Link><button className={styles.secondaryButton} onClick={() => void signOut({ callbackUrl: "/login" })}>Sign out</button></div></main>; }

function initials(value: string) { return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "A"; }
function title(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function compactId(value: string) { return value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value; }
function number(value: number) { return new Intl.NumberFormat("en-NG").format(value); }
function money(kobo: number) { return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(kobo / 100); }
function date(timestamp: number) { return new Intl.DateTimeFormat("en-NG", { day: "2-digit", month: "short", year: "numeric" }).format(timestamp); }
function shortDate(timestamp: number) { return new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short" }).format(timestamp); }
function dateTime(timestamp: number) { return new Intl.DateTimeFormat("en-NG", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(timestamp); }
function relative(timestamp: number) { const seconds = Math.round((timestamp - Date.now()) / 1000); const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" }); const abs = Math.abs(seconds); if (abs < 60) return formatter.format(seconds, "second"); if (abs < 3600) return formatter.format(Math.round(seconds / 60), "minute"); if (abs < 86400) return formatter.format(Math.round(seconds / 3600), "hour"); return formatter.format(Math.round(seconds / 86400), "day"); }
