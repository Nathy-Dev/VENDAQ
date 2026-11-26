import type { Metadata } from "next";
import DashboardNavbar from "@/components/DashboardNavbar";
import styles from "./layout.module.css";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your Pipelixr workspace for WhatsApp sales, leads, and follow-ups.",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.layout}>
      <DashboardNavbar />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
