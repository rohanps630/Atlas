export function post(url: string, body: unknown): Promise<unknown> {
  return fetch(url, { method: "POST", body: JSON.stringify(body) }).then((r) =>
    r.json(),
  );
}

export function get(url: string): Promise<unknown> {
  return fetch(url).then((r) => r.json());
}
