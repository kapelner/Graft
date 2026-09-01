/**
 * The Rails routing DSL (`config/routes.rb`). Structurally different from
 * every other Ruby/Rails recognizer in this file: no enclosing class, and
 * the target (a controller#action) lives in a separate file entirely, so
 * every recognized route becomes a typed-member `calls` edge resolved the
 * same way `Klass.method` dispatch already is — no route-specific
 * resolution logic. See extract.ts's `walkRailsRoutes` doc comment for why
 * `namespace do...end` blocks are recursed into but deliberately don't
 * qualify the resolved controller name.
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
  const dir = mkdtempSync(join(tmpdir(), "graft-rails-routes-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  await buildGraph(dir);
  const graph = readGraph(wiringPath(join(dir, "graft")))!;
  return { dir, graph };
}

test("rails routes: get ... to: resolves to the controller#action", async () => {
  const routes = `
Rails.application.routes.draw do
  get "/health", to: "health#check"
end
`;
  const controller = `
class HealthController < ApplicationController
  def check; end
end
`;
  const { dir, graph } = await buildAndRead({ "routes.rb": routes, "health_controller.rb": controller });
  try {
    assert.ok(
      graph.edges.some(
        (e) =>
          e.relation === "calls" &&
          e.source === "routes.rb" &&
          e.target === "health_controller.rb#HealthController.check",
      ),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rails routes: root resolves the same way, bare-string form", async () => {
  const routes = `
Rails.application.routes.draw do
  root "home#index"
end
`;
  const controller = `
class HomeController < ApplicationController
  def index; end
end
`;
  const { dir, graph } = await buildAndRead({ "routes.rb": routes, "home_controller.rb": controller });
  try {
    assert.ok(
      graph.edges.some(
        (e) => e.relation === "calls" && e.source === "routes.rb" && e.target === "home_controller.rb#HomeController.index",
      ),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rails routes: resources emits one edge per conventional action", () => {
  const src = `
Rails.application.routes.draw do
  resources :posts
end
`;
  const { rawEdges } = extractFile("routes.rb", src, "ruby");
  const targets = rawEdges.filter((e) => e.relation === "calls").map((e) => `${e.recvType}#${e.name}`);
  for (const action of ["index", "create", "new", "edit", "show", "update", "destroy"]) {
    assert.ok(targets.includes(`PostsController#${action}`), action);
  }
});

test("rails routes: resources only: narrows to the given actions", () => {
  const src = `
Rails.application.routes.draw do
  resources :posts, only: [:index, :create]
end
`;
  const { rawEdges } = extractFile("routes.rb", src, "ruby");
  const targets = rawEdges.filter((e) => e.relation === "calls").map((e) => e.name);
  assert.deepEqual(targets.sort(), ["create", "index"]);
});

test("rails routes: resource (singular) has no index action", () => {
  const src = `
Rails.application.routes.draw do
  resource :profile
end
`;
  const { rawEdges } = extractFile("routes.rb", src, "ruby");
  const targets = rawEdges.filter((e) => e.relation === "calls").map((e) => e.name);
  assert.equal(targets.includes("index"), false);
  assert.ok(targets.includes("show"));
});

test("rails routes: namespace do...end reaches nested routes (bare controller name, not qualified)", () => {
  const src = `
Rails.application.routes.draw do
  namespace :admin do
    resources :users, only: [:index]
  end
end
`;
  const { rawEdges } = extractFile("routes.rb", src, "ruby");
  const call = rawEdges.find((e) => e.relation === "calls" && e.name === "index");
  assert.equal(call?.recvType, "UsersController");
});

test("rails routes: a route with an in-string namespace (admin/users#index) qualifies via ::", () => {
  const src = `
Rails.application.routes.draw do
  get "/admin/users", to: "admin/users#index"
end
`;
  const { rawEdges } = extractFile("routes.rb", src, "ruby");
  const call = rawEdges.find((e) => e.relation === "calls");
  assert.equal(call?.recvType, "Admin::UsersController");
  assert.equal(call?.name, "index");
});

test("rails routes: unrelated do-block calls outside .routes.draw are untouched", () => {
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
