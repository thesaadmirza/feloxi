import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./v1";

// A dashboard page fires many requests in parallel. When the access token
// expires they all return 401 at once — without deduping, each middleware
// invocation starts its own /auth/refresh call, they race on the same
// refresh token, and every refresh after the winner sees a revoked row and
// kicks the user to /auth/login. Single-flight the refresh instead.
let inflightRefresh: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  if (!inflightRefresh) {
    inflightRefresh = fetch("/api/v1/auth/refresh", {
      method: "POST",
      credentials: "include",
    })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        inflightRefresh = null;
      });
  }
  return inflightRefresh;
}

const authMiddleware: Middleware = {
  async onResponse({ response, request, options }) {
    if (
      response.status === 401 &&
      typeof window !== "undefined" &&
      !request.url.includes("/auth/")
    ) {
      const ok = await refreshSession();
      if (ok) {
        return fetch(request, { ...options, credentials: "include" });
      }
      window.location.href = "/auth/login";
    }
    return undefined;
  },
};

const lazyFetch: typeof globalThis.fetch = (...args) => globalThis.fetch(...args);

export const fetchClient = createClient<paths>({
  baseUrl: "",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  fetch: lazyFetch,
});

fetchClient.use(authMiddleware);
