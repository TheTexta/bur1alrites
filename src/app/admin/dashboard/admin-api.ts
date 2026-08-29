export class AdminSessionExpiredError extends Error {}

export async function requestAdminJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const body = await response.json().catch(() => null);

  if (response.status === 401) {
    throw new AdminSessionExpiredError("Your session ended.");
  }

  if (!response.ok) {
    throw new Error(body?.error ?? "The request could not be completed.");
  }

  return body as T;
}