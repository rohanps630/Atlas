# extractors/

Per-language extractors. Each reads source and emits the normalized JSON in
`docs/schema.md` §2. The core never sees source (ADR 0005).

- `typescript/` — ts-morph. Functions, imports, calls, and HTTP `consumes`.
- `native/` — generic tree-sitter extractor driven by a **language registry**
  (Swift, Kotlin; Kotlin also emits Retrofit `consumes`).
- `go/` — tree-sitter-go. Functions/methods, calls, and chi `exposes` (ADR 0010).

## Adding a tree-sitter language

Most languages drop into `native/` with one registry entry:

1. Install the grammar: `npm install tree-sitter-<lang>` (pick a version whose
   `tree-sitter` peer matches our pinned core — see `.npmrc` / ADR 0008).
2. Add it to `LANGUAGES` in `native/index.ts`:

   ```ts
   rust: {
     grammar: Rust,
     exts: [".rs"],
     funcType: "function_item",
     callType: "call_expression",
     classScopeTypes: ["impl_item"],
     nameTypes: ["identifier"],
     classNameTypes: ["type_identifier"],
     memberType: "field_expression",
     memberSuffixType: "field_identifier",
   }
   ```

   Languages that share the common shape (`function_declaration` /
   `call_expression`, like Swift/Kotlin) can spread `...COMMON`.
3. That's it — `scan`/`refresh` pick it up automatically (`nativeLanguages()`),
   and detection (`cli/detect.ts`) can mark the extension extractable.

A language whose HTTP framework needs route extraction (like Go + chi) gets its
own extractor instead — see `go/` and ADR 0010. Keep it **earn-it**: add a
language only when a real service needs it (Phase 4 rule).
