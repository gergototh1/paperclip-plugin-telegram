export type SecretRefConfig = {
  telegramBotTokenRef?: unknown;
  paperclipBoardApiTokenRef?: unknown;
  transcriptionApiKeyRef?: unknown;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FIELDS = [
  { key: "telegramBotTokenRef", required: true },
  { key: "paperclipBoardApiTokenRef", required: false },
  { key: "transcriptionApiKeyRef", required: false },
] as const;

// LOCAL PATCH (Marveen): paperclipai >= 2026.722 stores and resolves plugin
// secret refs as { type: "secret_ref", secretId } objects -- the config save is
// what creates the companySecretBindings row the host requires at resolve time,
// and it only creates one for the object shape. `secrets.resolve` rejects a bare
// UUID string outright ("Use { type: \"secret_ref\", secretId, version? }").
// Upstream only knows the legacy UUID string, so accept both here and normalize
// to the object form at every resolve call site.
export type PluginSecretRef = {
  type: "secret_ref";
  // Matches the host's SecretVersionSelector: "latest" or a positive integer.
  version?: "latest" | number;
  secretId: string;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Normalize a configured secret ref (UUID string or object) to the object form. */
export function toSecretRefPayload(value: unknown): PluginSecretRef | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return UUID_RE.test(trimmed) ? { type: "secret_ref", secretId: trimmed } : undefined;
  }
  if (isPlainRecord(value) && value.type === "secret_ref" && typeof value.secretId === "string") {
    const secretId = value.secretId.trim();
    if (!UUID_RE.test(secretId)) return undefined;
    const rawVersion = value.version;
    if (rawVersion === "latest") return { type: "secret_ref", secretId, version: "latest" };
    if (typeof rawVersion === "number" && Number.isInteger(rawVersion) && rawVersion > 0) {
      return { type: "secret_ref", secretId, version: rawVersion };
    }
    return { type: "secret_ref", secretId };
  }
  return undefined;
}

export function isValidSecretRef(value: unknown): boolean {
  return toSecretRefPayload(value) !== undefined;
}

function describeBadValue(value: unknown): string {
  if (value === undefined || value === null) return "<empty>";
  if (typeof value !== "string") return `<${typeof value}>`;
  const trimmed = value.trim();
  if (trimmed.length === 0) return "<empty string>";
  // Truncate to avoid leaking long pasted secrets into error logs.
  const sample = trimmed.length > 16 ? `${trimmed.slice(0, 12)}…` : trimmed;
  return `"${sample}"`;
}

function fieldError(key: string, value: unknown): string {
  return [
    `${key} must be the UUID of a Paperclip secret`,
    `(format 8-4-4-4-12, e.g. "12f7ed4a-1234-4d0c-9abc-bd58d44d15e1"),`,
    `or the object form { "type": "secret_ref", "secretId": "<uuid>" }.`,
    `Got ${describeBadValue(value)}.`,
    `Create the secret first via POST /api/companies/{id}/secrets and paste the returned "id" value here —`,
    `not the raw token, the whole JSON response, or any other identifier.`,
  ].join(" ");
}

export function validateSecretRefFields(config: SecretRefConfig): string[] {
  const errors: string[] = [];
  for (const { key, required } of FIELDS) {
    const value = config[key];
    const isMissing =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim().length === 0);

    if (isMissing) {
      if (required) errors.push(`${key} is required.`);
      continue;
    }

    if (!isValidSecretRef(value)) {
      errors.push(fieldError(key, value));
    }
  }
  return errors;
}
