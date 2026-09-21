"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import * as Tabs from "@radix-ui/react-tabs";
import { ArrowDown, ArrowRight, ArrowUpRight, BookOpen, Building2, ChevronRight, Command, Cross, HeartPulse, Keyboard, Layers, LayoutPanelTop, Moon, Search, SlidersHorizontal, Sun, Type } from "lucide-react";
import { Button, Input, Modal, Tooltip } from "@/components/ui/primitives";
import { ClinicalSpecimen, PatientSpecimen, Foundations, KeyboardGuide } from "./specimens";
import { Controls, FeedbackStates } from "./controls";
import { CareGraphic, MeridianMark } from "./graphics";

const sections = [
  { id: "overview", label: "Overview", icon: LayoutPanelTop, number: "00" },
  { id: "registers", label: "The experience", icon: HeartPulse, number: "01" },
  { id: "foundations", label: "Visual language", icon: Type, number: "02" },
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
  function navigate(id: string) { setActive(id); document.getElementById(id)?.scrollIntoView({ behavior: "instant", block: "start" }); }
  const commandItems = [
    ...sections.map((section) => ({ id: section.id, label: section.label, icon: section.icon, action: () => navigate(section.id) })),
    { id: "patient", label: "Preview patient experience", icon: HeartPulse, action: () => { setRegister("patient"); navigate("registers"); } },
    { id: "queue", label: "Preview clinical queue", icon: BookOpen, action: () => { setRegister("clinical"); navigate("registers"); } },
    { id: "note", label: "New note — input specimen", icon: SlidersHorizontal, action: () => { navigate("controls"); window.setTimeout(() => document.getElementById("example-reason")?.focus(), 0); } },
  ].filter((item) => item.label.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; return () => { delete document.documentElement.dataset.theme; }; }, [dark]);
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
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    }, { rootMargin: "-75px 0px -55% 0px", threshold: 0 });
    sections.forEach(({ id }) => { const element = document.getElementById(id); if (element) observer.observe(element); });
    return () => observer.disconnect();
  }, []);
  function closeCommand(open: boolean) { setCommandOpen(open); if (!open) { setQuery(""); setCommandIndex(0); } }
  function runCommand(index: number) { const item = commandItems[index]; if (!item) return; closeCommand(false); window.setTimeout(item.action, 0); }

  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <aside className="sidebar">
      <Link className="brand" href="/" aria-label="Meridian home"><span className="brand-mark"><MeridianMark /></span>meridian<span className="brand-period">.</span></Link>
      <div className="workspace-identity"><span className="workspace-icon"><Building2 /></span><div><strong>Meridian Clinic</strong><span>Experience preview</span></div><span className="workspace-marker mono">M</span></div>
      <div className="sidebar-section"><span className="eyebrow">Explore the system</span><nav className="side-nav" aria-label="Design library sections">{sections.map(({ id, label, icon: Icon, number }) => <a key={id} href={`#${id}`} data-active={active === id} aria-current={active === id ? "location" : undefined} onClick={() => setActive(id)}><Icon /><span>{label}</span><span className="nav-index mono">{number}</span></a>)}</nav></div>
      <div className="sidebar-note"><div className="sidebar-symbol"><MeridianMark /><span className="eyebrow">Thoughtfully<br />connected.</span></div><p>One considered experience.<br />Every moment of care.</p><a href="#keyboard" className="sidebar-help" onClick={() => setActive("keyboard")}><Keyboard />Keyboard shortcuts<ArrowUpRight /></a><div className="revision"><span>Design review</span><span className="mono">02 / 2026</span></div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumb"><span className="breadcrumb-app"><LayoutPanelTop /></span><span className="muted breadcrumb-first">Workspace</span><ChevronRight /><span>Experience overview</span></div>
        <div className="topbar-actions"><Modal open={commandOpen} onOpenChange={closeCommand} title="Go to a specimen" description="Search the design library. These commands navigate the review specimens." className="command-dialog" trigger={<button className="shortcut-button" aria-label="Open command palette"><Search /><span>Search anything</span><kbd>Ctrl K</kbd></button>}>
          <div className="command-search"><Search /><Input ref={searchRef} placeholder="Search components…" aria-label="Search the design library" role="combobox" aria-expanded="true" aria-controls="command-results" aria-activedescendant={commandItems[commandIndex] ? `command-${commandItems[commandIndex].id}` : undefined} value={query} onChange={(event) => { setQuery(event.target.value); setCommandIndex(0); }} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setCommandIndex((index) => commandItems.length ? (index + (event.key === "ArrowDown" ? 1 : -1) + commandItems.length) % commandItems.length : 0); } if (event.key === "Enter") { event.preventDefault(); runCommand(commandIndex); } }} /></div>
          <div className="command-list" id="command-results" role="listbox" aria-label="Matching specimens">{commandItems.length ? commandItems.map((item, index) => <button type="button" id={`command-${item.id}`} className="command-item" key={item.id} role="option" aria-selected={commandIndex === index} data-selected={commandIndex === index} tabIndex={-1} onMouseMove={() => setCommandIndex(index)} onClick={() => runCommand(index)}><item.icon />{item.label}<span className="mono">↵</span></button>) : <p className="control-note">No matching specimen. Try “patient”, “controls” or “queue”.</p>}</div>
          <div className="command-footer"><span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>Esc</kbd> close</span></div>
        </Modal><span className="topbar-separator" /><Tooltip content={`Switch to ${dark ? "light" : "dark"} theme`}><Button variant="ghost" className="theme-button" aria-label={`Switch to ${dark ? "light" : "dark"} theme`} onClick={() => setDark((value) => !value)}>{dark ? <Moon /> : <Sun />}<span className="topbar-theme-label">{dark ? "Dark" : "Light"}</span></Button></Tooltip></div>
      </header>
      <main id="main" className="main-content">
        <section id="overview" className="intro"><div className="intro-copy">
          <div className="intro-meta"><span className="eyebrow"><span className="intro-rule" />A considered approach to care</span><span className="edition mono">Edition 02</span></div>
          <h1>Designed for the<br /><span>work of care.</span></h1><p>A clearer day for your care team.<br />A calmer experience for every patient.</p>
          <div className="intro-actions"><Button onClick={() => { setRegister("clinical"); navigate("registers"); }}>Explore the workspace <ArrowDown /></Button><Button variant="ghost" onClick={() => { setRegister("patient"); navigate("registers"); }}>Patient experience <ArrowUpRight /></Button></div>
          <div className="intro-footnote"><span className="mini-mark"><MeridianMark /></span><span>Precision in the details.<br /><strong>People at the center.</strong></span></div>
        </div><CareGraphic /></section>
        <div className="experience-strip" aria-label="The planned visit journey"><span className="eyebrow">A continuous experience</span><ol>{["Book", "Visit", "Care plan", "Follow-up"].map((step, index) => <li key={step}><span className="journey-number mono">0{index + 1}</span><span>{step}</span>{index < 3 && <ArrowRight />}</li>)}</ol><span className="strip-note">From first hello to what’s next.</span></div>
        <section id="registers" className="section"><Tabs.Root value={register} onValueChange={setRegister}><SectionHeader number="01" title="Built around your day." description="A focused workspace for clinicians. A welcoming space for patients."><Tabs.List className="tabs-list" aria-label="Interface density"><Tabs.Trigger className="tab-trigger" value="clinical"><HeartPulse />Clinical</Tabs.Trigger><Tabs.Trigger className="tab-trigger" value="patient"><Cross />Patient</Tabs.Trigger></Tabs.List></SectionHeader><Tabs.Content value="clinical"><ClinicalSpecimen /></Tabs.Content><Tabs.Content value="patient"><PatientSpecimen /></Tabs.Content></Tabs.Root></section>
        <section id="foundations" className="section"><SectionHeader number="02" title="A language of clarity." description="Warm surfaces. Purposeful color. Typography you can trust."><span className="section-aside"><span className="detail-line" />The Meridian palette</span></SectionHeader><Foundations /></section>
        <section id="controls" className="section"><SectionHeader number="03" title="Small details. A smoother day." description="Familiar actions with clear intent, from a quiet save to a careful decision."><span className="section-aside icon-label">Try the interactions <ArrowDown /></span></SectionHeader><Controls /></section>
        <section id="feedback" className="section"><SectionHeader number="04" title="Considered in every state." description="A clear way forward, even when the unexpected happens." /><FeedbackStates /></section>
        <section id="keyboard" className="section"><SectionHeader number="05" title="Find your rhythm." description="Move through the work with familiar shortcuts and visible focus."><span className="section-aside icon-label"><Command />Keyboard reference</span></SectionHeader><KeyboardGuide /></section>
        <footer className="page-footer"><span className="footer-brand"><MeridianMark />meridian<span className="footer-separator" />Experience preview · Synthetic data only</span><a href="#overview" onClick={() => setActive("overview")}>Back to overview <ArrowUpRight /></a></footer>
      </main>
    </div>
  </div>;
}
