"use client";

import { useEffect, useRef, useState } from "react";

/** Draws the server's own otpauth URI, so the authenticator entry carries the account label and exact TOTP parameters. */
export function AuthenticatorQr({ uri }: { uri?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    setUnavailable(false);
    if (!uri) return;
    let cancelled = false;
    const element = canvas.current;
    void import("qrcode").then(async (qr) => {
      if (!cancelled && element) await qr.toCanvas(element, uri, { width: 208, margin: 4, errorCorrectionLevel: "M" });
    }).catch(() => { if (!cancelled) setUnavailable(true); });
    return () => { cancelled = true; if (element) element.getContext("2d")?.clearRect(0, 0, element.width, element.height); };
  }, [uri]);
  if (!uri) return null;
  if (unavailable) return <p className="field-hint">The QR code could not be displayed. Use the setup key below.</p>;
  return <div className="auth-qr"><canvas ref={canvas} width={208} height={208} role="img" aria-label="Scan this QR code with your authenticator, or use the setup key below." /></div>;
}
