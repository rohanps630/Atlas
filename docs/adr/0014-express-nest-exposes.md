# 0014 - Express mount-prefix + NestJS exposes extraction

Status: Accepted

## Context
The TS extractor already emits `exposes` for the basic Express shape
(`app.get("/path", handler)`, `router.post("/path", handler)`) — so the original "TS emits no
exposes" framing is out of date. A probe over representative Node backends found the real gaps:

1. **Express mounted-router prefix is dropped.** Routes registered on a `Router()` are joined to
   their app via `app.use("/api/v1/orders", ordersRouter)`, but the extractor records the
   router-relative path (`/:id`, `/`) and ignores the mount prefix. A frontend calling
   `/api/v1/orders/123` therefore never links to that handler. This is the same problem chi
   nested `r.Route(prefix, …)` solves for Go (ADR 0010) — here the prefix lives in a separate
   `app.use(...)` call, often in another file.
2. **NestJS routes are invisible.** Nest declares routing with **decorators**
   (`@Controller("clinics")` + `@Get(":id")`), not `app.verb(...)` calls, so the
   CallExpression-only `detectExpose` produces **zero** exposes for a Nest backend.

Both are framework-specific endpoint extraction layered on the existing extractor, exactly like
chi `exposes` (ADR 0010) and Kotlin/Retrofit `consumes` (ADR 0011) — and emit the same
normalized `exposes` shape, so the core and schema are untouched (ADR 0005).

Honesty note (philosophy #10 / rejected.md "earn-it"): there is **no Node/Express/Nest backend
in the current dogfood workspaces** (HMS backends are Go, ghost is React Native). This change is
validated on representative **probe fixtures** (like `fixtures/cross/svc`), not a real repo —
weaker evidence than items that ran on HMS. It is in scope because the owner asked for it; the
fixtures encode the patterns a real Express/Nest service uses.

## Decision
Add two framework-specific passes to the TS extractor, both emitting normalized `exposes`:

1. **Express mount-prefix resolution.** Collect, across all files: (a) route registrations
   `R.<verb>(pathLiteral, …handlers)` keyed by the **resolved declaration** of the router object
   `R` (via ts-morph symbol resolution, so a router defined and `export default`ed in one file
   is the same identity when mounted in another); and (b) mounts
   `M.use(prefixLiteral, routerRef)` recording `routerDecl → (prefix, mountedOnDecl)`. Then each
   route's full path = the route path with its router's mount-prefix chain prepended, walked
   transitively to the app root (bounded depth, deduped; a router mounted at several prefixes
   yields several exposes). A route on an **unmounted** router keeps its bare path — today's
   behavior, never a regression. Param segments (`/:id`) normalize like any route at link time.

2. **NestJS decorators.** A class with a `@Controller(base?)` decorator is a controller (base
   path = the string-literal arg, else `""`). Each method carrying an HTTP-verb decorator
   (`@Get/@Post/@Put/@Delete/@Patch(sub?)`) is an exposed endpoint: `VERB` from the decorator
   name, path = `/` + join(base, sub), handler = the method's existing `Class.method` node.

Both are best-effort and syntactic where the value isn't statically present: dynamic/ computed
prefixes, `RouterModule.forRoutes(...)` config-based Nest routing, and non-literal paths are
skipped (a hint, philosophy #5), not guessed.

## Consequences
- A Node/Express/Nest backend's route surface links to frontend `consumes` by HTTP contract —
  closing the cross-repo gap for the Node ecosystem the same way Go/chi and Kotlin/Retrofit did.
- No schema or core change (ADR 0005): additive `exposes` only; the linker is unchanged.
- Cross-file router identity and mount-chain walking lean on ts-morph symbol resolution and are
  bounded/best-effort; deep or dynamically-built mounts may stay unresolved (hint #5).
- Validated on probe fixtures, not a real repo (see Context) — coverage/limits are stated, and a
  real service should be scanned before trusting the Node exposes as much as the Go ones.
- Express and Nest are the first two Node route styles supported; others (Fastify, Koa,
  decorator libs) are added the same way when a real service needs them (earn-it).
