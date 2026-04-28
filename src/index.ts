interface FetcherBinding {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS?: FetcherBinding;
  EMAIL_MANAGEMENT_WORKER_CORS_ORIGIN?: string;
  EMAIL_MANAGEMENT_WORKER_HTTP_TIMEOUT?: string;
  EMAIL_MANAGEMENT_WORKER_MAIL_FETCH_LIMIT?: string;
  EMAIL_MANAGEMENT_WORKER_LIVE_TOKEN_URL?: string;
  EMAIL_MANAGEMENT_WORKER_MS_TOKEN_URL?: string;
  EMAIL_MANAGEMENT_WORKER_GRAPH_BASE_URL?: string;
  EMAIL_MANAGEMENT_WORKER_GOOGLE_CLIENT_ID?: string;
  EMAIL_MANAGEMENT_WORKER_GOOGLE_CLIENT_SECRET?: string;
  EMAIL_MANAGEMENT_WORKER_GOOGLE_TOKEN_URL?: string;
  EMAIL_MANAGEMENT_WORKER_GMAIL_API_BASE_URL?: string;
}

type JsonObject = Record<string, unknown>;

interface TokenBundle {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenEndpoint: string;
  raw: JsonObject;
}

interface EmailRecord {
  id: string;
  subject: string;
  from_address: string;
  from_name: string;
  received_time: string;
  body_preview: string;
  body: string;
  is_read: boolean;
  body_html?: string;
}

class AppError extends Error {
  readonly errorType: string;
  readonly statusCode: number;
  readonly details?: JsonObject;

  constructor(message: string, errorType = "invalid", statusCode = 400, details?: JsonObject) {
    super(message);
    this.name = "AppError";
    this.errorType = errorType;
    this.statusCode = statusCode;
    this.details = details;
  }

  toPayload(): JsonObject {
    const payload: JsonObject = {
      success: false,
      message: this.message,
      error_type: this.errorType,
    };
    if (this.details) payload.details = this.details;
    return payload;
  }
}

const DEFAULT_LIVE_TOKEN_URL = "https://login.live.com/oauth20_token.srf";
const DEFAULT_MS_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const DEFAULT_GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
const DEFAULT_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_GMAIL_API_BASE_URL = "https://gmail.googleapis.com/gmail/v1";

function envString(value: string | undefined, fallback = ""): string {
  return String(value || fallback).trim();
}

function envInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function jsonResponse(payload: unknown, status = 200, env?: Env): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  const corsOrigin = envString(env?.EMAIL_MANAGEMENT_WORKER_CORS_ORIGIN);
  if (corsOrigin) {
    headers.set("Access-Control-Allow-Origin", corsOrigin);
    headers.set("Vary", "Origin");
    headers.set("Access-Control-Allow-Credentials", "true");
  }
  return new Response(JSON.stringify(payload), { status, headers });
}

function textResponse(message: string, status = 404, env?: Env): Response {
  const headers = new Headers({
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  const corsOrigin = envString(env?.EMAIL_MANAGEMENT_WORKER_CORS_ORIGIN);
  if (corsOrigin) headers.set("Access-Control-Allow-Origin", corsOrigin);
  return new Response(message, { status, headers });
}

function preflightResponse(env: Env): Response {
  const headers = new Headers({
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
  });
  const corsOrigin = envString(env.EMAIL_MANAGEMENT_WORKER_CORS_ORIGIN) || "*";
  headers.set("Access-Control-Allow-Origin", corsOrigin);
  if (corsOrigin !== "*") headers.set("Vary", "Origin");
  return new Response(null, { status: 204, headers });
}

async function parseJsonBody(request: Request): Promise<JsonObject> {
  try {
    const payload = await request.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
    return payload as JsonObject;
  } catch {
    return {};
  }
}

function requireString(payload: JsonObject, field: string, message: string): string {
  const value = String(payload[field] || "").trim();
  if (!value) throw new AppError(message, "invalid", 400);
  return value;
}

function extractErrorText(payload: unknown): string {
  if (payload == null) return "";
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

function classifyMicrosoftError(payload: unknown): [string, string] {
  const text = extractErrorText(payload).toLowerCase();
  if (!text) return ["invalid", "微软认证失败"];
  if (text.includes("locked") || text.includes("temporarily blocked") || text.includes("account has been locked")) {
    return ["locked", "账号已被 Microsoft 锁定"];
  }
  if (text.includes("banned") || text.includes("suspended") || text.includes("disabled") || text.includes("blocked")) {
    return ["banned", "账号已被 Microsoft 封禁或禁用"];
  }
  if (text.includes("700082") || text.includes("expired") || text.includes("expiration")) {
    return ["expired", "刷新令牌已过期"];
  }
  if (text.includes("invalid_grant") || text.includes("invalid token") || text.includes("bad token") || text.includes("unauthorized")) {
    return ["invalid", "刷新令牌无效"];
  }
  return ["invalid", "微软认证失败"];
}

function classifyGoogleError(payload: unknown, defaultMessage = "Google 认证失败"): [string, string] {
  const lowered = extractErrorText(payload).toLowerCase();
  if (lowered.includes("access_denied")) return ["invalid", "Google 授权被拒绝"];
  if (lowered.includes("invalid_client") || lowered.includes("unauthorized_client")) return ["invalid", "Google OAuth 客户端配置无效"];
  if (lowered.includes("invalid_scope")) return ["invalid", "Google OAuth scope 配置无效"];
  if (lowered.includes("redirect_uri_mismatch")) return ["invalid", "Google OAuth redirect URI 不匹配"];
  if (lowered.includes("invalid_grant")) {
    if (lowered.includes("expired")) return ["expired", "Google refresh token 已过期"];
    if (lowered.includes("revoked")) return ["invalid", "Google refresh token 已被撤销，请重新绑定 Gmail"];
    return ["invalid", "Google refresh token 无效"];
  }
  if (lowered.includes("insufficient authentication scopes") || lowered.includes("insufficientpermissions")) {
    return ["invalid", "Gmail API 权限不足，请重新授权 Gmail"];
  }
  if (lowered.includes("gmail api has not been used") || lowered.includes("api has not been used")) {
    return ["invalid", "Google Cloud 项目尚未启用 Gmail API"];
  }
  if (lowered.includes("quota") || lowered.includes("rate limit") || lowered.includes('"code":429') || lowered.includes('"code": 429')) {
    return ["invalid", "Gmail API 调用频率过高，请稍后再试"];
  }
  if (lowered.includes("backend error") || lowered.includes('"code":500') || lowered.includes('"code": 500') || lowered.includes('"code":503') || lowered.includes('"code": 503')) {
    return ["invalid", "Gmail API 暂时不可用，请稍后再试"];
  }
  return ["invalid", defaultMessage];
}

async function readJsonResponse(response: Response): Promise<JsonObject> {
  const text = await response.text();
  if (!text) return {};
  try {
    const payload = JSON.parse(text);
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : { value: payload };
  } catch {
    return { raw: text };
  }
}

async function postFormJson(url: string, formData: Record<string, string>): Promise<JsonObject> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(formData),
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new AppError("token endpoint failed", "invalid", response.status, { provider_response: extractErrorText(payload) });
  }
  return payload;
}

function microsoftTokenUrls(env: Env): string[] {
  return [
    envString(env.EMAIL_MANAGEMENT_WORKER_LIVE_TOKEN_URL, DEFAULT_LIVE_TOKEN_URL),
    envString(env.EMAIL_MANAGEMENT_WORKER_MS_TOKEN_URL, DEFAULT_MS_TOKEN_URL),
  ].filter((value, index, array) => value && array.indexOf(value) === index);
}

async function exchangeMicrosoftRefreshToken(env: Env, tokenUrl: string, clientId: string, refreshToken: string): Promise<TokenBundle> {
  const tokenData = await postFormJson(tokenUrl, {
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const accessToken = String(tokenData.access_token || "").trim();
  if (!accessToken) {
    throw new AppError("微软认证失败", "invalid", 401, { provider_response: extractErrorText(tokenData) });
  }
  return {
    accessToken,
    refreshToken: String(tokenData.refresh_token || ""),
    expiresIn: Number(tokenData.expires_in || 3600),
    tokenEndpoint: tokenUrl,
    raw: tokenData,
  };
}

function graphBaseUrl(env: Env): string {
  return envString(env.EMAIL_MANAGEMENT_WORKER_GRAPH_BASE_URL, DEFAULT_GRAPH_BASE_URL).replace(/\/+$/, "");
}

function graphFolderName(folder: string): string {
  return folder === "junkemail" ? "junkemail" : "inbox";
}

async function graphGetJson(env: Env, accessToken: string, pathAndQuery: string): Promise<JsonObject> {
  const url = `${graphBaseUrl(env)}${pathAndQuery}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    const [errorType, message] = classifyMicrosoftError(payload);
    const unsupported = response.status === 401 || response.status === 403;
    throw new AppError(
      unsupported ? "该 Microsoft refresh token 无法访问 Graph Mail；Worker 版暂不支持 IMAP/O2 token" : message,
      unsupported ? "unsupported_graph" : errorType,
      unsupported ? 502 : 502,
      { provider_response: extractErrorText(payload) },
    );
  }
  return payload;
}

async function withMicrosoftGraph<T>(
  env: Env,
  clientId: string,
  refreshToken: string,
  action: (bundle: TokenBundle) => Promise<T>,
): Promise<{ bundle: TokenBundle; result: T }> {
  const attempts: string[] = [];
  let lastError: AppError | null = null;

  for (const tokenUrl of microsoftTokenUrls(env)) {
    let bundle: TokenBundle;
    try {
      bundle = await exchangeMicrosoftRefreshToken(env, tokenUrl, clientId, refreshToken);
    } catch (error) {
      if (error instanceof AppError) {
        const [errorType, message] = classifyMicrosoftError(error.details?.provider_response || error.message);
        attempts.push(`${tokenUrl}: ${message}`);
        lastError = new AppError(message, errorType, error.statusCode, error.details);
        continue;
      }
      attempts.push(`${tokenUrl}: ${String(error)}`);
      continue;
    }

    try {
      const result = await action(bundle);
      return { bundle, result };
    } catch (error) {
      if (error instanceof AppError) {
        attempts.push(`${tokenUrl}: ${error.message}`);
        lastError = error;
        continue;
      }
      attempts.push(`${tokenUrl}: ${String(error)}`);
    }
  }

  if (lastError?.errorType === "unsupported_graph") {
    throw new AppError(lastError.message, "unsupported_graph", 502, { attempts });
  }
  if (lastError) {
    throw new AppError(lastError.message, lastError.errorType, lastError.statusCode, { attempts });
  }
  throw new AppError("无法用 refresh token 换取 Microsoft Graph access token", "invalid", 401, { attempts, client_id: clientId });
}

async function probeGraphAccess(env: Env, accessToken: string, folder = "inbox"): Promise<boolean> {
  const query = new URLSearchParams({ "$top": "1", "$select": "id" });
  const payload = await graphGetJson(env, accessToken, `/me/mailFolders/${graphFolderName(folder)}/messages?${query}`);
  return Array.isArray(payload.value);
}

function graphMessageToRecord(item: JsonObject): EmailRecord {
  const from = (item.from && typeof item.from === "object" ? item.from : {}) as JsonObject;
  const emailAddress = (from.emailAddress && typeof from.emailAddress === "object" ? from.emailAddress : {}) as JsonObject;
  const body = (item.body && typeof item.body === "object" ? item.body : {}) as JsonObject;
  return {
    id: String(item.id || ""),
    subject: String(item.subject || "(无主题)"),
    from_address: String(emailAddress.address || ""),
    from_name: String(emailAddress.name || ""),
    received_time: String(item.receivedDateTime || ""),
    body_preview: String(item.bodyPreview || ""),
    body: String(body.content || ""),
    is_read: Boolean(item.isRead),
  };
}

async function fetchGraphMessages(env: Env, accessToken: string, folder: string, limit: number): Promise<EmailRecord[]> {
  const query = new URLSearchParams({
    "$top": String(limit),
    "$select": "id,subject,from,receivedDateTime,bodyPreview,body,isRead",
  });
  const payload = await graphGetJson(env, accessToken, `/me/mailFolders/${graphFolderName(folder)}/messages?${query}`);
  const value = Array.isArray(payload.value) ? payload.value : [];
  return value.filter((item): item is JsonObject => item && typeof item === "object").map(graphMessageToRecord);
}

function ensureGoogleConfig(env: Env): { clientId: string; clientSecret: string; tokenUrl: string; gmailBaseUrl: string } {
  const clientId = envString(env.EMAIL_MANAGEMENT_WORKER_GOOGLE_CLIENT_ID);
  const clientSecret = envString(env.EMAIL_MANAGEMENT_WORKER_GOOGLE_CLIENT_SECRET);
  if (!clientId || !clientSecret) {
    const missing = [];
    if (!clientId) missing.push("EMAIL_MANAGEMENT_WORKER_GOOGLE_CLIENT_ID");
    if (!clientSecret) missing.push("EMAIL_MANAGEMENT_WORKER_GOOGLE_CLIENT_SECRET");
    throw new AppError("Google OAuth 配置不完整，请先设置 Worker 变量或 Secret", "invalid", 500, { missing });
  }
  return {
    clientId,
    clientSecret,
    tokenUrl: envString(env.EMAIL_MANAGEMENT_WORKER_GOOGLE_TOKEN_URL, DEFAULT_GOOGLE_TOKEN_URL),
    gmailBaseUrl: envString(env.EMAIL_MANAGEMENT_WORKER_GMAIL_API_BASE_URL, DEFAULT_GMAIL_API_BASE_URL).replace(/\/+$/, ""),
  };
}

async function exchangeGoogleRefreshToken(env: Env, refreshToken: string): Promise<TokenBundle> {
  const config = ensureGoogleConfig(env);
  let tokenData: JsonObject;
  try {
    tokenData = await postFormJson(config.tokenUrl, {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
  } catch (error) {
    if (error instanceof AppError) {
      const [errorType, message] = classifyGoogleError(error.details?.provider_response || error.message, "Google refresh token 交换失败");
      throw new AppError(message, errorType, 401, error.details);
    }
    throw error;
  }

  const accessToken = String(tokenData.access_token || "").trim();
  if (!accessToken) {
    const [errorType, message] = classifyGoogleError(tokenData, "Google OAuth 未返回 access token");
    throw new AppError(message, errorType, 401, { provider_response: extractErrorText(tokenData) });
  }
  return {
    accessToken,
    refreshToken: String(tokenData.refresh_token || ""),
    expiresIn: Number(tokenData.expires_in || 3600),
    tokenEndpoint: config.tokenUrl,
    raw: tokenData,
  };
}

async function gmailGetJson(env: Env, accessToken: string, pathAndQuery: string): Promise<JsonObject> {
  const { gmailBaseUrl } = ensureGoogleConfig(env);
  const response = await fetch(`${gmailBaseUrl}${pathAndQuery}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    let defaultMessage = "Gmail API 请求失败";
    if (response.status === 403) defaultMessage = "Gmail API 拒绝了请求";
    else if (response.status === 429) defaultMessage = "Gmail API 调用频率过高";
    else if (response.status >= 500) defaultMessage = "Gmail API 暂时不可用";
    const [errorType, message] = classifyGoogleError(payload, defaultMessage);
    throw new AppError(message, errorType, 502, { provider_response: extractErrorText(payload) });
  }
  return payload;
}

function decodeMimeWords(value: string): string {
  return value.replace(/=\?([^?]+)\?([bqBQ])\?([^?]+)\?=/g, (_match, charset: string, encoding: string, data: string) => {
    try {
      let bytes: Uint8Array;
      if (encoding.toLowerCase() === "b") {
        const binary = atob(data.replace(/\s/g, ""));
        bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      } else {
        const decoded = data.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_hexMatch, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
        bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
      }
      return new TextDecoder(charset || "utf-8", { fatal: false }).decode(bytes);
    } catch {
      return data;
    }
  });
}

function parseAddress(headerValue: string): { name: string; address: string } {
  const decoded = decodeMimeWords(headerValue || "").trim();
  const match = decoded.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    return { name: match[1].replace(/^"|"$/g, "").trim(), address: match[2].trim() };
  }
  return { name: "", address: decoded };
}

function gmailHeadersMap(headers: unknown): Record<string, string> {
  const mapped: Record<string, string> = {};
  if (!Array.isArray(headers)) return mapped;
  for (const item of headers) {
    if (!item || typeof item !== "object") continue;
    const row = item as JsonObject;
    const name = String(row.name || "").trim().toLowerCase();
    const value = String(row.value || "").trim();
    if (name && value && !(name in mapped)) mapped[name] = value;
  }
  return mapped;
}

function formatGmailInternalDate(rawValue: unknown): string {
  const timestampMs = Number.parseInt(String(rawValue || "0"), 10);
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return "";
  const date = new Date(timestampMs);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function gmailMessageToSummary(item: JsonObject): EmailRecord {
  const payload = (item.payload && typeof item.payload === "object" ? item.payload : {}) as JsonObject;
  const headers = gmailHeadersMap(payload.headers);
  const from = parseAddress(headers.from || "");
  const labels = new Set(Array.isArray(item.labelIds) ? item.labelIds.map(String) : []);
  return {
    id: String(item.id || ""),
    subject: decodeMimeWords(headers.subject || "") || "(无主题)",
    from_address: from.address,
    from_name: from.name,
    received_time: formatGmailInternalDate(item.internalDate),
    body_preview: String(item.snippet || "").trim(),
    body: "",
    is_read: !labels.has("UNREAD"),
  };
}

async function fetchGmailMessages(env: Env, accessToken: string, folder: string, limit: number): Promise<EmailRecord[]> {
  const labelId = folder === "junkemail" ? "SPAM" : "INBOX";
  const listQuery = new URLSearchParams({ labelIds: labelId, maxResults: String(limit) });
  if (labelId === "SPAM") listQuery.set("includeSpamTrash", "true");
  const listPayload = await gmailGetJson(env, accessToken, `/users/me/messages?${listQuery}`);
  const messages = Array.isArray(listPayload.messages) ? listPayload.messages : [];
  const records: EmailRecord[] = [];
  for (const item of messages) {
    if (!item || typeof item !== "object") continue;
    const messageId = String((item as JsonObject).id || "").trim();
    if (!messageId) continue;
    const detailPath = `/users/me/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&fields=id,internalDate,labelIds,snippet,payload/headers`;
    const detailPayload = await gmailGetJson(env, accessToken, detailPath);
    records.push(gmailMessageToSummary(detailPayload));
  }
  return records;
}

async function handleDetectPermission(request: Request, env: Env): Promise<Response> {
  const payload = await parseJsonBody(request);
  const clientId = requireString(payload, "client_id", "缺少 client_id 或 refresh_token");
  const refreshToken = requireString(payload, "refresh_token", "缺少 client_id 或 refresh_token");

  const { bundle } = await withMicrosoftGraph(env, clientId, refreshToken, async (candidate) => {
    await probeGraphAccess(env, candidate.accessToken);
    return true;
  });

  return jsonResponse(
    {
      success: true,
      token_type: "graph",
      use_local_ip: false,
      meta: {
        strategy: "graph_only",
        token_endpoint: bundle.tokenEndpoint,
        rotated_refresh_token: Boolean(bundle.refreshToken),
      },
    },
    200,
    env,
  );
}

async function handleRefreshEmails(request: Request, env: Env): Promise<Response> {
  const payload = await parseJsonBody(request);
  const emailAddress = requireString(payload, "email_address", "缺少有效的 email_address");
  if (!emailAddress.includes("@")) throw new AppError("缺少有效的 email_address", "invalid", 400);
  const refreshToken = requireString(payload, "refresh_token", "缺少 refresh_token");
  const provider = String(payload.provider || "microsoft").trim().toLowerCase() || "microsoft";
  const folder = String(payload.folder || "inbox").trim() || "inbox";
  const limit = envInt(env.EMAIL_MANAGEMENT_WORKER_MAIL_FETCH_LIMIT, 20);

  if (provider === "google") {
    const tokenBundle = await exchangeGoogleRefreshToken(env, refreshToken);
    const emails = await fetchGmailMessages(env, tokenBundle.accessToken, folder, limit);
    return jsonResponse(
      {
        success: true,
        message: `成功刷新 ${emails.length} 封邮件`,
        data: emails,
        meta: {
          strategy: "gmail_api",
          provider: "google",
          rotated_refresh_token: tokenBundle.refreshToken || "",
        },
      },
      200,
      env,
    );
  }

  if (provider !== "microsoft") throw new AppError(`不支持的 provider: ${provider}`, "invalid", 400);
  const clientId = requireString(payload, "client_id", "缺少 client_id 或 refresh_token");
  const { bundle, result: emails } = await withMicrosoftGraph(env, clientId, refreshToken, (candidate) => fetchGraphMessages(env, candidate.accessToken, folder, limit));

  return jsonResponse(
    {
      success: true,
      message: `成功刷新 ${emails.length} 封邮件`,
      data: emails,
      meta: {
        strategy: "graph",
        provider: "microsoft",
        graph_only: true,
        rotated_refresh_token: bundle.refreshToken || "",
      },
    },
    200,
    env,
  );
}

async function handleApiRequest(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS" && (url.pathname.startsWith("/api/") || url.pathname === "/detect-permission")) {
    return preflightResponse(env);
  }
  if (request.method === "GET" && url.pathname === "/healthz") {
    return jsonResponse({ success: true, status: "ok", runtime: "cloudflare-worker", microsoft_strategy: "graph_only" }, 200, env);
  }
  if (request.method === "POST" && url.pathname === "/detect-permission") return handleDetectPermission(request, env);
  if (request.method === "POST" && url.pathname === "/api/emails/refresh") return handleRefreshEmails(request, env);
  if (url.pathname.startsWith("/api/") || url.pathname === "/detect-permission") {
    return textResponse("Not Found", 404, env);
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const apiResponse = await handleApiRequest(request, env);
      if (apiResponse) return apiResponse;
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return textResponse("Static assets binding is not configured", 500, env);
    } catch (error) {
      if (error instanceof AppError) return jsonResponse(error.toPayload(), error.statusCode, env);
      console.error(error);
      return jsonResponse({ success: false, message: "服务器内部错误", error_type: "invalid" }, 500, env);
    }
  },
};
