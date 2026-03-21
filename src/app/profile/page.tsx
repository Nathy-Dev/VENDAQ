"use client";

import { useSession } from "next-auth/react";
import { User, Mail, Shield, Building, Edit3, Smartphone, Activity } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import Link from "next/link";
import DashboardNavbar from "@/components/DashboardNavbar";
import styles from "./profile.module.css";

export default function ProfilePage() {
  const { data: session } = useSession();
  
  const business = useQuery(api.businesses.getBusiness, 
    session?.user?.id ? { ownerId: session.user.id } : "skip"
  );
  
  return (
    <>
      <DashboardNavbar />
      <div className={styles.pageRoot}>
        <div className={styles.wrapper}>

          {/* Header */}
          <div className={styles.header}>
            <div>
              <h1 className={styles.pageTitle}>Your Profile</h1>
              <p className={styles.pageSubtitle}>Manage your personal operator identity and business entity.</p>
            </div>
            <Link href="/settings" className={styles.editBtn}>
              <Edit3 size={16} className={styles.editBtnIcon} /> Edit Settings
            </Link>
          </div>
          
          {/* Main Profile Card */}
          <div className={styles.profileCard}>
            {/* Banner */}
            <div className={styles.banner}>
              <div className={styles.avatarWrapper}>
                <div className={styles.avatar}>
                  {session?.user?.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={session.user.image} alt="Avatar" className={styles.avatarImg} />
                  ) : (
                    <span>{session?.user?.name?.[0]?.toUpperCase() || "U"}</span>
                  )}
                </div>
              </div>
              
              <div className={styles.roleBadge}>
                Role: <span>Admin</span>
              </div>
            </div>
            
            {/* Profile Body */}
            <div className={styles.profileBody}>
              <div className={styles.infoGrid}>
                
                {/* Personal Details */}
                <div className={styles.infoPanel}>
                  <div className={styles.panelHeader}>
                    <div className={`${styles.panelIcon} ${styles.panelIconGreen}`}>
                      <User size={18} />
                    </div>
                    <h2 className={styles.panelTitle}>Personal Identification</h2>
                  </div>
                  
                  <div className={styles.fieldList}>
                    <div>
                      <div className={styles.fieldLabel}>Operator Name</div>
                      <p className={styles.fieldValue}>
                        {session?.user?.name || "Loading..."}
                      </p>
                    </div>
                    
                    <div>
                      <div className={styles.fieldLabel}>
                        <Mail size={12} className={styles.fieldLabelIcon} /> Authorized Email
                      </div>
                      <p className={styles.fieldValue}>
                        {session?.user?.email || "Loading..."}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Business Details */}
                <div className={styles.infoPanel}>
                  <div className={styles.panelHeader}>
                    <div className={`${styles.panelIcon} ${styles.panelIconBlue}`}>
                      <Building size={18} />
                    </div>
                    <h2 className={styles.panelTitle}>Business Entity</h2>
                  </div>
                  
                  <div className={styles.fieldList}>
                    <div>
                      <div className={styles.fieldLabel}>Registered Workspace</div>
                      <p className={styles.fieldValue}>
                        {business ? business.name : "Loading..."}
                      </p>
                    </div>
                    
                    <div>
                      <div className={styles.fieldLabel}>
                        <Smartphone size={12} className={styles.fieldLabelIconBlue} /> WhatsApp Cloud API
                      </div>
                      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: '0.625rem' }}>
                        {business?.whatsappStatus === "connected" ? (
                          <span className={`${styles.statusBadge} ${styles.statusConnected}`}>
                            <span className={`${styles.statusDot} ${styles.statusDotGreen}`}></span> Connected
                          </span>
                        ) : (
                          <span className={`${styles.statusBadge} ${styles.statusDisconnected}`}>
                            <span className={`${styles.statusDot} ${styles.statusDotRed}`}></span> Disconnected
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                
              </div>
            </div>
          </div>
          
          {/* Bottom Status Cards */}
          <div className={styles.bottomGrid}>
            <div className={styles.bottomCard}>
              <div className={`${styles.bottomCardIcon} ${styles.bottomCardIconGreen}`}>
                <Shield size={24} />
              </div>
              <div>
                <h3 className={styles.bottomCardTitle}>Account Security</h3>
                <p className={styles.bottomCardDesc}>
                  Your operator identity is secured with enterprise-grade OAuth validation. No password changes required.
                </p>
              </div>
            </div>
            
            <div className={styles.bottomCard}>
              <div className={`${styles.bottomCardIcon} ${styles.bottomCardIconBlue}`}>
                <Activity size={24} />
              </div>
              <div>
                <h3 className={styles.bottomCardTitle}>System Status</h3>
                <p className={styles.bottomCardDesc}>
                  All PIPELIXR services are operational. Messaging synchronization runs in real-time.
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
