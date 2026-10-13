import "server-only";

/**
 * A tiny key-value store over a private Google Cloud Storage bucket, reached with no key anywhere: the function's
 * Vercel OIDC token is exchanged at Google's STS for a short-lived access token through the workload identity
 * provider in GCS_WIF_AUDIENCE, which trusts this Vercel project only. Holds sealed-details envelopes, which are
 * ciphertext Segundo can't open. With GCS_BUCKET or GCS_WIF_AUDIENCE unset, storage() is null and callers fall back.
 */
export type Storage = {
  read(key: string): Promise<string | null>;
  write(key: string, text: string, contentType?: string): Promise<void>;
};

const env = (name: string) => process.env[name]?.trim() || undefined;

let token: { value: string; exp: number } | null = null;

/** The function's Vercel OIDC token: the SDK's (from the request context, refreshed in dev), else the env var. */
async function vercelOidcToken(): Promise<string> {
  try {
    const { getVercelOidcToken } = await import("@vercel/oidc");
    return await getVercelOidcToken();
  } catch {
    const t = env("VERCEL_OIDC_TOKEN");
    if (!t) throw new Error("VERCEL_OIDC_TOKEN is not set (enable OIDC federation on the Vercel project)");
    return t;
  }
}

async function accessToken(audience: string): Promise<string> {
  if (token && token.exp - 300 > Date.now() / 1000) return token.value;
  const r = await fetch("https://sts.googleapis.com/v1/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience,
      scope: "https://www.googleapis.com/auth/devstorage.read_write",
      requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
      subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
      subjectToken: await vercelOidcToken(),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`GCS federation: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  token = { value: j.access_token, exp: Math.floor(Date.now() / 1000) + j.expires_in };
  return token.value;
}

function gcs(bucket: string, audience: string): Storage {
  const base = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o`;
  const upload = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o`;
  const auth = async () => ({ authorization: `Bearer ${await accessToken(audience)}` });
  return {
    async read(key) {
      const r = await fetch(`${base}/${encodeURIComponent(key)}?alt=media`, { headers: await auth(), cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`GCS read ${key}: HTTP ${r.status}`);
      return r.text();
    },
    async write(key, text, contentType = "application/json") {
      const q = new URLSearchParams({ uploadType: "media", name: key });
      const r = await fetch(`${upload}?${q}`, { method: "POST", headers: { ...(await auth()), "content-type": contentType }, body: text, signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`GCS write ${key}: HTTP ${r.status}`);
    },
  };
}

let chosen: Storage | null | undefined;

/** The bucket, or null when it isn't configured on this deployment. */
export function storage(): Storage | null {
  if (chosen !== undefined) return chosen;
  const bucket = env("GCS_BUCKET");
  const audience = env("GCS_WIF_AUDIENCE");
  chosen = bucket && audience ? gcs(bucket, audience) : null;
  return chosen;
}
