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
let authUnavailableUntil = 0;

interface UpstreamResponse {
  status: number;
  headers: IncomingMessage["headers"];
  body: string;
}

class OpenSkyProxyError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = "OpenSkyProxyError";
  }
}

function openskyRequest(
  hostname: string,
  path: string,
  method: "GET" | "POST",
  headers: Record<string, string>,
  body = "",
): Promise<UpstreamResponse> {
  return new Promise((resolve, reject) => {
    const attempt = (connectHost: string, allowDnsRetry: boolean) => {
      const request = https.request(
        {
          // OpenSky publishes a stable address and Vercel can occasionally
          // time out while resolving its hostname. Try the pinned address
          // first, then retry once through normal DNS so either network path
          // can serve the proxy without exposing credentials to the client.
          hostname: connectHost,
          servername: hostname,
          path,
          method,
          headers: { ...headers, Host: hostname },
          // Keep each upstream attempt bounded. The Python caller allows time
          // for the static-address attempt and this one DNS retry.
          timeout: 4_000,
        },
        (response) => {
          const responseStatus = response.statusCode ?? 502;
          // Some Vercel egress paths reach the published address but receive
          // a gateway/auth response before the hostname route is available.
          // Retry the same request through DNS once so anonymous states are
          // not discarded just because the first network path was rejected.
          if (
            allowDnsRetry
            && connectHost === OPENSKY_IP
            && (responseStatus === 401 || responseStatus === 403 || responseStatus === 408 || responseStatus >= 500)
          ) {
            response.resume();
            attempt(hostname, false);
            return;
          }
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
      request.on("error", (error) => {
        if (allowDnsRetry && connectHost === OPENSKY_IP) {
          attempt(hostname, false);
          return;
        }
        reject(error);
      });
      if (body) request.write(body);
      request.end();
    };

    attempt(OPENSKY_IP, true);
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
  if (response.status >= 400) throw new OpenSkyProxyError(response.status, `OpenSky authentication failed (${response.status}).`);
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
    let token = "";
    let anonymous = false;
    const anonymousFallbackEnabled = process.env.OPEN_SKY_PROXY_ANONYMOUS_FALLBACK !== "0";
    if (endpoint === "/states/all" && anonymousFallbackEnabled && Date.now() < authUnavailableUntil) {
      anonymous = true;
    } else {
      try {
        token = await accessToken();
      } catch (error) {
        // The public states endpoint supports anonymous access. If the stored
        // client credentials are rejected, keep complete viewport coverage
        // with a deliberately slower, credit-safe cadence in the Python layer
        // instead of silently shrinking back to the map centre.
        const authFailure = error instanceof OpenSkyProxyError && [401, 403].includes(error.statusCode);
        if (endpoint !== "/states/all" || !anonymousFallbackEnabled || !authFailure) throw error;
        anonymous = true;
        authUnavailableUntil = Date.now() + 15 * 60 * 1000;
      }
    }
    const upstream = await openskyRequest(
      "opensky-network.org",
      upstreamPath,
      "GET",
      anonymous
        ? {
            Accept: "application/json",
            "User-Agent": "SkyTrace/2.0 (+https://github.com/amassias/OpenSky-Flight-Tracking; anonymous states fallback)",
          }
        : {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "User-Agent": "SkyTrace/2.0 (+https://github.com/amassias/OpenSky-Flight-Tracking; contact: massias.arthur@gmail.com)",
          },
    );
    if (anonymous && upstream.status >= 400) {
      console.error("OpenSky anonymous states request failed", { status: upstream.status, endpoint });
    }
    response.statusCode = upstream.status;
    response.setHeader("Content-Type", upstream.headers["content-type"] ?? "application/json");
    response.setHeader("Cache-Control", "no-store");
    if (anonymous) response.setHeader("X-SkyTrace-Auth", "anonymous");
    response.end(upstream.body);
  } catch (error) {
    const status = error instanceof OpenSkyProxyError && error.statusCode >= 400 && error.statusCode < 500
      ? error.statusCode
      : 502;
    // Keep a status-only breadcrumb for Vercel runtime logs. Never include
    // credentials, request headers, or upstream response bodies here.
    console.error("OpenSky proxy request failed", {
      status,
      message: error instanceof Error ? error.message : "unknown error",
      endpoint,
    });
    sendJson(response, status, {
      success: false,
      error: error instanceof Error ? error.message : "OpenSky proxy request failed.",
    });
  }
}
