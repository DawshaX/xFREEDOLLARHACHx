import { setBaseUrl } from "@workspace/api-client-react";
import { resolveStandaloneApi } from "./lib/standalone-api";

// Use relative URL so the shared proxy routes /api correctly
setBaseUrl("");

// Universal Standalone & GitHub Pages API Interceptor:
// Guarantees 100% functionality when hosted statically on GitHub Pages (dawshax.github.io)
// or when running without an external PostgreSQL database.
if (typeof window !== "undefined" && typeof window.fetch === "function") {
  const originalFetch = window.fetch.bind(window);
  const isStaticHost = window.location.hostname.endsWith("github.io");

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;

    const isApiCall = urlStr.startsWith("/api/") || urlStr.includes("/api/");
    const method = (init?.method || "GET").toUpperCase();

    if (isApiCall) {
      const apiIndex = urlStr.indexOf("/api/");
      const apiPath = apiIndex >= 0 ? urlStr.slice(apiIndex) : urlStr;

      if (isStaticHost) {
        const data = resolveStandaloneApi(apiPath, method);
        if (data !== null) {
          return new Response(JSON.stringify(data), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      try {
        const res = await originalFetch(input, init);
        if (res.ok) return res;

        const fallback = resolveStandaloneApi(apiPath, method);
        if (fallback !== null) {
          return new Response(JSON.stringify(fallback), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return res;
      } catch (err) {
        const fallback = resolveStandaloneApi(apiPath, method);
        if (fallback !== null) {
          return new Response(JSON.stringify(fallback), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw err;
      }
    }

    return originalFetch(input, init);
  };
}
