/**
 * store_accessor/store, has_one_attached/has_many_attached, and
 * has_secure_token — the final batch from checking rails/rails directly for
 * exact method-generation behavior.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFile } from "../src/graph/extract.js";

test("rails store_accessor: one reader/writer per key, skipping the store attribute itself", () => {
  const src = `
class Post < ApplicationRecord
  store_accessor :settings, :color, :size
end
`;
  const { nodes } = extractFile("post.rb", src, "ruby");
  for (const name of ["color", "color=", "size", "size="]) {
    assert.equal(nodes.find((n) => n.name === name)?.kind, "method", name);
  }
  assert.equal(nodes.find((n) => n.name === "settings"), undefined, "the store attribute itself is not an accessor key");
});

test("rails store_accessor: prefix: true uses the store attribute's own name", () => {
  const src = `
class Post < ApplicationRecord
  store_accessor :settings, :color, prefix: true
end
`;
  const { nodes } = extractFile("post.rb", src, "ruby");
  assert.ok(nodes.find((n) => n.name === "settings_color"));
  assert.ok(nodes.find((n) => n.name === "settings_color="));
});

test("rails store_accessor: prefix: :sym and suffix: true combine correctly", () => {
  const src = `
class Post < ApplicationRecord
  store_accessor :settings, :color, prefix: :ui, suffix: true
end
`;
  const { nodes } = extractFile("post.rb", src, "ruby");
  assert.ok(nodes.find((n) => n.name === "ui_color_settings"));
});

test("rails store: accessors: [...] generates the same reader/writer pairs as store_accessor", () => {
  const src = `
class Post < ApplicationRecord
  store :settings, accessors: [:color, :size]
end
`;
  const { nodes } = extractFile("post.rb", src, "ruby");
  assert.ok(nodes.find((n) => n.name === "color"));
  assert.ok(nodes.find((n) => n.name === "size="));
});

test("rails store: with no accessors: option generates nothing (just serializes the column)", () => {
  const src = `
class Post < ApplicationRecord
  store :settings
end
`;
  const { rawEdges } = extractFile("post.rb", src, "ruby");
  assert.equal(rawEdges.filter((e) => e.relation === "contains").length, 1); // just the class itself
});

test("rails has_one_attached/has_many_attached: reader/writer pair each", () => {
  const src = `
class Post < ApplicationRecord
  has_one_attached :avatar
  has_many_attached :photos, dependent: :purge_later
end
`;
  const { nodes } = extractFile("post.rb", src, "ruby");
  for (const name of ["avatar", "avatar=", "photos", "photos="]) {
    assert.equal(nodes.find((n) => n.name === name)?.kind, "method", name);
  }
});

test("rails has_secure_token: bare form (default :token attribute)", () => {
  const src = `
class Post < ApplicationRecord
  has_secure_token
end
`;
  const { nodes } = extractFile("post.rb", src, "ruby");
  assert.equal(nodes.find((n) => n.name === "regenerate_token")?.kind, "method");
});

test("rails has_secure_token: explicit attribute", () => {
  const src = `
class Post < ApplicationRecord
  has_secure_token :auth_token
end
`;
  const { nodes } = extractFile("post.rb", src, "ruby");
  assert.equal(nodes.find((n) => n.name === "regenerate_auth_token")?.kind, "method");
  assert.equal(nodes.find((n) => n.name === "regenerate_token"), undefined);
});
