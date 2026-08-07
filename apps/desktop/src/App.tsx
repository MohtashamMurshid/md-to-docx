import { useMemo, useRef, useState } from "react";
import { convertMarkdownToDocx, type Options } from "@mohtasham/md-to-docx";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Check, ChevronDown, Download, FileText, LayoutTemplate, Menu, Search,
  Settings2, Sparkles, Upload, X, Zap,
} from "lucide-react";
import { templates } from "./templates";

type Tab = "write" | "preview";

type Settings = { fontFamily: string; paragraphSize: number; alignment: "LEFT" | "JUSTIFIED"; pageNumbers: boolean };

const initial = templates[1];

function countWords(text: string) { return text.trim() ? text.trim().split(/\s+/).length : 0; }
function estimatedPages(words: number) { return Math.max(1, Math.ceil(words / 450)); }

export default function App() {
  const [selectedId, setSelectedId] = useState(initial.id);
  const [markdown, setMarkdown] = useState(initial.markdown);
  const [filename, setFilename] = useState(initial.filename);
  const [baseOptions, setBaseOptions] = useState<Options>(initial.options);
  const [activeTab, setActiveTab] = useState<Tab>("write");
  const [query, setQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>({ fontFamily: initial.options.style?.fontFamily ?? "Aptos", paragraphSize: initial.options.style?.paragraphSize ?? 22, alignment: (initial.options.style?.paragraphAlignment as Settings["alignment"]) ?? "LEFT", pageNumbers: Boolean(initial.options.template?.pageNumbering) });
  const fileInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  const words = useMemo(() => countWords(markdown), [markdown]);
  const previewMarkdown = useMemo(() => markdown
    .replace(/^\[TOC\]$/gm, "_Table of contents will be generated in Word._")
    .replace(/^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\n>/gm, "> **$1**\n>"), [markdown]);
  const filtered = templates.filter((template) => `${template.name} ${template.category}`.toLowerCase().includes(query.toLowerCase()));
  const groups = Array.from(new Set(filtered.map((template) => template.category)));

  function applyTemplate(id: string) {
    const template = templates.find((entry) => entry.id === id)!;
    setSelectedId(id); setMarkdown(template.markdown); setFilename(template.filename); setBaseOptions(template.options);
    setSettings({ fontFamily: template.options.style?.fontFamily ?? "Aptos", paragraphSize: template.options.style?.paragraphSize ?? 22, alignment: (template.options.style?.paragraphAlignment as Settings["alignment"]) ?? "LEFT", pageNumbers: Boolean(template.options.template?.pageNumbering) });
    setSidebarOpen(false); setToast(`${template.name} applied`); window.setTimeout(() => setToast(null), 2200);
  }

  async function importFile(file?: File) {
    if (file) {
      setMarkdown(await file.text()); setFilename(file.name.replace(/\.(md|markdown|mdown|txt)$/i, "")); setSelectedId(""); return;
    }
    if (window.desktop) {
      const result = await window.desktop.openMarkdown();
      if (result) { setMarkdown(result.content); setFilename(result.name.replace(/\.[^.]+$/, "")); setSelectedId(""); }
    } else fileInput.current?.click();
  }

  async function exportDocument() {
    if (!markdown.trim()) return;
    setExporting(true);
    try {
      const options: Options = {
        ...baseOptions,
        style: { ...baseOptions.style, fontFamily: settings.fontFamily, paragraphSize: settings.paragraphSize, paragraphAlignment: settings.alignment },
        template: settings.pageNumbers ? { ...baseOptions.template, pageNumbering: baseOptions.template?.pageNumbering ?? { display: "current", alignment: "CENTER" } } : { ...baseOptions.template, pageNumbering: { display: "none" } },
        metadata: { ...baseOptions.metadata, title: filename || "Document" },
      };
      const blob = await convertMarkdownToDocx(markdown, options);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let saved: string | null = null;
      if (window.desktop) saved = await window.desktop.saveDocx(filename || "document", bytes);
      else {
        const url = URL.createObjectURL(blob); const link = document.createElement("a");
        link.href = url; link.download = `${filename || "document"}.docx`; link.click(); URL.revokeObjectURL(url); saved = link.download;
      }
      if (saved) { setToast("Word document exported"); window.setTimeout(() => setToast(null), 2600); }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Export failed");
    } finally { setExporting(false); }
  }

  return <div className="app-shell" onKeyDown={(event) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    if (event.key.toLowerCase() === "k") { event.preventDefault(); searchInput.current?.focus(); }
    if (event.key === "Enter") { event.preventDefault(); void exportDocument(); }
  }}>
    <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
      <div className="brand"><div className="brand-mark"><FileText size={18}/></div><div><strong>Doctera</strong><span>Document studio</span></div><button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)}><X size={18}/></button></div>
      <div className="search"><Search size={15}/><input ref={searchInput} aria-label="Search templates" placeholder="Search templates" value={query} onChange={(event) => setQuery(event.target.value)}/><kbd>⌘K</kbd></div>
      <nav className="template-list">
        <div className="nav-label"><LayoutTemplate size={14}/> Templates <span>{filtered.length}</span></div>
        {groups.map((group) => <section key={group}><h2>{group}</h2>{filtered.filter((template) => template.category === group).map((template) => <button className={`template-item ${selectedId === template.id ? "selected" : ""}`} key={template.id} onClick={() => applyTemplate(template.id)}><span className="template-icon" style={{"--accent": template.accent} as React.CSSProperties}><FileText size={16}/></span><span><b>{template.name}</b><small>{template.description}</small></span>{selectedId === template.id && <Check size={15}/>}</button>)}</section>)}
      </nav>
      <div className="sidebar-footer"><div className="powered"><Zap size={14}/><span><b>Local conversion</b><small>Your document stays on this device</small></span></div></div>
    </aside>

    <main className="workspace">
      <header className="topbar">
        <div className="file-identity"><button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)}><Menu size={19}/></button><div className="file-chip"><FileText size={16}/></div><div><input aria-label="Output filename" value={filename} onChange={(event) => setFilename(event.target.value)}/><span>Word document · Saved locally</span></div></div>
        <div className="actions"><button className="button secondary" onClick={() => importFile()}><Upload size={16}/><span>Import .md</span></button><button className="button secondary settings-button" onClick={() => setSettingsOpen(!settingsOpen)}><Settings2 size={16}/><span>Format</span><ChevronDown size={14}/></button><button className="button primary" onClick={exportDocument} disabled={exporting || !markdown.trim()}>{exporting ? <span className="spinner"/> : <Download size={16}/>}<span>{exporting ? "Building…" : "Export .docx"}</span></button></div>
      </header>

      {settingsOpen && <div className="format-panel">
        <label><span>Typeface</span><select value={settings.fontFamily} onChange={(event) => setSettings({...settings, fontFamily: event.target.value})}><option>Aptos</option><option>Aptos Display</option><option>Arial</option><option>Calibri</option><option>Georgia</option><option>Times New Roman</option><option>Trebuchet MS</option></select></label>
        <label><span>Body size</span><select value={settings.paragraphSize} onChange={(event) => setSettings({...settings, paragraphSize: Number(event.target.value)})}><option value="20">10 pt</option><option value="22">11 pt</option><option value="24">12 pt</option><option value="28">14 pt</option></select></label>
        <label><span>Alignment</span><select value={settings.alignment} onChange={(event) => setSettings({...settings, alignment: event.target.value as Settings["alignment"]})}><option value="LEFT">Left</option><option value="JUSTIFIED">Justified</option></select></label>
        <label className="toggle-label"><span>Page numbers</span><button role="switch" aria-checked={settings.pageNumbers} className={`toggle ${settings.pageNumbers ? "on" : ""}`} onClick={() => setSettings({...settings, pageNumbers: !settings.pageNumbers})}><i/></button></label>
      </div>}

      <div className="document-toolbar"><div className="tabs"><button className={activeTab === "write" ? "active" : ""} onClick={() => setActiveTab("write")}>Write</button><button className={activeTab === "preview" ? "active" : ""} onClick={() => setActiveTab("preview")}>Preview</button></div><div className="doc-stats"><span>{words.toLocaleString()} words</span><i/><span>~{estimatedPages(words)} {estimatedPages(words) === 1 ? "page" : "pages"}</span></div></div>

      <section className="canvas" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void importFile(event.dataTransfer.files[0]); }}>
        {activeTab === "write" ? <div className="editor-wrap"><div className="line-numbers" aria-hidden="true">{markdown.split("\n").map((_, index) => <span key={index}>{index + 1}</span>)}</div><textarea aria-label="Markdown editor" spellCheck="true" value={markdown} onChange={(event) => { setMarkdown(event.target.value); setSelectedId(""); }}/></div> : <article className="paper-preview"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer noopener"/> }}>{previewMarkdown}</ReactMarkdown></article>}
      </section>
      <footer className="statusbar"><span><i className="status-dot"/> Ready</span><span>Markdown → Word · UTF-8</span><span className="shortcut">⌘ Enter to export</span></footer>
    </main>
    <input ref={fileInput} hidden type="file" accept=".md,.markdown,.mdown,.txt,text/markdown,text/plain" onChange={(event) => void importFile(event.target.files?.[0])}/>
    {toast && <div className="toast"><Check size={16}/>{toast}</div>}
  </div>;
}
