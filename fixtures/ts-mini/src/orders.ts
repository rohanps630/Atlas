import { post, get } from "./http.js";

export function createOrder(item: string): Promise<unknown> {
  return post("/api/orders", { item });
}

export const getOrder = (id: string): Promise<unknown> => {
  return get(`/api/orders/${id}`);
};

export function placeAndFetch(item: string): Promise<unknown> {
  createOrder(item);
  return getOrder("1");
}
