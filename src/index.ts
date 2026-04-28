interface FetcherBinding {
  fetch(request: Request): Promise<Response>;
}

interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  error?: string;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(columnName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

interface Env {
  ASSETS?: FetcherBinding;
  DB?: D1Database;
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
  EMAIL_MANAGEMENT_WORKER_SESSION_SECRET?: string;
  EMAIL_MANAGEMENT_WORKER_ENCRYPTION_SECRET?: string;
  EMAIL_MANAGEMENT_WORKER_AUTH_SESSION_TTL_DAYS?: string;
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

interface AuthUser {
  id: string;
  email: string;
  created_at: string;
}

interface CloudAccountInput {
  email_address: string;
  provider?: string;
  group_name?: string;
  status?: string;
  note?: string;
  oauth_status?: string;
  oauth_email?: string;
  oauth_updated_at?: string;
  import_sequence?: number;
}

interface CloudSecretInput {
  email_address: string;
  password?: string;
  client_id?: string;
  refresh_token?: string;
  token_expires_at?: string;
  recovery_email?: string;
  twofa_secret?: string;
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
const AUTH_COOKIE_NAME = "emw_session";
const PASSWORD_ITERATIONS = 100_000;

function envString(value: string | undefined, fallback = ""): string {
  return String(value || fallback).trim();
}

function envInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nowIso(): string {
  return new Date().toISOString();
}

function addDaysIso(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function randomToken(): string {
  return bytesToBase64(randomBytes(32)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index++) diff |= left[index] ^ right[index];
  return diff === 0;
}

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function requireDb(env: Env): D1Database {
  if (!env.DB) {
    throw new AppError("D1 数据库未配置，请先在 wrangler.toml 绑定 DB", "config", 500);
  }
  return env.DB;
}

function requireSecret(env: Env, key: "EMAIL_MANAGEMENT_WORKER_SESSION_SECRET" | "EMAIL_MANAGEMENT_WORKER_ENCRYPTION_SECRET"): string {
  const secret = envString(env[key]);
  if (secret.length < 16) {
    throw new AppError(`${key} 未配置或长度过短`, "config", 500);
  }
  return secret;
}

function cookieHeader(request: Request): string {
  return request.headers.get("Cookie") || "";
}

function getCookie(request: Request, name: string): string {
  const cookies = cookieHeader(request).split(";");
  for (const cookie of cookies) {
    const [rawKey, ...rawValue] = cookie.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rawValue.join("="));
  }
  return "";
}

function getBearerToken(request: Request): string {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function getSessionToken(request: Request): string {
  return getBearerToken(request) || getCookie(request, AUTH_COOKIE_NAME);
}

function setCookieHeader(token: string, maxAgeSeconds: number): string {
  return `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function clearCookieHeader(): string {
  return `${AUTH_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function jsonResponse(payload: unknown, status = 200, env?: Env, extraHeaders?: Record<string, string>): Response {
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
  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
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

function isD1NotInitializedError(error: unknown): boolean {
  const text = extractErrorText(error).toLowerCase();
  return text.includes("no such table") && (
    text.includes("users") ||
    text.includes("auth_sessions") ||
    text.includes("cloud_accounts") ||
    text.includes("cloud_account_secrets") ||
    text.includes("auth_login_attempts")
  );
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

async function hashPassword(password: string, saltBase64 = bytesToBase64(randomBytes(16)), iterations = PASSWORD_ITERATIONS): Promise<{ hash: string; salt: string; iterations: number }> {
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: base64ToBytes(saltBase64).buffer as ArrayBuffer,
      iterations,
    },
    keyMaterial,
    256,
  );
  return { hash: bytesToBase64(new Uint8Array(derived)), salt: saltBase64, iterations };
}

async function verifyPassword(password: string, salt: string, iterations: number, expectedHash: string): Promise<boolean> {
  const candidate = await hashPassword(password, salt, iterations);
  return timingSafeEqual(candidate.hash, expectedHash);
}

async function hashSessionToken(env: Env, token: string): Promise<string> {
  const secret = requireSecret(env, "EMAIL_MANAGEMENT_WORKER_SESSION_SECRET");
  return sha256Hex(`${secret}:${token}`);
}

async function createSession(env: Env, userId: string): Promise<{ token: string; expiresAt: string; maxAgeSeconds: number }> {
  const db = requireDb(env);
  const token = randomToken();
  const tokenHash = await hashSessionToken(env, token);
  const ttlDays = envInt(env.EMAIL_MANAGEMENT_WORKER_AUTH_SESSION_TTL_DAYS, 30);
  const maxAgeSeconds = ttlDays * 24 * 60 * 60;
  const expiresAt = addDaysIso(ttlDays);
  await db
    .prepare(
      "INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(crypto.randomUUID(), userId, tokenHash, expiresAt, nowIso(), nowIso())
    .run();
  return { token, expiresAt, maxAgeSeconds };
}

async function currentUser(request: Request, env: Env, required = true): Promise<AuthUser | null> {
  const token = getSessionToken(request);
  if (!token) {
    if (required) throw new AppError("请先登录", "unauthorized", 401);
    return null;
  }
  const db = requireDb(env);
  const tokenHash = await hashSessionToken(env, token);
  const row = await db
    .prepare(
      `SELECT users.id, users.email, users.created_at
       FROM auth_sessions
       JOIN users ON users.id = auth_sessions.user_id
       WHERE auth_sessions.token_hash = ?
         AND auth_sessions.revoked_at IS NULL
         AND auth_sessions.expires_at > ?
       LIMIT 1`,
    )
    .bind(tokenHash, nowIso())
    .first<AuthUser>();
  if (!row) {
    if (required) throw new AppError("登录态已失效，请重新登录", "unauthorized", 401);
    return null;
  }
  await db.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?").bind(nowIso(), tokenHash).run();
  return row;
}

async function recordLoginAttempt(env: Env, email: string, request: Request, success: boolean, reason = ""): Promise<void> {
  const db = requireDb(env);
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "";
  const ipHash = ip ? await sha256Hex(`ip:${ip}`) : "";
  await db
    .prepare("INSERT INTO auth_login_attempts (id, email, ip_hash, success, failure_reason, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), email, ipHash, success ? 1 : 0, reason, nowIso())
    .run();
}

function publicUser(user: AuthUser): JsonObject {
  return {
    id: user.id,
    email: user.email,
    created_at: user.created_at,
  };
}

async function cloudSummary(env: Env, userId: string): Promise<JsonObject> {
  const db = requireDb(env);
  const accountCount = await db.prepare("SELECT COUNT(*) AS count FROM cloud_accounts WHERE user_id = ?").bind(userId).first<{ count: number }>();
  const secretCount = await db.prepare("SELECT COUNT(*) AS count FROM cloud_account_secrets WHERE user_id = ?").bind(userId).first<{ count: number }>();
  return {
    account_count: Number(accountCount?.count || 0),
    secret_count: Number(secretCount?.count || 0),
  };
}

async function handleRegister(request: Request, env: Env): Promise<Response> {
  const payload = await parseJsonBody(request);
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || "");
  if (!email || !email.includes("@")) throw new AppError("请输入有效邮箱", "invalid", 400);
  if (password.length < 8) throw new AppError("密码至少需要 8 位", "invalid", 400);

  const db = requireDb(env);
  const existing = await db.prepare("SELECT id FROM users WHERE email = ? LIMIT 1").bind(email).first<{ id: string }>();
  if (existing) throw new AppError("该邮箱已注册", "invalid", 409);

  const passwordHash = await hashPassword(password);
  const user: AuthUser = { id: crypto.randomUUID(), email, created_at: nowIso() };
  await db
    .prepare(
      "INSERT INTO users (id, email, password_hash, password_salt, password_iterations, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(user.id, email, passwordHash.hash, passwordHash.salt, passwordHash.iterations, user.created_at, user.created_at)
    .run();
  await recordLoginAttempt(env, email, request, true, "register");
  const session = await createSession(env, user.id);
  return jsonResponse(
    { success: true, user: publicUser(user), session_token: session.token, expires_at: session.expiresAt, cloud: await cloudSummary(env, user.id) },
    200,
    env,
    { "Set-Cookie": setCookieHeader(session.token, session.maxAgeSeconds) },
  );
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const payload = await parseJsonBody(request);
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || "");
  if (!email || !password) throw new AppError("请输入邮箱和密码", "invalid", 400);

  const db = requireDb(env);
  const row = await db
    .prepare("SELECT id, email, password_hash, password_salt, password_iterations, created_at FROM users WHERE email = ? LIMIT 1")
    .bind(email)
    .first<AuthUser & { password_hash: string; password_salt: string; password_iterations: number }>();
  if (!row) {
    await recordLoginAttempt(env, email, request, false, "user_not_found");
    throw new AppError("邮箱或密码错误", "unauthorized", 401);
  }
  const ok = await verifyPassword(password, row.password_salt, Number(row.password_iterations), row.password_hash);
  await recordLoginAttempt(env, email, request, ok, ok ? "login" : "bad_password");
  if (!ok) throw new AppError("邮箱或密码错误", "unauthorized", 401);

  const session = await createSession(env, row.id);
  const user: AuthUser = { id: row.id, email: row.email, created_at: row.created_at };
  return jsonResponse(
    { success: true, user: publicUser(user), session_token: session.token, expires_at: session.expiresAt, cloud: await cloudSummary(env, row.id) },
    200,
    env,
    { "Set-Cookie": setCookieHeader(session.token, session.maxAgeSeconds) },
  );
}

async function handleMe(request: Request, env: Env): Promise<Response> {
  if (!env.DB) {
    return jsonResponse(
      {
        success: true,
        authenticated: false,
        user: null,
        cloud_available: false,
        mode: "local_only",
      },
      200,
      env,
    );
  }
  const user = await currentUser(request, env, false);
  if (!user) return jsonResponse({ success: true, authenticated: false, user: null, cloud_available: true, mode: "cloud" }, 200, env);
  return jsonResponse({ success: true, authenticated: true, user: publicUser(user), cloud_available: true, mode: "cloud", cloud: await cloudSummary(env, user.id) }, 200, env);
}

async function handleLogout(request: Request, env: Env): Promise<Response> {
  const token = getSessionToken(request);
  if (token && env.DB) {
    const tokenHash = await hashSessionToken(env, token);
    await env.DB.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ?").bind(nowIso(), tokenHash).run();
  }
  return jsonResponse({ success: true }, 200, env, { "Set-Cookie": clearCookieHeader() });
}

function cleanString(value: unknown, maxLength = 1000): string {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeCloudAccount(item: unknown): CloudAccountInput | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const row = item as JsonObject;
  const email = normalizeEmail(row.email_address);
  if (!email || !email.includes("@")) return null;
  const importSequence = Number(row.import_sequence || 0);
  return {
    email_address: email,
    provider: ["microsoft", "google"].includes(cleanString(row.provider, 50).toLowerCase()) ? cleanString(row.provider, 50).toLowerCase() : "microsoft",
    group_name: cleanString(row.group_name, 200) || "默认分组",
    status: cleanString(row.status, 100),
    note: cleanString(row.note, 2000),
    oauth_status: cleanString(row.oauth_status, 100),
    oauth_email: cleanString(row.oauth_email, 320),
    oauth_updated_at: cleanString(row.oauth_updated_at, 100),
    import_sequence: Number.isFinite(importSequence) ? importSequence : 0,
  };
}

function normalizeCloudSecret(item: unknown): CloudSecretInput | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const row = item as JsonObject;
  const email = normalizeEmail(row.email_address);
  if (!email || !email.includes("@")) return null;
  return {
    email_address: email,
    password: String(row.password || ""),
    client_id: String(row.client_id || ""),
    refresh_token: String(row.refresh_token || ""),
    token_expires_at: String(row.token_expires_at || ""),
    recovery_email: String(row.recovery_email || ""),
    twofa_secret: String(row.twofa_secret || ""),
  };
}

async function encryptionKey(env: Env): Promise<CryptoKey> {
  const secret = requireSecret(env, "EMAIL_MANAGEMENT_WORKER_ENCRYPTION_SECRET");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptSecretPayload(env: Env, payload: CloudSecretInput): Promise<{ ciphertext: string; iv: string; algorithm: string }> {
  const key = await encryptionKey(env);
  const iv = randomBytes(12);
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv.buffer as ArrayBuffer }, key, data.buffer as ArrayBuffer);
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv), algorithm: "AES-GCM-256" };
}

async function decryptSecretPayload(env: Env, ciphertext: string, iv: string): Promise<CloudSecretInput> {
  const key = await encryptionKey(env);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv).buffer as ArrayBuffer }, key, base64ToBytes(ciphertext).buffer as ArrayBuffer);
  const parsed = JSON.parse(new TextDecoder().decode(decrypted));
  const normalized = normalizeCloudSecret(parsed);
  if (!normalized) throw new AppError("云端加密资料格式异常", "invalid", 500);
  return normalized;
}

async function handleGetCloudAccounts(request: Request, env: Env): Promise<Response> {
  const user = await currentUser(request, env);
  const db = requireDb(env);
  const result = await db
    .prepare(
      `SELECT email_address, provider, group_name, status, note, oauth_status, oauth_email, oauth_updated_at, import_sequence, updated_at
       FROM cloud_accounts
       WHERE user_id = ?
       ORDER BY import_sequence ASC, email_address ASC`,
    )
    .bind(user!.id)
    .all<JsonObject>();
  return jsonResponse({ success: true, accounts: result.results || [] }, 200, env);
}

async function handleSyncCloudAccounts(request: Request, env: Env): Promise<Response> {
  const user = await currentUser(request, env);
  const payload = await parseJsonBody(request);
  const rawAccounts = Array.isArray(payload.accounts) ? payload.accounts : [];
  const accounts = rawAccounts.map(normalizeCloudAccount).filter((item): item is CloudAccountInput => Boolean(item));
  const unique = new Map(accounts.map((account) => [account.email_address, account]));
  const db = requireDb(env);
  const timestamp = nowIso();

  await db.prepare("DELETE FROM cloud_accounts WHERE user_id = ?").bind(user!.id).run();
  if (unique.size > 0) {
    const statements = Array.from(unique.values()).map((account) =>
      db
        .prepare(
          `INSERT INTO cloud_accounts
           (user_id, email_address, provider, group_name, status, note, oauth_status, oauth_email, oauth_updated_at, import_sequence, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          user!.id,
          account.email_address,
          account.provider || "microsoft",
          account.group_name || "默认分组",
          account.status || "",
          account.note || "",
          account.oauth_status || "",
          account.oauth_email || "",
          account.oauth_updated_at || "",
          account.import_sequence || 0,
          timestamp,
          timestamp,
        ),
    );
    await db.batch(statements);
  }

  return jsonResponse({ success: true, synced: unique.size }, 200, env);
}

async function handleSyncCloudSecrets(request: Request, env: Env): Promise<Response> {
  const user = await currentUser(request, env);
  const payload = await parseJsonBody(request);
  const rawSecrets = Array.isArray(payload.accounts) ? payload.accounts : Array.isArray(payload.secrets) ? payload.secrets : [];
  const secrets = rawSecrets.map(normalizeCloudSecret).filter((item): item is CloudSecretInput => Boolean(item));
  const unique = new Map(secrets.map((secret) => [secret.email_address, secret]));
  const db = requireDb(env);
  const timestamp = nowIso();

  await db.prepare("DELETE FROM cloud_account_secrets WHERE user_id = ?").bind(user!.id).run();
  const statements: D1PreparedStatement[] = [];
  for (const secret of unique.values()) {
    const encrypted = await encryptSecretPayload(env, secret);
    statements.push(
      db
        .prepare(
          `INSERT INTO cloud_account_secrets
           (user_id, email_address, encrypted_payload, iv, algorithm, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(user!.id, secret.email_address, encrypted.ciphertext, encrypted.iv, encrypted.algorithm, timestamp, timestamp),
    );
  }
  if (statements.length > 0) await db.batch(statements);

  return jsonResponse({ success: true, synced: unique.size }, 200, env);
}

async function handleUnlockCloudSecrets(request: Request, env: Env): Promise<Response> {
  const user = await currentUser(request, env);
  const payload = await parseJsonBody(request);
  const requestedEmails = new Set(Array.isArray(payload.email_addresses) ? payload.email_addresses.map(normalizeEmail).filter(Boolean) : []);
  const db = requireDb(env);
  const result = await db
    .prepare("SELECT email_address, encrypted_payload, iv FROM cloud_account_secrets WHERE user_id = ? ORDER BY email_address ASC")
    .bind(user!.id)
    .all<{ email_address: string; encrypted_payload: string; iv: string }>();
  const secrets: CloudSecretInput[] = [];
  for (const row of result.results || []) {
    if (requestedEmails.size > 0 && !requestedEmails.has(normalizeEmail(row.email_address))) continue;
    secrets.push(await decryptSecretPayload(env, row.encrypted_payload, row.iv));
  }
  return jsonResponse({ success: true, accounts: secrets }, 200, env);
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
    return jsonResponse({ success: true, status: "ok", runtime: "cloudflare-worker", microsoft_strategy: "graph_only", d1_configured: Boolean(env.DB) }, 200, env);
  }
  if (request.method === "POST" && url.pathname === "/api/auth/register") return handleRegister(request, env);
  if (request.method === "POST" && url.pathname === "/api/auth/login") return handleLogin(request, env);
  if (request.method === "GET" && url.pathname === "/api/auth/me") return handleMe(request, env);
  if (request.method === "POST" && url.pathname === "/api/auth/logout") return handleLogout(request, env);
  if (request.method === "GET" && url.pathname === "/api/cloud/accounts") return handleGetCloudAccounts(request, env);
  if (request.method === "POST" && url.pathname === "/api/cloud/accounts/sync") return handleSyncCloudAccounts(request, env);
  if (request.method === "POST" && url.pathname === "/api/cloud/secrets/sync") return handleSyncCloudSecrets(request, env);
  if (request.method === "POST" && url.pathname === "/api/cloud/secrets/unlock") return handleUnlockCloudSecrets(request, env);
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
      if (isD1NotInitializedError(error)) {
        return jsonResponse(
          {
            success: false,
            message: "D1 数据库还没有初始化，请先执行 migrations 后再注册/登录",
            error_type: "database_not_initialized",
            details: {
              command: "npx wrangler d1 migrations apply email-management-worker-db --remote",
            },
          },
          500,
          env,
        );
      }
      console.error(error);
      return jsonResponse({ success: false, message: "服务器内部错误", error_type: "invalid" }, 500, env);
    }
  },
};
