"use client";

import { useEffect, useRef, useState } from "react";

export function AuthenticatorQr({ secret }: { secret?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (!secret) return;
    let cancelled = false;
    const element = canvas.current;
    const uri = `otpauth://totp/Meridian:Clinic%20workspace?secret=${encodeURIComponent(secret)}&issuer=Meridian&algorithm=SHA1&digits=6&period=30`;
    void import("qrcode").then(async (qr) => {
      if (!cancelled && element) await qr.toCanvas(element, uri, { width: 208, margin: 4, errorCorrectionLevel: "M" });
    }).catch(() => { if (!cancelled) setUnavailable(true); });
    return () => { cancelled = true; if (element) element.getContext("2d")?.clearRect(0, 0, element.width, element.height); };
  }, [secret]);
  if (!secret) return null;
  if (unavailable) return <p className="field-hint">The QR code could not be displayed. Use the setup key below.</p>;
  return <div className="auth-qr"><canvas ref={canvas} width={208} height={208} role="img" aria-label="Scan this QR code with your authenticator, or use the setup key below." /></div>;
}
