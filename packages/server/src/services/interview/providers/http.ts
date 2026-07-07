import { AppError } from "../../../utils/errors";

/** POST JSON with a bearer token and parse the JSON response, mapping non-2xx
 *  vendor errors to a 502 AppError. */
export async function postJson<T = any>(
  url: string,
  token: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || json?.message || `Provider API error (${res.status})`;
    throw new AppError(502, "PROVIDER_API_ERROR", msg);
  }
  return json as T;
}
