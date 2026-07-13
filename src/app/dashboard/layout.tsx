import DashboardNavbar from "@/components/DashboardNavbar";
import styles from "./layout.module.css";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.layout}>
      <DashboardNavbar />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
