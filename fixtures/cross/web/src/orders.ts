// Minimal FE: a client wrapper and a service call that consumes a real route.
const api = {
  post(url: string, body: unknown): Promise<unknown> {
    return fetch(url, { method: "POST", body: JSON.stringify(body) }).then((r) =>
      r.json(),
    );
  },
};

export function createOrder(item: string): Promise<unknown> {
  return api.post("/api/orders", { item }); // → POST /api/orders
}
