// The tree-sitter native packages ship no type declarations. We use them
// loosely (extractors churn and are tested lightly — ADR 0005), so declare
// them as `any` rather than hand-maintaining grammar types.
declare module "tree-sitter";
declare module "tree-sitter-swift";
declare module "tree-sitter-kotlin";
declare module "tree-sitter-go";
