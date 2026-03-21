/* LeadPipeline.tsx */
"use client";

import React from "react";
import { MoreHorizontal, Plus, Flame, Zap, Wind } from "lucide-react";
import styles from "./LeadPipeline.module.css";
import { formatDistanceToNow } from "date-fns";
import { PooledOrders, Order } from "@/types";
import { formatDisplayName } from "@/utils/format";

interface LeadPipelineProps {
  orders: PooledOrders | undefined;
  isLoading: boolean;
}

type Temperature = "hot" | "warm" | "cold";

export default function LeadPipeline({ orders, isLoading }: LeadPipelineProps) {
  
  const [now, setNow] = React.useState<number>(0);

  React.useEffect(() => {
    setNow(Date.now());
  }, []);

  const getTemperature = (order: Order, currentTime: number): Temperature => {
    // Logic for heat scoring
    if (order.status === "awaiting_payment" || order.totalAmount > 20000) return "hot";
    
    // If we don't have the current time yet, use order.createdAt as a safe fallback for the calculation
    const effectiveTime = currentTime || order.createdAt;
    if (order.status === "processing" || (effectiveTime - order.createdAt < 12 * 60 * 60 * 1000)) return "warm";
    
    return "cold";
  };

  const isLeaking = (order: Order, currentTime: number): boolean => {
    // If it's hot but older than 4 hours, it's "leaking" (cooling down)
    const ageHours = (currentTime - order.createdAt) / (1000 * 60 * 60);
    return getTemperature(order, currentTime) === "hot" && ageHours > 4 && order.status !== "delivered";
  };

  const columns = [
    { id: "inquiry", title: "Inquiry", items: orders?.pending || [] },
    { id: "qualified", title: "Qualified", items: orders?.processing || [] },
    { id: "closing", title: "Closing", items: orders?.awaiting_payment || [] },
    { id: "done", title: "Done", items: orders?.delivered || [] },
  ];

  if (isLoading) {
    return (
      <div className={styles.pipelineContainer}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={styles.column}>
            <div className={styles.columnHeader}>
              <div className="h-4 bg-slate-800 rounded w-1/2 animate-pulse"></div>
            </div>
            <div className="h-32 bg-slate-800/50 rounded-xl w-full animate-pulse mt-4"></div>
            <div className="h-32 bg-slate-800/50 rounded-xl w-full animate-pulse mt-4"></div>
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
            <h3 className={styles.columnTitle}>{column.title}</h3>
            <span className={styles.count}>{column.items.length}</span>
          </div>

          <div className={styles.cardList}>
            {column.items.length === 0 ? (
              <div className={styles.emptyColumn}>No leads here</div>
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
                    
                    <div className="flex justify-between items-start mb-2">
                       <div className="flex items-center gap-1.5">
                          {temp === "hot" && <Flame size={14} className="text-red-500" />}
                          {temp === "warm" && <Zap size={14} className="text-amber-500" />}
                          {temp === "cold" && <Wind size={14} className="text-blue-400" />}
                          <span className={styles.customerName}>
                            {formatDisplayName(order.customerName, order.customerPhone)}
                          </span>
                       </div>
                       <MoreHorizontal size={14} className="text-slate-500 cursor-pointer" />
                    </div>

                    <div className={styles.orderValue}>
                      ₦{order.totalAmount.toLocaleString()}
                    </div>
                    
                    <div className="flex items-center justify-between mt-3">
                      <span className={styles.orderDate}>
                        {formatDistanceToNow(order.createdAt, { addSuffix: true })}
                      </span>
                      {leaking && (
                        <span className="text-[9px] font-bold text-red-500 animate-pulse">
                          LEAKING
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            
            <button className={styles.addButton}>
              <Plus size={14} /> Add Lead
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
