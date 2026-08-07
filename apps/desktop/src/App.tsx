import { useMemo, useRef, useState } from "react";
import { convertMarkdownToDocx, type Options } from "@mohtasham/md-to-docx";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Check,
  ChevronDown,
  Download,
  FileText,
  FolderOpen,
  LayoutGrid,
  Menu,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  X,
} from "lucide-react";
import logoMark from "../assets/logo-mark.svg";
import { templates, type Template } from "./templates";

type Tab = "write" | "preview";
type Settings = {
  fontFamily: string;
  paragraphSize: number;
  alignment: "LEFT" | "JUSTIFIED";
  pageNumbers: boolean;
};

const initial = templates[1];

function countWords(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function estimatedPages(words: number) {
  return Math.max(1, Math.ceil(words / 450));
}

function TemplatePreview({ template }: { template: Template }) {
  const kind = template.id;

  return (
    <div className={`template-page template-page-${kind}`} aria-hidden="true">
      {kind === "blank" && (
        <>
          <div className="mini-title">Untitled document</div>
          <div className="mini-rule long" />
          <div className="mini-rule medium" />
          <div className="mini-rule short" />
        </>
      )}
      {kind === "report" && (
        <>
          <div className="mini-meta">Executive report · 2026</div>
          <div className="mini-display">Evidence first.</div>
          <div className="mini-lede">A concise view of the decision, findings, and next actions.</div>
          <div className="mini-metrics"><span><b>91%</b><small>Quality</small></span><span><b>3</b><small>Actions</small></span></div>
          <div className="mini-table"><i /><i /><i /><i /></div>
        </>
      )}
      {kind === "proposal" && (
        <>
          <div className="mini-meta">Project proposal</div>
          <div className="mini-display">A clearer path<br />to delivery.</div>
          <div className="mini-rule medium" />
          <div className="mini-phases"><span>01</span><span>02</span><span>03</span></div>
          <div className="mini-total"><small>Investment</small><b>RM 00,000</b></div>
        </>
      )}
      {kind === "research" && (
        <>
          <div className="mini-paper-title">Paper title</div>
          <div className="mini-author">AUTHOR · INSTITUTION</div>
          <div className="mini-abstract"><b>Abstract</b><i /><i /><i /></div>
          <div className="mini-columns"><span><b>1. Introduction</b><i /><i /><i /></span><span><b>2. Method</b><i /><i /><i /></span></div>
        </>
      )}
      {kind === "meeting" && (
        <>
          <div className="mini-meta">Meeting brief · 07 Aug</div>
          <div className="mini-title">Decisions and actions</div>
          <div className="mini-decision"><b>01</b><span><strong>Confirm requirements</strong><small>Owner · Friday</small></span></div>
          <div className="mini-decision"><b>02</b><span><strong>Publish document</strong><small>Owner · Monday</small></span></div>
          <div className="mini-table compact"><i /><i /><i /></div>
        </>
      )}
      {kind === "resume" && (
        <>
          <div className="mini-resume-head"><div><div className="mini-display">Your Name</div><span>AI Engineer · Kuala Lumpur</span></div><i>YN</i></div>
          <div className="mini-resume-grid"><aside><b>Contact</b><span>you@example.com</span><span>github.com/you</span><b>Skills</b><span>AI/ML · Python</span><span>TypeScript · GCP</span></aside><section><b>Experience</b><strong>AI Engineer</strong><i /><i /><i /><b>Projects</b><strong>Project name</strong><i /><i /></section></div>
        </>
      )}
    </div>
  );
}

export default function App() {
  const [selectedId, setSelectedId] = useState(initial.id);
  const [markdown, setMarkdown] = useState(initial.markdown);
  const [filename, setFilename] = useState(initial.filename);
  const [baseOptions, setBaseOptions] = useState<Options>(initial.options);
  const [activeTab, setActiveTab] = useState<Tab>("write");
  const [galleryOpen, setGalleryOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>({
    fontFamily: initial.options.style?.fontFamily ?? "Aptos",
    paragraphSize: initial.options.style?.paragraphSize ?? 22,
    alignment: (initial.options.style?.paragraphAlignment as Settings["alignment"]) ?? "LEFT",
    pageNumbers: Boolean(initial.options.template?.pageNumbering),
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  const words = useMemo(() => countWords(markdown), [markdown]);
  const previewMarkdown = useMemo(
    () =>
      markdown
        .replace(/^\[TOC\]$/gm, "_Table of contents will be generated in Word._")
        .replace(/^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\n>/gm, "> **$1**\n>"),
    [markdown],
  );
  const filtered = templates.filter((template) =>
    `${template.name} ${template.category} ${template.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  const groups = Array.from(new Set(filtered.map((template) => template.category)));

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2400);
  }

  function applyTemplate(id: string) {
    const template = templates.find((entry) => entry.id === id)!;
    setSelectedId(id);
    setMarkdown(template.markdown);
    setFilename(template.filename);
    setBaseOptions(template.options);
    setSettings({
      fontFamily: template.options.style?.fontFamily ?? "Aptos",
      paragraphSize: template.options.style?.paragraphSize ?? 22,
      alignment: (template.options.style?.paragraphAlignment as Settings["alignment"]) ?? "LEFT",
      pageNumbers: Boolean(template.options.template?.pageNumbering),
    });
    setGalleryOpen(false);
    setSidebarOpen(false);
    setActiveTab("write");
    notify(`${template.name} ready`);
  }

  async function importFile(file?: File) {
    if (file) {
      setMarkdown(await file.text());
      setFilename(file.name.replace(/\.(md|markdown|mdown|txt)$/i, ""));
      setSelectedId("");
      setGalleryOpen(false);
      return;
    }
    if (window.desktop) {
      const result = await window.desktop.openMarkdown();
      if (result) {
        setMarkdown(result.content);
        setFilename(result.name.replace(/\.[^.]+$/, ""));
        setSelectedId("");
        setGalleryOpen(false);
      }
    } else {
      fileInput.current?.click();
    }
  }

  async function exportDocument() {
    if (!markdown.trim()) return;
    setExporting(true);
    try {
      const options: Options = {
        ...baseOptions,
        style: {
          ...baseOptions.style,
          fontFamily: settings.fontFamily,
          paragraphSize: settings.paragraphSize,
          paragraphAlignment: settings.alignment,
        },
        template: settings.pageNumbers
          ? {
              ...baseOptions.template,
              pageNumbering: baseOptions.template?.pageNumbering ?? {
                display: "current",
                alignment: "CENTER",
              },
            }
          : { ...baseOptions.template, pageNumbering: { display: "none" } },
        metadata: { ...baseOptions.metadata, title: filename || "Document" },
      };
      const blob = await convertMarkdownToDocx(markdown, options);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let saved: string | null = null;
      if (window.desktop) {
        saved = await window.desktop.saveDocx(filename || "document", bytes);
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${filename || "document"}.docx`;
        link.click();
        URL.revokeObjectURL(url);
        saved = link.download;
      }
      if (saved) notify("Word document exported");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div
      className="app-shell"
      onKeyDown={(event) => {
        if (!(event.metaKey || event.ctrlKey)) return;
        if (event.key.toLowerCase() === "k") {
          event.preventDefault();
          searchInput.current?.focus();
        }
        if (event.key === "Enter" && !galleryOpen) {
          event.preventDefault();
          void exportDocument();
        }
      }}
    >
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <img className="brand-mark" src={logoMark} alt="" />
          <strong>Smarttex</strong>
          <span className="brand-separator" />
          <span>Studio</span>
          <button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu"><X size={16} /></button>
        </div>

        <button className="new-document" onClick={() => setGalleryOpen(true)}>
          <Plus size={15} /> New document <kbd>N</kbd>
        </button>

        <div className="search">
          <Search size={14} />
          <input ref={searchInput} aria-label="Search templates" placeholder="Search templates" value={query} onChange={(event) => setQuery(event.target.value)} />
          <kbd>⌘K</kbd>
        </div>

        <nav className="template-list">
          <button className={`rail-link ${galleryOpen ? "active" : ""}`} onClick={() => setGalleryOpen(true)}><LayoutGrid size={15} /> Template gallery <span>{templates.length}</span></button>
          <div className="rail-heading">Documents</div>
          {groups.map((group) => (
            <section key={group}>
              <h2>{group}</h2>
              {filtered.filter((template) => template.category === group).map((template) => (
                <button className={`template-item ${!galleryOpen && selectedId === template.id ? "selected" : ""}`} key={template.id} onClick={() => applyTemplate(template.id)}>
                  <FileText size={14} />
                  <span>{template.name}</span>
                  {!galleryOpen && selectedId === template.id && <Check size={13} />}
                </button>
              ))}
            </section>
          ))}
        </nav>

        <div className="sidebar-footer">
          <ShieldCheck size={14} />
          <span><b>Local by default</b><small>Files never leave this device</small></span>
        </div>
      </aside>

      <main className={`workspace ${galleryOpen ? "gallery-workspace" : ""}`}>
        <header className="topbar">
          <div className="file-identity">
            <button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Menu size={17} /></button>
            {galleryOpen ? (
              <><LayoutGrid size={16} /><strong>Templates</strong></>
            ) : (
              <><FileText size={16} /><div><input aria-label="Output filename" value={filename} onChange={(event) => setFilename(event.target.value)} /><span>.docx</span></div></>
            )}
          </div>
          <div className="actions">
            <button className="button secondary" onClick={() => importFile()}><FolderOpen size={15} /><span>Import</span></button>
            {!galleryOpen && <>
              <button className="button secondary settings-button" onClick={() => setSettingsOpen(!settingsOpen)}><Settings2 size={15} /><span>Format</span><ChevronDown size={13} /></button>
              <button className="button primary" onClick={exportDocument} disabled={exporting || !markdown.trim()}>
                {exporting ? <span className="spinner" /> : <Download size={15} />}
                <span>{exporting ? "Creating…" : "Export"}</span>
              </button>
            </>}
          </div>
        </header>

        {settingsOpen && !galleryOpen && (
          <div className="format-panel">
            <div className="popover-title"><span>Document format</span><button onClick={() => setSettingsOpen(false)} aria-label="Close format panel"><X size={14} /></button></div>
            <label><span>Typeface</span><select value={settings.fontFamily} onChange={(event) => setSettings({ ...settings, fontFamily: event.target.value })}><option>Aptos</option><option>Aptos Display</option><option>Arial</option><option>Calibri</option><option>Georgia</option><option>Times New Roman</option><option>Trebuchet MS</option></select></label>
            <div className="format-grid">
              <label><span>Body size</span><select value={settings.paragraphSize} onChange={(event) => setSettings({ ...settings, paragraphSize: Number(event.target.value) })}><option value="20">10 pt</option><option value="22">11 pt</option><option value="24">12 pt</option><option value="28">14 pt</option></select></label>
              <label><span>Alignment</span><select value={settings.alignment} onChange={(event) => setSettings({ ...settings, alignment: event.target.value as Settings["alignment"] })}><option value="LEFT">Left</option><option value="JUSTIFIED">Justified</option></select></label>
            </div>
            <label className="toggle-label"><span><b>Page numbers</b><small>Show numbering in the footer</small></span><button role="switch" aria-checked={settings.pageNumbers} className={`toggle ${settings.pageNumbers ? "on" : ""}`} onClick={() => setSettings({ ...settings, pageNumbers: !settings.pageNumbers })}><i /></button></label>
          </div>
        )}

        {galleryOpen ? (
          <section className="gallery">
            <div className="gallery-intro">
              <div><h1>Start with a template</h1><p>Choose a document structure, then make it yours. Every template exports to a production-ready Word file.</p></div>
              <span>{filtered.length} templates</span>
            </div>
            <div className="gallery-grid">
              {filtered.map((template) => (
                <button className="gallery-card" key={template.id} onClick={() => applyTemplate(template.id)}>
                  <div className="thumbnail-stage"><TemplatePreview template={template} /></div>
                  <div className="gallery-card-copy">
                    <span><b>{template.name}</b><small>{template.description}</small></span>
                    <i><Plus size={14} /></i>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ) : (
          <>
            <div className="document-toolbar">
              <div className="tabs"><button className={activeTab === "write" ? "active" : ""} onClick={() => setActiveTab("write")}>Editor</button><button className={activeTab === "preview" ? "active" : ""} onClick={() => setActiveTab("preview")}>Preview</button></div>
              <div className="doc-stats"><span>{words.toLocaleString()} words</span><i /><span>~{estimatedPages(words)} {estimatedPages(words) === 1 ? "page" : "pages"}</span></div>
            </div>
            <section className="canvas" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void importFile(event.dataTransfer.files[0]); }}>
              {activeTab === "write" ? (
                <div className="editor-wrap"><div className="line-numbers" aria-hidden="true">{markdown.split("\n").map((_, index) => <span key={index}>{index + 1}</span>)}</div><textarea aria-label="Markdown editor" spellCheck="true" value={markdown} onChange={(event) => { setMarkdown(event.target.value); setSelectedId(""); }} /></div>
              ) : (
                <article className="paper-preview"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer noopener" /> }}>{previewMarkdown}</ReactMarkdown></article>
              )}
            </section>
            <footer className="statusbar"><span><i className="status-dot" /> Ready</span><span>Markdown → Word</span><span className="shortcut">⌘ Enter to export</span></footer>
          </>
        )}
      </main>

      <input ref={fileInput} hidden type="file" accept=".md,.markdown,.mdown,.txt,text/markdown,text/plain" onChange={(event) => void importFile(event.target.files?.[0])} />
      {toast && <div className="toast"><Check size={15} />{toast}</div>}
    </div>
  );
}
