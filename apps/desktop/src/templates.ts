import type { Options } from "@mohtasham/md-to-docx";

export type Template = {
  id: string;
  name: string;
  category: string;
  description: string;
  accent: string;
  filename: string;
  markdown: string;
  options: Options;
};

export const templates: Template[] = [
  {
    id: "blank", name: "Blank document", category: "Essentials", accent: "#a3a3a3",
    description: "A clean page for notes, drafts, and everyday writing.", filename: "untitled-document",
    markdown: "# Untitled document\n\nStart writing here.\n",
    options: { documentType: "document", style: { fontFamily: "Aptos", paragraphSize: 22, lineSpacing: 1.15 } },
  },
  {
    id: "report", name: "Executive report", category: "Business", accent: "#7c9cff",
    description: "Structured report with summary, findings, and numbered pages.", filename: "executive-report",
    markdown: `# Executive Report

**Prepared for:** Client or team

**Date:** August 2026

[TOC]

# Executive summary

State the decision, result, or recommendation in two concise paragraphs.

> [!NOTE]
> Put the most important context where readers cannot miss it.

# Key findings

| Finding | Evidence | Priority |
| --- | --- | ---: |
| Conversion quality | Consistent document structure | High |
| Review speed | Reusable presets reduce setup | Medium |

# Recommendations

1. Confirm the document owner.
2. Resolve high-priority findings.
3. Publish the approved version.

# Appendix

Add supporting detail, methodology, or source notes here.
`,
    options: { documentType: "report", style: { fontFamily: "Aptos", paragraphAlignment: "JUSTIFIED", heading1Size: 36, paragraphSize: 22 }, toc: { title: "Table of Contents" }, template: { pageNumbering: { display: "current", alignment: "CENTER" } }, metadata: { title: "Executive Report", language: "en-MY" } },
  },
  {
    id: "proposal", name: "Project proposal", category: "Business", accent: "#45d6a8",
    description: "A persuasive scope, timeline, and investment proposal.", filename: "project-proposal",
    markdown: `# Project Proposal

## A clearer path from idea to delivery

**Prepared for:** Organisation name

**Prepared by:** Your name

---

# Opportunity

Describe the problem, who experiences it, and why it matters now.

# Proposed solution

Explain the approach in plain language and connect each capability to an outcome.

## Deliverables

- Production-ready application
- Tested conversion workflow
- Deployment and handover documentation

# Timeline

| Phase | Scope | Duration |
| --- | --- | ---: |
| Discover | Requirements and risks | 1 week |
| Build | Core implementation | 3 weeks |
| Launch | QA and handover | 1 week |

# Investment

**Total:** RM 00,000

> [!IMPORTANT]
> This proposal is valid for 30 days.
`,
    options: { documentType: "report", style: { fontFamily: "Aptos Display", heading1Size: 38, paragraphSize: 22 }, template: { pageNumbering: { display: "currentAndTotal", alignment: "RIGHT" } }, metadata: { title: "Project Proposal", language: "en-MY" } },
  },
  {
    id: "research", name: "Research paper", category: "Academic", accent: "#d7a6ff",
    description: "Academic structure with abstract, methods, and references.", filename: "research-paper",
    markdown: `# Paper Title

**Author Name**

Institution · author@example.com

## Abstract

Summarise the research question, method, principal result, and significance.

**Keywords:** document generation; Markdown; reproducible workflows

# 1. Introduction

Define the problem and the gap addressed by this work.

# 2. Methodology

Describe data, experimental setup, and evaluation criteria.

# 3. Results

| Metric | Baseline | Proposed |
| --- | ---: | ---: |
| Accuracy | 0.82 | **0.91** |
| Latency | 280 ms | **190 ms** |

# 4. Discussion

Interpret the results, limitations, and practical implications.

# 5. Conclusion

State the contribution and the most useful next step.

# References

1. Author. *Title*. Publisher, 2026.
`,
    options: { documentType: "document", style: { fontFamily: "Times New Roman", paragraphAlignment: "JUSTIFIED", heading1Size: 28, heading1Alignment: "CENTER", paragraphSize: 24, lineSpacing: 1.5 }, template: { pageNumbering: { display: "current", alignment: "CENTER" } }, metadata: { title: "Research Paper", language: "en-GB" } },
  },
  {
    id: "meeting", name: "Meeting brief", category: "Essentials", accent: "#ffb15c",
    description: "Decisions, owners, and actions without meeting-note clutter.", filename: "meeting-brief",
    markdown: `# Meeting Brief

**Topic:** Project review

**Date:** August 2026

**Participants:** Name, Name, Name

# Decisions

- **Decision one:** Add the rationale and owner.
- **Decision two:** Add the impact and effective date.

# Discussion notes

## Progress

Summarise what changed since the previous review.

## Risks

> [!WARNING]
> Describe the risk, trigger, and mitigation owner.

# Actions

| Action | Owner | Due | Status |
| --- | --- | --- | --- |
| Confirm requirements | Name | Friday | In progress |
| Share final document | Name | Monday | Not started |
`,
    options: { documentType: "document", style: { fontFamily: "Aptos", paragraphSize: 22, heading1Size: 32 }, metadata: { title: "Meeting Brief", language: "en-MY" } },
  },
  {
    id: "resume", name: "Modern résumé", category: "Personal", accent: "#ff7f91",
    description: "Compact, scan-friendly experience and skills layout.", filename: "resume",
    markdown: `# YOUR NAME

**AI Engineer · Kuala Lumpur, Malaysia**

you@example.com · linkedin.com/in/you · github.com/you

---

# Profile

Outcome-focused engineer building reliable AI systems, evaluation infrastructure, and production data workflows.

# Experience

## AI Engineer — Company
*2024–Present · Kuala Lumpur*

- Shipped an evaluation platform used across multilingual model releases.
- Reduced experiment turnaround by **40%** through reusable pipelines.
- Led production readiness reviews across data, serving, and observability.

# Selected projects

## Project name
One-line product description with the user, problem, and measurable outcome.

# Skills

**AI/ML:** LLM evaluation, fine-tuning, RAG, PyTorch

**Engineering:** TypeScript, Python, SQL, Docker, GCP

# Education

**Degree** — University, 2024
`,
    options: { documentType: "document", style: { fontFamily: "Aptos", heading1Size: 28, heading1Alignment: "LEFT", paragraphSize: 20, paragraphSpacing: 120, lineSpacing: 1.05 }, metadata: { title: "Resume", language: "en-MY" } },
  },
];
