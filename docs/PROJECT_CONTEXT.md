# LinkPocket — Project Context & Development Direction

## 1. Project Overview

**LinkPocket** is a web application designed to store and organize articles and links while automatically enriching them using AI.

Core capabilities:

* Save article/news URLs
* AI generates:

  * improved title
  * summary
  * keywords
  * category
* Organize content via:

  * reading status
  * collections
  * tags
* Search and filtering
* Import/export
* Bulk AI analysis

The long-term goal is to evolve LinkPocket into an **AI-powered Knowledge Archive**, not just a bookmarking tool.

---

# 2. Product Positioning

Primary positioning:

**AI Knowledge Archive**

Meaning:

> Transform saved articles into structured knowledge.

This positions LinkPocket between:

| Category         | Competitors     |
| ---------------- | --------------- |
| Read later       | Pocket          |
| Bookmark manager | Raindrop        |
| Knowledge system | Notion          |
| AI reading tools | Readwise Reader |

Target identity:

**Personal research & knowledge archive powered by AI.**

---

# 3. Technology Stack

Actual stack discovered:

Frontend

* React
* TypeScript
* Vite

Backend

* Cloudflare Workers

Database / Auth

* Supabase

AI

* OpenAI Chat Completions API

Structure:

```
/web
/api
/supabase
/docs
```

Frontend entry:

```
web/src/App.tsx
```

Current architecture:

* Large monolithic React component
* No router
* Single global CSS file

---

# 4. Current Application Layout

Authenticated app structure:

```
Sidebar
Topbar
Stats cards
Toolbar
Article list
Detail panel
Settings
```

Overlay elements:

```
Add link modal
Help modal
Detail drawer
Toasts
```

UI structure summary:

```
.app-layout
 ├ sidebar
 └ main
     ├ topbar
     ├ stats
     ├ toolbar
     ├ article list
     └ settings
```

---

# 5. Current Visual System

Design tokens exist but are inconsistent.

Color system:

Background

```
--bg
--surface-1
--surface-2
--surface-3
```

Text

```
--text-1
--text-2
--text-3
```

Brand accent

```
--brand (currently green)
```

Issue discovered:

Logo uses **blue accent** while UI uses **green**.

This causes brand inconsistency.

---

# 6. UI Problems Identified

The UI currently suffers from several design issues.

### Typography mismatch

HTML loads:

```
Geist
Instrument Serif
```

CSS references:

```
Sora
Space Grotesk
```

---

### Icon system inconsistency

Current icons include:

```
emoji
unicode
text labels
```

Example:

```
✏️
🗑
DEL
↗
★
```

No consistent icon system.

---

### Spacing inconsistency

Spacing values include:

```
2px
3px
4px
5px
7px
10px
12px
13px
14px
```

No standardized spacing scale.

---

### Radius too small

Current tokens:

```
2px
3px
5px
7px
```

Feels outdated.

---

### Visual density

UI elements are too compact:

* sidebar
* toolbars
* cards

This reduces visual clarity.

---

# 7. UI Improvement Work Completed

A **visual polish pass** was performed.

Goals:

* modern dark SaaS interface
* developer-focused aesthetic
* minimal but structured

Key changes requested:

Color system

```
Primary accent: blue (#3F46D8)
```

Typography

```
UI font: Geist
Display font: Instrument Serif
```

Spacing scale

```
4
8
12
16
24
32
```

Radius upgrade

```
6px
10px
14px
```

Icon system

```
lucide-react
```

Component polish

* sidebar spacing
* topbar alignment
* card design
* button consistency

---

# 8. Product Direction

The product will evolve from:

**Link Saver**

to

**Knowledge Archive**

Meaning:

Saved articles should become **structured knowledge units.**

---

# 9. Knowledge Archive Core Concepts

Future data model ideas:

### Topic system

Topics represent major knowledge areas.

Example:

```
AI
Energy
Geopolitics
Semiconductors
```

AI automatically groups related articles.

---

### Knowledge cards

Articles should evolve into knowledge objects.

Example structure:

```
Title
Summary
Key insights
Why it matters
Sources
Tags
Topics
```

---

### AI insights

AI should generate deeper understanding.

Examples:

```
Key insight
Why it matters
Contrarian perspective
Related topics
```

---

# 10. Future Feature Roadmap

## Phase 1 — Code structure refactor

Break monolithic component into modules.

Example structure:

```
components/
Sidebar
Topbar
LinkCard
StatsCards
Toolbar
DetailDrawer
SettingsPanel

modals/
AddLinkModal
HelpModal

pages/
LibraryPage
SettingsPage

hooks/
useLinks
useCollections
useAuth
```

---

## Phase 2 — Router introduction

Introduce routing:

```
/
 /login
 /app
 /app/library
 /app/settings
```

Benefits:

* deep links
* cleaner architecture
* marketing site separation

---

## Phase 3 — Marketing landing page

Current:

```
login screen = landing
```

Future:

```
/          marketing
/login     auth
/app       product
```

Landing sections:

```
Hero
Product demo
Features
AI workflow
Screenshots
Pricing
FAQ
CTA
```

---

## Phase 4 — Search upgrade

Current search is basic.

Future improvements:

* full-text search
* semantic search
* topic search
* command palette (Cmd + K)

---

## Phase 5 — AI research features

Examples:

* AI insights
* topic clustering
* related article discovery
* timeline view

---

## Phase 6 — Reader mode

Add clean article reading view.

Features:

* highlight
* notes
* distraction-free reading

---

## Phase 7 — Knowledge graph

Visualize topic relationships.

Example:

```
AI
 ├ LLM
 ├ OpenAI
 └ Regulation
```

---

## Phase 8 — Knowledge synthesis

Allow AI to answer questions using saved articles.

Example query:

```
"What is happening in offshore wind in Korea?"
```

AI produces:

* summary
* timeline
* key insights
* supporting articles

---

## Phase 9 — Import ecosystem

Allow migration from other services.

Examples:

```
Pocket
Raindrop
Notion
Browser bookmarks
```

---

## Phase 10 — Writing tools

Convert saved knowledge into outputs.

Examples:

```
Research report
Newsletter
Article draft
Markdown export
```

---

# 11. Strategic Principle

The core value of LinkPocket:

```
Saved information → Structured knowledge
```

The product should help users:

```
Save → Organize → Understand → Synthesize
```

---

# 12. Current Development Priority

Recommended order:

1. UI polish (completed)
2. code structure refactor
3. router introduction
4. landing page
5. topic system
6. AI insights
7. reader mode
8. semantic search
9. knowledge graph
10. synthesis AI
