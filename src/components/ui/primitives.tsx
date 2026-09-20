"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as SelectPrimitive from "@radix-ui/react-select";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Button({ className, variant = "primary", size = "default", asChild = false, ...props }: React.ComponentProps<"button"> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "default" | "small" | "icon"; asChild?: boolean }) {
  const Component = asChild ? Slot : "button";
  return <Component className={cn("button", `button-${variant}`, `button-${size}`, className)} {...props} />;
}
export function Badge({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: "neutral" | "accent" | "high" | "critical" | "low"; className?: string }) {
  return <span className={cn("badge", `badge-${tone}`, className)}>{children}</span>;
}
export function Input({ className, ...props }: React.ComponentProps<"input">) { return <input className={cn("input", className)} {...props} />; }
export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) { return <textarea className={cn("input textarea", className)} {...props} />; }
export function Field({ label, id, children, error, hint, className }: { label: string; id: string; children: React.ReactNode; error?: string; hint?: string; className?: string }) {
  return <div className={cn("field", className)}><label htmlFor={id}>{label}</label>{children}{error ? <p id={`${id}-error`} className="field-error" role="alert">{error}</p> : hint ? <p id={`${id}-hint`} className="field-hint">{hint}</p> : null}</div>;
}
export function Select({ id, value, onValueChange, placeholder, options, label, disabled }: { id: string; value?: string; onValueChange?: (value: string) => void; placeholder?: string; options: { value: string; label: string }[]; label: string; disabled?: boolean }) {
  return <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}><SelectPrimitive.Trigger id={id} className="input select-trigger" aria-label={label}><SelectPrimitive.Value placeholder={placeholder} /><SelectPrimitive.Icon><ChevronDown /></SelectPrimitive.Icon></SelectPrimitive.Trigger><SelectPrimitive.Portal><SelectPrimitive.Content position="popper" sideOffset={5} className="floating select-content"><SelectPrimitive.Viewport>{options.map((option) => <SelectPrimitive.Item key={option.value} value={option.value} className="select-item"><SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText><SelectPrimitive.ItemIndicator><Check /></SelectPrimitive.ItemIndicator></SelectPrimitive.Item>)}</SelectPrimitive.Viewport></SelectPrimitive.Content></SelectPrimitive.Portal></SelectPrimitive.Root>;
}
export function Checkbox({ id, checked, onCheckedChange, children }: { id: string; checked: boolean; onCheckedChange: (checked: boolean) => void; children: React.ReactNode }) {
  return <div className="check-field"><CheckboxPrimitive.Root id={id} className="checkbox" checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)}><CheckboxPrimitive.Indicator><Check /></CheckboxPrimitive.Indicator></CheckboxPrimitive.Root><label htmlFor={id}>{children}</label></div>;
}
export function Switch({ id, checked, onCheckedChange, children }: { id: string; checked: boolean; onCheckedChange: (checked: boolean) => void; children: React.ReactNode }) {
  return <div className="switch-field"><label htmlFor={id}>{children}</label><SwitchPrimitive.Root className="switch" id={id} checked={checked} onCheckedChange={onCheckedChange}><SwitchPrimitive.Thumb className="switch-thumb" /></SwitchPrimitive.Root></div>;
}
export function Tooltip({ children, content }: { children: React.ReactNode; content: string }) {
  return <TooltipPrimitive.Provider delayDuration={400}><TooltipPrimitive.Root><TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger><TooltipPrimitive.Portal><TooltipPrimitive.Content className="tooltip floating" sideOffset={6}>{content}</TooltipPrimitive.Content></TooltipPrimitive.Portal></TooltipPrimitive.Root></TooltipPrimitive.Provider>;
}
export function Modal({ open, onOpenChange, title, description, children, trigger, className }: { open?: boolean; onOpenChange?: (open: boolean) => void; title: string; description: string; children: React.ReactNode; trigger?: React.ReactNode; className?: string }) {
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>{trigger && <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>}<DialogPrimitive.Portal><DialogPrimitive.Overlay className="dialog-overlay" /><DialogPrimitive.Content className={cn("dialog-content floating", className)}><div className="dialog-heading"><DialogPrimitive.Title>{title}</DialogPrimitive.Title><DialogPrimitive.Close asChild><Button variant="ghost" size="icon" aria-label="Close dialog"><X /></Button></DialogPrimitive.Close></div><DialogPrimitive.Description className="dialog-description">{description}</DialogPrimitive.Description>{children}</DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>;
}
export function Skeleton({ className }: { className?: string }) { return <span className={cn("skeleton", className)} aria-hidden="true" />; }
