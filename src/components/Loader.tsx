"use client";

import React from 'react';
import Image from 'next/image';

export default function Loader() {
  return (
    <div style={{ 
      height: '100vh', 
      width: '100vw', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      backgroundColor: '#020617', 
      color: 'white',
      flexDirection: 'column',
      gap: '1.5rem',
      position: 'fixed',
      top: 0,
      left: 0,
      zIndex: 9999
    }}>
      <style>{`
        @keyframes float {
          0% { transform: translateY(0px); filter: drop-shadow(0 0 10px rgba(16, 185, 129, 0.2)); }
          50% { transform: translateY(-10px); filter: drop-shadow(0 0 25px rgba(16, 185, 129, 0.6)); }
          100% { transform: translateY(0px); filter: drop-shadow(0 0 10px rgba(16, 185, 129, 0.2)); }
        }
        @keyframes pulse-text {
          0%, 100% { opacity: 0.5; letter-spacing: 0.1em; }
          50% { opacity: 1; letter-spacing: 0.2em; }
        }
        .pipelixr-logo-anim {
          border-radius: 16px;
          animation: float 2.5s ease-in-out infinite;
        }
        .pipelixr-loader-text {
          font-family: inherit;
          font-weight: 700;
          color: #94a3b8;
          font-size: 0.875rem;
          text-transform: uppercase;
          animation: pulse-text 2.5s ease-in-out infinite;
        }
        .logoAccent {
          color: #10b981;
        }
      `}</style>
      
      <Image 
        src="/logo.png" 
        alt="PIPELIXR Logo" 
        width={72} 
        height={72} 
        className="pipelixr-logo-anim"
        priority
      />
      
      <div className="pipelixr-loader-text">
        PIPE<span className="logoAccent">LIXR</span>
      </div>
    </div>
  );
}
