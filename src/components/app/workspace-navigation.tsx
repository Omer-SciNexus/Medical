"use client";

import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { Modal } from "@/components/ui/primitives";

export function WorkspaceNavigation({ children, currentLabel, clinicName }: { children: React.ReactNode; currentLabel: string; clinicName: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { const desktop = window.matchMedia("(min-width: 1021px)"); const closeOnDesktop = () => { if (desktop.matches) setOpen(false); }; desktop.addEventListener("change", closeOnDesktop); return () => desktop.removeEventListener("change", closeOnDesktop); }, []);
  return <><div className="workspace-desktop-nav">{children}</div><div className="workspace-mobile-nav">
    <Modal open={open} onOpenChange={setOpen} title="Your workspace" description={`${clinicName} · ${currentLabel}`} className="workspace-menu" trigger={<button className="shortcut-button" type="button" aria-label="Open workspace navigation"><Menu aria-hidden="true" />Menu</button>}>
      <div onClick={(event) => { if (event.target instanceof Element && event.target.closest("a")) setOpen(false); }}>{children}</div>
    </Modal>
  </div></>;
}
