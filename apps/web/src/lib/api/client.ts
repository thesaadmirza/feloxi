import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./v1";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

const authMiddleware: Middleware = {
  async onResponse({ response, request, options }) {
    if (
      response.status === 401 &&
      typeof window !== "undefined" &&
      !request.url.includes("/auth/")
    ) {
      const refreshRes = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (refreshRes.ok) {
        return fetch(request, { ...options, credentials: "include" });
      }
      window.location.href = "/auth/login";
    }
    return undefined;
  },
};

const lazyFetch: typeof globalThis.fetch = (...args) => globalThis.fetch(...args);

export const fetchClient = createClient<paths>({
  baseUrl: API_BASE,
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  fetch: lazyFetch,
});

fetchClient.use(authMiddleware);
