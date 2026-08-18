import { escapeMarkdownV2 } from "./telegram-api.js";

/**
 * The board's "waiting on a human" feed (GET /api/companies/:id/attention) —
 * the same source the Decisions page renders.
 *
 * The plugin cannot subscribe to this: the plugin event catalogue has no
 * interaction event, so an agent asking a question on an issue thread reaches
 * nobody. Polling the feed is the only way to see it.
 */

/**
 * "Someone is asking you, or something broke."
 *
 * Deliberately excludes blocker_attention, review, decision, join_request,
 * recovery_action and productivity_review: on a live board those are standing
 * state rather than news, and they bury the two kinds that actually need a
 * reply. They are visible on the Decisions page either way.
 */
export const NARROW_ATTENTION_KINDS = [
  "issue_thread_interaction",
  "approval",
  "agent_error_alert",
] as const;

export type AttentionItem = {
  id: string;
  dedupKey?: string;
  sourceKind: string;
  whyNow?: string;
  severity?: string;
  inlineResolvable?: boolean;
  subject?: {
    /** For an interaction this is the interaction id, not the issue id. */
    id?: string;
    title?: string;
    identifier?: string | null;
    href?: string | null;
    status?: string;
    metadata?: { kind?: string; issueId?: string } & Record<string, unknown>;
  };
  decisionVerbs?: Array<{ id: string; label: string; description?: string }>;
};

export type AttentionSelection = {
  /** Items to report now. Empty on the first check. */
  fresh: AttentionItem[];
  /** Keys to persist for the next check. */
  seenIds: string[];
  firstRun: boolean;
  /** How many items were already waiting when this ran for the first time. */
  backlogCount: number;
};

function itemKey(item: AttentionItem): string {
  if (item.id) return item.id;
  return `${item.sourceKind}:${item.dedupKey ?? ""}`;
}

/**
 * Decide what to report.
 *
 * `previouslySeen` is null on the very first check. A live board carries a
 * backlog of items that have been waiting for days — replaying all of them as
 * individual messages would be a wall of notifications about nothing new, so
 * the first check records them silently and reports a count instead.
 *
 * The persisted set is rebuilt from what is currently in the feed rather than
 * accumulated, so it stays bounded and resolved items drop out on their own.
 */
export function selectAttention(
  items: AttentionItem[],
  allowedKinds: readonly string[],
  previouslySeen: string[] | null,
): AttentionSelection {
  const allowed = new Set(allowedKinds);
  const relevant = items.filter((item) => allowed.has(item.sourceKind));
  const seenIds = relevant.map(itemKey);

  if (previouslySeen === null) {
    return { fresh: [], seenIds, firstRun: true, backlogCount: relevant.length };
  }

  const known = new Set(previouslySeen);
  return {
    fresh: relevant.filter((item) => !known.has(itemKey(item))),
    seenIds,
    firstRun: false,
    backlogCount: 0,
  };
}

/** A link is only worth sending if the reader's phone can actually open it. */
function isReachableUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const { hostname, protocol } = new URL(url);
    if (protocol !== "https:" && protocol !== "http:") return false;
    return !["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"].includes(hostname);
  } catch {
    return false;
  }
}

const KIND_LABELS: Record<string, string> = {
  issue_thread_interaction: "❓ Kérdés tőled",
  approval: "✅ Jóváhagyás kérés",
  agent_error_alert: "⚠️ Ügynök hibában",
};

export function formatAttentionItem(item: AttentionItem, publicUrl?: string): string {
  const heading = KIND_LABELS[item.sourceKind] ?? "📌 Döntés vár rád";
  const title = item.subject?.title?.trim() || item.whyNow?.trim() || "(nincs cím)";

  const lines = [`*${escapeMarkdownV2(heading)}*`, "", escapeMarkdownV2(title)];

  const identifier = item.subject?.identifier;
  const href = item.subject?.href;
  if (identifier) {
    const link = isReachableUrl(publicUrl) && href
      ? `[${escapeMarkdownV2(identifier)}](${publicUrl}${href})`
      : `\`${escapeMarkdownV2(identifier)}\``;
    lines.push("", link);
  }

  const verbs = item.decisionVerbs?.map((verb) => verb.label).filter(Boolean) ?? [];
  if (verbs.length > 0) {
    lines.push("", escapeMarkdownV2(`Lehetőségek: ${verbs.join(" · ")}`));
  }

  return lines.join("\n");
}


// --- Inline resolution ---
//
// Telegram caps callback_data at 64 bytes, which two UUIDs do not fit in. The
// buttons therefore carry a short token and the plugin stores the ids under it.

const CALLBACK_PREFIX = "atn";
const TOKEN_LENGTH = 12;

export type AttentionActionTarget = {
  issueId: string;
  interactionId: string;
};

export type AttentionAction = {
  token: string;
  target: AttentionActionTarget;
  buttons: Array<{ text: string; callback_data: string }>;
};

const VERB_CODES: Record<string, string> = { accept: "a", reject: "r" };
const CODE_VERBS: Record<string, string> = { a: "accept", r: "reject" };

/**
 * Build the inline buttons for an item the reader can resolve from Telegram.
 *
 * Only pending issue-thread interactions qualify: they are the ones the
 * attention feed marks inlineResolvable and that map onto the accept/reject
 * endpoints. Everything else is reported without buttons rather than with
 * buttons that would fail on click.
 */
export function buildAttentionAction(item: AttentionItem): AttentionAction | null {
  if (item.sourceKind !== "issue_thread_interaction") return null;
  if (item.inlineResolvable === false) return null;

  const interactionId = item.subject?.id;
  const issueId = item.subject?.metadata?.issueId;
  if (!interactionId || !issueId) return null;

  const verbs = (item.decisionVerbs ?? []).filter((verb) => VERB_CODES[verb.id]);
  if (verbs.length === 0) return null;

  const token = interactionId.replace(/-/g, "").slice(0, TOKEN_LENGTH);
  return {
    token,
    target: { issueId, interactionId },
    buttons: verbs.map((verb) => ({
      text: verb.label,
      callback_data: `${CALLBACK_PREFIX}_${VERB_CODES[verb.id]}_${token}`,
    })),
  };
}

export function parseAttentionCallback(
  data: string,
): { verb: string; token: string } | null {
  const parts = data.split("_");
  if (parts.length !== 3 || parts[0] !== CALLBACK_PREFIX) return null;
  const verb = CODE_VERBS[parts[1] ?? ""];
  if (!verb || !parts[2]) return null;
  return { verb, token: parts[2] };
}

export function attentionActionStateKey(token: string): string {
  return `attention_action_${token}`;
}

/**
 * Read the items out of an attention response.
 *
 * The endpoint returns an envelope — { companyId, totalCount, items, … } — not
 * a bare array. Treating an unrecognised shape as "no items" hides a broken
 * integration behind a quiet, plausible "nothing is waiting", so this throws
 * instead.
 */
export function parseAttentionFeed(payload: unknown): AttentionItem[] {
  if (Array.isArray(payload)) return payload as AttentionItem[];
  if (payload && typeof payload === "object") {
    const items = (payload as { items?: unknown }).items;
    if (Array.isArray(items)) return items as AttentionItem[];
  }
  throw new Error(
    "Unrecognised attention response: expected an array or an object with an items array",
  );
}
