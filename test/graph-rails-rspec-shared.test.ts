/**
 * shared_examples/shared_examples_for/shared_context and their invocation
 * forms (it_behaves_like/it_should_behave_like/include_examples/
 * include_context) — closes the gap flagged after the initial RSpec pass.
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
  const dir = mkdtempSync(join(tmpdir(), "graft-rspec-shared-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  await buildGraph(dir);
  const graph = readGraph(wiringPath(join(dir, "graft")))!;
  return { dir, graph };
}

test("rspec shared: shared_examples/shared_examples_for/shared_context are recognized as groups", () => {
  const src = `
RSpec.shared_examples "a valid model" do
  it "is valid" do
    1
  end
end

RSpec.shared_context "with a user" do
  let(:user) { 1 }
end
`;
  const { nodes } = extractFile("shared.rb", src, "ruby");
  const group1 = nodes.find((n) => n.name === "a_valid_model");
  assert.equal(group1?.kind, "class");
  const example = nodes.find((n) => n.name === "is_valid");
  assert.equal(example?.owner, "a_valid_model");
  const group2 = nodes.find((n) => n.name === "with_a_user");
  assert.equal(group2?.kind, "class");
  const user = nodes.find((n) => n.name === "user");
  assert.equal(user?.owner, "with_a_user");
});

test("rspec shared: it_behaves_like resolves a references edge to the shared_examples group, even across files", async () => {
  const shared = `
RSpec.shared_examples "a valid model" do
  it "is valid" do
    1
  end
end
`;
  const spec = `
RSpec.describe Post do
  it_behaves_like "a valid model"
end
`;
  const { dir, graph } = await buildAndRead({ "model_examples.rb": shared, "post_spec.rb": spec });
  try {
    const group = graph.nodes.find((n) => n.name === "a_valid_model");
    assert.ok(group, "shared group extracted");
    assert.ok(
      graph.edges.some(
        (e) => e.relation === "references" && e.source === "post_spec.rb#Post" && e.target === group?.id,
      ),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rspec shared: it_should_behave_like/include_examples/include_context all resolve the same way", () => {
  const src = `
RSpec.shared_examples "a valid model" do
end

RSpec.shared_context "with a user" do
end

RSpec.describe Post do
  it_should_behave_like "a valid model"
  include_examples "a valid model"
  include_context "with a user"
end
`;
  const { rawEdges } = extractFile("post_spec.rb", src, "ruby");
  const targets = rawEdges.filter((e) => e.relation === "references").map((e) => e.name);
  assert.deepEqual(targets.sort(), ["a_valid_model", "a_valid_model", "with_a_user"].sort());
});

test("rspec shared: a block passed to it_behaves_like still walks its content under the current group", () => {
  const src = `
RSpec.shared_examples "a valid model" do
end

RSpec.describe Post do
  it_behaves_like "a valid model" do
    let(:user) { 1 }
  end
end
`;
  const { nodes } = extractFile("post_spec.rb", src, "ruby");
  const user = nodes.find((n) => n.name === "user");
  assert.equal(user?.kind, "method");
  assert.equal(user?.owner, "Post");
});
