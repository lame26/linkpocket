# LinkPocket Architecture

## Overview

LinkPocket is an AI-powered knowledge archive designed to transform
saved links and articles into structured knowledge.

Core architecture components:

Frontend: - React - TypeScript - Vite

Backend: - Cloudflare Workers

Database & Auth: - Supabase

AI Processing: - OpenAI Chat Completions API

------------------------------------------------------------------------

## High-Level Architecture

User Browser ↓ React Frontend (Vite) ↓ Cloudflare Worker API ↓ Supabase
Database ↓ OpenAI API

------------------------------------------------------------------------

## Frontend Structure

Current entry:

web/src/App.tsx

Future modular structure:

src/ components/ Sidebar Topbar LinkCard StatsCards Toolbar DetailDrawer

modals/ AddLinkModal HelpModal

pages/ LibraryPage SettingsPage

hooks/ useLinks useCollections useAuth

------------------------------------------------------------------------

## Backend Responsibilities

Cloudflare Worker handles:

-   AI enrichment
-   title improvements
-   summaries
-   keyword extraction
-   category classification

------------------------------------------------------------------------

## Database Schema (Core Tables)

links collections tags link_tags profiles ai_tasks user_ai_preferences

------------------------------------------------------------------------

## AI Pipeline

1.  User saves link
2.  Link stored in Supabase
3.  Worker fetches webpage content
4.  AI processes article
5.  Database updated with:
    -   improved title
    -   summary
    -   keywords
    -   category
