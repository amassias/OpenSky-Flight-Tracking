import https from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";

const OPENSKY_IP = "194.209.200.34";
const ALLOWED_ENDPOINTS = new Set([
  "/states/all",
  "/flights/departure",
  "/flights/arrival",
  "/flights/aircraft",
  "/flights/all",
  "/tracks/all",
  "/tracks",
]);

let cachedToken = "";
let tokenExpiresAt = 0;

interface UpstreamResponse {
  status: number;
  headers: IncomingMessage["headers"];
  body: string;
}

function openskyRequest(
  hostname: string,
  path: string,
  method: "GET" | "POST",
  headers: Record<string, string>,
  body = "",
): Promise<UpstreamResponse> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: OPENSKY_IP,
        servername: hostname,
        path,
        method,
        headers: { ...headers, Host: hostname },
        timeout: 30_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => resolve({
          status: response.statusCode ?? 502,
          headers: response.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        }));
      },
    );
    request.on("timeout", () => request.destroy(new Error("OpenSky connection timed out.")));
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

async function accessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  const clientId = process.env.OPEN_SKY_CLIENT_ID;
  const clientSecret = process.env.OPEN_SKY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("OpenSky credentials are not configured.");

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  }).toString();
  const response = await openskyRequest(
    "auth.opensky-network.org",
    "/auth/realms/opensky-network/protocol/openid-connect/token",
    "POST",
    {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": String(Buffer.byteLength(body)),
      Accept: "application/json",
    },
    body,
  );
  if (response.status >= 400) throw new Error(`OpenSky authentication failed (${response.status}).`);
  const payload = JSON.parse(response.body) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new Error("OpenSky did not return an access token.");
  cachedToken = payload.access_token;
  tokenExpiresAt = Date.now() + Math.max(60, (payload.expires_in ?? 1800) - 60) * 1000;
  return cachedToken;
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  const expectedSecret = process.env.OPEN_SKY_PROXY_SECRET;
  if (!expectedSecret || request.headers["x-skytrace-proxy-secret"] !== expectedSecret) {
    sendJson(response, 401, { success: false, error: "Unauthorized" });
    return;
  }

  const requestUrl = new URL(request.url ?? "/", "https://internal.skytrace");
  const endpoint = requestUrl.searchParams.get("endpoint") ?? "";
  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    sendJson(response, 400, { success: false, error: "Unsupported OpenSky endpoint" });
    return;
  }

  const upstreamParams = new URLSearchParams(requestUrl.searchParams);
  upstreamParams.delete("endpoint");
  const upstreamPath = `/api${endpoint}${upstreamParams.size ? `?${upstreamParams}` : ""}`;

  try {
    const token = await accessToken();
    const upstream = await openskyRequest(
      "opensky-network.org",
      upstreamPath,
      "GET",
      { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "SkyTrace/2.0" },
    );
    response.statusCode = upstream.status;
    response.setHeader("Content-Type", upstream.headers["content-type"] ?? "application/json");
    response.setHeader("Cache-Control", "no-store");
    response.end(upstream.body);
  } catch (error) {
    sendJson(response, 502, {
      success: false,
      error: error instanceof Error ? error.message : "OpenSky proxy request failed.",
    });
  }
}
