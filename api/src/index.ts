interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL?: string;
}

interface AuthUser {
  id: string;
  email?: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS"
};

const REQUIRED_ENV_KEYS: Array<keyof Env> = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY"
];

const AI_CATEGORY_CATALOG = [
  "정치",
  "경제",
  "사회",
  "생활/문화",
  "IT/과학",
  "세계",
  "사설/칼럼"
] as const;

type SummaryLengthMode = "short" | "medium" | "long";
type SummaryStyleMode = "neutral" | "easy" | "insight";

interface UserAiPreferences {
  summary_focus: string | null;
  summary_length: SummaryLengthMode;
  summary_style: SummaryStyleMode;
  custom_prompt: string | null;
}

const DEFAULT_AI_PREFERENCES: UserAiPreferences = {
  summary_focus: null,
  summary_length: "medium",
  summary_style: "neutral",
  custom_prompt: null
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...CORS_HEADERS
    }
  });
}

function parseBearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

async function getAuthenticatedUser(request: Request, env: Env): Promise<AuthUser | null> {
  const token = parseBearerToken(request);
  if (!token) {
    return null;
  }

  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${token}`
    }
  });

  if (!res.ok) {
    return null;
  }

  const user = (await res.json()) as AuthUser;
  if (!user?.id) {
    return null;
  }

  return user;
}

async function supabaseRest<T>(env: Env, pathWithQuery: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${pathWithQuery}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      ...(init.headers || {})
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase error ${response.status}: ${errorText}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const rawText = await response.text();
  const trimmed = rawText.trim();
  if (!trimmed) {
    return undefined as T;
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(`Supabase returned invalid JSON for ${pathWithQuery}`);
  }
}

function isValidHttpUrl(input: string): boolean {
  try {
    const parsed = new URL(input);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function extractHtmlTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) {
    return null;
  }

  return match[1]
    .replace(/\s+/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function extractReadableText(html: string): string | null {
  const articleMatch = html.match(/<article[\s\S]*?<\/article>/i);
  const mainMatch = html.match(/<main[\s\S]*?<\/main>/i);
  const bodyMatch = html.match(/<body[\s\S]*?<\/body>/i);
  const source = articleMatch?.[0] || mainMatch?.[0] || bodyMatch?.[0] || html;

  const cleaned = decodeHtmlEntities(
    source
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<img[^>]*>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );

  if (!cleaned) {
    return null;
  }

  return cleaned.slice(0, 6000);
}

async function fetchPageTitle(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "LinkPocketBot/1.0 (+https://linkpocket.app)"
      }
    });

    if (!res.ok) {
      return null;
    }

    const html = await res.text();
    return extractHtmlTitle(html);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPageSnapshot(url: string): Promise<{ title: string | null; text: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "LinkPocketBot/1.0 (+https://linkpocket.app)"
      }
    });
    if (!res.ok) {
      return { title: null, text: null };
    }
    const html = await res.text();
    return {
      title: extractHtmlTitle(html),
      text: extractReadableText(html)
    };
  } catch {
    return { title: null, text: null };
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAiJson<T>(env: Env, systemPrompt: string, userPrompt: string): Promise<T> {
  const model = env.OPENAI_MODEL || "gpt-4o-mini";

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${errorText}`);
  }

  const rawPayloadText = await response.text();
  const payloadText = rawPayloadText.trim();
  if (!payloadText) {
    throw new Error("OpenAI returned empty response body");
  }

  let payload: {
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string; text?: string }>;
      };
    }>;
  };
  try {
    payload = JSON.parse(payloadText) as typeof payload;
  } catch {
    throw new Error("OpenAI returned invalid outer JSON");
  }

  const rawContent = payload.choices?.[0]?.message?.content;
  const content = typeof rawContent === "string"
    ? rawContent
    : Array.isArray(rawContent)
      ? rawContent
          .map((part) => (typeof part?.text === "string" ? part.text : ""))
          .join("\n")
      : "";

  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("OpenAI returned empty JSON text");
  }

  const candidates: string[] = [trimmed];
  if (trimmed.startsWith("```")) {
    candidates.push(trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = candidate.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    try {
      return JSON.parse(normalized) as T;
    } catch {
      // continue
    }
  }

  throw new Error("OpenAI returned invalid JSON");
}

async function createAiTask(env: Env, params: {
  userId: string;
  linkId: string;
  taskType: "preview_title" | "analyze_link";
  status: "pending" | "success" | "failed";
  input?: unknown;
  output?: unknown;
  errorMessage?: string | null;
}): Promise<string | null> {
  const rows = await supabaseRest<Array<{ id: string }>>(env, "ai_tasks", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([
      {
        user_id: params.userId,
        link_id: params.linkId,
        task_type: params.taskType,
        status: params.status,
        input: params.input ?? null,
        output: params.output ?? null,
        error_message: params.errorMessage ?? null
      }
    ])
  });

  return rows[0]?.id ?? null;
}

async function updateAiTask(env: Env, taskId: string, patch: {
  status: "pending" | "success" | "failed";
  output?: unknown;
  errorMessage?: string | null;
}): Promise<void> {
  await supabaseRest(env, `ai_tasks?id=eq.${taskId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status: patch.status,
      output: patch.output ?? null,
      error_message: patch.errorMessage ?? null
    })
  });
}

function toSafeErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, 400);
}

async function deleteAuthUser(env: Env, userId: string): Promise<void> {
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  });

  if (!response.ok) {
    const text = (await response.text()).trim();
    throw new Error(`delete_auth_user_failed (${response.status}) ${text || "unknown"}`);
  }
}

function sanitizeNullableText(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, maxLength);
}

function normalizeSummaryLength(raw: unknown): SummaryLengthMode {
  return raw === "short" || raw === "medium" || raw === "long" ? raw : "medium";
}

function normalizeSummaryStyle(raw: unknown): SummaryStyleMode {
  return raw === "neutral" || raw === "easy" || raw === "insight" ? raw : "neutral";
}

function normalizeAiPreferencesRow(row: unknown): UserAiPreferences {
  const raw = (row || {}) as Record<string, unknown>;
  return {
    summary_focus: sanitizeNullableText(raw.summary_focus, 120),
    summary_length: normalizeSummaryLength(raw.summary_length),
    summary_style: normalizeSummaryStyle(raw.summary_style),
    custom_prompt: sanitizeNullableText(raw.custom_prompt, 500)
  };
}

function toAiPreferencesResponse(pref: UserAiPreferences): {
  summaryFocus: string;
  summaryLength: SummaryLengthMode;
  summaryStyle: SummaryStyleMode;
  customPrompt: string;
} {
  return {
    summaryFocus: pref.summary_focus || "",
    summaryLength: pref.summary_length,
    summaryStyle: pref.summary_style,
    customPrompt: pref.custom_prompt || ""
  };
}

function getSummaryLengthInstruction(lengthMode: SummaryLengthMode): string {
  if (lengthMode === "short") {
    return "summary must be 2 to 3 Korean sentences (roughly 110 to 220 Korean characters).";
  }
  if (lengthMode === "long") {
    return "summary must be 7 to 9 Korean sentences (roughly 380 to 700 Korean characters).";
  }
  return "summary must be 4 to 6 Korean sentences (roughly 220 to 420 Korean characters) with concrete key points.";
}

function getSummaryStyleInstruction(styleMode: SummaryStyleMode): string {
  if (styleMode === "easy") {
    return "Use very plain Korean wording for non-experts and avoid jargon where possible.";
  }
  if (styleMode === "insight") {
    return "Emphasize implications, significance, and practical meaning.";
  }
  return "Keep the tone objective and fact-focused.";
}

async function getUserAiPreferences(env: Env, userId: string): Promise<UserAiPreferences> {
  const rows = await supabaseRest<Array<Record<string, unknown>>>(
    env,
    `user_ai_preferences?user_id=eq.${userId}&select=summary_focus,summary_length,summary_style,custom_prompt&limit=1`
  );
  if (!rows || rows.length === 0) {
    return { ...DEFAULT_AI_PREFERENCES };
  }
  return normalizeAiPreferencesRow(rows[0]);
}

function isSyntheticImportUrl(input: string): boolean {
  try {
    const parsed = new URL(input);
    const hostMatched = parsed.hostname === "www.google.com" || parsed.hostname === "google.com";
    const pathMatched = parsed.pathname === "/search";
    const q = (parsed.searchParams.get("q") || "").toLowerCase();
    return hostMatched && pathMatched && q.includes("linklens import");
  } catch {
    return false;
  }
}

function normalizeAiCategory(raw: string | undefined): string {
  const value = (raw || "").trim();
  if (!value) {
    return "사회";
  }

  if ((AI_CATEGORY_CATALOG as readonly string[]).includes(value)) {
    return value;
  }

  const direct: Record<string, string> = {
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
  if (direct[value]) {
    return direct[value];
  }

  const lower = value.toLowerCase();
  if (lower.includes("사설") || lower.includes("칼럼") || lower.includes("opinion") || lower.includes("column") || lower.includes("editorial")) return "사설/칼럼";
  if (lower.includes("세계") || lower.includes("국제") || lower.includes("해외") || lower.includes("world") || lower.includes("global") || lower.includes("international")) return "세계";
  if (lower.includes("정치") || lower.includes("국회") || lower.includes("대통령") || lower.includes("정부") || lower.includes("정당") || lower.includes("election") || lower.includes("politic")) return "정치";
  if (lower.includes("경제") || lower.includes("금융") || lower.includes("주식") || lower.includes("비즈니스") || lower.includes("투자") || lower.includes("business") || lower.includes("finance") || lower.includes("market")) return "경제";
  if (lower.includes("생활") || lower.includes("문화") || lower.includes("연예") || lower.includes("여행") || lower.includes("food") || lower.includes("lifestyle")) return "생활/문화";
  if (lower.includes("ai") || lower.includes("ml") || lower.includes("개발") || lower.includes("it") || lower.includes("프로그래밍") || lower.includes("software") || lower.includes("data") || lower.includes("분석") || lower.includes("보안") || lower.includes("infra") || lower.includes("과학") || lower.includes("science") || lower.includes("tech")) return "IT/과학";
  return "사회";
}

function mergeKeywordList(existing: unknown, incoming: unknown, limit = 12): string[] {
  const values: string[] = [];
  if (Array.isArray(existing)) {
    values.push(...existing.filter((item): item is string => typeof item === "string"));
  }
  if (Array.isArray(incoming)) {
    values.push(...incoming.filter((item): item is string => typeof item === "string"));
  }

  const seen = new Set<string>();
  const merged: string[] = [];
  for (const raw of values) {
    const trimmed = raw.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(trimmed);
    if (merged.length >= limit) {
      break;
    }
  }
  return merged;
}

function normalizeTagName(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, 40);
}

async function upsertAutoTags(env: Env, params: { userId: string; linkId: string; names: string[] }): Promise<void> {
  const uniqueNames = Array.from(new Set(params.names.map(normalizeTagName).filter((v): v is string => Boolean(v)))).slice(0, 8);
  if (uniqueNames.length === 0) {
    return;
  }

  const tags = await supabaseRest<Array<{ id: string; name: string }>>(env, "tags?on_conflict=user_id,name", {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify(uniqueNames.map((name) => ({ user_id: params.userId, name })))
  });

  const linkTagsPayload = tags
    .map((tag) => tag.id)
    .filter((id) => typeof id === "string" && id.length > 0)
    .map((tagId) => ({
      link_id: params.linkId,
      tag_id: tagId
    }));

  if (linkTagsPayload.length === 0) {
    return;
  }

  await supabaseRest(env, "link_tags?on_conflict=link_id,tag_id", {
    method: "POST",
    headers: {
      Prefer: "resolution=ignore-duplicates,return=minimal"
    },
    body: JSON.stringify(linkTagsPayload)
  });
}

function getMissingEnvKeys(env: Env): string[] {
  return REQUIRED_ENV_KEYS.filter((key) => {
    const value = env[key];
    return typeof value !== "string" || value.trim().length === 0;
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    const url = new URL(request.url);
    const missingEnvKeys = getMissingEnvKeys(env);

    if (request.method === "GET" && url.pathname === "/api/v1/health") {
      return jsonResponse({
        ok: missingEnvKeys.length === 0,
        service: "linkpocket-api",
        date: new Date().toISOString(),
        missingEnvKeys
      });
    }

    if (missingEnvKeys.length > 0) {
      return jsonResponse(
        {
          error: "misconfigured_worker",
          message: "Missing required environment variables",
          missingEnvKeys
        },
        500
      );
    }

    if (request.method === "POST" && url.pathname === "/api/v1/account/delete") {
      const user = await getAuthenticatedUser(request, env);
      if (!user) {
        return jsonResponse({ error: "unauthorized" }, 401);
      }

      try {
        await deleteAuthUser(env, user.id);
        return jsonResponse({ ok: true });
      } catch (error) {
        return jsonResponse(
          {
            error: "delete_account_failed",
            message: toSafeErrorMessage(error)
          },
          500
        );
      }
    }

    if (request.method === "GET" && url.pathname === "/api/v1/ai/preferences") {
      const user = await getAuthenticatedUser(request, env);
      if (!user) {
        return jsonResponse({ error: "unauthorized" }, 401);
      }

      try {
        const preferences = await getUserAiPreferences(env, user.id);
        return jsonResponse({ ok: true, preferences: toAiPreferencesResponse(preferences) });
      } catch (error) {
        return jsonResponse(
          {
            error: "preferences_fetch_failed",
            message: toSafeErrorMessage(error)
          },
          500
        );
      }
    }

    if (request.method === "PATCH" && url.pathname === "/api/v1/ai/preferences") {
      const user = await getAuthenticatedUser(request, env);
      if (!user) {
        return jsonResponse({ error: "unauthorized" }, 401);
      }

      const body = (await request.json().catch(() => null)) as
        | {
            summaryFocus?: unknown;
            summaryLength?: unknown;
            summaryStyle?: unknown;
            customPrompt?: unknown;
          }
        | null;
      if (!body || typeof body !== "object") {
        return jsonResponse({ error: "invalid_body" }, 400);
      }

      const patch: UserAiPreferences = {
        summary_focus: sanitizeNullableText(body.summaryFocus, 120),
        summary_length: normalizeSummaryLength(body.summaryLength),
        summary_style: normalizeSummaryStyle(body.summaryStyle),
        custom_prompt: sanitizeNullableText(body.customPrompt, 500)
      };

      try {
        const rows = await supabaseRest<Array<Record<string, unknown>>>(env, "user_ai_preferences?on_conflict=user_id", {
          method: "POST",
          headers: {
            Prefer: "resolution=merge-duplicates,return=representation"
          },
          body: JSON.stringify([
            {
              user_id: user.id,
              summary_focus: patch.summary_focus,
              summary_length: patch.summary_length,
              summary_style: patch.summary_style,
              custom_prompt: patch.custom_prompt
            }
          ])
        });

        const saved = rows && rows.length > 0 ? normalizeAiPreferencesRow(rows[0]) : patch;
        return jsonResponse({ ok: true, preferences: toAiPreferencesResponse(saved) });
      } catch (error) {
        return jsonResponse(
          {
            error: "preferences_save_failed",
            message: toSafeErrorMessage(error)
          },
          500
        );
      }
    }

    if (request.method === "POST" && url.pathname === "/api/v1/ai/preview-title") {
      const user = await getAuthenticatedUser(request, env);
      if (!user) {
        return jsonResponse({ error: "unauthorized" }, 401);
      }

      const body = (await request.json().catch(() => null)) as { url?: string } | null;
      const targetUrl = body?.url?.trim() ?? "";

      if (!isValidHttpUrl(targetUrl)) {
        return jsonResponse({ error: "invalid_url" }, 400);
      }

      const fallbackTitle = new URL(targetUrl).hostname;
      const rawTitle = await fetchPageTitle(targetUrl);

      try {
        const result = await callOpenAiJson<{ title?: string }>(
          env,
          [
            "You are a title assistant for a read-later app.",
            "Return only JSON.",
            "Create a concise Korean title no longer than 60 chars.",
            "If source context is weak, keep it neutral and avoid hallucination."
          ].join(" "),
          `URL: ${targetUrl}\nRaw title: ${rawTitle ?? ""}\nReturn format: {\"title\":\"...\"}`
        );

        const title = (result.title || rawTitle || fallbackTitle).trim();
        return jsonResponse({ title });
      } catch {
        return jsonResponse({ title: rawTitle || fallbackTitle });
      }
    }

    if (request.method === "POST" && url.pathname === "/api/v1/ai/analyze-link") {
      const user = await getAuthenticatedUser(request, env);
      if (!user) {
        return jsonResponse({ error: "unauthorized" }, 401);
      }

      const body = (await request.json().catch(() => null)) as { linkId?: string } | null;
      const linkId = body?.linkId?.trim() ?? "";
      const uuidLike = /^[0-9a-fA-F-]{36}$/;
      if (!uuidLike.test(linkId)) {
        return jsonResponse({ error: "invalid_link_id" }, 400);
      }

      let taskId: string | null = null;

      try {
        const selectPath = `links?id=eq.${linkId}&user_id=eq.${user.id}&select=id,url,title,note,keywords`;
        const links = await supabaseRest<Array<{ id: string; url: string; title: string | null; note: string | null; keywords: string[] | null }>>(env, selectPath);
        const link = links[0];

        if (!link) {
          return jsonResponse({ error: "not_found" }, 404);
        }

        await supabaseRest(env, `links?id=eq.${linkId}&user_id=eq.${user.id}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ ai_state: "pending", ai_error: null })
        });

        taskId = await createAiTask(env, {
          userId: user.id,
          linkId,
          taskType: "analyze_link",
          status: "pending",
          input: { url: link.url, title: link.title, note: link.note }
        });

        const syntheticImport = isSyntheticImportUrl(link.url);
        const snapshot = syntheticImport ? { title: null, text: null } : await fetchPageSnapshot(link.url);
        const rawTitle = snapshot.title;
        const articleText = snapshot.text;
        const articleExcerpt = (articleText || "").slice(0, 4000);
        const fallbackTitle = syntheticImport ? "imported-article" : new URL(link.url).hostname;
        const userPreferences = await getUserAiPreferences(env, user.id);
        const summaryLengthInstruction = getSummaryLengthInstruction(userPreferences.summary_length);
        const summaryStyleInstruction = getSummaryStyleInstruction(userPreferences.summary_style);
        const summaryFocusInstruction = userPreferences.summary_focus
          ? `Prioritize this user focus in summary: ${userPreferences.summary_focus}`
          : "If no clear special angle exists, keep balanced coverage of core facts.";
        const customPromptInstruction = userPreferences.custom_prompt
          ? `User custom summary instruction (highest priority for summary): ${userPreferences.custom_prompt}`
          : "";

        const analysis = await callOpenAiJson<{
          improvedTitle?: string;
          summary?: string;
          keywords?: string[];
          category?: string;
        }>(
          env,
          [
            "You are a classifier for a personal read-later app.",
            "Return strict JSON only.",
            "No hallucinations: if uncertain, keep values conservative.",
            "If rawTitle is available, use it to improve title quality.",
            "Use only facts found in raw title, article text excerpt, or user note.",
            "If requested details (numbers/quotes) are missing in sources, explicitly mention limited source details.",
            "You MUST apply user summary preferences strictly when generating summary.",
            "When a custom summary instruction is provided, prioritize it unless it conflicts with JSON format or safety.",
            summaryLengthInstruction,
            summaryStyleInstruction,
            summaryFocusInstruction,
            customPromptInstruction,
            "keywords must be an array of up to 5 short strings.",
            `category must be exactly one of: ${AI_CATEGORY_CATALOG.join(", ")}.`,
            "Never output a category outside the allowed list."
          ].filter(Boolean).join(" "),
          [
            `URL: ${link.url}`,
            `Synthetic import URL: ${syntheticImport ? "yes" : "no"}`,
            `Raw title: ${rawTitle ?? ""}`,
            `Article text excerpt: ${articleExcerpt}`,
            `Current title: ${link.title ?? ""}`,
            `User note: ${link.note ?? ""}`,
            `Summary length mode: ${userPreferences.summary_length}`,
            `Summary style mode: ${userPreferences.summary_style}`,
            `Summary focus: ${userPreferences.summary_focus ?? ""}`,
            `Summary custom prompt: ${userPreferences.custom_prompt ?? ""}`,
            "Return format: {\"improvedTitle\":\"\",\"summary\":\"\",\"keywords\":[\"\"],\"category\":\"\"}"
          ].join("\n")
        );

        const keywords = mergeKeywordList(link.keywords, analysis.keywords, 12);
        const category = normalizeAiCategory(analysis.category);
        const nextTitle = (analysis.improvedTitle || rawTitle || link.title || fallbackTitle).trim() || null;

        await upsertAutoTags(env, {
          userId: user.id,
          linkId,
          names: [...keywords, category]
        });

        await supabaseRest(env, `links?id=eq.${linkId}&user_id=eq.${user.id}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            title: nextTitle,
            summary: (analysis.summary || "").trim() || null,
            keywords,
            category,
            ai_state: "success",
            ai_error: null,
            last_analyzed_at: new Date().toISOString()
          })
        });

        if (taskId) {
          await updateAiTask(env, taskId, {
            status: "success",
            output: {
              improvedTitle: nextTitle,
              summary: analysis.summary ?? null,
              keywords,
              category
            }
          });
        }

        return jsonResponse({
          ok: true,
          result: {
            improvedTitle: nextTitle,
            summary: analysis.summary ?? null,
            keywords,
            category
          }
        });
      } catch (error) {
        const message = toSafeErrorMessage(error);

        await supabaseRest(env, `links?id=eq.${linkId}&user_id=eq.${user.id}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ ai_state: "failed", ai_error: message })
        }).catch(() => null);

        if (taskId) {
          await updateAiTask(env, taskId, {
            status: "failed",
            errorMessage: message
          }).catch(() => null);
        }

        return jsonResponse({ error: "analysis_failed", message }, 500);
      }
    }

    return jsonResponse({ error: "not_found" }, 404);
  }
} satisfies ExportedHandler<Env>;
