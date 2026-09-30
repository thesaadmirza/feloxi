/// Masks the password in any `scheme://user:password@host` URL inside a message,
/// so broker errors that echo a connection string don't put secrets on screen.
export function maskUrlPasswords(text: string): string {
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/[^\s:/@]*):[^\s@/]+@/gi, "$1:•••@");
}

/// Query errors from `$api` are the API's JSON body (`{ error: { message } }`);
/// mutations and network failures throw an Error. Returns the message either way.
export function errorText(err: unknown): string | undefined {
  if (!err) return undefined;
  let message: unknown;
  if (err instanceof Error) message = err.message;
  else if (typeof err === "object" && "error" in err) {
    message = (err as { error?: { message?: unknown } }).error?.message;
  }
  return typeof message === "string" && message ? maskUrlPasswords(message) : undefined;
}
