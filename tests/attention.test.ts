import { describe, it, expect } from "vitest";
import {
  NARROW_ATTENTION_KINDS,
  selectAttention,
  formatAttentionItem,
  type AttentionItem,
} from "../src/attention.js";

function item(id: string, sourceKind: string, title = "Question?"): AttentionItem {
  return {
    id,
    sourceKind,
    whyNow: "Confirmation requested on an issue thread.",
    subject: { title, identifier: "GERA-10", href: "/GERA/issues/GERA-10" },
  };
}

describe("selectAttention - first check", () => {
  it("reports a count instead of replaying every item already waiting", () => {
    const items = [
      item("a", "issue_thread_interaction"),
      item("b", "approval"),
      item("c", "agent_error_alert"),
    ];

    const result = selectAttention(items, NARROW_ATTENTION_KINDS, null);

    expect(result.firstRun).toBe(true);
    expect(result.fresh).toEqual([]);
    expect(result.backlogCount).toBe(3);
    expect(result.seenIds.sort()).toEqual(["a", "b", "c"]);
  });
});

describe("selectAttention - filtering", () => {
  it("keeps only the source kinds the operator asked for", () => {
    const items = [
      item("a", "issue_thread_interaction"),
      item("b", "blocker_attention"),
      item("c", "review"),
    ];

    const result = selectAttention(items, NARROW_ATTENTION_KINDS, []);

    expect(result.fresh.map((i) => i.id)).toEqual(["a"]);
    expect(result.seenIds).toEqual(["a"]);
  });
});

describe("selectAttention - deduplication", () => {
  it("does not report an item that was already reported", () => {
    const items = [item("a", "approval")];

    const result = selectAttention(items, NARROW_ATTENTION_KINDS, ["a"]);

    expect(result.fresh).toEqual([]);
  });

  it("reports an item that appeared since the last check", () => {
    const items = [item("a", "approval"), item("b", "issue_thread_interaction")];

    const result = selectAttention(items, NARROW_ATTENTION_KINDS, ["a"]);

    expect(result.fresh.map((i) => i.id)).toEqual(["b"]);
  });

  it("forgets items that left the feed so the tracked set cannot grow without bound", () => {
    const items = [item("b", "approval")];

    const result = selectAttention(items, NARROW_ATTENTION_KINDS, ["a", "b"]);

    expect(result.seenIds).toEqual(["b"]);
  });

  it("falls back to sourceKind and dedupKey when the feed omits an id", () => {
    const withoutId = { ...item("", "approval"), id: "", dedupKey: "dk-1" };

    const first = selectAttention([withoutId], NARROW_ATTENTION_KINDS, []);
    expect(first.fresh).toHaveLength(1);

    const second = selectAttention([withoutId], NARROW_ATTENTION_KINDS, first.seenIds);
    expect(second.fresh).toEqual([]);
  });
});

describe("formatAttentionItem", () => {
  it("leads with the question the agent actually asked", () => {
    const text = formatAttentionItem(item("a", "issue_thread_interaction", "Újraindíthatom a szervert?"));

    expect(text).toContain("Újraindíthatom a szervert?");
    // MarkdownV2 escapes the hyphen, so the identifier travels as GERA\-10.
    expect(text).toContain("GERA\\-10");
  });

  it("links to the item when a public base url is configured", () => {
    const text = formatAttentionItem(item("a", "approval"), "https://paperclip.example.com");

    expect(text).toContain("https://paperclip.example.com/GERA/issues/GERA-10");
  });

  it("omits the link on a loopback url that would not open on the reader's phone", () => {
    const text = formatAttentionItem(item("a", "approval"), "http://localhost:3333");

    expect(text).not.toContain("localhost:3333");
  });
});
