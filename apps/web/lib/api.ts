import axios from "axios";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export const IS_MOCK = false;

export const api = axios.create({
  baseURL: `${API_URL}/api/v1`,
  headers: { "Content-Type": "application/json" },
  timeout: 30000,
});

export const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000";

export function createWs(path: string): WebSocket | null {
  return new WebSocket(`${WS_URL}${path}`);
}
