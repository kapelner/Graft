/**
 * ActiveSupport::Concern's `included do ... end` / `class_methods do ... end`
 * blocks. Confirmed directly against tree-sitter-ruby (not assumed): both are
 * a no-argument-list `call` whose block is a `do_block` wrapping an ordinary
 * `body_statement` — the same statement-container shape every other class/
 * module body already uses. That means content nested inside either block
 * (macros, defs) reaches the walk with `ctx.enclosingClass` unchanged (still
 * the concern module), so it attributes correctly with NO code beyond plain
 * recursive descent — verified here, not assumed. The one real gap: `included`/
 * `class_methods` are themselves ordinary call shapes that would otherwise
 * fall through to a spurious `calls` edge — plausible, not just theoretical,
 * since `def self.included(base)` is itself a common Ruby hook method name a
 * real codebase might define elsewhere.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFile } from "../src/graph/extract.js";

const CONCERN_RB = `
module Trackable
  extend ActiveSupport::Concern

  included do
    before_save :set_tracked_at
    scope :tracked, -> { where(tracked: true) }

    def set_tracked_at; end
  end

  class_methods do
    def find_recent
      1
    end
  end

  def instance_helper
    2
  end
end
`;

test("rails concern: defs inside included do...end attribute to the concern module", () => {
  const { nodes } = extractFile("trackable.rb", CONCERN_RB, "ruby");
  const setTrackedAt = nodes.find((n) => n.name === "set_tracked_at");
  assert.equal(setTrackedAt?.kind, "method");
  assert.equal(setTrackedAt?.owner, "Trackable");
});

test("rails concern: Rails macros inside included do...end are still recognized (scope, callback)", () => {
  const { nodes, rawEdges } = extractFile("trackable.rb", CONCERN_RB, "ruby");
  const tracked = nodes.find((n) => n.name === "tracked");
  assert.equal(tracked?.kind, "method");
  assert.equal(tracked?.owner, "Trackable");
  const module_ = nodes.find((n) => n.name === "Trackable");
  assert.ok(
    rawEdges.some((e) => e.relation === "calls" && e.source === module_?.id && e.name === "set_tracked_at"),
    "before_save's calls edge still fires from inside included do",
  );
});

test("rails concern: defs inside class_methods do...end attribute to the concern module", () => {
  const { nodes } = extractFile("trackable.rb", CONCERN_RB, "ruby");
  const findRecent = nodes.find((n) => n.name === "find_recent");
  assert.equal(findRecent?.kind, "method");
  assert.equal(findRecent?.owner, "Trackable");
});

test("rails concern: included/class_methods themselves do not emit a spurious calls edge", () => {
  const { nodes, rawEdges } = extractFile("trackable.rb", CONCERN_RB, "ruby");
  const module_ = nodes.find((n) => n.name === "Trackable");
  assert.equal(
    rawEdges.some(
      (e) => e.relation === "calls" && e.source === module_?.id && (e.name === "included" || e.name === "class_methods"),
    ),
    false,
  );
});

test("rails concern: a plain do-block call unrelated to Concern is untouched", () => {
  const src = `
class Widget
  transaction do
    persist
  end
end
`;
  const { rawEdges } = extractFile("widget.rb", src, "ruby");
  assert.ok(rawEdges.some((e) => e.relation === "calls" && e.name === "transaction"));
});
