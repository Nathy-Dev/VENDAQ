import DashboardNavbar from "@/components/DashboardNavbar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#020617' }}>
      <DashboardNavbar />
      <main style={{ flex: 1 }}>
        {children}
      </main>
    </div>
  );
}
