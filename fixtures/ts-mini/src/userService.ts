import { api } from "./api.js";

// Stand-in for a registry resolver: the path is indirected through a call,
// so atlas records it as a symbolic (unresolved) consume.
function resolveSlug(group: string, key: string): string {
  return `/${group}/${key}`;
}

export function getUser(id: string): Promise<unknown> {
  return api.get(`/api/users/${id}`); // resolved → GET /api/users/{}
}

export function createUser(name: string): Promise<unknown> {
  return api.post("/api/users", { name }); // resolved → POST /api/users
}

export function whoAmI(): Promise<unknown> {
  return api.get(resolveSlug("user", "me")); // symbolic → unresolved
}
