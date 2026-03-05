import createQueryClient from "openapi-react-query";
import { fetchClient } from "./client";

export const $api = createQueryClient(fetchClient);
export { fetchClient } from "./client";
export type { paths, components, operations } from "./v1";

export async function unwrap<T>(
  promise: Promise<{ data?: T; error?: unknown; response: Response }>
): Promise<T> {
  const { data, error, response } = await promise;
  if (!response.ok || error) {
    const msg =
      typeof error === "object" && error !== null && "error" in error
        ? (error as { error?: { message?: string } }).error?.message
        : response.statusText;
    throw new Error(msg || "Request failed");
  }
  return data as T;
}
