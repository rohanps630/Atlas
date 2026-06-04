// A tiny HTTP client wrapper (object whose name matches the client heuristic).
export const api = {
  get(url: string): Promise<unknown> {
    return fetch(url).then((r) => r.json());
  },
  post(url: string, body: unknown): Promise<unknown> {
    return fetch(url, { method: "POST", body: JSON.stringify(body) }).then((r) =>
      r.json(),
    );
  },
};
