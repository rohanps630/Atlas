// A frontend consuming the Node backend's Express + Nest routes.
import axios from "axios";

const api = axios.create({ baseURL: "https://svc.example" });

export function fetchOrder(id: string) {
  return api.get(`/api/v1/orders/${id}`); // → Express mounted router
}

export function fetchClinic(id: string) {
  return api.get(`/clinics/${id}`); // → Nest controller
}
