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
    return "기타";
  }

  if ((AI_CATEGORY_CATALOG as readonly string[]).includes(value)) {
    return value;
  }

  const lower = value.toLowerCase();
  if (lower.includes("ai") || lower.includes("ml") || lower.includes("머신러닝")) return "AI/머신러닝";
  if (lower.includes("개발") || lower.includes("프로그래밍") || lower.includes("software") || lower.includes("code")) return "개발/프로그래밍";
  if (lower.includes("data") || lower.includes("분석")) return "데이터/분석";
  if (lower.includes("보안") || lower.includes("infra") || lower.includes("인프라") || lower.includes("cloud")) return "보안/인프라";
  if (lower.includes("디자인") || lower.includes("ux") || lower.includes("ui") || lower.includes("product")) return "제품/디자인";
  if (lower.includes("startup") || lower.includes("비즈니스") || lower.includes("business")) return "스타트업/비즈니스";
  if (lower.includes("투자") || lower.includes("금융") || lower.includes("finance")) return "투자/금융";
  if (lower.includes("경제") || lower.includes("policy") || lower.includes("정책")) return "경제/정책";
  if (lower.includes("science") || lower.includes("과학") || lower.includes("기술")) return "과학/기술";
  if (lower.includes("health") || lower.includes("bio") || lower.includes("헬스") || lower.includes("바이오")) return "헬스/바이오";
  if (lower.includes("정치") || lower.includes("사회") || lower.includes("politic")) return "정치/사회";
  if (lower.includes("교육") || lower.includes("커리어") || lower.includes("career") || lower.includes("study")) return "교육/커리어";
  if (lower.includes("문화") || lower.includes("lifestyle") || lower.includes("life")) return "문화/라이프";
  return "기타";
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
        const selectPath = `links?id=eq.${linkId}&user_id=eq.${user.id}&select=id,url,title,note`;
        const links = await supabaseRest<Array<{ id: string; url: string; title: string | null; note: string | null }>>(env, selectPath);
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
        const rawTitle = syntheticImport ? null : await fetchPageTitle(link.url);
        const fallbackTitle = syntheticImport ? "imported-article" : new URL(link.url).hostname;

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
            "summary must be max 3 Korean sentences.",
            "keywords must be an array of up to 5 short strings.",
            `category must be exactly one of: ${AI_CATEGORY_CATALOG.join(", ")}.`,
            "Never output a category outside the allowed list."
          ].join(" "),
          [
            `URL: ${link.url}`,
            `Synthetic import URL: ${syntheticImport ? "yes" : "no"}`,
            `Raw title: ${rawTitle ?? ""}`,
            `Current title: ${link.title ?? ""}`,
            `User note: ${link.note ?? ""}`,
            "Return format: {\"improvedTitle\":\"\",\"summary\":\"\",\"keywords\":[\"\"],\"category\":\"\"}"
          ].join("\n")
        );

        const keywords = Array.isArray(analysis.keywords)
          ? analysis.keywords.filter((v) => typeof v === "string" && v.trim().length > 0).slice(0, 5)
          : [];
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
