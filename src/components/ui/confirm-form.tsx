"use client";

import { useRef, useState } from "react";
import { Button, Modal } from "./primitives";

/** Keeps native validation and the original server action; confirmation never submits on its own. */
export function ConfirmForm({ title, description, confirmLabel, children, ...props }: Omit<React.ComponentProps<"form">, "onSubmit" | "ref"> & { title: string; description: string; confirmLabel: string }) {
  const form = useRef<HTMLFormElement>(null);
  const approved = useRef(false);
  const submitter = useRef<HTMLButtonElement | HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  function close() { setOpen(false); requestAnimationFrame(() => submitter.current?.focus()); }
  return <form {...props} ref={form} onSubmit={(event) => {
    if (approved.current) { approved.current = false; return; }
    event.preventDefault();
    const target = (event.nativeEvent as SubmitEvent).submitter;
    submitter.current = target instanceof HTMLButtonElement || target instanceof HTMLInputElement ? target : null;
    setOpen(true);
  }}>
    {children}
    <Modal open={open} onOpenChange={(next) => { if (!next) close(); else setOpen(true); }} title={title} description={description}>
      <div className="dialog-actions"><Button type="button" variant="ghost" onClick={close}>Go back</Button><Button type="button" onClick={() => {
        if (!form.current?.reportValidity()) { setOpen(false); return; }
        approved.current = true;
        close();
        form.current.requestSubmit(submitter.current ?? undefined);
        approved.current = false;
      }}>{confirmLabel}</Button></div>
    </Modal>
  </form>;
}
