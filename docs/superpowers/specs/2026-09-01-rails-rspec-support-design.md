# Rails and RSpec macro support — design

Status: implemented (retrospective — this branch was designed and built
incrementally, in-chat, one macro family at a time; this document records
the resulting design for reference, matching the pattern
`2026-08-31-ruby-support-design.md` set for the plain-Ruby work this
extends)
Date: 2026-09-01
Precedent: `feat/rails-support` (branched off `feat/ruby-support`)

## Goal

Recognize the Rails and RSpec macro vocabulary layered on top of graft's
plain-Ruby extraction (`feat/ruby-support`), so a Rails codebase's
associations, callbacks, routes, and specs show up in the graph the same
way an ordinary `def` does — without requiring any new pipeline stage,
schema field, or `Kind`/`Relation` variant.

## Non-goals

Unchanged from the plain-Ruby design's own non-goals (no deep
metaprogramming, no receiver-type binding table), plus, specific to this
extension:

- **No singularization/pluralization guessing.** `has_many :categories`
  does not infer a `Category` class name — only an explicit `class_name:`/
  `controller:` option, or a naming convention Rails itself guarantees is
  reversible (`resources :posts` → `PostsController`, a deterministic
  camelization with no plural/singular ambiguity), ever produces a
  cross-symbol edge from a bare macro argument.
- **No routing DSL edge cases**: hash-rocket routes (`get "/x" => "y#z"`),
  `constraints`/`concern` blocks, `scope module:` (only `namespace do` is
  read), and nested `resources` inside a `resources do...end` block (a
  different controller entirely) are unrecognized, not guessed at.
- **No `ActiveSupport::Concern`-style splicing for arbitrary modules** —
  only `included do`/`class_methods do`'s OWN hook-call noise is
  suppressed; nothing about a plain `include SomeModule` changes.
- **No third-party gem DSLs** (Devise, Sidekiq, GraphQL-Ruby, ViewComponent,
  ActionCable/Turbo) — Rails/ActiveSupport/ActiveRecord/ActionController/
  ActiveStorage core and RSpec only.
- **`delegated_type`'s override options** (`primary_key:`, `foreign_type:`,
  `foreign_key:`) are read for recursion purposes only where needed; the
  synthesized method NAMES always follow Rails' default convention, not a
  custom override.
- **`belongs_to`/`has_many ... do ... end`** (the association-extension
  block form) is unrecognized — any methods defined inside are silently
  skipped, not attributed anywhere.

## Architecture

Every recognizer is a small, independently-testable function in
`src/graph/extract.ts`, colocated with the plain-Ruby helpers, following
one of three existing shapes (no new mechanism was introduced beyond what
Ruby Phase 4/5 already established):

1. **Node synthesis** (`RubySynthesizedMethod[]` → `emitRubySynthesizedMethod`)
   — for macros that generate real callable methods: associations, `scope`,
   `delegate`, `enum`, `has_secure_password`/`has_secure_token`,
   `accepts_nested_attributes_for`, `attribute`, `encrypts`, `delegated_type`,
   `store`/`store_accessor`, `has_one_attached`/`has_many_attached`.
2. **Edge-only interception** (no node, a `RawEdge` pushed directly) — for
   macros that reference an ALREADY-EXISTING method rather than generating
   one: AR/ActionController callbacks, `rescue_from`, `helper_method`,
   `it_behaves_like`/`include_examples`/etc.
3. **Suppression, with or without early return** — for macros with no
   useful node/edge representation (`validates`, `queue_as`/`retry_on`/
   `discard_on`) or whose block content still needs the ordinary trailing
   recursion to reach it (`ActiveSupport::Concern`'s `included`/
   `class_methods`, RSpec's `before`/`after`/`around`).

One genuinely new mechanism was added beyond these three shapes:
**`describeRspec`**, a `call`-node branch in `describeRuby()`'s definition
dispatch. RSpec's `describe`/`context`/`shared_examples`/`shared_context`
blocks aren't inside any real Ruby class — recognizing them as
`kind: "class"` definitions (the closest existing fit) lets every
downstream mechanism (childCtx's `enclosingClass`, `contains` edges,
`mintId` dedup) work for free exactly as it already does for a real class.
`it`/`specify` are `kind: "method"` the same way, slugified
(`rspecSlug`) from their string description since there's no identifier to
name them with.

## Phases (as built, each its own commit)

1. **ActiveRecord associations, `scope`, callbacks, `delegate`, suppression**
   — the foundational pass establishing the interception-chain pattern
   every later phase reuses.
2. **`ActiveSupport::Concern`** — `included`/`class_methods` hook-noise
   suppression; verified (not assumed) that nested content already
   attributes correctly via plain recursive descent.
3. **Routing DSL** — `get`/`post`/`root`/`resources`/`namespace`, resolved
   as typed-member `calls` edges (`viaMember: true, recvType:
   "<Controller>"`) reusing the SAME resolution path `Klass.method`
   dispatch already uses. Discovered mid-implementation that `namespace do`
   must NOT qualify the resolved controller name (`NodeV1.owner` is always
   a bare class name).
4. **Routing DSL member/collection blocks** — `resources`'s own
   `do...end`, both the block form and the inline `on:` form.
5. **RSpec** — the biggest single piece; `describeRspec`'s new
   definition-recognition mechanism, plus `let`/`subject`/`before`/`after`/
   `around`. Surfaced and fixed a real, recurring gap in plain-Ruby bare-call
   recognition (curly-brace `{ }` blocks weren't checked, only `do...end`'s
   `body_statement`).
6. **`enum`, `has_secure_password`, `accepts_nested_attributes_for`**
7. **`attribute`, `encrypts`, `helper_method`, `delegated_type`**
8. **`store`/`store_accessor`, `has_one_attached`/`has_many_attached`,
   `has_secure_token`**
9. **`shared_examples`/`shared_examples_for`/`shared_context` +
   `it_behaves_like`/`it_should_behave_like`/`include_examples`/
   `include_context`** — closed after an explicit gap review.

Every macro's exact method-generation behavior was confirmed by reading
the real `rails/rails` source (via `gh api`), not inferred from
documentation or guessed from naming conventions.

## Testing

One test file per phase (`test/graph-rails*.test.ts`), following the
plain-Ruby convention: `node:test` + `assert/strict`, node-level facts via
direct `extractFile()` calls, edge/cross-file resolution via
`buildGraph()`/`readGraph()`. `tsc --noEmit` and the full suite verified
clean after every commit throughout.
