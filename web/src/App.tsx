import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import type { Collection, LinkItem, LinkStatus } from "./lib/types";

const RAW_API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || "";
const FALLBACK_PROD_API_BASE_URL = "https://linkpocket-api.lame26.workers.dev";
const AUTH_MODE_QUERY_KEY = "auth";

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

const API_BASE_URL = (() => {
  if (typeof window !== "undefined") {
    const appOnLocalhost = isLocalHost(window.location.hostname);
    if (!RAW_API_BASE_URL) {
      return appOnLocalhost ? "" : FALLBACK_PROD_API_BASE_URL;
    }

    try {
      const parsed = new URL(RAW_API_BASE_URL);
      const targetHost = parsed.hostname;
      if (!appOnLocalhost && isLocalHost(targetHost)) {
        return FALLBACK_PROD_API_BASE_URL;
      }
      return parsed.toString().replace(/\/$/, "");
    } catch {
      return appOnLocalhost ? "" : FALLBACK_PROD_API_BASE_URL;
    }
  }

  if (!RAW_API_BASE_URL) {
    return "";
  }

  return RAW_API_BASE_URL.replace(/\/$/, "");
})();

function toApiUrl(pathname: string): string {
  return API_BASE_URL ? `${API_BASE_URL}${pathname}` : pathname;
}

const REQUEST_TIMEOUT_MS = 25000;

async function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} 요청 시간 초과`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function parseResponseError(response: Response): Promise<string> {
  const text = (await response.text()).trim();
  if (response.status === 401) {
    return "인증이 만료되었습니다. 다시 로그인해 주세요.";
  }
  if (!text) {
    return `HTTP ${response.status}`;
  }

  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };
    if (parsed?.message) {
      return parsed.message;
    }
    if (parsed?.error) {
      return parsed.error;
    }
  } catch {
    // no-op
  }

  const lowered = text.toLowerCase();
  if (lowered.includes("<!doctype") || lowered.includes("<html")) {
    return `API 응답이 HTML입니다 (HTTP ${response.status}). VITE_API_BASE_URL/Worker 배포를 확인해 주세요.`;
  }

  return text;
}

async function getFreshAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

type SortMode = "newest" | "oldest" | "rating";
type ViewMode = "card" | "list";
type StatusFilter = "all" | LinkStatus;
type ThemeMode = "dark" | "light";
type MainTab = "library" | "settings";
type FontScaleMode = "small" | "normal" | "large";
type SummaryLengthMode = "short" | "medium" | "long";
type SummaryStyleMode = "neutral" | "easy" | "insight";
const DETAIL_STATUS_ORDER: LinkStatus[] = ["unread", "reading", "archived"];
const SUMMARY_LENGTH_ORDER: SummaryLengthMode[] = ["short", "medium", "long"];
const SUMMARY_STYLE_ORDER: SummaryStyleMode[] = ["neutral", "easy", "insight"];
const SUMMARY_LENGTH_LABEL: Record<SummaryLengthMode, string> = {
  short: "짧게",
  medium: "보통",
  long: "길게"
};
const SUMMARY_STYLE_LABEL: Record<SummaryStyleMode, string> = {
  neutral: "객관",
  easy: "쉽게",
  insight: "인사이트"
};

const CATEGORY_BASE_MENU = [
  "정치",
  "경제",
  "사회",
  "생활/문화",
  "IT/과학",
  "세계",
  "사설/칼럼"
] as const;

const CATEGORY_COMPAT_MAP: Record<string, string> = {
  정치: "정치",
  경제: "경제",
  사회: "사회",
  "생활/문화": "생활/문화",
  "IT/과학": "IT/과학",
  세계: "세계",
  "사설/칼럼": "사설/칼럼",
  "정치/사회": "정치",
  "비즈니스/금융": "경제",
  "비즈니스/경제": "경제",
  "경제/정책": "경제",
  "투자/금융": "경제",
  "라이프/문화": "생활/문화",
  "문화/라이프": "생활/문화",
  "인공지능/개발": "IT/과학",
  "AI/개발": "IT/과학",
  "AI/머신러닝": "IT/과학",
  "개발/프로그래밍": "IT/과학",
  "데이터/인프라": "IT/과학",
  "데이터/분석": "IT/과학",
  "보안/인프라": "IT/과학",
  "과학/헬스": "IT/과학",
  "과학/기술": "IT/과학",
  "헬스/바이오": "IT/과학",
  "사회/정책": "사회",
  "교육/커리어": "사회",
  기타: "사회"
};

const CATEGORY_FILTER_ALIASES: Record<string, string[]> = {
  정치: ["정치", "정치/사회"],
  경제: ["경제", "비즈니스/금융", "비즈니스/경제", "경제/정책", "투자/금융"],
  사회: ["사회", "사회/정책", "교육/커리어", "기타"],
  "생활/문화": ["생활/문화", "라이프/문화", "문화/라이프"],
  "IT/과학": [
    "IT/과학",
    "인공지능/개발",
    "AI/개발",
    "AI/머신러닝",
    "개발/프로그래밍",
    "데이터/인프라",
    "데이터/분석",
    "보안/인프라",
    "과학/헬스",
    "과학/기술",
    "헬스/바이오"
  ],
  세계: ["세계", "국제"],
  "사설/칼럼": ["사설/칼럼", "사설", "칼럼"]
};

const COLLECTION_COLOR_PRESET = [
  "#7f8c8d",
  "#8d6e63",
  "#6d7b8d",
  "#8e7ca6",
  "#5f8a7a",
  "#a68a64",
  "#b06b7d",
  "#7b8ea3",
  "#7a967f",
  "#ab7f6b",
  "#7f8fa6",
  "#9d6f53"
] as const;

const FONT_SCALE_MAP: Record<FontScaleMode, number> = {
  small: 0.92,
  normal: 1,
  large: 1.08
};

interface LinkDraft {
  note: string;
  status: LinkStatus;
  rating: string;
  tags: string;
  collectionId: string;
}

interface LibraryStats {
  total: number;
  unread: number;
  reading: number;
  archived: number;
  favorite: number;
  aiDone: number;
  trash: number;
}

interface ImportArticleRow {
  url?: string;
  title?: string;
  notes?: string;
  press_raw?: string;
  date_raw?: string;
  date_iso?: string;
  date?: string;
  keywords?: string[];
  keywords_joined?: string;
  tags?: string[] | string;
}

const STATUS_LABEL: Record<LinkStatus, string> = {
  unread: "안읽음",
  reading: "읽음",
  archived: "보관"
};

const AI_STATE_LABEL: Record<string, string> = {
  pending: "분석중",
  success: "완료",
  failed: "실패",
  idle: "대기"
};

function formatDateLabel(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("ko-KR");
}

function getDisplayDateValue(link: Pick<LinkItem, "published_at" | "created_at">): string {
  return link.published_at || link.created_at;
}

function getDateSortValue(link: Pick<LinkItem, "published_at" | "created_at">): number {
  const raw = getDisplayDateValue(link);
  const value = Date.parse(raw);
  return Number.isNaN(value) ? 0 : value;
}

function renderRating(rating: number | null): string {
  if (!rating || rating < 1) {
    return "미평가";
  }

  return `${"★".repeat(rating)}${"☆".repeat(5 - rating)}`;
}

function getUrlHostLabel(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return rawUrl;
  }
}

function getLinkDisplayLabel(link: Pick<LinkItem, "title" | "url">): string {
  const base = (link.title || getUrlHostLabel(link.url)).trim();
  return base.length > 32 ? `${base.slice(0, 32)}...` : base;
}

function normalizeTags(raw: string): string[] {
  const set = new Set<string>();
  raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      const key = item.toLowerCase();
      if (!set.has(key)) {
        set.add(key);
      }
    });

  return Array.from(set.values());
}

function parseUrlValid(input: string): boolean {
  try {
    const parsed = new URL(input);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function parseRating(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (Number.isNaN(parsed)) {
    return null;
  }

  if (parsed < 1) {
    return 1;
  }

  if (parsed > 5) {
    return 5;
  }

  return parsed;
}

function buildImportFallbackUrl(row: ImportArticleRow, index: number): string {
  const queryParts = [row.title, row.press_raw, row.date_iso, row.date, row.date_raw].filter(
    (value) => typeof value === "string" && value.trim().length > 0
  );
  const query = queryParts.join(" ").trim();
  if (!query) {
    return `https://www.google.com/search?q=linklens+import+${index + 1}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function toIsoStartOfDayUtc(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null;
  }
  return dt.toISOString();
}

function parseImportDateToIso(raw: string, fallbackYear: number): string | null {
  const value = raw.trim();
  if (!value) {
    return null;
  }

  const fullIso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s.*)?$/);
  if (fullIso) {
    return toIsoStartOfDayUtc(Number(fullIso[1]), Number(fullIso[2]), Number(fullIso[3]));
  }

  const fullDot = value.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
  if (fullDot) {
    return toIsoStartOfDayUtc(Number(fullDot[1]), Number(fullDot[2]), Number(fullDot[3]));
  }

  const shortYmd = value.match(/^'?(\d{2})\.(\d{1,2})\.(\d{1,2})$/);
  if (shortYmd) {
    return toIsoStartOfDayUtc(2000 + Number(shortYmd[1]), Number(shortYmd[2]), Number(shortYmd[3]));
  }

  const mdOnly = value.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (mdOnly) {
    return toIsoStartOfDayUtc(fallbackYear, Number(mdOnly[1]), Number(mdOnly[2]));
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return toIsoStartOfDayUtc(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
  }

  return null;
}

function inferImportYear(rows: ImportArticleRow[]): number {
  const yearCounts = new Map<number, number>();
  const addYear = (year: number) => {
    if (!Number.isInteger(year) || year < 2000 || year > 2099) {
      return;
    }
    yearCounts.set(year, (yearCounts.get(year) || 0) + 1);
  };

  rows.forEach((row) => {
    const iso = (row.date_iso || row.date || "").trim();
    const raw = (row.date_raw || "").trim();

    const isoYear = iso.match(/^(\d{4})-/);
    if (isoYear) {
      addYear(Number(isoYear[1]));
    }

    const rawFullYear = raw.match(/^(\d{4})[.\-/]/);
    if (rawFullYear) {
      addYear(Number(rawFullYear[1]));
    }

    const rawTwoYear = raw.match(/^'?(\d{2})\./);
    if (rawTwoYear) {
      addYear(2000 + Number(rawTwoYear[1]));
    }
  });

  if (yearCounts.size === 0) {
    return new Date().getUTCFullYear();
  }

  let bestYear = new Date().getUTCFullYear();
  let bestCount = -1;
  for (const [year, count] of yearCounts.entries()) {
    if (count > bestCount) {
      bestCount = count;
      bestYear = year;
    }
  }
  return bestYear;
}

function resolveImportPublishedAt(row: ImportArticleRow, fallbackYear: number): string | null {
  const isoCandidate = (row.date_iso || row.date || "").trim();
  const rawCandidate = (row.date_raw || "").trim();

  const fromIso = isoCandidate ? parseImportDateToIso(isoCandidate, fallbackYear) : null;
  if (fromIso) {
    return fromIso;
  }
  return rawCandidate ? parseImportDateToIso(rawCandidate, fallbackYear) : null;
}

function parseImportKeywords(row: ImportArticleRow): string[] {
  const fromArray = Array.isArray(row.keywords) ? row.keywords : [];
  const fromJoined = typeof row.keywords_joined === "string" ? row.keywords_joined.split("|") : [];
  return Array.from(
    new Set(
      [...fromArray, ...fromJoined]
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0)
    )
  ).slice(0, 12);
}

function parseCsvRows(text: string): ImportArticleRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }

    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    if (char === "\r") {
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((value) => value.replace(/^\uFEFF/, "").trim());
  return rows
    .slice(1)
    .filter((values) => values.some((value) => value.trim().length > 0))
    .map((values) => {
      const mapped: Record<string, string> = {};
      headers.forEach((header, index) => {
        mapped[header] = (values[index] || "").trim();
      });

      return {
        url: mapped.url || "",
        title: mapped.title || "",
        notes: mapped.notes || "",
        press_raw: mapped.press_raw || "",
        date_iso: mapped.date_iso || "",
        date_raw: mapped.date_raw || "",
        keywords_joined: mapped.keywords_joined || "",
        tags: mapped.tags || ""
      } satisfies ImportArticleRow;
    });
}

function csvEscape(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function downloadTextFile(filename: string, text: string, mimeType: string): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function normalizeCategoryName(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const value = raw.trim();
  if (!value) {
    return null;
  }

  const direct = CATEGORY_COMPAT_MAP[value];
  if (direct) {
    return direct;
  }

  const lower = value.toLowerCase();
  if (lower.includes("사설") || lower.includes("칼럼") || lower.includes("opinion") || lower.includes("editorial") || lower.includes("column")) return "사설/칼럼";
  if (lower.includes("세계") || lower.includes("국제") || lower.includes("해외") || lower.includes("world") || lower.includes("global") || lower.includes("international")) return "세계";
  if (lower.includes("정치") || lower.includes("국회") || lower.includes("대통령") || lower.includes("정부") || lower.includes("정당") || lower.includes("election") || lower.includes("politic")) return "정치";
  if (lower.includes("경제") || lower.includes("금융") || lower.includes("주식") || lower.includes("비즈니스") || lower.includes("투자") || lower.includes("business") || lower.includes("finance") || lower.includes("market")) return "경제";
  if (lower.includes("생활") || lower.includes("문화") || lower.includes("연예") || lower.includes("여행") || lower.includes("푸드") || lower.includes("food") || lower.includes("lifestyle")) return "생활/문화";
  if (
    lower.includes("ai") ||
    lower.includes("it") ||
    lower.includes("개발") ||
    lower.includes("프로그래밍") ||
    lower.includes("데이터") ||
    lower.includes("인프라") ||
    lower.includes("보안") ||
    lower.includes("과학") ||
    lower.includes("기술") ||
    lower.includes("science") ||
    lower.includes("tech")
  ) {
    return "IT/과학";
  }
  return "사회";
}

function normalizeStatus(raw: unknown): LinkStatus {
  if (raw === "unread" || raw === "reading" || raw === "archived") {
    return raw;
  }
  if (raw === "done") {
    return "archived";
  }
  return "unread";
}

function createEmptyCategoryCounts(): Record<string, number> {
  return CATEGORY_BASE_MENU.reduce((acc, category) => {
    acc[category] = 0;
    return acc;
  }, {} as Record<string, number>);
}

function draftTagKey(raw: string): string {
  return normalizeTags(raw).sort().join("|");
}

function linkTagKey(tags: string[]): string {
  return normalizeTags(tags.join(",")).sort().join("|");
}

function isDraftDirty(link: LinkItem, draft: LinkDraft): boolean {
  const draftRating = parseRating(draft.rating);
  const draftCollectionId = draft.collectionId || null;
  const draftNote = draft.note.trim();
  const linkNote = (link.note || "").trim();

  return (
    draftNote !== linkNote ||
    draft.status !== link.status ||
    draftRating !== link.rating ||
    draftCollectionId !== link.collection_id ||
    draftTagKey(draft.tags) !== linkTagKey(link.tags)
  );
}

function pickAutoCollectionColor(collectionList: Collection[], seed = ""): string {
  const used = new Set(
    collectionList
      .map((item) => (item.color || "").trim().toLowerCase())
      .filter((value) => value.length > 0)
  );
  const firstUnused = COLLECTION_COLOR_PRESET.find((color) => !used.has(color.toLowerCase()));
  if (firstUnused) {
    return firstUnused;
  }

  let hash = 0;
  const source = seed || String(collectionList.length);
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  }
  return COLLECTION_COLOR_PRESET[hash % COLLECTION_COLOR_PRESET.length];
}

function mapLinkRow(row: any): LinkItem {
  const tags = Array.isArray(row?.link_tags)
    ? row.link_tags
        .map((item: any) => item?.tag?.name)
        .filter((value: unknown): value is string => typeof value === "string")
    : [];

  return {
    id: row.id,
    url: row.url,
    title: row.title,
    note: row.note,
    status: normalizeStatus(row.status),
    rating: row.rating,
    is_favorite: row.is_favorite,
    category: normalizeCategoryName(row.category),
    summary: row.summary,
    keywords: Array.isArray(row.keywords) ? row.keywords : [],
    collection_id: row.collection_id,
    ai_state: row.ai_state,
    ai_error: row.ai_error,
    published_at: row.published_at ?? null,
    created_at: row.created_at,
    deleted_at: row.deleted_at,
    collection: row.collection
      ? {
          id: row.collection.id,
          name: row.collection.name,
          color: row.collection.color
        }
      : null,
    tags
  };
}

function getLinkDraft(link: LinkItem): LinkDraft {
  return {
    note: link.note || "",
    status: link.status,
    rating: link.rating ? String(link.rating) : "",
    tags: link.tags.join(", "),
    collectionId: link.collection_id || ""
  };
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");

  const [links, setLinks] = useState<LinkItem[]>([]);
  const [libraryStats, setLibraryStats] = useState<LibraryStats>({
    total: 0,
    unread: 0,
    reading: 0,
    archived: 0,
    favorite: 0,
    aiDone: 0,
    trash: 0
  });
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>(() => createEmptyCategoryCounts());
  const [collections, setCollections] = useState<Collection[]>([]);
  const [drafts, setDrafts] = useState<Record<string, LinkDraft>>({});

  const [loadingLinks, setLoadingLinks] = useState(false);
  const [savingLink, setSavingLink] = useState(false);
  const [savingLinkId, setSavingLinkId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [collectionFilter, setCollectionFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [viewMode, setViewMode] = useState<ViewMode>("card");
  const [showTrash, setShowTrash] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [mainTab, setMainTab] = useState<MainTab>("library");
  const [fontScaleMode, setFontScaleMode] = useState<FontScaleMode>("normal");
  const [autoAnalyzeOnImport, setAutoAnalyzeOnImport] = useState(false);

  const [newUrl, setNewUrl] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newPublishedAt, setNewPublishedAt] = useState<string | null>(null);
  const [newStatus, setNewStatus] = useState<LinkStatus>("unread");
  const [newCollectionId, setNewCollectionId] = useState("");
  const [newTags, setNewTags] = useState("");
  const [newTagInput, setNewTagInput] = useState("");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [manualTitleEdited, setManualTitleEdited] = useState(false);
  const [importingFile, setImportingFile] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<"" | "jsonl" | "csv">("");
  const [deletingAll, setDeletingAll] = useState(false);
  const [bulkAiRunning, setBulkAiRunning] = useState(false);
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [nextPassword, setNextPassword] = useState("");
  const [nextPasswordConfirm, setNextPasswordConfirm] = useState("");
  const [summaryLengthMode, setSummaryLengthMode] = useState<SummaryLengthMode>("medium");
  const [summaryStyleMode, setSummaryStyleMode] = useState<SummaryStyleMode>("neutral");
  const [summaryFocusText, setSummaryFocusText] = useState("");
  const [summaryCustomPrompt, setSummaryCustomPrompt] = useState("");
  const [loadingAiPreferences, setLoadingAiPreferences] = useState(false);
  const [savingAiPreferences, setSavingAiPreferences] = useState(false);
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);

  const [collectionName, setCollectionName] = useState("");
  const [collectionColor, setCollectionColor] = useState<string>(COLLECTION_COLOR_PRESET[0]);
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [selectedLinkIds, setSelectedLinkIds] = useState<string[]>([]);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [toast, setToast] = useState<{ kind: "info" | "ok" | "err"; message: string } | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showSignupGuide, setShowSignupGuide] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const newUrlInputRef = useRef<HTMLInputElement | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const authInitDoneRef = useRef(false);
  const draftsRef = useRef<Record<string, LinkDraft>>({});
  const autoSaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const selectedLink = useMemo(() => links.find((item) => item.id === selectedLinkId) || null, [links, selectedLinkId]);
  const selectedDraft = selectedLink ? drafts[selectedLink.id] || getLinkDraft(selectedLink) : null;

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      authInitDoneRef.current = true;
      setSession(data.session ?? null);
      setAuthReady(true);
    });

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "SIGNED_OUT" && !nextSession) {
        setSession(null);
        setAuthReady(true);
        return;
      }

      if (!authInitDoneRef.current && event === "INITIAL_SESSION") {
        authInitDoneRef.current = true;
      }

      setSession(nextSession);
      setAuthReady(true);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get(AUTH_MODE_QUERY_KEY) === "signup") {
      setAuthMode("signup");
      setAuthNotice("회원가입 후 이메일 인증을 완료한 뒤 로그인해 주세요.");
    }
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  useEffect(() => {
    return () => {
      Object.values(autoSaveTimersRef.current).forEach((timer) => clearTimeout(timer));
      autoSaveTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (!selectedLinkId) {
      return;
    }
    if (!links.some((item) => item.id === selectedLinkId)) {
      setSelectedLinkId(null);
    }
  }, [links, selectedLinkId]);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("linklens-theme") : null;
    if (saved === "light" || saved === "dark") {
      setThemeMode(saved);
    }
  }, []);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("linklens-font-scale") : null;
    if (saved === "small" || saved === "normal" || saved === "large") {
      setFontScaleMode(saved);
    }
  }, []);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("linkpocket-import-auto-ai") : null;
    if (saved === "1") {
      setAutoAnalyzeOnImport(true);
    }
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = themeMode;
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem("linklens-theme", themeMode);
    }
  }, [themeMode]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.style.setProperty("--ui-scale", String(FONT_SCALE_MAP[fontScaleMode]));
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem("linklens-font-scale", fontScaleMode);
    }
  }, [fontScaleMode]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("linkpocket-import-auto-ai", autoAnalyzeOnImport ? "1" : "0");
    }
  }, [autoAnalyzeOnImport]);

  useEffect(() => {
    if (mainTab !== "library") {
      setSelectedLinkId(null);
    }
  }, [mainTab]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (isAddModalOpen && event.key === "Escape") {
        event.preventDefault();
        setIsAddModalOpen(false);
        return;
      }

      if (isHelpModalOpen && event.key === "Escape") {
        event.preventDefault();
        setIsHelpModalOpen(false);
        return;
      }

      if (!selectedLink) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setSelectedLinkId(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedLink, isAddModalOpen, isHelpModalOpen]);

  function clearLocalSessionState(): void {
    setSelectedLinkId(null);
    setSelectedLinkIds([]);
    setShowUserMenu(false);
    setLinks([]);
    setCollections([]);
    setDrafts({});
    resetAiPreferenceState();
  }

  useEffect(() => {
    setSelectedLinkIds((prev) => prev.filter((id) => links.some((item) => item.id === id)));
  }, [links]);

  useEffect(() => {
    if (mainTab !== "library") {
      setSelectedLinkIds([]);
      setMultiSelectMode(false);
    }
  }, [mainTab]);

  useEffect(() => {
    setSelectedLinkIds([]);
  }, [statusFilter, collectionFilter, categoryFilter, favoriteOnly, showTrash]);

  useEffect(() => {
    if (!multiSelectMode) {
      setSelectedLinkIds([]);
    }
  }, [multiSelectMode]);

  useEffect(() => {
    if (!importingFile) {
      return;
    }

    function handleBeforeUnload(event: BeforeUnloadEvent): void {
      event.preventDefault();
      event.returnValue = "파일 업로드가 진행 중입니다.";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [importingFile]);

  function resetAiPreferenceState(): void {
    setSummaryLengthMode("medium");
    setSummaryStyleMode("neutral");
    setSummaryFocusText("");
    setSummaryCustomPrompt("");
  }

  useEffect(() => {
    if (!showUserMenu) {
      return;
    }

    function closeMenu(): void {
      setShowUserMenu(false);
    }

    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [showUserMenu]);

  const loadCollections = useCallback(async () => {
    if (!session) {
      setCollections([]);
      return;
    }

    const { data, error } = await supabase
      .from("collections")
      .select("id, name, color")
      .order("name", { ascending: true });

    if (error) {
      setErrorMessage(`컬렉션 조회 실패: ${error.message}`);
      return;
    }

    setCollections((data || []) as Collection[]);
  }, [session]);

  const loadAiPreferences = useCallback(async () => {
    if (!session) {
      resetAiPreferenceState();
      return;
    }

    setLoadingAiPreferences(true);
    try {
      const accessToken = await getFreshAccessToken();
      if (!accessToken) {
        throw new Error("인증이 만료되었습니다. 다시 로그인해 주세요.");
      }

      const response = await withTimeout(
        fetch(toApiUrl("/api/v1/ai/preferences"), {
          method: "GET",
          headers: {
            authorization: `Bearer ${accessToken}`
          }
        }),
        REQUEST_TIMEOUT_MS,
        "AI 설정 조회"
      );
      if (!response.ok) {
        throw new Error(await parseResponseError(response));
      }

      const payload = (await response.json().catch(() => null)) as
        | {
            preferences?: {
              summaryLength?: SummaryLengthMode;
              summaryStyle?: SummaryStyleMode;
              summaryFocus?: string;
              customPrompt?: string;
            };
          }
        | null;
      const pref = payload?.preferences;
      const nextLength = pref?.summaryLength;
      const nextStyle = pref?.summaryStyle;
      setSummaryLengthMode(nextLength === "short" || nextLength === "medium" || nextLength === "long" ? nextLength : "medium");
      setSummaryStyleMode(nextStyle === "neutral" || nextStyle === "easy" || nextStyle === "insight" ? nextStyle : "neutral");
      setSummaryFocusText((pref?.summaryFocus || "").slice(0, 120));
      setSummaryCustomPrompt((pref?.customPrompt || "").slice(0, 500));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(`AI 요약 설정 조회 실패: ${message}`);
    } finally {
      setLoadingAiPreferences(false);
    }
  }, [session]);

  const loadLinks = useCallback(async (options?: { silent?: boolean; skipCounts?: boolean }) => {
    if (!session) {
      setLinks([]);
      setCategoryCounts(createEmptyCategoryCounts());
      setLibraryStats({
        total: 0,
        unread: 0,
        reading: 0,
        archived: 0,
        favorite: 0,
        aiDone: 0,
        trash: 0
      });
      return;
    }

    const silent = options?.silent === true;
    const skipCounts = options?.skipCounts === true;

    if (!silent) {
      setLoadingLinks(true);
    }
    setErrorMessage(null);

    try {
      let query = supabase
        .from("links")
        .select(
          "id, url, title, note, status, rating, is_favorite, category, summary, keywords, collection_id, ai_state, ai_error, published_at, created_at, deleted_at, collection:collections(id, name, color), link_tags(tag:tags(name))"
        );

      query = showTrash ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);

      if (collectionFilter !== "all") {
        query = query.eq("collection_id", collectionFilter);
      }

      if (categoryFilter !== "all") {
        const aliases = CATEGORY_FILTER_ALIASES[categoryFilter] || [categoryFilter];
        query = aliases.length > 1 ? query.in("category", aliases) : query.eq("category", aliases[0]);
      }

      if (favoriteOnly) {
        query = query.eq("is_favorite", true);
      }

      const searchValue = search.trim();
      if (searchValue) {
        query = query.or(`url.ilike.%${searchValue}%,title.ilike.%${searchValue}%,note.ilike.%${searchValue}%`);
      }

      if (sortMode === "newest") {
        query = query.order("published_at", { ascending: false, nullsFirst: false });
        query = query.order("created_at", { ascending: false });
      }

      if (sortMode === "oldest") {
        query = query.order("published_at", { ascending: true, nullsFirst: false });
        query = query.order("created_at", { ascending: true });
      }

      if (sortMode === "rating") {
        query = query.order("rating", { ascending: false, nullsFirst: false });
        query = query.order("created_at", { ascending: false });
      }

      const countOnly = async (countQuery: any) => {
        const { count, error } = await countQuery;
        if (error) {
          throw error;
        }
        return count ?? 0;
      };

      const listPromise = query.limit(200);
      const statsPromise = skipCounts
        ? Promise.resolve<{
            total: number;
            unread: number;
            reading: number;
            archived: number;
            favorite: number;
            aiDone: number;
            trash: number;
            categoryCountValues: number[];
          } | null>(null)
        : (async () => {
            const fixedQueries = [
              countOnly(supabase.from("links").select("id", { count: "exact", head: true }).is("deleted_at", null)),
              countOnly(supabase.from("links").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("status", "unread")),
              countOnly(supabase.from("links").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("status", "reading")),
              countOnly(supabase.from("links").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("status", "archived")),
              countOnly(supabase.from("links").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("is_favorite", true)),
              countOnly(supabase.from("links").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("ai_state", "success")),
              countOnly(supabase.from("links").select("id", { count: "exact", head: true }).not("deleted_at", "is", null))
            ] as const;

            const categoryCountQueries = CATEGORY_BASE_MENU.map((category) => {
              const aliases = CATEGORY_FILTER_ALIASES[category] || [category];
              return countOnly(
                supabase.from("links").select("id", { count: "exact", head: true }).is("deleted_at", null).in("category", aliases)
              );
            });

            const [fixedResults, categoryCountValues] = await Promise.all([Promise.all(fixedQueries), Promise.all(categoryCountQueries)]);
            const [total, unread, reading, archived, favorite, aiDone, trash] = fixedResults;
            return { total, unread, reading, archived, favorite, aiDone, trash, categoryCountValues };
          })();

      const [listResult, statsPayload] = await Promise.all([listPromise, statsPromise]);

      if (listResult.error) {
        setErrorMessage(`링크 조회 실패: ${listResult.error.message}`);
        return;
      }

      if (statsPayload) {
        setLibraryStats({
          total: statsPayload.total,
          unread: statsPayload.unread,
          reading: statsPayload.reading,
          archived: statsPayload.archived,
          favorite: statsPayload.favorite,
          aiDone: statsPayload.aiDone,
          trash: statsPayload.trash
        });

        const nextCategoryCounts = createEmptyCategoryCounts();
        CATEGORY_BASE_MENU.forEach((category, index) => {
          nextCategoryCounts[category] = statsPayload.categoryCountValues[index] ?? 0;
        });
        setCategoryCounts(nextCategoryCounts);
      }

      const mapped = (listResult.data || []).map(mapLinkRow);
      if (sortMode === "newest") {
        mapped.sort((a, b) => getDateSortValue(b) - getDateSortValue(a));
      } else if (sortMode === "oldest") {
        mapped.sort((a, b) => getDateSortValue(a) - getDateSortValue(b));
      }
      setLinks(mapped);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(`링크 조회 실패: ${message}`);
    } finally {
      if (!silent) {
        setLoadingLinks(false);
      }
    }
  }, [session, showTrash, collectionFilter, categoryFilter, favoriteOnly, search, sortMode]);

  const requestAiAnalysis = useCallback(
    async (linkId: string): Promise<void> => {
      if (!session) {
        throw new Error("세션이 만료되었습니다. 다시 로그인해 주세요.");
      }
      const accessToken = await getFreshAccessToken();
      if (!accessToken) {
        throw new Error("인증이 만료되었습니다. 다시 로그인해 주세요.");
      }

      const response = await withTimeout(
        fetch(toApiUrl("/api/v1/ai/analyze-link"), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${accessToken}`
          },
          body: JSON.stringify({ linkId })
        }),
        REQUEST_TIMEOUT_MS,
        "AI 분석"
      );

      if (!response.ok) {
        const message = await parseResponseError(response);
        throw new Error(message);
      }
    },
    [session]
  );

  const runAiWithRetry = useCallback(
    async (linkId: string, retryCount = 1): Promise<void> => {
      let attempt = 0;
      while (true) {
        try {
          await requestAiAnalysis(linkId);
          return;
        } catch (error) {
          attempt += 1;
          const message = error instanceof Error ? error.message : String(error);
          const mayRetry =
            message.includes("요청 시간 초과") ||
            message.includes("Failed to fetch") ||
            message.includes("NetworkError") ||
            /\b429\b/.test(message) ||
            /\b5\d\d\b/.test(message);
          if (!mayRetry || attempt > retryCount) {
            throw error;
          }
          await new Promise((resolve) => setTimeout(resolve, 900));
        }
      }
    },
    [requestAiAnalysis]
  );

  const runAiEnrichmentInBackground = useCallback(
    async (link: Pick<LinkItem, "id" | "title" | "url">, options?: { silent?: boolean; refreshAfter?: boolean }) => {
      try {
        await runAiWithRetry(link.id, 1);
        if (!options?.silent) {
          setToast({ kind: "ok", message: `AI 분석 완료: ${getLinkDisplayLabel(link)}` });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setErrorMessage(`AI 자동 분석 실패: ${message}`);
        if (!options?.silent) {
          setToast({ kind: "err", message: `AI 분석 실패: ${getLinkDisplayLabel(link)} (재시도 가능)` });
        }
      } finally {
        if (options?.refreshAfter !== false) {
          await loadLinks({ silent: true, skipCounts: true });
        }
      }
    },
    [runAiWithRetry, loadLinks]
  );

  useEffect(() => {
    if (!session) {
      return;
    }

    void Promise.all([loadCollections(), loadLinks(), loadAiPreferences()]);
  }, [session, loadCollections, loadLinks, loadAiPreferences]);

  useEffect(() => {
    if (!isAddModalOpen || !session) {
      return;
    }

    if (manualTitleEdited) {
      return;
    }

    const targetUrl = newUrl.trim();
    if (!parseUrlValid(targetUrl)) {
      setNewPublishedAt(null);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const accessToken = await getFreshAccessToken();
        if (!accessToken) {
          throw new Error("인증이 만료되었습니다. 다시 로그인해 주세요.");
        }
        const response = await fetch(toApiUrl("/api/v1/ai/preview-title"), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${accessToken}`
          },
          body: JSON.stringify({ url: targetUrl }),
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(await parseResponseError(response));
        }

        const payload = (await response.json()) as { title?: string; publishedAt?: string };
        if (payload?.title && !manualTitleEdited) {
          setNewTitle(payload.title);
        }
        setNewPublishedAt(payload?.publishedAt || null);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          const message = error instanceof Error ? error.message : String(error);
          setErrorMessage(`제목 자동완성 실패: ${message}`);
        }
        setNewPublishedAt(null);
      } finally {
        setPreviewLoading(false);
      }
    }, 600);

    return () => {
      clearTimeout(timer);
      controller.abort();
      setPreviewLoading(false);
    };
  }, [isAddModalOpen, session, newUrl, manualTitleEdited]);

  async function syncLinkTags(linkId: string, tagsRaw: string): Promise<void> {
    if (!session) {
      return;
    }

    const names = normalizeTags(tagsRaw);

    if (names.length > 0) {
      const upsertPayload = names.map((name) => ({
        user_id: session.user.id,
        name
      }));

      const { error: upsertError } = await supabase.from("tags").upsert(upsertPayload, {
        onConflict: "user_id,name",
        ignoreDuplicates: true
      });

      if (upsertError) {
        throw upsertError;
      }
    }

    const { data: tagRows, error: tagError } = names.length
      ? await supabase.from("tags").select("id, name").in("name", names)
      : { data: [], error: null };

    if (tagError) {
      throw tagError;
    }

    const tagIds = (tagRows || []).map((row: any) => row.id);

    const { error: deleteError } = await supabase.from("link_tags").delete().eq("link_id", linkId);
    if (deleteError) {
      throw deleteError;
    }

    if (tagIds.length > 0) {
      const rows = tagIds.map((tagId) => ({
        link_id: linkId,
        tag_id: tagId
      }));

      const { error: linkTagError } = await supabase.from("link_tags").insert(rows);
      if (linkTagError) {
        throw linkTagError;
      }
    }
  }

  async function handleAuthSubmit(event: React.FormEvent) {
    event.preventDefault();
    setAuthLoading(true);
    setErrorMessage(null);
    setAuthNotice(null);

    try {
      if (authMode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) {
          throw error;
        }

        const duplicateSignup = Array.isArray(data.user?.identities) && data.user?.identities.length === 0;
        if (duplicateSignup) {
          setAuthNotice("이미 가입된 이메일입니다. 로그인으로 전환합니다.");
          setAuthMode("login");
          return;
        }

        setAuthNotice("회원가입 완료. 이메일 인증 후 로그인해 주세요.");
        setAuthMode("login");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          throw error;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(`인증 처리 실패: ${message}`);
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    if (logoutLoading) {
      return;
    }

    setLogoutLoading(true);
    setErrorMessage(null);
    clearLocalSessionState();
    setSession(null);
    setAuthReady(true);

    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        setErrorMessage(`로그아웃 처리 실패: ${error.message}`);
      }
    } finally {
      setLogoutLoading(false);
    }
  }

  async function handleUpdatePassword(): Promise<void> {
    if (!session || updatingPassword) {
      return;
    }

    const passwordValue = nextPassword.trim();
    const confirmValue = nextPasswordConfirm.trim();

    if (passwordValue.length < 6) {
      setErrorMessage("새 비밀번호는 6자 이상이어야 합니다.");
      return;
    }
    if (passwordValue !== confirmValue) {
      setErrorMessage("비밀번호 확인이 일치하지 않습니다.");
      return;
    }

    setUpdatingPassword(true);
    setErrorMessage(null);

    try {
      const { error } = await supabase.auth.updateUser({ password: passwordValue });
      if (error) {
        throw error;
      }

      setNextPassword("");
      setNextPasswordConfirm("");
      setToast({ kind: "ok", message: "비밀번호가 변경되었습니다." });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(`비밀번호 변경 실패: ${message}`);
      setToast({ kind: "err", message: "비밀번호 변경 실패" });
    } finally {
      setUpdatingPassword(false);
    }
  }

  async function handleSaveAiPreferences(): Promise<void> {
    if (!session || savingAiPreferences) {
      return;
    }

    setSavingAiPreferences(true);
    setErrorMessage(null);
    try {
      const accessToken = await getFreshAccessToken();
      if (!accessToken) {
        throw new Error("인증이 만료되었습니다. 다시 로그인해 주세요.");
      }

      const response = await withTimeout(
        fetch(toApiUrl("/api/v1/ai/preferences"), {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${accessToken}`
          },
          body: JSON.stringify({
            summaryLength: summaryLengthMode,
            summaryStyle: summaryStyleMode,
            summaryFocus: summaryFocusText,
            customPrompt: summaryCustomPrompt
          })
        }),
        REQUEST_TIMEOUT_MS,
        "AI 설정 저장"
      );

      if (!response.ok) {
        throw new Error(await parseResponseError(response));
      }

      const payload = (await response.json().catch(() => null)) as
        | {
            preferences?: {
              summaryLength?: SummaryLengthMode;
              summaryStyle?: SummaryStyleMode;
              summaryFocus?: string;
              customPrompt?: string;
            };
          }
        | null;
      const pref = payload?.preferences;
      const nextLength = pref?.summaryLength;
      const nextStyle = pref?.summaryStyle;
      setSummaryLengthMode(nextLength === "short" || nextLength === "medium" || nextLength === "long" ? nextLength : summaryLengthMode);
      setSummaryStyleMode(nextStyle === "neutral" || nextStyle === "easy" || nextStyle === "insight" ? nextStyle : summaryStyleMode);
      setSummaryFocusText((pref?.summaryFocus || "").slice(0, 120));
      setSummaryCustomPrompt((pref?.customPrompt || "").slice(0, 500));
      setToast({ kind: "ok", message: "AI 요약 설정이 저장되었습니다." });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(`AI 요약 설정 저장 실패: ${message}`);
      setToast({ kind: "err", message: "AI 요약 설정 저장 실패" });
    } finally {
      setSavingAiPreferences(false);
    }
  }

  function handleResetAiPreferencesDraft(): void {
    resetAiPreferenceState();
  }

  async function handleDeleteAccount(): Promise<void> {
    if (!session || deletingAccount) {
      return;
    }

    const confirmed = window.confirm("회원 탈퇴 시 모든 링크/컬렉션/태그 데이터가 즉시 삭제되고 복구할 수 없습니다.\n정말 진행할까요?");
    if (!confirmed) {
      return;
    }

    const phrase = window.prompt("확인을 위해 DELETE 를 입력해 주세요.");
    if (phrase !== "DELETE") {
      setToast({ kind: "info", message: "회원 탈퇴가 취소되었습니다." });
      return;
    }

    setDeletingAccount(true);
    setErrorMessage(null);
    setShowUserMenu(false);

    try {
      const accessToken = await getFreshAccessToken();
      if (!accessToken) {
        throw new Error("인증이 만료되었습니다. 다시 로그인해 주세요.");
      }

      const response = await withTimeout(
        fetch(toApiUrl("/api/v1/account/delete"), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${accessToken}`
          }
        }),
        REQUEST_TIMEOUT_MS,
        "회원 탈퇴"
      );

      if (!response.ok) {
        throw new Error(await parseResponseError(response));
      }

      await supabase.auth.signOut().catch(() => null);
      clearLocalSessionState();
      setSession(null);
      setAuthReady(true);
      setAuthMode("login");
      setAuthNotice("회원 탈퇴가 완료되었습니다.");
      setPassword("");
      setNextPassword("");
      setNextPasswordConfirm("");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(`회원 탈퇴 실패: ${message}`);
      setToast({ kind: "err", message: "회원 탈퇴 실패" });
    } finally {
      setDeletingAccount(false);
    }
  }

  async function handleCreateCollection(event: React.FormEvent) {
    event.preventDefault();
    const trimmedName = collectionName.trim();
    if (!session || !trimmedName) {
      return;
    }

    const payload = editingCollectionId
      ? {
          name: trimmedName,
          color: collectionColor
        }
      : {
          name: trimmedName,
          color: pickAutoCollectionColor(collections, trimmedName)
        };

    const { error } = editingCollectionId
      ? await supabase.from("collections").update(payload).eq("id", editingCollectionId)
      : await supabase.from("collections").insert([
          {
            user_id: session.user.id,
            ...payload
          }
        ]);

    if (error) {
      setErrorMessage(`컬렉션 ${editingCollectionId ? "수정" : "생성"} 실패: ${error.message}`);
      return;
    }

    setCollectionName("");
    setCollectionColor(COLLECTION_COLOR_PRESET[0]);
    setEditingCollectionId(null);
    await loadCollections();
  }

  async function handleImportArticlesFile(file: File): Promise<void> {
    if (!session) {
      return;
    }

    setImportingFile(true);
    setErrorMessage(null);

    try {
      const text = await file.text();
      const trimmed = text.trim();
      const lowerName = file.name.toLowerCase();
      if (!trimmed) {
        setToast({ kind: "err", message: "비어 있는 파일입니다." });
        return;
      }

      let rows: ImportArticleRow[] = [];
      if (lowerName.endsWith(".csv")) {
        rows = parseCsvRows(text);
      } else if (trimmed.startsWith("[")) {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          rows = parsed as ImportArticleRow[];
        }
      } else {
        rows = [];
        for (const line of trimmed.split(/\r?\n/)) {
          const rawLine = line.trim();
          if (!rawLine) {
            continue;
          }
          try {
            rows.push(JSON.parse(rawLine) as ImportArticleRow);
          } catch {
            // skip malformed line
          }
        }
      }

      if (rows.length === 0) {
        setToast({ kind: "err", message: "가져올 데이터가 없습니다." });
        return;
      }

      const inferredYear = inferImportYear(rows);
      let inserted = 0;
      let failed = 0;
      const importedLinksForAi: Array<Pick<LinkItem, "id" | "url" | "title">> = [];

      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const rawUrl = (row.url || "").trim();
        const resolvedUrl = parseUrlValid(rawUrl) ? rawUrl : buildImportFallbackUrl(row, i);
        const resolvedTitle = (row.title || "").trim() || `가져온 기사 #${i + 1}`;
        const publishedAt = resolveImportPublishedAt(row, inferredYear);
        const noteParts = [
          row.press_raw ? `출처: ${row.press_raw}` : "",
          row.date_iso ? `날짜: ${row.date_iso}` : row.date ? `날짜: ${row.date}` : row.date_raw ? `날짜: ${row.date_raw}` : "",
          row.notes ? `\n${row.notes}` : ""
        ].filter(Boolean);
        const importKeywords = parseImportKeywords(row);
        const importTagsRaw =
          Array.isArray(row.tags)
            ? row.tags.filter((item) => typeof item === "string")
            : typeof row.tags === "string"
              ? row.tags.split(",")
              : [];
        const importTags = normalizeTags([...importKeywords, ...importTagsRaw].join(", "));

        const { data, error }: { data: any; error: any } = await supabase
          .from("links")
          .insert([
            {
              user_id: session.user.id,
              url: resolvedUrl,
              title: resolvedTitle,
              note: noteParts.join("\n"),
              status: "unread",
              category: null,
              published_at: publishedAt,
              keywords: []
            }
          ])
          .select(
            "id, url, title, note, status, rating, is_favorite, category, summary, keywords, collection_id, ai_state, ai_error, published_at, created_at, deleted_at"
          )
          .single();

        if (error || !data?.id) {
          failed += 1;
          continue;
        }

        if (importTags.length > 0) {
          await syncLinkTags(data.id, importTags.join(", "));
        }

        inserted += 1;
        importedLinksForAi.push({
          id: data.id,
          url: data.url,
          title: data.title
        });
      }

      await loadLinks({ silent: true, skipCounts: true });
      if (autoAnalyzeOnImport && importedLinksForAi.length > 0) {
        void (async () => {
          for (const link of importedLinksForAi) {
            await runAiEnrichmentInBackground(link, { silent: true, refreshAfter: false });
          }
          await loadLinks({ silent: true });
          setToast({ kind: "ok", message: `가져온 기사 AI 보강 완료 (${importedLinksForAi.length}건)` });
        })();
      }
      setToast({
        kind: failed > 0 ? "info" : "ok",
        message: `가져오기 완료: 성공 ${inserted}건${failed > 0 ? `, 실패 ${failed}건` : ""}${autoAnalyzeOnImport && importedLinksForAi.length > 0 ? ` · AI 보강 시작` : ""}`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(`파일 가져오기 실패: ${message}`);
      setToast({ kind: "err", message: "파일 형식을 확인해 주세요. (CSV/JSONL/JSON)" });
    } finally {
      setImportingFile(false);
      if (importFileInputRef.current) {
        importFileInputRef.current.value = "";
      }
    }
  }

  async function fetchAllLinksForExport(): Promise<LinkItem[]> {
    if (!session) {
      return [];
    }

    const pageSize = 500;
    let page = 0;
    const result: LinkItem[] = [];

    while (true) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      const { data, error } = await supabase
        .from("links")
        .select(
          "id, url, title, note, status, rating, is_favorite, category, summary, keywords, collection_id, ai_state, ai_error, published_at, created_at, deleted_at, collection:collections(id, name, color), link_tags(tag:tags(name))"
        )
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .range(from, to);

      if (error) {
        throw error;
      }

      if (!data || data.length === 0) {
        break;
      }

      result.push(...data.map(mapLinkRow));
      if (data.length < pageSize) {
        break;
      }

      page += 1;
    }

    return result;
  }

  async function handleExportLinks(format: "jsonl" | "csv"): Promise<void> {
    if (!session || exportingFormat) {
      return;
    }

    setExportingFormat(format);
    setErrorMessage(null);

    try {
      const rows = await fetchAllLinksForExport();
      if (rows.length === 0) {
        setToast({ kind: "info", message: "내보낼 링크가 없습니다." });
        return;
      }

      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      if (format === "jsonl") {
        const jsonl = rows
          .map((item) =>
            JSON.stringify({
              url: item.url,
              title: item.title,
              notes: item.note,
              status: item.status,
              rating: item.rating,
              category: item.category,
              summary: item.summary,
              keywords: item.keywords,
              tags: item.tags,
              collection: item.collection?.name || null,
              published_at: item.published_at,
              created_at: item.created_at
            })
          )
          .join("\n");
        downloadTextFile(`linkpocket_export_${stamp}.jsonl`, jsonl, "application/x-ndjson;charset=utf-8");
      } else {
        const header = [
          "url",
          "title",
          "notes",
          "status",
          "rating",
          "category",
          "summary",
          "keywords_joined",
          "tags_joined",
          "collection",
          "published_at",
          "created_at"
        ];
        const lines = rows.map((item) =>
          [
            item.url,
            item.title || "",
            item.note || "",
            item.status,
            item.rating ?? "",
            item.category || "",
            item.summary || "",
            item.keywords.join(" | "),
            item.tags.join(" | "),
            item.collection?.name || "",
            item.published_at || "",
            item.created_at
          ]
            .map(csvEscape)
            .join(",")
        );
        const csv = [header.join(","), ...lines].join("\n");
        downloadTextFile(`linkpocket_export_${stamp}.csv`, csv, "text/csv;charset=utf-8");
      }

      setToast({ kind: "ok", message: `내보내기 완료 (${rows.length}건)` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(`내보내기 실패: ${message}`);
      setToast({ kind: "err", message: "내보내기 실패" });
    } finally {
      setExportingFormat("");
    }
  }

  async function handleDeleteAllLinks(): Promise<void> {
    if (!session || deletingAll) {
      return;
    }

    const totalCount = libraryStats.total + libraryStats.trash;
    if (totalCount <= 0) {
      setToast({ kind: "info", message: "삭제할 링크가 없습니다." });
      return;
    }

    const confirmed = window.confirm(`전체 링크 ${totalCount}건을 영구 삭제할까요?\n이 작업은 되돌릴 수 없습니다.`);
    if (!confirmed) {
      return;
    }

    setDeletingAll(true);
    setErrorMessage(null);
    try {
      const { error } = await supabase.from("links").delete().eq("user_id", session.user.id);
      if (error) {
        throw error;
      }

      setSelectedLinkId(null);
      setDrafts({});
      await loadLinks();
      setToast({ kind: "ok", message: `전체 링크 ${totalCount}건 삭제 완료` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(`전체 삭제 실패: ${message}`);
      setToast({ kind: "err", message: "전체 삭제 실패" });
    } finally {
      setDeletingAll(false);
    }
  }

  function startCollectionEdit(collection: Collection): void {
    setEditingCollectionId(collection.id);
    setCollectionName(collection.name);
    setCollectionColor(collection.color || COLLECTION_COLOR_PRESET[0]);
  }

  async function handleDeleteCollection(collectionId: string): Promise<void> {
    const { error: unlinkError } = await supabase.from("links").update({ collection_id: null }).eq("collection_id", collectionId);
    if (unlinkError) {
      setErrorMessage(`컬렉션 연결 해제 실패: ${unlinkError.message}`);
      return;
    }

    const { error } = await supabase.from("collections").delete().eq("id", collectionId);
    if (error) {
      setErrorMessage(`컬렉션 삭제 실패: ${error.message}`);
      return;
    }

    if (collectionFilter === collectionId) {
      setCollectionFilter("all");
    }
    if (editingCollectionId === collectionId) {
      setEditingCollectionId(null);
      setCollectionName("");
      setCollectionColor(COLLECTION_COLOR_PRESET[0]);
    }
    await loadCollections();
    await loadLinks();
  }

  async function handleCreateLink(event: React.FormEvent) {
    event.preventDefault();
    if (!session) {
      return;
    }

    const trimmedUrl = newUrl.trim();
    if (!parseUrlValid(trimmedUrl)) {
      setErrorMessage("유효한 URL을 입력해 주세요.");
      return;
    }

    setSavingLink(true);
    setErrorMessage(null);

    try {
      const payload = {
        user_id: session.user.id,
        url: trimmedUrl,
        title: newTitle.trim() || null,
        note: newNote.trim() || null,
        published_at: newPublishedAt,
        status: newStatus,
        collection_id: newCollectionId || null,
        category: normalizeCategoryName(newCategory) || null
      };

      const { data, error }: { data: any; error: any } = await withTimeout(
        supabase
          .from("links")
          .insert([payload])
          .select(
            "id, url, title, note, status, rating, is_favorite, category, summary, keywords, collection_id, ai_state, ai_error, published_at, created_at, deleted_at"
          )
          .single(),
        REQUEST_TIMEOUT_MS,
        "링크 저장"
      );

      if (error) {
        throw error;
      }

      const optimistic: LinkItem = {
        id: data.id,
        url: data.url,
        title: data.title,
        note: data.note,
        status: data.status,
        rating: data.rating,
        is_favorite: data.is_favorite,
        category: normalizeCategoryName(data.category),
        summary: data.summary,
        keywords: data.keywords || [],
        collection_id: data.collection_id,
        ai_state: data.ai_state,
        ai_error: data.ai_error,
        published_at: data.published_at ?? null,
        created_at: data.created_at,
        deleted_at: data.deleted_at,
        collection: collections.find((item) => item.id === data.collection_id) || null,
        tags: normalizeTags(newTags)
      };

      setLinks((prev) => [{ ...optimistic, ai_state: "pending", ai_error: null }, ...prev]);
      await syncLinkTags(data.id, newTags);
      setToast({ kind: "info", message: `저장됨: ${getLinkDisplayLabel(optimistic)} (AI 분석 중)` });

      setNewUrl("");
      setNewTitle("");
      setNewCategory("");
      setNewNote("");
      setNewPublishedAt(null);
      setNewStatus("unread");
      setNewCollectionId("");
      setNewTags("");
      setNewTagInput("");
      setIsAddModalOpen(false);

      void runAiEnrichmentInBackground(optimistic);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(`링크 저장 실패: ${message}`);
    } finally {
      setSavingLink(false);
    }
  }

  async function saveDraftById(linkId: string) {
    if (!session) {
      return;
    }

    const link = links.find((item) => item.id === linkId);
    if (!link) {
      return;
    }

    const draft = draftsRef.current[linkId] || getLinkDraft(link);
    if (!isDraftDirty(link, draft)) {
      return;
    }

    const ratingValue = parseRating(draft.rating);

    setSavingLinkId(linkId);
    setErrorMessage(null);

    try {
      const payload = {
        note: draft.note.trim() || null,
        status: draft.status,
        rating: ratingValue,
        collection_id: draft.collectionId || null
      };

      const { error } = await supabase.from("links").update(payload).eq("id", linkId);
      if (error) {
        throw error;
      }

      await syncLinkTags(linkId, draft.tags);

      const normalizedTags = normalizeTags(draft.tags);
      setLinks((prev) =>
        prev.map((item) =>
          item.id === linkId
            ? {
                ...item,
                note: payload.note,
                status: draft.status,
                rating: ratingValue,
                collection_id: payload.collection_id,
                collection: collections.find((collection) => collection.id === payload.collection_id) || null,
                tags: normalizedTags
              }
            : item
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(`링크 수정 실패: ${message}`);
    } finally {
      setSavingLinkId(null);
    }
  }

  function scheduleDraftAutoSave(linkId: string): void {
    const prevTimer = autoSaveTimersRef.current[linkId];
    if (prevTimer) {
      clearTimeout(prevTimer);
    }

    autoSaveTimersRef.current[linkId] = setTimeout(() => {
      delete autoSaveTimersRef.current[linkId];
      void saveDraftById(linkId);
    }, 500);
  }

  async function setLinkDeleted(linkId: string, deleted: boolean) {
    const { error } = await supabase
      .from("links")
      .update({ deleted_at: deleted ? new Date().toISOString() : null })
      .eq("id", linkId);

    if (error) {
      setErrorMessage(`삭제/복원 실패: ${error.message}`);
      return;
    }

    await loadLinks();
  }

  function toggleSelectLink(linkId: string): void {
    setSelectedLinkIds((prev) => (prev.includes(linkId) ? prev.filter((id) => id !== linkId) : [...prev, linkId]));
  }

  function toggleSelectAllVisible(allVisibleSelected: boolean, visibleIds: string[]): void {
    if (visibleIds.length === 0) {
      return;
    }

    setSelectedLinkIds((prev) => {
      if (allVisibleSelected) {
        return prev.filter((id) => !visibleIds.includes(id));
      }
      const merged = new Set(prev);
      for (const id of visibleIds) {
        merged.add(id);
      }
      return Array.from(merged);
    });
  }

  async function bulkUpdateStatus(targetStatus: "unread" | "reading", targetIds: string[]): Promise<void> {
    if (targetIds.length === 0) {
      return;
    }

    setErrorMessage(null);
    const { error } = await supabase.from("links").update({ status: targetStatus }).in("id", targetIds).is("deleted_at", null);
    if (error) {
      setErrorMessage(`일괄 상태 변경 실패: ${error.message}`);
      return;
    }

    setLinks((prev) =>
      prev.map((item) =>
        targetIds.includes(item.id)
          ? {
              ...item,
              status: targetStatus
            }
          : item
      )
    );
    setSelectedLinkIds((prev) => prev.filter((id) => !targetIds.includes(id)));
    await loadLinks({ silent: true });
    setToast({ kind: "ok", message: `${targetIds.length}건을 ${targetStatus === "reading" ? "읽음" : "안읽음"}으로 변경했습니다.` });
  }

  async function bulkDeleteLinks(targetIds: string[]): Promise<void> {
    if (targetIds.length === 0) {
      return;
    }

    const confirmed = window.confirm(`선택한 링크 ${targetIds.length}건을 삭제할까요?`);
    if (!confirmed) {
      return;
    }

    setErrorMessage(null);
    const { error } = await supabase
      .from("links")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", targetIds)
      .is("deleted_at", null);
    if (error) {
      setErrorMessage(`일괄 삭제 실패: ${error.message}`);
      return;
    }

    setSelectedLinkIds((prev) => prev.filter((id) => !targetIds.includes(id)));
    await loadLinks({ silent: true });
    setToast({ kind: "ok", message: `${targetIds.length}건을 삭제했습니다.` });
  }

  async function restoreDeletedLinks(targetIds: string[]): Promise<void> {
    if (targetIds.length === 0) {
      return;
    }

    setErrorMessage(null);
    const { error } = await supabase.from("links").update({ deleted_at: null }).in("id", targetIds).not("deleted_at", "is", null);
    if (error) {
      setErrorMessage(`일괄 복원 실패: ${error.message}`);
      return;
    }

    setSelectedLinkIds((prev) => prev.filter((id) => !targetIds.includes(id)));
    if (selectedLinkId && targetIds.includes(selectedLinkId)) {
      setSelectedLinkId(null);
    }
    await loadLinks({ silent: true });
    setToast({ kind: "ok", message: `${targetIds.length}건을 복원했습니다.` });
  }

  async function permanentlyDeleteLinks(targetIds: string[]): Promise<void> {
    if (targetIds.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `선택한 휴지통 기사 ${targetIds.length}건을 영구 삭제할까요?\n이 작업은 되돌릴 수 없습니다.`
    );
    if (!confirmed) {
      return;
    }

    setErrorMessage(null);
    const { error } = await supabase.from("links").delete().in("id", targetIds);
    if (error) {
      setErrorMessage(`영구 삭제 실패: ${error.message}`);
      return;
    }

    setSelectedLinkIds((prev) => prev.filter((id) => !targetIds.includes(id)));
    if (selectedLinkId && targetIds.includes(selectedLinkId)) {
      setSelectedLinkId(null);
    }
    await loadLinks({ silent: true });
    setToast({ kind: "ok", message: `${targetIds.length}건을 영구 삭제했습니다.` });
  }

  function handleCardPrimaryAction(link: LinkItem): void {
    if (multiSelectMode) {
      toggleSelectLink(link.id);
      return;
    }
    openLinkDetail(link);
  }

  async function toggleFavorite(link: LinkItem) {
    const { error } = await supabase
      .from("links")
      .update({ is_favorite: !link.is_favorite })
      .eq("id", link.id);

    if (error) {
      setErrorMessage(`즐겨찾기 변경 실패: ${error.message}`);
      return;
    }

    setLinks((prev) => prev.map((item) => (item.id === link.id ? { ...item, is_favorite: !item.is_favorite } : item)));
  }

  async function runAiAnalysis(link: LinkItem) {
    if (!session) {
      return;
    }

    setSavingLinkId(link.id);

    try {
      setLinks((prev) => prev.map((item) => (item.id === link.id ? { ...item, ai_state: "pending", ai_error: null } : item)));
      await runAiWithRetry(link.id, 1);

      await loadLinks({ silent: true });
      setToast({ kind: "ok", message: `AI 분석 완료: ${getLinkDisplayLabel(link)}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(`AI 분석 실패: ${message}`);
      setToast({ kind: "err", message: `AI 분석 실패: ${getLinkDisplayLabel(link)}` });
      await loadLinks({ silent: true });
    } finally {
      setSavingLinkId(null);
    }
  }

  async function runBulkAiForUncategorized() {
    if (!session || bulkAiRunning) {
      return;
    }

    setBulkAiRunning(true);
    setErrorMessage(null);

    try {
      const pageSize = 500;
      let page = 0;
      const targets: { id: string }[] = [];

      while (true) {
        const from = page * pageSize;
        const to = from + pageSize - 1;
        const { data, error } = await supabase
          .from("links")
          .select("id, category, ai_state")
          .is("deleted_at", null)
          .order("created_at", { ascending: true })
          .range(from, to);

        if (error) {
          throw error;
        }

        if (!data || data.length === 0) {
          break;
        }

        for (const row of data) {
          const category = normalizeCategoryName(row?.category);
          if (!category && row?.ai_state !== "pending" && typeof row?.id === "string") {
            targets.push({ id: row.id });
          }
        }

        if (data.length < pageSize) {
          break;
        }

        page += 1;
      }

      if (targets.length === 0) {
        setToast({ kind: "info", message: "미분류 링크가 없습니다." });
        return;
      }

      setToast({ kind: "info", message: `미분류 링크 AI 분석 시작 (${targets.length}건)` });

      let success = 0;
      let failed = 0;

      for (const target of targets) {
        setLinks((prev) => prev.map((item) => (item.id === target.id ? { ...item, ai_state: "pending", ai_error: null } : item)));
        try {
          await runAiWithRetry(target.id, 1);
          success += 1;
        } catch {
          failed += 1;
        }
      }

      await loadLinks({ silent: true });
      if (failed === 0) {
        setToast({ kind: "ok", message: `미분류 링크 AI 분석 완료 (${success}건)` });
      } else {
        setToast({ kind: "err", message: `일괄 AI 분석 완료: 성공 ${success}건, 실패 ${failed}건` });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(`미분류 일괄 AI 실행 실패: ${message}`);
      setToast({ kind: "err", message: "미분류 일괄 AI 실행 실패" });
    } finally {
      setBulkAiRunning(false);
    }
  }

  const markLinkAsRead = useCallback(
    async (linkId: string) => {
      if (!session) {
        return;
      }

      setLinks((prev) => prev.map((item) => (item.id === linkId && item.status === "unread" ? { ...item, status: "reading" } : item)));
      setDrafts((prev) => {
        const current = prev[linkId];
        if (!current || current.status !== "unread") {
          return prev;
        }
        return {
          ...prev,
          [linkId]: {
            ...current,
            status: "reading"
          }
        };
      });

      const { error } = await supabase
        .from("links")
        .update({ status: "reading" })
        .eq("id", linkId)
        .eq("status", "unread");

      if (error) {
        setErrorMessage(`읽음 상태 변경 실패: ${error.message}`);
        await loadLinks();
      }
    },
    [session, loadLinks]
  );

  const openLinkDetail = useCallback(
    (link: LinkItem) => {
      setSelectedLinkId(link.id);
      if (link.status === "unread") {
        void markLinkAsRead(link.id);
      }
    },
    [markLinkAsRead]
  );

  function updateDraft(link: LinkItem, patch: Partial<LinkDraft>) {
    setDrafts((prev) => {
      const current = prev[link.id] || getLinkDraft(link);
      const next = {
        ...prev,
        [link.id]: {
          ...current,
          ...patch
        }
      };
      draftsRef.current = next;
      return next;
    });
    scheduleDraftAutoSave(link.id);
  }

  const modalTags = useMemo(() => normalizeTags(newTags), [newTags]);

  function appendModalTag(tagRaw: string): void {
    const trimmed = tagRaw.trim().replace(/^#+/, "");
    if (!trimmed) {
      return;
    }
    const next = normalizeTags(`${newTags},${trimmed}`);
    setNewTags(next.join(", "));
    setNewTagInput("");
  }

  function removeModalTag(tag: string): void {
    const next = modalTags.filter((item) => item !== tag);
    setNewTags(next.join(", "));
  }

  const headerStats = useMemo(
    () => ({
      total: libraryStats.total,
      unread: libraryStats.unread,
      aiDone: libraryStats.aiDone,
      favorite: libraryStats.favorite
    }),
    [libraryStats]
  );

  const visibleLinks = useMemo(
    () => (statusFilter === "all" ? links : links.filter((item) => item.status === statusFilter)),
    [links, statusFilter]
  );
  const visibleLinkIds = useMemo(() => visibleLinks.map((item) => item.id), [visibleLinks]);
  const selectedVisibleIds = useMemo(() => visibleLinkIds.filter((id) => selectedLinkIds.includes(id)), [visibleLinkIds, selectedLinkIds]);
  const selectedVisibleCount = selectedVisibleIds.length;
  const allVisibleSelected = visibleLinks.length > 0 && selectedVisibleCount === visibleLinks.length;

  const categoryMenu = useMemo(() => [...CATEGORY_BASE_MENU], []);

  const categoryStats = useMemo(() => {
    return categoryMenu.map((category) => ({
      category,
      count: categoryCounts[category] || 0
    }));
  }, [categoryMenu, categoryCounts]);

  const readingCount = libraryStats.reading;
  const archivedCount = libraryStats.archived;
  const userLabel = useMemo(() => {
    const emailValue = session?.user?.email || "User";
    return emailValue.split("@")[0] || emailValue;
  }, [session]);
  const userInitial = userLabel.slice(0, 1).toUpperCase();
  const currentCollectionName = useMemo(
    () => collections.find((item) => item.id === collectionFilter)?.name || null,
    [collections, collectionFilter]
  );
  const currentViewTitle = useMemo(() => {
    if (mainTab === "settings") {
      return "설정";
    }
    if (showTrash) {
      return "휴지통";
    }
    if (favoriteOnly) {
      return "즐겨찾기";
    }
    if (categoryFilter !== "all") {
      return categoryFilter;
    }
    if (currentCollectionName) {
      return currentCollectionName;
    }
    if (statusFilter === "unread") {
      return "안읽음";
    }
    if (statusFilter === "reading") {
      return "읽음";
    }
    if (statusFilter === "archived") {
      return "보관";
    }
    return "전체 기사";
  }, [mainTab, showTrash, favoriteOnly, categoryFilter, currentCollectionName, statusFilter]);

  if (!authReady) {
    return <main className="app-shell">세션 확인 중...</main>;
  }

  if (!session) {
    return (
      <main className="auth-shell">
        <section className="auth-layout">
          <aside className="auth-showcase">
            <div className="auth-showcase-mark" aria-hidden>
              <img src="/logo-mark.svg" alt="" />
            </div>
            <p className="auth-showcase-kicker">LINKPOCKET</p>
            <h1>
              <span>읽을거리 아카이브를</span>
              <span>더 선명하게</span>
            </h1>
            <p className="auth-showcase-desc">저장부터 요약, 분류, 재탐색까지 하나의 화면에서 일관되게 관리하는 개인 지식 파이프라인.</p>
            <div className="auth-showcase-metrics">
              <article>
                <strong>Save Fast</strong>
                <span>URL / 파일 업로드 즉시 정리</span>
              </article>
              <article>
                <strong>Think Clear</strong>
                <span>AI 요약 + 키워드 + 카테고리 보강</span>
              </article>
              <article>
                <strong>Find Again</strong>
                <span>상태/태그/컬렉션 필터로 재탐색</span>
              </article>
            </div>
            <ul className="auth-showcase-list">
              <li>
                <strong>수집 속도 최적화</strong>
                <span>여러 소스의 기사를 한 번에 모아도 흐름이 끊기지 않습니다.</span>
              </li>
              <li>
                <strong>핵심 정보 중심 요약</strong>
                <span>중요 수치와 맥락을 놓치지 않도록 요약 품질을 커스터마이징할 수 있습니다.</span>
              </li>
              <li>
                <strong>다시 찾기 쉬운 구조</strong>
                <span>읽기 상태와 태그를 기준으로 필요한 자료를 빠르게 복원합니다.</span>
              </li>
            </ul>
          </aside>

          <section className="auth-card">
            <div className="auth-head">
              <p className="auth-mode-chip">{authMode === "login" ? "LOGIN" : "SIGN UP"}</p>
              <h2>{authMode === "login" ? "로그인" : "회원가입"}</h2>
              <p>{authMode === "login" ? "저장한 아카이브를 이어서 관리하세요." : "새 계정을 만들고 바로 시작하세요."}</p>
            </div>

            <form onSubmit={handleAuthSubmit} className="stack auth-form">
              <label>
                이메일
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="you@example.com" />
              </label>

              <label>
                비밀번호
                <input
                  type="password"
                  minLength={6}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  placeholder="6자 이상"
                />
              </label>

              <button type="submit" disabled={authLoading}>
                {authLoading ? "처리 중..." : authMode === "login" ? "로그인" : "회원가입"}
              </button>
            </form>

            <div className="auth-switch-row">
              <span>{authMode === "login" ? "처음이신가요?" : "이미 계정이 있나요?"}</span>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  if (authMode === "login") {
                    setShowSignupGuide(true);
                    return;
                  }
                  setAuthMode("login");
                  setAuthNotice(null);
                  setErrorMessage(null);
                }}
              >
                {authMode === "login" ? "회원가입으로 전환" : "로그인으로 전환"}
              </button>
            </div>

            {authNotice && <p className="ok-text">{authNotice}</p>}
            {errorMessage && <p className="error-text">{errorMessage}</p>}
          </section>
        </section>

        {showSignupGuide && (
          <div className="signup-guide-overlay" role="presentation" onClick={() => setShowSignupGuide(false)}>
            <section className="signup-guide-modal" role="dialog" aria-modal="true" aria-label="회원가입 안내" onClick={(event) => event.stopPropagation()}>
              <div className="signup-guide-head">
                <h3>회원가입 안내</h3>
                <button type="button" className="icon-btn" onClick={() => setShowSignupGuide(false)} aria-label="닫기">
                  ×
                </button>
              </div>
              <p className="muted">회원가입은 새 창 또는 현재 창에서 진행할 수 있습니다.</p>
              <ol className="signup-guide-steps">
                <li>회원가입을 완료합니다.</li>
                <li>이메일 인증 메일에서 인증을 완료합니다.</li>
                <li>인증 후 현재 로그인 화면에서 로그인합니다.</li>
              </ol>
              <div className="signup-guide-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      const nextUrl = new URL(window.location.href);
                      nextUrl.searchParams.set(AUTH_MODE_QUERY_KEY, "signup");
                      window.open(nextUrl.toString(), "_blank", "noopener,noreferrer");
                    }
                    setShowSignupGuide(false);
                    setAuthNotice("새 창에서 가입 후 이메일 인증을 완료하고, 현재 창에서 로그인해 주세요.");
                  }}
                >
                  새 창에서 가입
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode("signup");
                    setShowSignupGuide(false);
                    setAuthNotice("회원가입 후 이메일 인증을 완료한 뒤 로그인해 주세요.");
                    setErrorMessage(null);
                  }}
                >
                  현재 창에서 가입
                </button>
              </div>
            </section>
          </div>
        )}
      </main>
    );
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-row">
            <div className="logo-mark-wrap" aria-hidden>
              <img src="/logo-mark.svg" alt="" className="logo-mark" />
            </div>
            <div>
              <p className="eyebrow">Reading Archive</p>
              <h1 className="logo-name">LinkPocket</h1>
            </div>
          </div>
        </div>

        <div className="sidebar-scroll">
          <div className="nav-group">
            <p className="nav-group-label">홈</p>
            <button
              type="button"
              className={`nav-btn ${mainTab === "library" ? "active" : ""}`}
              onClick={() => setMainTab("library")}
            >
              라이브러리
            </button>
          </div>

          <div className="nav-group">
            <p className="nav-group-label">라이브러리</p>
            <button
              type="button"
              className={`nav-btn ${!showTrash && statusFilter === "all" && !favoriteOnly ? "active" : ""}`}
              onClick={() => {
                setMainTab("library");
                setShowTrash(false);
                setStatusFilter("all");
                setCategoryFilter("all");
                setFavoriteOnly(false);
              }}
            >
              전체 기사 <span className="nav-count">{headerStats.total}</span>
            </button>
            <button
              type="button"
              className={`nav-btn ${!showTrash && statusFilter === "unread" ? "active" : ""}`}
              onClick={() => {
                setMainTab("library");
                setShowTrash(false);
                setStatusFilter("unread");
                setCategoryFilter("all");
                setFavoriteOnly(false);
              }}
            >
              안읽음 <span className="nav-count">{headerStats.unread}</span>
            </button>
            <button
              type="button"
              className={`nav-btn ${!showTrash && statusFilter === "reading" ? "active" : ""}`}
              onClick={() => {
                setMainTab("library");
                setShowTrash(false);
                setStatusFilter("reading");
                setCategoryFilter("all");
                setFavoriteOnly(false);
              }}
            >
              읽음 <span className="nav-count">{readingCount}</span>
            </button>
            <button
              type="button"
              className={`nav-btn ${!showTrash && favoriteOnly ? "active" : ""}`}
              onClick={() => {
                setMainTab("library");
                setShowTrash(false);
                setStatusFilter("all");
                setCategoryFilter("all");
                setFavoriteOnly(true);
              }}
            >
              즐겨찾기 <span className="nav-count">{headerStats.favorite}</span>
            </button>
            <button
              type="button"
              className={`nav-btn ${!showTrash && statusFilter === "archived" ? "active" : ""}`}
              onClick={() => {
                setMainTab("library");
                setShowTrash(false);
                setStatusFilter("archived");
                setCategoryFilter("all");
                setFavoriteOnly(false);
              }}
            >
              보관 <span className="nav-count">{archivedCount}</span>
            </button>
            <button
              type="button"
              className={`nav-btn ${showTrash ? "active" : ""}`}
              onClick={() => {
                setMainTab("library");
                setFavoriteOnly(false);
                setCategoryFilter("all");
                setShowTrash((prev) => !prev);
              }}
            >
              휴지통 <span className="nav-count">{libraryStats.trash}</span>
            </button>
          </div>

          <div className="nav-group">
            <p className="nav-group-label">카테고리</p>
            {categoryStats.map((row) => (
              <button
                key={row.category}
                type="button"
                className={`nav-btn ${!showTrash && categoryFilter === row.category ? "active" : ""}`}
                onClick={() => {
                  setMainTab("library");
                  setShowTrash(false);
                  setFavoriteOnly(false);
                  setCollectionFilter("all");
                  setCategoryFilter((prev) => (prev === row.category ? "all" : row.category));
                }}
              >
                {row.category}
                <span className="nav-count">{row.count}</span>
              </button>
            ))}
          </div>

          <div className="nav-group">
            <p className="nav-group-label">컬렉션</p>
            <button
              type="button"
              className={`nav-btn ${collectionFilter === "all" ? "active" : ""}`}
              onClick={() => {
                setMainTab("library");
                setCollectionFilter("all");
                setCategoryFilter("all");
              }}
            >
              모든 컬렉션
            </button>
            {collections.map((collection) => {
              const count = links.filter((item) => item.collection_id === collection.id).length;
              return (
                <div key={collection.id} className={`collection-item ${collectionFilter === collection.id ? "active" : ""}`}>
                  <button
                    type="button"
                    className={`nav-btn collection-btn ${collectionFilter === collection.id ? "active" : ""}`}
                    onClick={() => {
                      setMainTab("library");
                      setCategoryFilter("all");
                      setCollectionFilter(collection.id);
                    }}
                  >
                    <span className="collection-dot" style={{ backgroundColor: collection.color || COLLECTION_COLOR_PRESET[0] }} />
                    {collection.name}
                    <span className="nav-count">{count}</span>
                  </button>
                  <div className="collection-actions">
                    <button
                      type="button"
                      className="collection-icon-btn"
                      title="수정"
                      onClick={(event) => {
                        event.stopPropagation();
                        startCollectionEdit(collection);
                      }}
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      className="collection-icon-btn danger"
                      title="삭제"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDeleteCollection(collection.id);
                      }}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              );
            })}
            <form onSubmit={handleCreateCollection} className="sidebar-collection-form">
              <input
                value={collectionName}
                onChange={(event) => setCollectionName(event.target.value)}
                placeholder="컬렉션 이름"
                required
              />
              {!editingCollectionId && <p className="muted mini-hint">색상은 자동으로 배정됩니다. 필요하면 수정에서 바꿀 수 있어요.</p>}
              <div className="sidebar-collection-row">
                {editingCollectionId && <input type="color" value={collectionColor} onChange={(event) => setCollectionColor(event.target.value)} />}
                <button type="submit">{editingCollectionId ? "수정" : "+ 컬렉션 추가"}</button>
                {editingCollectionId && (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setEditingCollectionId(null);
                      setCollectionName("");
                      setCollectionColor(COLLECTION_COLOR_PRESET[0]);
                    }}
                  >
                    취소
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="plan-card">
            <p className="plan-name">Free 플랜</p>
            <div className="plan-row">
              <span>현재 저장량</span>
              <strong>{headerStats.total} / 무제한</strong>
            </div>
            <div className="plan-bar-bg">
              <div className="plan-bar" style={{ width: "24%" }} />
            </div>
          </div>
        </div>
      </aside>

      <main className="main">
        <input
          ref={importFileInputRef}
          type="file"
          accept=".csv,.jsonl,.json,.txt"
          style={{ display: "none" }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void handleImportArticlesFile(file);
            }
          }}
        />

        <header className="topbar">
          <h2 className="page-title">{currentViewTitle}</h2>
          <div className="topbar-right">
            {mainTab === "library" && (
              <>
                <input
                  ref={searchInputRef}
                  className="search-input"
                  placeholder="검색어 입력"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
	                <button
	                  type="button"
	                  onClick={() => {
	                    setIsAddModalOpen(true);
	                    setManualTitleEdited(false);
	                    setNewPublishedAt(null);
	                    setTimeout(() => newUrlInputRef.current?.focus(), 0);
	                  }}
	                >
	                  + 링크 추가
	                </button>
              </>
            )}
            <div className="user-menu-wrap" onClick={(event) => event.stopPropagation()}>
              <button
                type="button"
                className="user-btn"
                onClick={() => setShowUserMenu((prev) => !prev)}
                aria-label="사용자 메뉴"
              >
                <span className="user-avatar">{userInitial}</span>
                <span>{userLabel}</span>
                <span>▾</span>
              </button>
              {showUserMenu && (
                <div className="user-menu">
                  <p>{session.user.email}</p>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setIsHelpModalOpen(true);
                      setShowUserMenu(false);
                    }}
                  >
                    도움말
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setMainTab("settings");
                      setShowUserMenu(false);
                    }}
                  >
                    설정
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={handleLogout}
                    disabled={logoutLoading}
                  >
                    {logoutLoading ? "로그아웃 중..." : "로그아웃"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="content">
          {mainTab === "library" ? (
            <>
          <section className="stats-grid">
            <article className="stat">
              <span>전체</span>
              <strong>{headerStats.total}</strong>
            </article>
            <article className="stat">
              <span>안읽음</span>
              <strong>{headerStats.unread}</strong>
            </article>
            <article className="stat">
              <span>AI 요약 완료</span>
              <strong>{headerStats.aiDone}</strong>
            </article>
            <article className="stat">
              <span>즐겨찾기</span>
              <strong>{headerStats.favorite}</strong>
            </article>
          </section>

	          <section className="panel toolbar-panel">
	            <div className="toolbar-left">
	              <div className="chip-row">
	                <button type="button" className={`chip ${sortMode === "newest" ? "active" : ""}`} onClick={() => setSortMode("newest")}>
	                  최신순
	                </button>
	                <button type="button" className={`chip ${sortMode === "oldest" ? "active" : ""}`} onClick={() => setSortMode("oldest")}>
	                  오래된순
	                </button>
	                <button type="button" className={`chip ${sortMode === "rating" ? "active" : ""}`} onClick={() => setSortMode("rating")}>
	                  별점순
	                </button>
	                <button
	                  type="button"
	                  className={`chip ${statusFilter === "unread" ? "active" : ""}`}
	                  onClick={() => setStatusFilter((prev) => (prev === "unread" ? "all" : "unread"))}
	                >
	                  안읽음만
	                </button>
	              </div>
		              <div className="bulk-toolbar">
		                <button
		                  type="button"
		                  className={`chip ${multiSelectMode ? "active" : ""}`}
		                  onClick={() => setMultiSelectMode((prev) => !prev)}
		                >
		                  {multiSelectMode ? "다중선택 종료" : "다중선택"}
		                </button>
		                {multiSelectMode && (
		                  <>
		                    <button
		                      type="button"
		                      className={`chip ${allVisibleSelected ? "active" : ""}`}
		                      onClick={() => toggleSelectAllVisible(allVisibleSelected, visibleLinkIds)}
		                      disabled={visibleLinks.length === 0}
		                    >
		                      {allVisibleSelected ? "전체선택 해제" : "전체선택"}
		                    </button>
		                    <span className="bulk-count">{selectedVisibleCount}개 선택</span>
		                    {showTrash ? (
		                      <>
		                        <button
		                          type="button"
		                          className="chip"
		                          onClick={() => void restoreDeletedLinks(selectedVisibleIds)}
		                          disabled={selectedVisibleCount === 0}
		                        >
		                          복원
		                        </button>
		                        <button
		                          type="button"
		                          className="chip danger-chip"
		                          onClick={() => void permanentlyDeleteLinks(selectedVisibleIds)}
		                          disabled={selectedVisibleCount === 0}
		                        >
		                          영구삭제
		                        </button>
		                      </>
		                    ) : (
		                      <>
		                        <button
		                          type="button"
		                          className="chip"
		                          onClick={() => void bulkUpdateStatus("reading", selectedVisibleIds)}
		                          disabled={selectedVisibleCount === 0}
		                        >
		                          읽음으로
		                        </button>
		                        <button
		                          type="button"
		                          className="chip"
		                          onClick={() => void bulkUpdateStatus("unread", selectedVisibleIds)}
		                          disabled={selectedVisibleCount === 0}
		                        >
		                          안읽음으로
		                        </button>
		                        <button
		                          type="button"
		                          className="chip danger-chip"
		                          onClick={() => void bulkDeleteLinks(selectedVisibleIds)}
		                          disabled={selectedVisibleCount === 0}
		                        >
		                          삭제
		                        </button>
		                      </>
		                    )}
		                  </>
		                )}
		              </div>
		            </div>
		            <div className="view-toggle">
              <button
                type="button"
                className={`icon-btn ${viewMode === "card" ? "active" : ""}`}
                aria-label="그리드 보기"
                title="그리드 보기"
                onClick={() => setViewMode("card")}
              >
                ▦
              </button>
              <button
                type="button"
                className={`icon-btn ${viewMode === "list" ? "active" : ""}`}
                aria-label="리스트 보기"
                title="리스트 보기"
                onClick={() => setViewMode("list")}
              >
                ☰
              </button>
            </div>
          </section>

          <section className={`panel links-panel ${viewMode}`}>
            {loadingLinks && <p className="muted">불러오는 중...</p>}

            {!loadingLinks && visibleLinks.length === 0 && (
              <div className="empty-state">
                <div className="empty-icon" aria-hidden>
                  ▤
                </div>
                <strong>아직 저장된 기사가 없습니다</strong>
                <p>"링크 추가" 버튼으로 기사를 저장해보세요</p>
              </div>
            )}

	            {!loadingLinks &&
	              visibleLinks.map((link) => {
	                const displayTags = Array.from(
	                  new Set(
                    [...(Array.isArray(link.tags) ? link.tags : []), ...(Array.isArray(link.keywords) ? link.keywords : [])]
                      .map((item) => item.trim())
	                      .filter((item) => item.length > 0)
	                  )
	                );
		                const isMultiSelected = selectedLinkIds.includes(link.id);
		                return (
		                  <article
		                    key={link.id}
		                    className={`link-card ${selectedLinkId === link.id && !multiSelectMode ? "selected" : ""} ${isMultiSelected ? "multi-selected" : ""} ${multiSelectMode ? "multi-mode" : ""}`}
		                    onClick={() => handleCardPrimaryAction(link)}
		                    role="button"
		                    tabIndex={0}
	                    onKeyDown={(event) => {
	                      if (event.key === "Enter" || event.key === " ") {
	                        event.preventDefault();
	                        handleCardPrimaryAction(link);
	                      }
	                    }}
		                  >
		                    <header>
		                      <div className="tile-head">
		                        {multiSelectMode && (
		                          <label
		                            className="multi-select-toggle"
		                            onClick={(event) => event.stopPropagation()}
		                            onMouseDown={(event) => event.stopPropagation()}
		                          >
		                            <input
		                              type="checkbox"
		                              checked={isMultiSelected}
		                              onChange={() => toggleSelectLink(link.id)}
		                              onClick={(event) => event.stopPropagation()}
		                              onKeyDown={(event) => event.stopPropagation()}
		                              aria-label="항목 선택"
		                            />
		                          </label>
		                        )}
		                        <div className="tile-icon" aria-hidden>
		                          {getUrlHostLabel(link.url).slice(0, 1).toUpperCase()}
		                        </div>
                        <div className="link-title-wrap">
                        <div className="link-title-head">
                          {link.status === "unread" && <span className="unread-dot" aria-label="안읽음" />}
                          <h3>{link.title || link.url}</h3>
                        </div>
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => {
                            event.stopPropagation();
                          }}
                        >
                          {getUrlHostLabel(link.url)}
                        </a>
                      </div>
                      </div>
                      <div className="pill-row">
                        <span className={`pill status-pill status-${link.status}`}>{STATUS_LABEL[link.status]}</span>
                        {link.collection && (
                          <span className="pill collection-pill">
                            {link.collection.color && <i style={{ backgroundColor: link.collection.color }} aria-hidden />}
                            {link.collection.name}
                          </span>
                        )}
                        {link.ai_state !== "idle" && (
                          <span className={`pill ai-pill ai-${link.ai_state}`}>AI {AI_STATE_LABEL[link.ai_state] || link.ai_state}</span>
                        )}
                      </div>
                    </header>

                    <div className="link-meta">
                      <span>{getUrlHostLabel(link.url)}</span>
                      <span>{formatDateLabel(getDisplayDateValue(link))}</span>
                      <span>{STATUS_LABEL[link.status]}</span>
                    </div>

                    {link.summary && <p className="summary">{link.summary}</p>}
                    {displayTags.length > 0 && <p className="keywords">#{displayTags.join(" #")}</p>}
                    {link.ai_error && <p className="error-text">AI 오류: {link.ai_error}</p>}

                    <div className="card-actions">
                      <button
                        type="button"
                        className="action-btn"
                        aria-label="원문 열기"
                        title="원문 열기"
                        onClick={(event) => {
                          event.stopPropagation();
                          window.open(link.url, "_blank", "noopener,noreferrer");
                        }}
                      >
                        ↗
                      </button>
                      <button
                        type="button"
                        className={`action-btn ${link.is_favorite ? "is-active" : ""}`}
                        aria-label={link.is_favorite ? "즐겨찾기 해제" : "즐겨찾기"}
                        title={link.is_favorite ? "즐겨찾기 해제" : "즐겨찾기"}
                        onClick={(event) => {
                          event.stopPropagation();
                          void toggleFavorite(link);
                        }}
                      >
                        ★
                      </button>
                      <button
                        type="button"
                        className="action-btn"
                        aria-label="상세 편집"
                        title="상세 편집"
                        onClick={(event) => {
                          event.stopPropagation();
                          openLinkDetail(link);
                        }}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="action-btn"
                        aria-label="AI 분석"
                        title="AI 분석"
                        onClick={(event) => {
                          event.stopPropagation();
                          void runAiAnalysis(link);
                        }}
                        disabled={savingLinkId === link.id}
                      >
                        AI
                      </button>
                      {(link.ai_state === "failed" || link.ai_error) && (
                        <button
                          type="button"
                          className="action-btn warn"
                          aria-label="AI 재시도"
                          title="AI 재시도"
                          onClick={(event) => {
                            event.stopPropagation();
                            void runAiAnalysis(link);
                          }}
                          disabled={savingLinkId === link.id}
                        >
                          ⟳
                        </button>
                      )}
	                      {showTrash ? (
	                        <>
	                          <button
	                            type="button"
	                            className="action-btn"
	                            aria-label="복원"
	                            title="복원"
	                            onClick={(event) => {
	                              event.stopPropagation();
	                              void restoreDeletedLinks([link.id]);
	                            }}
	                          >
	                            ↺
	                          </button>
	                          <button
	                            type="button"
	                            className="action-btn danger"
	                            aria-label="영구 삭제"
	                            title="영구 삭제"
	                            onClick={(event) => {
	                              event.stopPropagation();
	                              void permanentlyDeleteLinks([link.id]);
	                            }}
	                          >
	                            DEL
	                          </button>
	                        </>
	                      ) : (
	                        <button
	                          type="button"
	                          className="action-btn danger"
                          aria-label="삭제"
                          title="삭제"
                          onClick={(event) => {
                            event.stopPropagation();
                            void setLinkDeleted(link.id, true);
                          }}
                        >
                          ⌫
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
          </section>
            </>
          ) : (
            <section className="panel settings-panel">
              <div className="settings-grid">
                <article className="settings-card">
                  <h3>데이터 관리</h3>
                  <p className="muted">기사 가져오기/내보내기와 AI 일괄 실행을 관리합니다.</p>
                  <div className="settings-control">
                    <span>가져오기 후 AI 자동 분석</span>
                    <div className="chip-row">
                      <button
                        type="button"
                        className={`chip ${!autoAnalyzeOnImport ? "active" : ""}`}
                        onClick={() => setAutoAnalyzeOnImport(false)}
                      >
                        끔
                      </button>
                      <button
                        type="button"
                        className={`chip ${autoAnalyzeOnImport ? "active" : ""}`}
                        onClick={() => setAutoAnalyzeOnImport(true)}
                      >
                        켬
                      </button>
                    </div>
                  </div>
                  <div className="settings-actions">
                    <button type="button" className="ghost" onClick={() => importFileInputRef.current?.click()} disabled={importingFile}>
                      {importingFile ? "가져오는 중..." : "파일 가져오기"}
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => void handleExportLinks("jsonl")}
                      disabled={Boolean(exportingFormat)}
                    >
                      {exportingFormat === "jsonl" ? "JSONL 내보내는 중..." : "JSONL 내보내기"}
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => void handleExportLinks("csv")}
                      disabled={Boolean(exportingFormat)}
                    >
                      {exportingFormat === "csv" ? "CSV 내보내는 중..." : "CSV 내보내기"}
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => void runBulkAiForUncategorized()}
                      disabled={bulkAiRunning || loadingLinks}
                    >
                      {bulkAiRunning ? "미분류 AI 처리중..." : "미분류 전체 AI 분석"}
                    </button>
                  </div>
                  <p className="muted">내보내기는 삭제되지 않은 링크만 포함합니다.</p>
                </article>

                <article className="settings-card">
                  <h3>AI 요약 설정</h3>
                  <p className="muted">원하는 내용과 분량으로 요약을 커스터마이징합니다. 저장 후 다음 AI 실행부터 적용됩니다.</p>
                  <div className="settings-control">
                    <span>요약 분량</span>
                    <div className="chip-row">
                      {SUMMARY_LENGTH_ORDER.map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          className={`chip ${summaryLengthMode === mode ? "active" : ""}`}
                          onClick={() => setSummaryLengthMode(mode)}
                        >
                          {SUMMARY_LENGTH_LABEL[mode]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="settings-control">
                    <span>요약 스타일</span>
                    <div className="chip-row">
                      {SUMMARY_STYLE_ORDER.map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          className={`chip ${summaryStyleMode === mode ? "active" : ""}`}
                          onClick={() => setSummaryStyleMode(mode)}
                        >
                          {SUMMARY_STYLE_LABEL[mode]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="settings-form-grid">
                    <label>
                      원하는 내용 (핵심 포커스)
                      <input
                        value={summaryFocusText}
                        onChange={(event) => setSummaryFocusText(event.target.value.slice(0, 120))}
                        placeholder="예: 정책 영향, 투자 시사점, 핵심 수치 중심"
                        maxLength={120}
                      />
                    </label>
                    <label>
                      커스텀 프롬프트
                      <textarea
                        value={summaryCustomPrompt}
                        onChange={(event) => setSummaryCustomPrompt(event.target.value.slice(0, 500))}
                        rows={4}
                        placeholder="예: 근거와 수치를 우선하고, 마지막에 1줄 결론을 추가해줘."
                        maxLength={500}
                      />
                    </label>
                  </div>
                  <div className="settings-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => void handleSaveAiPreferences()}
                      disabled={savingAiPreferences || loadingAiPreferences}
                    >
                      {savingAiPreferences ? "AI 설정 저장 중..." : "AI 설정 저장"}
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={handleResetAiPreferencesDraft}
                      disabled={savingAiPreferences || loadingAiPreferences}
                    >
                      기본값으로 되돌리기
                    </button>
                  </div>
                  {loadingAiPreferences && <p className="muted">AI 요약 설정 불러오는 중...</p>}
                </article>

                <article className="settings-card">
                  <h3>화면 설정</h3>
                  <p className="muted">테마와 글자 크기를 즉시 변경할 수 있습니다.</p>
                  <div className="settings-control">
                    <span>테마</span>
                    <div className="chip-row">
                      <button
                        type="button"
                        className={`chip ${themeMode === "dark" ? "active" : ""}`}
                        onClick={() => setThemeMode("dark")}
                      >
                        다크
                      </button>
                      <button
                        type="button"
                        className={`chip ${themeMode === "light" ? "active" : ""}`}
                        onClick={() => setThemeMode("light")}
                      >
                        라이트
                      </button>
                    </div>
                  </div>
                  <div className="settings-control">
                    <span>글자 크기</span>
                    <div className="chip-row">
                      <button
                        type="button"
                        className={`chip ${fontScaleMode === "small" ? "active" : ""}`}
                        onClick={() => setFontScaleMode("small")}
                      >
                        작게
                      </button>
                      <button
                        type="button"
                        className={`chip ${fontScaleMode === "normal" ? "active" : ""}`}
                        onClick={() => setFontScaleMode("normal")}
                      >
                        기본
                      </button>
                      <button
                        type="button"
                        className={`chip ${fontScaleMode === "large" ? "active" : ""}`}
                        onClick={() => setFontScaleMode("large")}
                      >
                        크게
                      </button>
                    </div>
                  </div>
                </article>

                <article className="settings-card">
                  <h3>보안</h3>
                  <p className="muted">비밀번호 변경과 계정 정리를 관리합니다.</p>
                  <div className="settings-form-grid">
                    <label>
                      새 비밀번호
                      <input
                        type="password"
                        minLength={6}
                        value={nextPassword}
                        onChange={(event) => setNextPassword(event.target.value)}
                        placeholder="6자 이상"
                      />
                    </label>
                    <label>
                      새 비밀번호 확인
                      <input
                        type="password"
                        minLength={6}
                        value={nextPasswordConfirm}
                        onChange={(event) => setNextPasswordConfirm(event.target.value)}
                        placeholder="동일하게 입력"
                      />
                    </label>
                  </div>
                  <div className="settings-actions">
                    <button type="button" className="ghost" onClick={() => void handleUpdatePassword()} disabled={updatingPassword}>
                      {updatingPassword ? "비밀번호 변경 중..." : "비밀번호 변경"}
                    </button>
                  </div>
                  <div className="settings-control">
                    <span>데이터 / 계정</span>
                    <p className="muted">삭제 작업은 복구할 수 없습니다.</p>
                  </div>
                  <div className="settings-actions">
                    <button type="button" className="danger-solid" onClick={() => void handleDeleteAllLinks()} disabled={deletingAll}>
                      {deletingAll ? "전체 삭제 중..." : "기사 전체 삭제"}
                    </button>
                    <button type="button" className="danger-solid" onClick={() => void handleDeleteAccount()} disabled={deletingAccount}>
                      {deletingAccount ? "회원 탈퇴 처리중..." : "회원 탈퇴"}
                    </button>
                  </div>
                </article>

                <article className="settings-card">
                  <h3>도움말</h3>
                  <p className="muted">기본 사용법만 간단하게 확인합니다.</p>
                  <div className="settings-actions">
                    <button type="button" className="ghost" onClick={() => setIsHelpModalOpen(true)}>
                      도움말 열기
                    </button>
                  </div>
                </article>
              </div>
            </section>
          )}
        </div>

        {isAddModalOpen && (
          <div
            className="add-modal-overlay"
            onClick={() => setIsAddModalOpen(false)}
            role="presentation"
          >
            <section
              className="add-modal"
              role="dialog"
              aria-modal="true"
              aria-label="링크 추가"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="add-modal-head">
                <h3>링크 추가</h3>
                <button type="button" className="icon-btn" onClick={() => setIsAddModalOpen(false)} aria-label="닫기">
                  ×
                </button>
              </div>

              <p className="add-modal-hint">AI가 자동으로 제목, 요약, 키워드, 카테고리를 추출합니다</p>

              <form onSubmit={handleCreateLink} className="add-modal-form">
                <label className="full">
                  URL *
                  <div className="url-input-row">
                    <input
                      ref={newUrlInputRef}
                      value={newUrl}
                      onChange={(event) => setNewUrl(event.target.value)}
                      placeholder="https://news-site.com/article"
                      required
                    />
                    <button
                      type="button"
                      className="ghost"
                      onClick={async () => {
                        try {
                          const text = await navigator.clipboard.readText();
                          if (text) {
                            setNewUrl(text);
                          }
                        } catch {
                          setErrorMessage("클립보드 읽기에 실패했습니다.");
                        }
                      }}
                    >
                      붙여넣기
                    </button>
                  </div>
                </label>

                <label className="full">
                  제목 (자동 입력, 직접 수정 가능)
                  <input
                    value={newTitle}
                    onChange={(event) => {
                      setManualTitleEdited(true);
                      setNewTitle(event.target.value);
                    }}
                    placeholder="기사 제목을 입력하거나 자동 감지됩니다"
                  />
                </label>
                {previewLoading && <p className="muted">제목 자동 감지 중...</p>}

                <div className="modal-row">
                  <label>
                    카테고리
                    <select value={newCategory} onChange={(event) => setNewCategory(event.target.value)}>
                      <option value="">자동 분류 (AI)</option>
                      {categoryMenu.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    읽기 상태
                    <select value={newStatus} onChange={(event) => setNewStatus(event.target.value as LinkStatus)}>
                      <option value="unread">안읽음</option>
                      <option value="reading">읽음</option>
                      <option value="archived">보관</option>
                    </select>
                  </label>
                </div>

                <label className="full">
                  태그 (Enter로 추가)
                  <input
                    value={newTagInput}
                    onChange={(event) => setNewTagInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        appendModalTag(newTagInput);
                      }
                    }}
                    placeholder="태그를 입력하고 Enter"
                  />
                </label>
                {modalTags.length > 0 && (
                  <div className="tag-chip-row">
                    {modalTags.map((tag) => (
                      <button key={tag} type="button" className="tag-chip" onClick={() => removeModalTag(tag)} title="태그 제거">
                        #{tag}
                      </button>
                    ))}
                  </div>
                )}

                <label className="full">
                  메모
                  <textarea
                    value={newNote}
                    onChange={(event) => setNewNote(event.target.value)}
                    rows={4}
                    placeholder="이 기사에 대한 생각이나 메모를 남겨보세요"
                  />
                </label>

                <div className="add-modal-footer">
                  <button type="button" className="ghost" onClick={() => setIsAddModalOpen(false)}>
                    취소
                  </button>
                  <button type="submit" disabled={savingLink}>
                    {savingLink ? "저장 중..." : "AI 분석 후 저장"}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}

        {isHelpModalOpen && (
          <div className="help-overlay" role="presentation" onClick={() => setIsHelpModalOpen(false)}>
            <section className="help-modal" role="dialog" aria-modal="true" aria-label="도움말" onClick={(event) => event.stopPropagation()}>
              <div className="help-head">
                <h3>도움말</h3>
                <button type="button" className="icon-btn" onClick={() => setIsHelpModalOpen(false)} aria-label="닫기">
                  ×
                </button>
              </div>
              <ul className="help-list">
                <li>상단 `+ 링크 추가`에서 URL을 저장하면 AI가 제목/요약/카테고리를 보강합니다.</li>
                <li>기사 카드를 누르면 상세 편집창이 열리고 변경 사항은 자동 저장됩니다.</li>
                <li>좌측 사이드바에서 상태, 카테고리, 컬렉션 기준으로 바로 필터링할 수 있습니다.</li>
                <li>설정의 `데이터 관리`에서 파일 가져오기/내보내기를 실행할 수 있습니다.</li>
                <li>설정의 `보안`에서 비밀번호 변경, 전체 기사 삭제, 회원 탈퇴를 처리할 수 있습니다.</li>
              </ul>
            </section>
          </div>
        )}

        <div
          className={`detail-backdrop ${selectedLink ? "open" : ""}`}
          onClick={() => setSelectedLinkId(null)}
          aria-hidden={!selectedLink}
        />
        <aside
          className={`detail-panel ${selectedLink ? "open" : ""}`}
          aria-hidden={!selectedLink}
          onKeyDown={(event) => {
            if (!selectedLink) {
              return;
            }
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void saveDraftById(selectedLink.id);
            }
          }}
        >
          {selectedLink && selectedDraft && (
            <>
              <div className="detail-head">
                <h3>링크 상세 편집</h3>
                <button type="button" className="ghost" onClick={() => setSelectedLinkId(null)}>
                  닫기
                </button>
              </div>
              <div className="detail-scroll">
                <p className="detail-title">{selectedLink.title || selectedLink.url}</p>
                <div className="detail-link-row">
                  <button
                    type="button"
                    className="detail-link-btn"
                    onClick={() => window.open(selectedLink.url, "_blank", "noopener,noreferrer")}
                  >
                    원문 열기 ↗
                  </button>
                  <span className="detail-link-host" title={selectedLink.url}>
                    {getUrlHostLabel(selectedLink.url)}
                  </span>
                </div>

                <div className="detail-meta">
                  <div className="detail-meta-item">
                    <span className="detail-meta-label">날짜</span>
                    <strong className="detail-meta-value">{formatDateLabel(getDisplayDateValue(selectedLink))}</strong>
                  </div>
                  <div className="detail-meta-item">
                    <span className="detail-meta-label">평가</span>
                    <strong className="detail-meta-value">{renderRating(selectedLink.rating)}</strong>
                  </div>
                  <div className="detail-meta-item">
                    <span className="detail-meta-label">컬렉션</span>
                    <strong className="detail-meta-value" title={selectedLink.collection?.name || "컬렉션 없음"}>
                      {selectedLink.collection?.name || "컬렉션 없음"}
                    </strong>
                  </div>
                </div>

                <section className="detail-summary-block" aria-label="기사 요약">
                  <p className="detail-section-kicker">기사 요약</p>
                  <p className={`detail-summary-text ${selectedLink.summary ? "" : "empty"}`}>
                    {selectedLink.summary || "요약이 아직 없습니다. 하단의 AI 재실행을 누르면 생성됩니다."}
                  </p>
                </section>

                <div className="detail-toggle-row">
                  <div className="detail-control-block">
                    <p className="detail-section-kicker">읽기 상태</p>
                    <div className="detail-status-toggle" role="group" aria-label="상태 선택">
                      {DETAIL_STATUS_ORDER.map((status) => (
                        <button
                          key={status}
                          type="button"
                          className={`status-mini-btn ${selectedDraft.status === status ? "active" : ""}`}
                          onClick={() => updateDraft(selectedLink, { status })}
                        >
                          {STATUS_LABEL[status]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="detail-control-block">
                    <p className="detail-section-kicker">별점</p>
                    <div className="detail-star-rating" role="group" aria-label="별점 선택">
                      {[1, 2, 3, 4, 5].map((star) => {
                        const current = Number(selectedDraft.rating || 0);
                        return (
                          <button
                            key={star}
                            type="button"
                            className={`star-btn ${current >= star ? "active" : ""}`}
                            onClick={() => updateDraft(selectedLink, { rating: String(star) })}
                            aria-label={`${star}점`}
                            title={`${star}점`}
                          >
                            ★
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        className={`star-clear ${selectedDraft.rating ? "active" : ""}`}
                        onClick={() => updateDraft(selectedLink, { rating: "" })}
                      >
                        초기화
                      </button>
                    </div>
                  </div>
                </div>

                <label className="detail-note">
                  메모
                  <textarea
                    rows={9}
                    value={selectedDraft.note}
                    onChange={(event) => updateDraft(selectedLink, { note: event.target.value })}
                  />
                </label>
                <label>
                  컬렉션
                  <div className="detail-collection-buttons">
                    <button
                      type="button"
                      className={`collection-choice ${selectedDraft.collectionId === "" ? "active" : ""}`}
                      onClick={() => updateDraft(selectedLink, { collectionId: "" })}
                    >
                      컬렉션 없음
                    </button>
                    {collections.map((collection) => (
                      <button
                        key={collection.id}
                        type="button"
                        className={`collection-choice ${selectedDraft.collectionId === collection.id ? "active" : ""}`}
                        onClick={() => updateDraft(selectedLink, { collectionId: collection.id })}
                      >
                        <span className="collection-dot" style={{ backgroundColor: collection.color || COLLECTION_COLOR_PRESET[0] }} />
                        {collection.name}
                      </button>
                    ))}
                  </div>
                </label>
                <label>
                  태그
                  <input
                    className="detail-tag-input"
                    value={selectedDraft.tags}
                    onChange={(event) => updateDraft(selectedLink, { tags: event.target.value })}
                  />
                </label>

                {selectedLink.ai_error && <p className="error-text">AI 오류: {selectedLink.ai_error}</p>}
              </div>
              <div className="detail-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void runAiAnalysis(selectedLink)}
                  disabled={savingLinkId === selectedLink.id}
                >
                  AI 재실행
                </button>
                <span className="detail-autosave-state">{savingLinkId === selectedLink.id ? "저장 중..." : "자동 저장됨"}</span>
              </div>
            </>
          )}
        </aside>

	        {toast && <div className={`toast toast-${toast.kind}`}>{toast.message}</div>}
	        {errorMessage && <p className="error-text global-error">{errorMessage}</p>}
	        {importingFile && (
	          <div className="upload-lock-overlay" role="alert" aria-live="assertive">
	            <div className="upload-lock-card">
	              <strong>파일 업로드 진행 중</strong>
	              <p>업로드가 끝날 때까지 새로고침/페이지 이동이 제한됩니다.</p>
	            </div>
	          </div>
	        )}
	      </main>
	    </div>
  );
}
