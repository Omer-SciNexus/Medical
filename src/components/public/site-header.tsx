"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { Brand } from "./brand";

const navigation = [
  { href: "#platform", label: "The platform" },
  { href: "#experience", label: "The experience" },
  { href: "#news", label: "Health news" },
];

export function SiteHeader() {
  const [open, setOpen] = React.useState(false);
  const header = React.useRef<HTMLElement>(null);
  const toggle = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    const desktop = window.matchMedia("(min-width: 981px)");
    const closeOnDesktop = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); toggle.current?.focus(); }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !header.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return <header ref={header} className="site-header">
    <div className="site-nav-shell">
      <div className="site-nav-row">
        <div className="site-nav-brand"><Brand /><span className="site-brand-caption">More room for care</span></div>
        <nav className="site-desktop-nav" aria-label="Main navigation">
          {navigation.map((item) => <a key={item.href} href={item.href}>{item.label}</a>)}
        </nav>
        <div className="site-nav-actions">
          <Link href="/sign-in" className="site-sign-in">Sign in</Link>
          <Link href="/sign-up" className="site-start">Get started <span><ArrowUpRight aria-hidden="true" /></span></Link>
          <button ref={toggle} type="button" className="site-menu-toggle" aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open} aria-controls="site-mobile-navigation" onClick={() => setOpen((current) => !current)}>
            {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
      </div>
      <nav id="site-mobile-navigation" className="site-mobile-nav" aria-label="Mobile navigation" hidden={!open}>
        <span className="site-menu-label">EXPLORE MERIDIAN</span>
        {navigation.map((item, index) => <a key={item.href} href={item.href} onClick={() => setOpen(false)}><span className="site-menu-number" aria-hidden="true">0{index + 1}</span>{item.label}<ArrowUpRight aria-hidden="true" /></a>)}
        <div className="site-mobile-actions">
          <Link href="/sign-in" onClick={() => setOpen(false)}>Sign in <ArrowUpRight aria-hidden="true" /></Link>
          <Link href="/design" onClick={() => setOpen(false)}>Explore the preview <ArrowUpRight aria-hidden="true" /></Link>
          <Link href="/sign-up" className="site-mobile-start" onClick={() => setOpen(false)}>Create a workspace <ArrowUpRight aria-hidden="true" /></Link>
        </div>
      </nav>
    </div>
  </header>;
}
