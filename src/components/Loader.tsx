import Brand from "./Brand";
import styles from "./FoundationWorkspace.module.css";

export default function Loader({ label = "Opening your workspace…" }: { label?: string }) {
  return (
    <div className={styles.gate} role="status" aria-live="polite">
      <div className={styles.gateCard}>
        <Brand />
        <p className={styles.loadingLabel}><span className={styles.spinner} aria-hidden="true" />{label}</p>
      </div>
    </div>
  );
}
