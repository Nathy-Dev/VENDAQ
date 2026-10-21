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
              <h1 className={styles.pageTitle}>My Profile</h1>
              <p className={styles.pageSubtitle}>Your account details and business info.</p>
            </div>
            <Link href="/settings" className={styles.editBtn}>
              <Edit3 size={15} className={styles.editBtnIcon} /> Edit Settings
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
                Admin
              </div>
            </div>
            
            {/* Profile Body */}
            <div className={styles.profileBody}>
              <div className={styles.infoGrid}>
                
                {/* Personal Details */}
                <div className={styles.infoPanel}>
                  <div className={styles.panelHeader}>
                    <div className={`${styles.panelIcon} ${styles.panelIconGreen}`}>
                      <User size={17} />
                    </div>
                    <h2 className={styles.panelTitle}>Your Details</h2>
                  </div>
                  
                  <div className={styles.fieldList}>
                    <div>
                      <div className={styles.fieldLabel}>Name</div>
                      <p className={styles.fieldValue}>
                        {session?.user?.name || "Loading…"}
                      </p>
                    </div>
                    
                    <div>
                      <div className={styles.fieldLabel}>
                        <Mail size={11} className={styles.fieldLabelIcon} /> Email
                      </div>
                      <p className={styles.fieldValue}>
                        {session?.user?.email || "Loading…"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Business Details */}
                <div className={styles.infoPanel}>
                  <div className={styles.panelHeader}>
                    <div className={`${styles.panelIcon} ${styles.panelIconBlue}`}>
                      <Building size={17} />
                    </div>
                    <h2 className={styles.panelTitle}>Your Business</h2>
                  </div>
                  
                  <div className={styles.fieldList}>
                    <div>
                      <div className={styles.fieldLabel}>Business Name</div>
                      <p className={styles.fieldValue}>
                        {business ? business.name : "Loading…"}
                      </p>
                    </div>
                    
                    <div>
                      <div className={styles.fieldLabel}>
                        <Smartphone size={11} className={styles.fieldLabelIconBlue} /> WhatsApp
                      </div>
                      <div style={{ paddingBottom: "0.625rem" }}>
                        {business?.whatsappStatus === "connected" ? (
                          <span className={`${styles.statusBadge} ${styles.statusConnected}`}>
                            <span className={`${styles.statusDot} ${styles.statusDotGreen}`}></span> Connected
                          </span>
                        ) : (
                          <span className={`${styles.statusBadge} ${styles.statusDisconnected}`}>
                            <span className={`${styles.statusDot} ${styles.statusDotRed}`}></span> Not connected
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
                <Shield size={22} />
              </div>
              <div>
                <h3 className={styles.bottomCardTitle}>Your account is secure</h3>
                <p className={styles.bottomCardDesc}>
                  You log in with Google, so there&apos;s no password to worry about. Your account is protected by Google&apos;s security.
                </p>
              </div>
            </div>
            
            <div className={styles.bottomCard}>
              <div className={`${styles.bottomCardIcon} ${styles.bottomCardIconBlue}`}>
                <Activity size={22} />
              </div>
              <div>
                <h3 className={styles.bottomCardTitle}>Everything is running</h3>
                <p className={styles.bottomCardDesc}>
                  All systems are online. Your AI is active and messages are syncing in real-time.
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
