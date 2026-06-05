# 0016 - Native (Kotlin/Swift) receiver typing: params, fields, external classification

Status: Accepted

## Context
ADR 0012 made the native (Swift/Kotlin) extractor resolve a call when the callee's short name
was unique, plus two precise layers: enclosing-class scope (bare/`this`/`self`) and `val x = Foo()`
constructor bindings. Categorising the **1072 ambiguous `x.method()` calls** on the HMS Android
app (Kotlin, `hms-mobile`, 59% coverage) showed where the rest go:

| category | count |
|---|---|
| receiver is a typed **param / class field / property** | **786** |
| untypable identifier | 187 |
| chained / non-identifier receiver | 49 |
| repo class, method via inheritance | 48 |
| external type | 2 |

So **786 of 1072** ambiguous calls have a receiver we *could* type to a repo method — but the
extractor ignores **function-parameter types** and **class property/field types** entirely
(it only uses class scope and constructor-bound locals). This is exactly the receiver-typing Go
already does (params + struct fields, ADR 0012/0015); Kotlin/Swift just never got it. Resolving
most of the 786 would lift `hms-mobile` from 59% toward ~85% and add hundreds of real call edges
— a genuine resolution win (unlike the Go ADR 0015 pass, which was mostly reclassification).

## Decision
Extend the native extractor's receiver typing for **both Kotlin and Swift** (their grammars share
the relevant node names — `property_declaration`, `parameter`, `user_type`, `navigation_expression`
— so the logic is largely uniform; Kotlin's constructor `class_parameter` is the one extra case):

1. **Function-parameter types.** A `fun handle(svc: Service)` / `func handle(svc: Service)` binds
   `svc : Service` in the function's type environment (type = the parameter's `user_type`).
2. **Class field/property types.** A class's stored properties and Kotlin constructor `val/var`
   parameters (`val repo: Repo`, `private val x: Y`) form a per-class field→type map; a receiver
   identifier that isn't a local/param is looked up against the enclosing class's fields. Untyped
   `val x = Foo()` properties keep resolving via their constructor call (today's behavior).
3. **External-receiver classification** (mirror ADR 0015). When a receiver resolves to a type that
   is **not** a class declared in the repo (`String`, `Context`, `List`, …), the call is counted
   `external` and not run through the global short-name fallback — removing wrong edges and making
   coverage honest.

Resolution order is unchanged in spirit: a single `Class.method` match emits an edge; nothing is
guessed among same-named candidates. Interface/protocol dispatch, generics, and chained or
untypable receivers stay unresolved (a hint, philosophy #5).

## Consequences
- `hms-mobile` (Kotlin) call resolution rises substantially (hundreds of edges; coverage 59% →
  measured on dogfood), making `impact`/`path` on the Android app far more complete. Swift gains
  the same typing, dogfooded on `ghost_daddy` (the only Swift in a workspace).
- No schema/core change (ADR 0005); the normalized output shape is unchanged.
- Best-effort and syntactic: nullable/safe calls (`a?.b()`) resolve by the same path; generics,
  protocol/interface dispatch, extension-function receivers, and chained receivers remain partial
  (#5). No guessing.
- Coverage numbers for native repos shift (upward) on the next `refresh` — expected, noted in the
  CHANGELOG. Measured before/after reported there rather than predicted here.
