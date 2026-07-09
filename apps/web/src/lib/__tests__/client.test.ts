import { describe, expect, it } from "vitest";
import { shouldAttemptRefresh } from "../api/client";

describe("shouldAttemptRefresh", () => {
  it("refreshes on session-carrying endpoints", () => {
    // /auth/me bootstraps the session on page load. Regression: a blanket
    // "/auth/" exclusion used to skip refresh here, so returning after the
    // access-token TTL always landed on the login page.
    expect(shouldAttemptRefresh("http://x/api/v1/auth/me")).toBe(true);
    expect(shouldAttemptRefresh("http://x/api/v1/auth/orgs")).toBe(true);
    expect(shouldAttemptRefresh("http://x/api/v1/tasks/summary")).toBe(true);
    expect(shouldAttemptRefresh("http://x/api/v1/alerts/rules")).toBe(true);
  });

  it("does not refresh where 401 is a real answer", () => {
    expect(shouldAttemptRefresh("http://x/api/v1/auth/refresh")).toBe(false);
    expect(shouldAttemptRefresh("http://x/api/v1/auth/login")).toBe(false);
    expect(shouldAttemptRefresh("http://x/api/v1/auth/logout")).toBe(false);
    expect(shouldAttemptRefresh("http://x/api/v1/auth/register")).toBe(false);
    expect(shouldAttemptRefresh("http://x/api/v1/auth/magic-link/verify")).toBe(false);
    expect(shouldAttemptRefresh("http://x/api/v1/auth/accept-invite")).toBe(false);
    expect(shouldAttemptRefresh("http://x/api/v1/auth/invite/abc")).toBe(false);
    expect(shouldAttemptRefresh("http://x/api/v1/auth/google/callback")).toBe(false);
  });
});
