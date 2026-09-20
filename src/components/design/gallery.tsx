"use client";

import { useEffect, useRef, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { ArrowUpRight, BookOpen, Check, ChevronRight, Command, Cross, HeartPulse, Keyboard, Layers, LayoutPanelTop, Moon, Search, SlidersHorizontal, Sun, Type } from "lucide-react";
import { Badge, Button, Input, Modal, Tooltip } from "@/components/ui/primitives";
import { ClinicalSpecimen, PatientSpecimen, Foundations, KeyboardGuide } from "./specimens";
import { Controls, FeedbackStates } from "./controls";

const sections = [
  { id: "overview", label: "Overview", icon: LayoutPanelTop, number: "00" },
  { id: "registers", label: "Two registers", icon: HeartPulse, number: "01" },
  { id: "foundations", label: "Foundations", icon: Type, number: "02" },
  { id: "controls", label: "Controls & actions", icon: SlidersHorizontal, number: "03" },
  { id: "feedback", label: "States & feedback", icon: Layers, number: "04" },
  { id: "keyboard", label: "Keyboard & focus", icon: Keyboard, number: "05" },
];

function SectionHeader({ number, title, description, children }: { number: string; title: string; description: string; children?: React.ReactNode }) {
  return <div className="section-header"><div><div className="section-heading"><span className="section-number mono">{number}</span><h2>{title}</h2></div><p className="section-description">{description}</p></div>{children}</div>;
}

export function DesignGallery() {
  const [dark, setDark] = useState(false);
  const [active, setActive] = useState("overview");
  const [register, setRegister] = useState("clinical");
  const [commandOpen, setCommandOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [commandIndex, setCommandIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const commandItems = [
    ...sections.map((section) => ({ id: section.id, label: section.label, icon: section.icon, action: () => navigate(section.id) })),
    { id: "patient", label: "Preview patient experience", icon: HeartPulse, action: () => { setRegister("patient"); navigate("registers"); } },
    { id: "queue", label: "Preview clinical queue", icon: BookOpen, action: () => { setRegister("clinical"); navigate("registers"); } },
    { id: "note", label: "New note — input specimen", icon: SlidersHorizontal, action: () => { navigate("controls"); window.setTimeout(() => document.getElementById("example-reason")?.focus(), 0); } },
  ].filter((item) => item.label.toLowerCase().includes(query.toLowerCase()));

  function navigate(id: string) { setActive(id); document.getElementById(id)?.scrollIntoView({ behavior: "instant", block: "start" }); }

  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; }, [dark]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommandOpen((open) => !open); } };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  useEffect(() => {
    if (!commandOpen) return;
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [commandOpen]);
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      const intersecting = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (intersecting[0]) setActive(intersecting[0].target.id);
    }, { rootMargin: "-75px 0px -55% 0px", threshold: 0 });
    sections.forEach(({ id }) => { const element = document.getElementById(id); if (element) observer.observe(element); });
    return () => observer.disconnect();
  }, []);

  function closeCommand(open: boolean) { setCommandOpen(open); if (!open) { setQuery(""); setCommandIndex(0); } }
  function runCommand(index: number) { const item = commandItems[index]; if (!item) return; closeCommand(false); window.setTimeout(item.action, 0); }

  return <div className="app-shell"><a className="skip-link" href="#main">Skip to content</a><aside className="sidebar"><a className="brand" href="#overview" onClick={() => setActive("overview")} aria-label="Meridian design library overview"><span className="brand-mark"><Cross /></span>meridian</a><p className="brand-caption">The work of care, considered.</p><div className="sidebar-section"><span className="eyebrow">Design library</span><nav className="side-nav" aria-label="Design library sections">{sections.map(({ id, label, icon: Icon, number }) => <a key={id} href={`#${id}`} data-active={active === id} aria-current={active === id ? "location" : undefined} onClick={() => setActive(id)}><Icon /><span>{label}</span><span className="nav-index mono">{number}</span></a>)}</nav></div><div className="sidebar-note"><span className="eyebrow">Clinical Instrument</span><p>Built around the people<br />on both sides of care.</p><div className="revision"><span>Design review</span><span className="mono">v0.1</span></div></div></aside><div className="workspace"><header className="topbar"><div className="breadcrumb"><span className="muted breadcrumb-first">Meridian</span><ChevronRight /><span>Design system</span></div><div className="topbar-actions"><Modal open={commandOpen} onOpenChange={closeCommand} title="Go to a specimen" description="Search the design library. These commands navigate the review specimens." className="command-dialog" trigger={<button className="shortcut-button" aria-label="Open command palette"><Search /><span>Find a component</span><kbd>Ctrl K</kbd></button>}><div className="command-search"><Search /><Input ref={searchRef} placeholder="Search components…" aria-label="Search the design library" role="combobox" aria-expanded="true" aria-controls="command-results" aria-activedescendant={commandItems[commandIndex] ? `command-${commandItems[commandIndex].id}` : undefined} value={query} onChange={(event) => { setQuery(event.target.value); setCommandIndex(0); }} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setCommandIndex((index) => commandItems.length ? (index + (event.key === "ArrowDown" ? 1 : -1) + commandItems.length) % commandItems.length : 0); } if (event.key === "Enter") { event.preventDefault(); runCommand(commandIndex); } }} /></div><div className="command-list" id="command-results" role="listbox" aria-label="Matching specimens">{commandItems.length ? commandItems.map((item, index) => <button type="button" id={`command-${item.id}`} className="command-item" key={item.id} role="option" aria-selected={commandIndex === index} data-selected={commandIndex === index} tabIndex={-1} onMouseMove={() => setCommandIndex(index)} onClick={() => runCommand(index)}><item.icon />{item.label}<span className="mono">↵</span></button>) : <p className="control-note">No matching specimen. Try “patient”, “controls” or “queue”.</p>}</div><div className="command-footer"><span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>Esc</kbd> close</span></div></Modal><span className="topbar-separator" /><Tooltip content={`Switch to ${dark ? "light" : "dark"} theme`}><Button variant="ghost" aria-label={`Switch to ${dark ? "light" : "dark"} theme`} onClick={() => setDark((value) => !value)}>{dark ? <Moon /> : <Sun />}<span className="topbar-theme-label">{dark ? "Dark" : "Light"}</span></Button></Tooltip></div></header>
      <main id="main" className="main-content"><section id="overview" className="intro"><div className="intro-meta"><span className="eyebrow">Meridian / Interface foundations</span><Badge>Design review <span className="mono">01</span></Badge></div><h1>Designed for the work of care.</h1><p>Precision for the care team. Reassurance for the patient.<br />A shared visual language, with room for two very different rhythms.</p><div className="intro-bottom"><span><Check />Two density registers</span><span><Sun />Light & dark</span><span><Keyboard />Keyboard first</span></div></section>
        <section id="registers" className="section"><Tabs.Root value={register} onValueChange={setRegister}><SectionHeader number="01" title="One system. Two rhythms." description="The same foundations, tuned to the person using them."><Tabs.List className="tabs-list" aria-label="Interface density"><Tabs.Trigger className="tab-trigger" value="clinical"><HeartPulse />Clinical</Tabs.Trigger><Tabs.Trigger className="tab-trigger" value="patient"><Cross />Patient</Tabs.Trigger></Tabs.List></SectionHeader><Tabs.Content value="clinical"><ClinicalSpecimen /></Tabs.Content><Tabs.Content value="patient"><PatientSpecimen /></Tabs.Content></Tabs.Root></section>
        <section id="foundations" className="section"><SectionHeader number="02" title="The essentials, well considered." description="Typography, surface and color do the heavy lifting."><span className="section-aside mono">Plex / OKLCH / 1px rules</span></SectionHeader><Foundations /></section>
        <section id="controls" className="section"><SectionHeader number="03" title="Clear intent. Predictable response." description="Working controls, including the moments that need a little more care."><span className="section-aside">Try the interactions</span></SectionHeader><Controls /></section>
        <section id="feedback" className="section"><SectionHeader number="04" title="Every state is part of the experience." description="Useful when empty, stable while loading, honest when interrupted." /><FeedbackStates /></section>
        <section id="keyboard" className="section"><SectionHeader number="05" title="Keep your hands on the work." description="Visible focus. Familiar shortcuts. No unexpected movement."><span className="section-aside icon-label"><Command />Keyboard reference</span></SectionHeader><KeyboardGuide /></section>
        <footer className="page-footer"><span>Meridian design library <span className="caption-dot" />Synthetic data only <span className="caption-dot" /><span className="mono">v0.1.0</span></span><a href="#overview" onClick={() => setActive("overview")}>Back to overview <ArrowUpRight /></a></footer>
      </main></div></div>;
}
