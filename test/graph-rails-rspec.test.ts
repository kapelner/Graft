/**
 * RSpec's test DSL. Structurally the biggest addition of the Rails/Ruby
 * work: `describe`/`context` blocks aren't inside any real Ruby class, so
 * `describeRspec` (in extract.ts's `describeRuby` dispatch) recognizes them
 * as `kind: "class"` definitions in their own right — the closest existing
 * fit, letting every downstream mechanism (childCtx's enclosingClass,
 * contains edges, mintId dedup, heritageEdges/rubyPostHocVisibility's
 * graceful no-ops on a `call` node's missing fields) work for free exactly
 * as it already does for a real class. `it`/`specify` are `kind: "method"`,
 * slugified from their string description. `let`/`let!`/`subject` reuse the
 * existing synthesized-method machinery. `before`/`after`/`around` are
 * suppressed (no name to reference), same pattern as Concern's hooks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFile } from "../src/graph/extract.js";

test("rspec: RSpec.describe Post recognizes the constant name", () => {
  const src = `
RSpec.describe Post, type: :model do
  it "is valid" do
    expect(true).to eq(true)
  end
end
`;
  const { nodes } = extractFile("post_spec.rb", src, "ruby");
  const group = nodes.find((n) => n.name === "Post");
  assert.equal(group?.kind, "class");
  const example = nodes.find((n) => n.name === "is_valid");
  assert.equal(example?.kind, "method");
  assert.equal(example?.owner, "Post");
});

test("rspec: nested describe/context slugify a string description", () => {
  const src = `
RSpec.describe Post do
  describe "#publish" do
    context "when published" do
      it "sets published_at" do
        1
      end
    end
  end
end
`;
  const { nodes } = extractFile("post_spec.rb", src, "ruby");
  const publish = nodes.find((n) => n.name === "publish");
  assert.equal(publish?.kind, "class");
  assert.equal(publish?.owner, undefined); // groups aren't methods, no owner field
  const whenPublished = nodes.find((n) => n.name === "when_published");
  assert.equal(whenPublished?.kind, "class");
  const example = nodes.find((n) => n.name === "sets_published_at");
  assert.equal(example?.kind, "method");
  assert.equal(example?.owner, "when_published");
});

test("rspec: it with no block (a pending example) still gets a node", () => {
  const src = `
RSpec.describe Post do
  it "is pending"
end
`;
  const { nodes } = extractFile("post_spec.rb", src, "ruby");
  assert.equal(nodes.find((n) => n.name === "is_pending")?.kind, "method");
});

test("rspec: let/let!/subject synthesize methods, block body walked so nested calls resolve", () => {
  const src = `
RSpec.describe Post do
  let(:post) { helper }
  let!(:eager) { 1 }
  subject { 2 }
  subject(:result) { 3 }

  def helper; end
end
`;
  const { nodes, rawEdges } = extractFile("post_spec.rb", src, "ruby");
  for (const name of ["post", "eager", "subject", "result"]) {
    const n = nodes.find((x) => x.name === name);
    assert.equal(n?.kind, "method", `${name} synthesized as a method`);
    assert.equal(n?.owner, "Post", `${name} owned by the describe group`);
  }
  const post = nodes.find((n) => n.name === "post");
  assert.ok(rawEdges.some((e) => e.relation === "calls" && e.source === post?.id && e.name === "helper"));
});

test("rspec: before/after/around hooks emit no spurious calls edge, but their body still resolves", () => {
  const src = `
RSpec.describe Post do
  before do
    helper
  end

  after(:each) do
    helper
  end

  def helper; end
end
`;
  const { nodes, rawEdges } = extractFile("post_spec.rb", src, "ruby");
  const group = nodes.find((n) => n.name === "Post");
  assert.equal(rawEdges.some((e) => e.relation === "calls" && (e.name === "before" || e.name === "after")), false);
  const helperCalls = rawEdges.filter((e) => e.relation === "calls" && e.name === "helper" && e.source === group?.id);
  assert.equal(helperCalls.length, 2, "both before and after bodies still resolve their bare call to helper");
});

test("rspec: describe with a receiver other than RSpec is not mistaken for the DSL", () => {
  const src = `
class Foo
  def self.describe(x)
    x
  end
end

Foo.describe("bar")
`;
  const { nodes, rawEdges } = extractFile("foo.rb", src, "ruby");
  assert.equal(nodes.find((n) => n.name === "bar"), undefined);
  assert.ok(rawEdges.some((e) => e.relation === "calls" && e.name === "describe"));
});

test("rspec: a plain describe/context/it at the file top level (no RSpec, unrelated gem) still requires an enclosing group for it", () => {
  // A bare top-level `it "x" do end` with no enclosing describe/context has
  // no ctx.enclosingClass to own it under -- deliberately unrecognized,
  // consistent with every other Ruby definition needing a real scope.
  const src = `
it "orphaned" do
  1
end
`;
  const { nodes } = extractFile("orphan_spec.rb", src, "ruby");
  assert.equal(nodes.find((n) => n.name === "orphaned"), undefined);
});
