/**
 * attribute, encrypts, helper_method, and delegated_type -- four more
 * Rails macro recognizers, found by checking the actual rails/rails source
 * (not guessed) for the exact methods each macro internally calls.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractFile } from "../src/graph/extract.js";
import { buildGraph } from "../src/graph/build.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import type { GraphV1 } from "../src/graph/types.js";

async function buildAndRead(files: Record<string, string>): Promise<{ dir: string; graph: GraphV1 }> {
  const dir = mkdtempSync(join(tmpdir(), "graft-rails-attribute-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  await buildGraph(dir);
  const graph = readGraph(wiringPath(join(dir, "graft")))!;
  return { dir, graph };
}

test("rails attribute: :title, :string synthesizes a reader/writer for the FIRST symbol only", () => {
  const src = `
class Post < ApplicationRecord
  attribute :title, :string
  attribute :views, :integer, default: 0
end
`;
  const { nodes } = extractFile("post.rb", src, "ruby");
  assert.equal(nodes.find((n) => n.name === "title")?.kind, "method");
  assert.equal(nodes.find((n) => n.name === "title=")?.kind, "method");
  assert.equal(nodes.find((n) => n.name === "views")?.kind, "method");
  assert.equal(nodes.find((n) => n.name === "views=")?.kind, "method");
  // the type symbol (:string/:integer) must never itself become a node
  assert.equal(nodes.find((n) => n.name === "string"), undefined);
  assert.equal(nodes.find((n) => n.name === "integer"), undefined);
});

test("rails encrypts: every symbol argument is its own attribute", () => {
  const src = `
class User < ApplicationRecord
  encrypts :name, :email, deterministic: true
end
`;
  const { nodes } = extractFile("user.rb", src, "ruby");
  for (const name of ["name", "name=", "email", "email="]) {
    assert.equal(nodes.find((n) => n.name === name)?.kind, "method", name);
  }
});

test("rails helper_method: emits calls edges to already-existing controller methods, no new node", async () => {
  const src = `
class ApplicationController < ActionController::Base
  helper_method :current_user

  def current_user; end
end
`;
  const { dir, graph } = await buildAndRead({ "application_controller.rb": src });
  try {
    assert.equal(
      graph.nodes.filter((n) => n.name === "current_user").length,
      1,
      "helper_method must not synthesize a second node for an already-existing method",
    );
    assert.ok(
      graph.edges.some(
        (e) =>
          e.relation === "calls" &&
          e.source === "application_controller.rb#ApplicationController" &&
          e.target === "application_controller.rb#ApplicationController.current_user",
      ),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rails delegated_type: synthesizes the association pair, class/types helpers, and one predicate per %w[] type", () => {
  const src = `
class Entry < ApplicationRecord
  delegated_type :entryable, types: %w[ Message Comment ]
end
`;
  const { nodes } = extractFile("entry.rb", src, "ruby");
  for (const name of ["entryable", "entryable=", "entryable_class", "entryable_types", "message?", "comment?"]) {
    assert.equal(nodes.find((n) => n.name === name)?.kind, "method", name);
  }
});

test("rails delegated_type: also recognizes a double-quoted array form", () => {
  const src = `
class Entry < ApplicationRecord
  delegated_type :entryable, types: ["Message", "Comment"]
end
`;
  const { nodes } = extractFile("entry.rb", src, "ruby");
  assert.ok(nodes.find((n) => n.name === "message?"));
  assert.ok(nodes.find((n) => n.name === "comment?"));
});

test("rails delegated_type: a multi-word type name underscores correctly (BlogPost -> blog_post?)", () => {
  const src = `
class Entry < ApplicationRecord
  delegated_type :entryable, types: %w[ BlogPost ]
end
`;
  const { nodes } = extractFile("entry.rb", src, "ruby");
  assert.ok(nodes.find((n) => n.name === "blog_post?"));
});
