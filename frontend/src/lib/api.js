export const API_BASE = import.meta.env.VITE_API_BASE?.replace(/\/$/, "");

if (!API_BASE) {
  throw new Error("Missing VITE_API_BASE. Add it to frontend/.env.local");
}

export const HEADERS = (token) => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${token}`,
  "ngrok-skip-browser-warning": "true",
});

export const AUTH_HEADERS = (token) => ({
  Authorization: `Bearer ${token}`,
  "ngrok-skip-browser-warning": "true",
});