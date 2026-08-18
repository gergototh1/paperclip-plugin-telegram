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
    title?: string;
    identifier?: string | null;
    href?: string | null;
    status?: string;
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
