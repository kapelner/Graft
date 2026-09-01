/**
 * Rails macro recognition, layered on top of Ruby's Phase 4/5 machinery
 * (mixin edges / synthesized methods): ActiveRecord associations, scopes,
 * AR + ActionController callbacks (+ rescue_from), delegate, and a
 * suppression-only pass for validations and the thin ActiveJob macros.
 * See each recognizer's own doc comment in extract.ts for the grammar
 * shapes and modeling decisions.
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
  const dir = mkdtempSync(join(tmpdir(), "graft-rails-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  await buildGraph(dir);
  const graph = readGraph(wiringPath(join(dir, "graft")))!;
  return { dir, graph };
}

test("rails: belongs_to synthesizes a reader and a writer", () => {
  const src = `
class Post < ApplicationRecord
  belongs_to :user
end
`;
  const { nodes } = extractFile("post.rb", src, "ruby");
  assert.equal(nodes.find((n) => n.name === "user")?.kind, "method");
  assert.equal(nodes.find((n) => n.name === "user")?.owner, "Post");
  assert.equal(nodes.find((n) => n.name === "user=")?.kind, "method");
});

test("rails: has_many/has_one/has_and_belongs_to_many all synthesize a reader+writer", () => {
  const src = `
class Post < ApplicationRecord
  has_many :comments
  has_one :thumbnail
  has_and_belongs_to_many :tags
end
`;
  const { nodes } = extractFile("post.rb", src, "ruby");
  for (const n of ["comments", "thumbnail", "tags"]) {
    assert.ok(nodes.find((x) => x.name === n), `${n} reader`);
    assert.ok(nodes.find((x) => x.name === `${n}=`), `${n}= writer`);
  }
});

test("rails: belongs_to with class_name: resolves to a references edge", async () => {
  const src = `
class Post < ApplicationRecord
  belongs_to :category, class_name: "Topic"
end

class Topic < ApplicationRecord
end
`;
  const { dir, graph } = await buildAndRead({ "models.rb": src });
  try {
    assert.ok(
      graph.edges.some(
        (e) => e.relation === "references" && e.source === "models.rb#Post" && e.target === "models.rb#Topic",
      ),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rails: belongs_to without class_name: emits no references edge (no guessing)", () => {
  const src = `
class Post < ApplicationRecord
  belongs_to :user
end
`;
  const { rawEdges } = extractFile("post.rb", src, "ruby");
  assert.equal(rawEdges.some((e) => e.relation === "references"), false);
});

test("rails: scope synthesizes a method, -> { } form, block body walked", async () => {
  const src = `
class Post < ApplicationRecord
  scope :published, -> { helper() }

  def self.helper
    1
  end
end
`;
  const { dir, graph } = await buildAndRead({ "post.rb": src });
  try {
    const published = graph.nodes.find((n) => n.name === "published");
    assert.equal(published?.kind, "method");
    assert.equal(published?.owner, "Post");
    assert.ok(
      graph.edges.some(
        (e) => e.relation === "calls" && e.source === published?.id && e.target === "post.rb#Post.helper",
      ),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rails: scope recognizes the lambda { } form too", () => {
  const src = `
class Post < ApplicationRecord
  scope :recent, lambda { order(created_at: :desc) }
end
`;
  const { nodes } = extractFile("post.rb", src, "ruby");
  assert.equal(nodes.find((n) => n.name === "recent")?.kind, "method");
});

test("rails: before_save/after_create emit calls edges from the class to each named method", async () => {
  const src = `
class Post < ApplicationRecord
  before_save :set_slug
  after_create :notify, :log

  def set_slug; end
  def notify; end
  def log; end
end
`;
  const { dir, graph } = await buildAndRead({ "post.rb": src });
  try {
    for (const target of ["set_slug", "notify", "log"]) {
      assert.ok(
        graph.edges.some(
          (e) => e.relation === "calls" && e.source === "post.rb#Post" && e.target === `post.rb#Post.${target}`,
        ),
        `calls edge to ${target}`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rails: before_action (ActionController) uses the same callback recognizer", async () => {
  const src = `
class PostsController < ApplicationController
  before_action :authenticate!

  def authenticate!; end
end
`;
  const { dir, graph } = await buildAndRead({ "posts_controller.rb": src });
  try {
    assert.ok(
      graph.edges.some(
        (e) =>
          e.relation === "calls" &&
          e.source === "posts_controller.rb#PostsController" &&
          e.target === "posts_controller.rb#PostsController.authenticate!",
      ),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rails: rescue_from Klass, with: :handler emits a calls edge to the handler", async () => {
  const src = `
class PostsController < ApplicationController
  rescue_from StandardError, with: :handle_error

  def handle_error; end
end
`;
  const { dir, graph } = await buildAndRead({ "posts_controller.rb": src });
  try {
    assert.ok(
      graph.edges.some(
        (e) =>
          e.relation === "calls" &&
          e.source === "posts_controller.rb#PostsController" &&
          e.target === "posts_controller.rb#PostsController.handle_error",
      ),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rails: delegate synthesizes one reader per symbol", () => {
  const src = `
class Post < ApplicationRecord
  delegate :name, :email, to: :user
end
`;
  const { nodes } = extractFile("post.rb", src, "ruby");
  assert.equal(nodes.find((n) => n.name === "name")?.kind, "method");
  assert.equal(nodes.find((n) => n.name === "email")?.kind, "method");
});

test("rails: delegate with prefix: true prepends the to: target's name", () => {
  const src = `
class Post < ApplicationRecord
  delegate :name, to: :user, prefix: true
end
`;
  const { nodes } = extractFile("post.rb", src, "ruby");
  assert.ok(nodes.find((n) => n.name === "user_name"), "user_name synthesized");
  assert.equal(nodes.find((n) => n.name === "name"), undefined, "bare name NOT also synthesized");
});

test("rails: delegate with prefix: :custom uses the custom prefix", () => {
  const src = `
class Post < ApplicationRecord
  delegate :name, to: :user, prefix: :author
end
`;
  const { nodes } = extractFile("post.rb", src, "ruby");
  assert.ok(nodes.find((n) => n.name === "author_name"), "author_name synthesized");
});

test("rails: validates/validates_presence_of are suppressed, not turned into calls edges", () => {
  const src = `
class Post < ApplicationRecord
  validates :title, presence: true
  validates_presence_of :body
end
`;
  const { nodes, rawEdges } = extractFile("post.rb", src, "ruby");
  assert.equal(nodes.find((n) => n.name === "title" || n.name === "body"), undefined);
  assert.equal(rawEdges.some((e) => e.relation === "calls" && (e.name === "validates" || e.name === "validates_presence_of")), false);
});

test("rails: queue_as/retry_on/discard_on are suppressed, not turned into calls edges", () => {
  const src = `
class SlowJob < ApplicationJob
  queue_as :default
  retry_on Timeout::Error
  discard_on ActiveJob::DeserializationError
end
`;
  const { rawEdges } = extractFile("slow_job.rb", src, "ruby");
  assert.equal(
    rawEdges.some((e) => e.relation === "calls" && ["queue_as", "retry_on", "discard_on"].includes(e.name ?? "")),
    false,
  );
});
