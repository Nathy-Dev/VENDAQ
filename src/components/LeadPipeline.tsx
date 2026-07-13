/* LeadPipeline.tsx */
"use client";

import React from "react";
import { Plus, Flame, Zap, Wind } from "lucide-react";
import styles from "./LeadPipeline.module.css";
import { formatDistanceToNow } from "date-fns";
import { PooledOrders, Order } from "@/types";
import { formatDisplayName } from "@/utils/format";

interface LeadPipelineProps {
  orders: PooledOrders | undefined;
  isLoading: boolean;
}

type Temperature = "hot" | "warm" | "cold";

const COLUMN_LABELS: Record<string, string> = {
  inquiry: "New Inquiries",
  qualified: "Interested",
  closing: "Awaiting Payment",
  done: "Completed",
};

export default function LeadPipeline({ orders, isLoading }: LeadPipelineProps) {
  const [now, setNow] = React.useState<number>(0);

  React.useEffect(() => {
    setNow(Date.now());
  }, []);

  const getTemperature = (order: Order, currentTime: number): Temperature => {
    if (order.status === "awaiting_payment" || order.totalAmount > 20000) return "hot";
    const effectiveTime = currentTime || order.createdAt;
    if (order.status === "processing" || effectiveTime - order.createdAt < 12 * 60 * 60 * 1000)
      return "warm";
    return "cold";
  };

  const isLeaking = (order: Order, currentTime: number): boolean => {
    const ageHours = (currentTime - order.createdAt) / (1000 * 60 * 60);
    return (
      getTemperature(order, currentTime) === "hot" &&
      ageHours > 4 &&
      order.status !== "delivered"
    );
  };

  const columns = [
    { id: "inquiry", items: orders?.pending || [] },
    { id: "qualified", items: orders?.processing || [] },
    { id: "closing", items: orders?.awaiting_payment || [] },
    { id: "done", items: orders?.delivered || [] },
  ];

  if (isLoading) {
    return (
      <div className={styles.pipelineContainer}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={styles.column}>
            <div className={styles.columnHeader}>
              <div style={{ height: 10, background: "rgba(255,255,255,0.05)", borderRadius: 4, width: "60%", animation: "pulse 1.5s ease-in-out infinite" }} />
            </div>
            {[1, 2].map((j) => (
              <div
                key={j}
                style={{
                  height: 88,
                  borderRadius: "0.75rem",
                  background: "rgba(255,255,255,0.025)",
                  border: "1px solid rgba(255,255,255,0.04)",
                  animation: "pulse 1.5s ease-in-out infinite",
                  animationDelay: `${j * 0.1}s`,
                }}
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={styles.pipelineContainer}>
      {columns.map((column) => (
        <div key={column.id} className={styles.column} data-status={column.id}>
          <div className={styles.columnHeader}>
            <h3 className={styles.columnTitle}>{COLUMN_LABELS[column.id]}</h3>
            <span className={styles.count}>{column.items.length}</span>
          </div>

          <div className={styles.cardList}>
            {column.items.length === 0 ? (
              <div className={styles.emptyColumn}>No leads here yet</div>
            ) : (
              column.items.map((order) => {
                const temp = getTemperature(order, now);
                const leaking = isLeaking(order, now);

                return (
                  <div
                    key={order._id}
                    className={`${styles.orderCard} ${leaking ? styles.leaking : ""}`}
                    data-temp={temp}
                  >
                    <div className={styles.heatBar} />

                    <div className={styles.cardTop}>
                      <div className={styles.cardNameRow}>
                        {temp === "hot" && <Flame size={13} style={{ color: "#ef4444", flexShrink: 0 }} />}
                        {temp === "warm" && <Zap size={13} style={{ color: "#f59e0b", flexShrink: 0 }} />}
                        {temp === "cold" && <Wind size={13} style={{ color: "#60a5fa", flexShrink: 0 }} />}
                        <span className={styles.customerName}>
                          {formatDisplayName(order.customerName, order.customerPhone)}
                        </span>
                      </div>
                    </div>

                    <div className={styles.orderValue}>
                      NGN {order.totalAmount.toLocaleString()}
                    </div>

                    <div className={styles.cardFooter}>
                      <span className={styles.orderDate}>
                        {formatDistanceToNow(order.createdAt, { addSuffix: true })}
                      </span>
                      {leaking && <span className={styles.leakingTag}>Cooling</span>}
                    </div>
                  </div>
                );
              })
            )}

            <button className={styles.addButton}>
              <Plus size={13} /> Add Lead
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
