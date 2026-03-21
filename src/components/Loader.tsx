"use client";

import React from 'react';

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
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .pipelixr-spinner {
          width: 48px;
          height: 48px;
          border: 4px solid rgba(16, 185, 129, 0.1);
          border-top-color: #10b981;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          box-shadow: 0 0 20px rgba(16, 185, 129, 0.2);
        }
        .pipelixr-loader-text {
          font-family: sans-serif;
          font-weight: 600;
          letter-spacing: 0.05em;
          color: #94a3b8;
          font-size: 0.875rem;
          text-transform: uppercase;
        }
      `}</style>
      <div className="pipelixr-spinner" />
      <div className="pipelixr-loader-text">PIPELIXR</div>
    </div>
  );
}
