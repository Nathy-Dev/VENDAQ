import Image from "next/image";
import styles from "./Brand.module.css";

export default function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={styles.brand}>
      <span className={styles.mark} aria-hidden="true">
        <Image src="/logo.png" alt="" width={64} height={64} className={styles.image} />
      </span>
      {!compact && <span className={styles.wordmark}>pipelixr</span>}
    </span>
  );
}
