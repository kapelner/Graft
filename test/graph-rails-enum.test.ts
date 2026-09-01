/**
 * enum, has_secure_password, and accepts_nested_attributes_for — three
 * small, additive Rails macro recognizers, all reusing the existing
 * rubySynthesizedMethods/emitRubySynthesizedMethod machinery, same shape as
 * every other Rails macro in this file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFile } from "../src/graph/extract.js";

test("rails enum: hash form synthesizes predicate/bang/scope per value", () => {
  const src = `
class Post < ApplicationRecord
  enum status: { active: 0, archived: 1 }
end
`;
  const { nodes } = extractFile("post.rb", src, "ruby");
  for (const v of ["active", "archived"]) {
    for (const suffix of ["?", "!", ""]) {
      const n = nodes.find((x) => x.name === `${v}${suffix}`);
      assert.equal(n?.kind, "method", `${v}${suffix} synthesized`);
      assert.equal(n?.owner, "Post");
    }
  }
});

test("rails enum: Rails 7+ positional form (:status, { ... })", () => {
  const src = `
class Post < ApplicationRecord
  enum :visibility, { public: 0, private: 1 }
end
`;
  const { nodes } = extractFile("post.rb", src, "ruby");
  assert.ok(nodes.find((n) => n.name === "public?"));
  assert.ok(nodes.find((n) => n.name === "private!"));
});

test("rails enum: array form (implicit indices)", () => {
  const src = `
class Post < ApplicationRecord
  enum kind: [:blog, :news]
end
`;
  const { nodes } = extractFile("post.rb", src, "ruby");
  assert.ok(nodes.find((n) => n.name === "blog?"));
  assert.ok(nodes.find((n) => n.name === "news"));
});

test("rails has_secure_password: bare form (default :password attribute) synthesizes the expected methods", () => {
  const src = `
class User < ApplicationRecord
  has_secure_password
end
`;
  const { nodes } = extractFile("user.rb", src, "ruby");
  for (const name of ["password=", "password_confirmation=", "authenticate_password", "authenticate"]) {
    assert.equal(nodes.find((n) => n.name === name)?.kind, "method", name);
  }
});

test("rails has_secure_password: explicit attribute -- no legacy authenticate alias", () => {
  const src = `
class User < ApplicationRecord
  has_secure_password :recovery_password, validations: false
end
`;
  const { nodes } = extractFile("user.rb", src, "ruby");
  assert.ok(nodes.find((n) => n.name === "recovery_password="));
  assert.ok(nodes.find((n) => n.name === "authenticate_recovery_password"));
  assert.equal(nodes.find((n) => n.name === "authenticate"), undefined);
});

test("rails accepts_nested_attributes_for: one writer per symbol", () => {
  const src = `
class Post < ApplicationRecord
  accepts_nested_attributes_for :comments, :tags
end
`;
  const { nodes } = extractFile("post.rb", src, "ruby");
  assert.ok(nodes.find((n) => n.name === "comments_attributes="));
  assert.ok(nodes.find((n) => n.name === "tags_attributes="));
});
