import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import type { Collection, LinkItem, LinkStatus } from "./lib/types";

const RAW_API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || "";

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

const API_BASE_URL = (() => {
  if (!RAW_API_BASE_URL) {
    return "";
  }

  if (typeof window !== "undefined") {
    const appOnLocalhost = isLocalHost(window.location.hostname);
    try {
      const targetHost = new URL(RAW_API_BASE_URL).hostname;
      if (!appOnLocalhost && isLocalHost(targetHost)) {
        return "";
      }
    } catch {
      return "";
    }
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
  return text || `HTTP ${response.status}`;
}

type SortMode = "newest" | "oldest" | "rating";
type ViewMode = "card" | "list";
type StatusFilter = "all" | LinkStatus;
type ThemeMode = "dark" | "light";

const CATEGORY_BASE_MENU = [
  "AI/머신러닝",
  "개발/프로그래밍",
  "데이터/분석",
  "보안/인프라",
  "제품/디자인",
  "스타트업/비즈니스",
  "투자/금융",
  "경제/정책",
  "과학/기술",
  "헬스/바이오",
  "정치/사회",
  "교육/커리어",
  "문화/라이프",
  "기타"
] as const;

interface LinkDraft {
  note: string;
  status: LinkStatus;
  rating: string;
  tags: string;
  collectionId: string;
}

interface ImportArticleRow {
  url?: string;
  title?: string;
  notes?: string;
  press_raw?: string;
  date_raw?: string;
  date_iso?: string;
  keywords?: string[];
  tags?: string[] | string;
}

const STATUS_LABEL: Record<LinkStatus, string> = {
  unread: "읽기전",
  reading: "읽음",
  done: "완료",
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
  const queryParts = [row.title, row.press_raw, row.date_iso, row.date_raw].filter((value) => typeof value === "string" && value.trim().length > 0);
  const query = queryParts.join(" ").trim();
  if (!query) {
    return `https://www.google.com/search?q=linklens+import+${index + 1}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
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
    status: row.status,
    rating: row.rating,
    is_favorite: row.is_favorite,
    category: row.category,
    summary: row.summary,
    keywords: Array.isArray(row.keywords) ? row.keywords : [],
    collection_id: row.collection_id,
    ai_state: row.ai_state,
    ai_error: row.ai_error,
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

  const [newUrl, setNewUrl] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newStatus, setNewStatus] = useState<LinkStatus>("unread");
  const [newCollectionId, setNewCollectionId] = useState("");
  const [newTags, setNewTags] = useState("");
  const [newTagInput, setNewTagInput] = useState("");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [manualTitleEdited, setManualTitleEdited] = useState(false);
  const [importingFile, setImportingFile] = useState(false);

  const [collectionName, setCollectionName] = useState("");
  const [collectionColor, setCollectionColor] = useState("#5f7df3");
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "info" | "ok" | "err"; message: string } | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const newUrlInputRef = useRef<HTMLInputElement | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const authInitDoneRef = useRef(false);

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
    if (!toast) {
      return;
    }
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

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
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = themeMode;
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem("linklens-theme", themeMode);
    }
  }, [themeMode]);

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
  }, [selectedLink, isAddModalOpen]);

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

  const loadLinks = useCallback(async () => {
    if (!session) {
      setLinks([]);
      return;
    }

    setLoadingLinks(true);
    setErrorMessage(null);

    let query = supabase
      .from("links")
      .select(
        "id, url, title, note, status, rating, is_favorite, category, summary, keywords, collection_id, ai_state, ai_error, created_at, deleted_at, collection:collections(id, name, color), link_tags(tag:tags(name))"
      );

    query = showTrash ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);

    if (collectionFilter !== "all") {
      query = query.eq("collection_id", collectionFilter);
    }

    if (categoryFilter !== "all") {
      query = query.eq("category", categoryFilter);
    }

    if (favoriteOnly) {
      query = query.eq("is_favorite", true);
    }

    const searchValue = search.trim();
    if (searchValue) {
      query = query.or(`url.ilike.%${searchValue}%,title.ilike.%${searchValue}%,note.ilike.%${searchValue}%`);
    }

    if (sortMode === "newest") {
      query = query.order("created_at", { ascending: false });
    }

    if (sortMode === "oldest") {
      query = query.order("created_at", { ascending: true });
    }

    if (sortMode === "rating") {
      query = query.order("rating", { ascending: false, nullsFirst: false });
      query = query.order("created_at", { ascending: false });
    }

    const { data, error } = await query.limit(200);

    setLoadingLinks(false);

    if (error) {
      setErrorMessage(`링크 조회 실패: ${error.message}`);
      return;
    }

    const mapped = (data || []).map(mapLinkRow);
    setLinks(mapped);
  }, [session, showTrash, collectionFilter, categoryFilter, favoriteOnly, search, sortMode]);

  const requestAiAnalysis = useCallback(
    async (linkId: string): Promise<void> => {
      if (!session) {
        throw new Error("세션이 만료되었습니다. 다시 로그인해 주세요.");
      }

      const response = await withTimeout(
        fetch(toApiUrl("/api/v1/ai/analyze-link"), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${session.access_token}`
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
    async (link: Pick<LinkItem, "id" | "title" | "url">, options?: { silent?: boolean }) => {
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
        await loadLinks();
      }
    },
    [runAiWithRetry, loadLinks]
  );

  useEffect(() => {
    if (!session) {
      return;
    }

    void Promise.all([loadCollections(), loadLinks()]);
  }, [session, loadCollections, loadLinks]);

  useEffect(() => {
    if (!isAddModalOpen || !session) {
      return;
    }

    if (manualTitleEdited) {
      return;
    }

    const targetUrl = newUrl.trim();
    if (!parseUrlValid(targetUrl)) {
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const response = await fetch(toApiUrl("/api/v1/ai/preview-title"), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ url: targetUrl }),
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(await parseResponseError(response));
        }

        const payload = (await response.json()) as { title?: string };
        if (payload?.title && !manualTitleEdited) {
          setNewTitle(payload.title);
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          const message = error instanceof Error ? error.message : String(error);
          setErrorMessage(`제목 자동완성 실패: ${message}`);
        }
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
    setSelectedLinkId(null);
    setShowUserMenu(false);
    setLinks([]);
    setCollections([]);
    setDrafts({});
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

  async function handleCreateCollection(event: React.FormEvent) {
    event.preventDefault();
    if (!session || !collectionName.trim()) {
      return;
    }

    const payload = {
      name: collectionName.trim(),
      color: collectionColor
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
    setCollectionColor("#5f7df3");
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
      if (!trimmed) {
        setToast({ kind: "err", message: "비어 있는 파일입니다." });
        return;
      }

      let rows: ImportArticleRow[] = [];
      if (trimmed.startsWith("[")) {
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

      let inserted = 0;
      let failed = 0;
      const importedLinksForAi: Array<Pick<LinkItem, "id" | "url" | "title">> = [];

      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const rawUrl = (row.url || "").trim();
        const resolvedUrl = parseUrlValid(rawUrl) ? rawUrl : buildImportFallbackUrl(row, i);
        const resolvedTitle = (row.title || "").trim() || `가져온 기사 #${i + 1}`;
        const noteParts = [
          row.press_raw ? `출처: ${row.press_raw}` : "",
          row.date_iso ? `날짜: ${row.date_iso}` : row.date_raw ? `날짜: ${row.date_raw}` : "",
          row.notes ? `\n${row.notes}` : ""
        ].filter(Boolean);
        const importKeywords = Array.isArray(row.keywords)
          ? row.keywords.filter((item) => typeof item === "string" && item.trim().length > 0).slice(0, 8)
          : [];
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
              keywords: []
            }
          ])
          .select(
            "id, url, title, note, status, rating, is_favorite, category, summary, keywords, collection_id, ai_state, ai_error, created_at, deleted_at"
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

      await loadLinks();
      if (importedLinksForAi.length > 0) {
        void (async () => {
          for (const link of importedLinksForAi) {
            await runAiEnrichmentInBackground(link, { silent: true });
          }
          setToast({ kind: "ok", message: `가져온 기사 AI 보강 완료 (${importedLinksForAi.length}건)` });
        })();
      }
      setToast({
        kind: failed > 0 ? "info" : "ok",
        message: `가져오기 완료: 성공 ${inserted}건${failed > 0 ? `, 실패 ${failed}건` : ""}${importedLinksForAi.length > 0 ? ` · AI 보강 시작` : ""}`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(`파일 가져오기 실패: ${message}`);
      setToast({ kind: "err", message: "파일 형식을 확인해 주세요. (JSONL/JSON)" });
    } finally {
      setImportingFile(false);
      if (importFileInputRef.current) {
        importFileInputRef.current.value = "";
      }
    }
  }

  function startCollectionEdit(collection: Collection): void {
    setEditingCollectionId(collection.id);
    setCollectionName(collection.name);
    setCollectionColor(collection.color || "#5f7df3");
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
      setCollectionColor("#5f7df3");
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
        status: newStatus,
        collection_id: newCollectionId || null,
        category: newCategory || null
      };

      const { data, error }: { data: any; error: any } = await withTimeout(
        supabase
          .from("links")
          .insert([payload])
          .select(
            "id, url, title, note, status, rating, is_favorite, category, summary, keywords, collection_id, ai_state, ai_error, created_at, deleted_at"
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
        category: data.category,
        summary: data.summary,
        keywords: data.keywords || [],
        collection_id: data.collection_id,
        ai_state: data.ai_state,
        ai_error: data.ai_error,
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
      setNewStatus("unread");
      setNewCollectionId("");
      setNewTags("");
      setNewTagInput("");
      setIsAddModalOpen(false);

      void runAiEnrichmentInBackground(optimistic);
      void loadLinks();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(`링크 저장 실패: ${message}`);
    } finally {
      setSavingLink(false);
    }
  }

  async function updateLink(link: LinkItem) {
    if (!session) {
      return;
    }

    const draft = drafts[link.id] || getLinkDraft(link);
    const ratingValue = parseRating(draft.rating);

    setSavingLinkId(link.id);
    setErrorMessage(null);

    try {
      const payload = {
        note: draft.note.trim() || null,
        status: draft.status,
        rating: ratingValue,
        collection_id: draft.collectionId || null
      };

      const { error } = await supabase.from("links").update(payload).eq("id", link.id);
      if (error) {
        throw error;
      }

      await syncLinkTags(link.id, draft.tags);
      await loadLinks();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(`링크 수정 실패: ${message}`);
    } finally {
      setSavingLinkId(null);
    }
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

      await loadLinks();
      setToast({ kind: "ok", message: `AI 분석 완료: ${getLinkDisplayLabel(link)}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(`AI 분석 실패: ${message}`);
      setToast({ kind: "err", message: `AI 분석 실패: ${getLinkDisplayLabel(link)}` });
      await loadLinks();
    } finally {
      setSavingLinkId(null);
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
      return {
        ...prev,
        [link.id]: {
          ...current,
          ...patch
        }
      };
    });
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
      total: links.length,
      unread: links.filter((item) => item.status === "unread").length,
      aiDone: links.filter((item) => item.ai_state === "success").length,
      favorite: links.filter((item) => item.is_favorite).length
    }),
    [links]
  );

  const visibleLinks = useMemo(
    () => (statusFilter === "all" ? links : links.filter((item) => item.status === statusFilter)),
    [links, statusFilter]
  );

  const categoryMenu = useMemo(() => {
    const fromLinks = links
      .map((item) => (item.category || "").trim())
      .filter((value) => value.length > 0);
    return Array.from(new Set([...CATEGORY_BASE_MENU, ...fromLinks]));
  }, [links]);

  const categoryStats = useMemo(() => {
    return categoryMenu.map((category) => ({
      category,
      count: links.filter((item) => item.category === category).length
    }));
  }, [categoryMenu, links]);

  const readingCount = useMemo(() => links.filter((item) => item.status === "reading").length, [links]);
  const doneCount = useMemo(() => links.filter((item) => item.status === "done").length, [links]);
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
      return "미읽음";
    }
    if (statusFilter === "reading") {
      return "나중에 읽기";
    }
    if (statusFilter === "done") {
      return "완료";
    }
    return "전체 기사";
  }, [showTrash, favoriteOnly, categoryFilter, currentCollectionName, statusFilter]);

  if (!authReady) {
    return <main className="app-shell">세션 확인 중...</main>;
  }

  if (!session) {
    return (
      <main className="app-shell auth-shell">
        <section className="auth-card">
          <h1>LinkPocket</h1>
          <p>가볍게 저장하고, 나중에 정확하게 찾는 개인 링크 아카이브</p>

          <form onSubmit={handleAuthSubmit} className="stack">
            <label>
              이메일
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </label>

            <label>
              비밀번호
              <input
                type="password"
                minLength={6}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>

            <button type="submit" disabled={authLoading}>
              {authLoading ? "처리 중..." : authMode === "login" ? "로그인" : "회원가입"}
            </button>
          </form>

          <button
            type="button"
            className="ghost"
            onClick={() => {
              setAuthMode(authMode === "login" ? "signup" : "login");
              setAuthNotice(null);
              setErrorMessage(null);
            }}
          >
            {authMode === "login" ? "회원가입으로 전환" : "로그인으로 전환"}
          </button>

          {authNotice && <p className="ok-text">{authNotice}</p>}
          {errorMessage && <p className="error-text">{errorMessage}</p>}
        </section>
      </main>
    );
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-row">
            <div>
            <p className="eyebrow">Reading Archive</p>
              <h1 className="logo-name">LinkLens</h1>
            </div>
            <button
              type="button"
              className="icon-btn"
              aria-label="테마 토글"
              title="테마 토글"
              onClick={() => setThemeMode((prev) => (prev === "dark" ? "light" : "dark"))}
            >
              {themeMode === "dark" ? "☀️" : "🌙"}
            </button>
          </div>
        </div>

        <div className="sidebar-scroll">
          <div className="nav-group">
            <p className="nav-group-label">라이브러리</p>
            <button
              type="button"
              className={`nav-btn ${!showTrash && statusFilter === "all" && !favoriteOnly ? "active" : ""}`}
              onClick={() => {
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
                setShowTrash(false);
                setStatusFilter("unread");
                setCategoryFilter("all");
                setFavoriteOnly(false);
              }}
            >
              읽기전 <span className="nav-count">{headerStats.unread}</span>
            </button>
            <button
              type="button"
              className={`nav-btn ${!showTrash && statusFilter === "reading" ? "active" : ""}`}
              onClick={() => {
                setShowTrash(false);
                setStatusFilter("reading");
                setCategoryFilter("all");
                setFavoriteOnly(false);
              }}
            >
              나중에 읽기 <span className="nav-count">{readingCount}</span>
            </button>
            <button
              type="button"
              className={`nav-btn ${!showTrash && favoriteOnly ? "active" : ""}`}
              onClick={() => {
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
              className={`nav-btn ${!showTrash && statusFilter === "done" ? "active" : ""}`}
              onClick={() => {
                setShowTrash(false);
                setStatusFilter("done");
                setCategoryFilter("all");
                setFavoriteOnly(false);
              }}
            >
              완료 <span className="nav-count">{doneCount}</span>
            </button>
            <button
              type="button"
              className={`nav-btn ${showTrash ? "active" : ""}`}
              onClick={() => {
                setFavoriteOnly(false);
                setCategoryFilter("all");
                setShowTrash((prev) => !prev);
              }}
            >
              휴지통 <span className="nav-count">{showTrash ? links.length : 0}</span>
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
                      setCategoryFilter("all");
                      setCollectionFilter(collection.id);
                    }}
                  >
                    <span className="collection-dot" style={{ backgroundColor: collection.color || "#8b7bff" }} />
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
              <div className="sidebar-collection-row">
                <input type="color" value={collectionColor} onChange={(event) => setCollectionColor(event.target.value)} />
                <button type="submit">{editingCollectionId ? "수정" : "+ 컬렉션 추가"}</button>
                {editingCollectionId && (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setEditingCollectionId(null);
                      setCollectionName("");
                      setCollectionColor("#5f7df3");
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
        <header className="topbar">
          <h2 className="page-title">{currentViewTitle}</h2>
          <div className="topbar-right">
            <input
              ref={importFileInputRef}
              type="file"
              accept=".jsonl,.json,.txt"
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void handleImportArticlesFile(file);
                }
              }}
            />
            <input
              ref={searchInputRef}
              className="search-input"
              placeholder="검색어 입력"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button
              type="button"
              className="ghost slim-btn"
              onClick={() => {
                setSearch("");
                setStatusFilter("all");
                setCollectionFilter("all");
                setCategoryFilter("all");
                setSortMode("newest");
                setFavoriteOnly(false);
              }}
            >
              초기화
            </button>
            <button type="button" className="icon-btn" aria-label="도움말" title="도움말">
              ?
            </button>
            <button type="button" className="ghost" onClick={() => void loadLinks()}>
              새로고침
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => importFileInputRef.current?.click()}
              disabled={importingFile}
            >
              {importingFile ? "가져오는 중..." : "파일 가져오기"}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsAddModalOpen(true);
                setManualTitleEdited(false);
                setTimeout(() => newUrlInputRef.current?.focus(), 0);
              }}
            >
              + 링크 추가
            </button>
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
                  <button type="button" className="ghost" onClick={handleLogout} disabled={logoutLoading}>
                    {logoutLoading ? "로그아웃 중..." : "로그아웃"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="content">
          <section className="stats-grid">
            <article className="stat">
              <span>전체</span>
              <strong>{headerStats.total}</strong>
            </article>
            <article className="stat">
              <span>읽기전</span>
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
                미읽음만
              </button>
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
            <div className="section-head">
              <h2>{showTrash ? "휴지통 링크" : "링크 목록"}</h2>
              <span className="result-count">{visibleLinks.length}개</span>
            </div>
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
                return (
                  <article
                    key={link.id}
                    className={`link-card ${selectedLinkId === link.id ? "selected" : ""}`}
                    onClick={() => openLinkDetail(link)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openLinkDetail(link);
                      }
                    }}
                  >
                    <header>
                      <div className="tile-head">
                        <div className="tile-icon" aria-hidden>
                          {getUrlHostLabel(link.url).slice(0, 1).toUpperCase()}
                        </div>
                        <div className="link-title-wrap">
                        <div className="link-title-head">
                          {link.status === "unread" && <span className="unread-dot" aria-label="미읽음" />}
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
                      <span>{formatDateLabel(link.created_at)}</span>
                      <span>{STATUS_LABEL[link.status]}</span>
                    </div>

                    {link.summary && <p className="summary">{link.summary}</p>}
                    {link.keywords.length > 0 && <p className="keywords">#{link.keywords.join(" #")}</p>}
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
                        <button
                          type="button"
                          className="action-btn"
                          aria-label="복원"
                          title="복원"
                          onClick={(event) => {
                            event.stopPropagation();
                            void setLinkDeleted(link.id, false);
                          }}
                        >
                          ↺
                        </button>
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
                      <option value="unread">미읽음</option>
                      <option value="reading">읽음</option>
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
              void updateLink(selectedLink);
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
                <a href={selectedLink.url} target="_blank" rel="noreferrer">
                  {selectedLink.url}
                </a>

                <div className="detail-meta">
                  <span>{formatDateLabel(selectedLink.created_at)}</span>
                  <span>{renderRating(selectedLink.rating)}</span>
                  <span>{selectedLink.collection?.name || "컬렉션 없음"}</span>
                </div>

                <label>
                  메모
                  <textarea
                    rows={4}
                    value={selectedDraft.note}
                    onChange={(event) => updateDraft(selectedLink, { note: event.target.value })}
                  />
                </label>
                <label>
                  상태
                  <select
                    value={selectedDraft.status}
                    onChange={(event) => updateDraft(selectedLink, { status: event.target.value as LinkStatus })}
                  >
                    <option value="unread">읽기전</option>
                    <option value="reading">읽음</option>
                    <option value="done">완료</option>
                    <option value="archived">보관</option>
                  </select>
                </label>
                <label>
                  컬렉션
                  <select
                    value={selectedDraft.collectionId}
                    onChange={(event) => updateDraft(selectedLink, { collectionId: event.target.value })}
                  >
                    <option value="">컬렉션 없음</option>
                    {collections.map((collection) => (
                      <option key={collection.id} value={collection.id}>
                        {collection.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  별점
                  <input
                    type="number"
                    min={1}
                    max={5}
                    placeholder="1~5"
                    value={selectedDraft.rating}
                    onChange={(event) => updateDraft(selectedLink, { rating: event.target.value })}
                  />
                </label>
                <label>
                  태그
                  <input value={selectedDraft.tags} onChange={(event) => updateDraft(selectedLink, { tags: event.target.value })} />
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
                <button type="button" onClick={() => void updateLink(selectedLink)} disabled={savingLinkId === selectedLink.id}>
                  변경 저장
                </button>
              </div>
            </>
          )}
        </aside>

        {toast && <div className={`toast toast-${toast.kind}`}>{toast.message}</div>}
        {errorMessage && <p className="error-text global-error">{errorMessage}</p>}
      </main>
    </div>
  );
}
