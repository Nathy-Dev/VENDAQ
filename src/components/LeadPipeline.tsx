"use client";

import React from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import styles from "./LeadPipeline.module.css";
import { formatDistanceToNow } from "date-fns";

import { PooledOrders } from "@/types";

interface LeadPipelineProps {
  orders: PooledOrders | undefined;
  isLoading: boolean;
}


export default function LeadPipeline({ orders, isLoading }: LeadPipelineProps) {
  const columns = [
    { id: "pending", title: "New Leads", items: orders?.pending || [] },
    { id: "awaiting_payment", title: "Awaiting Payment", items: orders?.awaiting_payment || [] },
    { id: "processing", title: "Processing", items: orders?.processing || [] },
    { id: "delivered", title: "Completed", items: orders?.delivered || [] },
  ];

  if (isLoading) {
    return (
      <div className={styles.pipelineContainer}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={styles.column}>
            <div className={styles.columnHeader}>
              <div className="h-4 bg-slate-800 rounded w-1/2 animate-pulse"></div>
            </div>
            <div className="h-24 bg-slate-800 rounded w-full animate-pulse mt-4"></div>
            <div className="h-24 bg-slate-800 rounded w-full animate-pulse mt-4"></div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={styles.pipelineContainer}>
      {columns.map((column) => (
        <div key={column.id} className={styles.column}>
          <div className={styles.columnHeader}>
            <h3 className={styles.columnTitle}>{column.title}</h3>
            <span className={styles.count}>{column.items.length}</span>
          </div>

          <div className={styles.cardList}>
            {column.items.length === 0 ? (
              <div className={styles.emptyColumn}>No items</div>
            ) : (
              column.items.map((order) => (
                <div key={order._id} className={styles.orderCard}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span className={styles.customerName}>Customer {order.customerId.substring(0, 5)}</span>
                    <MoreHorizontal size={14} color="#64748b" />
                  </div>
                  <div className={styles.orderValue}>₦{order.totalAmount.toLocaleString()}</div>
                  <span className={styles.orderDate}>
                    {formatDistanceToNow(order.createdAt, { addSuffix: true })}
                  </span>
                </div>
              ))
            )}
            
            <button style={{ 
              marginTop: 'auto', 
              padding: '0.5rem', 
              borderRadius: '8px', 
              border: '1px dashed rgba(255,255,255,0.05)',
              color: '#64748b',
              fontSize: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              background: 'transparent',
              cursor: 'pointer'
            }}>
              <Plus size={14} /> Add Lead
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
