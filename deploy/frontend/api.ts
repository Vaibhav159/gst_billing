/**
 * Improved API client - replaces src/utils/api.ts
 *
 * Changes from original:
 * 1. API base URL is configurable via VITE_API_BASE_URL env var
 *    - Dev: defaults to "/api/" (works with Vite proxy)
 *    - Prod: set VITE_API_BASE_URL=https://your-backend.com/api/ at build time
 * 2. Token refresh logic preserved (identical to original)
 */
import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api/",
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor to attach JWT token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("gst_access_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    // Let browser set Content-Type for FormData (multipart/form-data with boundary)
    if (config.data instanceof FormData) {
      delete config.headers["Content-Type"];
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor to handle token expiration/refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry && originalRequest.url !== "token/") {
      originalRequest._retry = true;
      const refreshToken = localStorage.getItem("gst_refresh_token");
      if (refreshToken) {
        try {
          const baseURL = import.meta.env.VITE_API_BASE_URL || "/api/";
          const response = await axios.post(`${baseURL}token/refresh/`, { refresh: refreshToken });
          localStorage.setItem("gst_access_token", response.data.access);
          api.defaults.headers.common["Authorization"] = `Bearer ${response.data.access}`;
          originalRequest.headers["Authorization"] = `Bearer ${response.data.access}`;
          return api(originalRequest);
        } catch {
          localStorage.removeItem("gst_access_token");
          localStorage.removeItem("gst_refresh_token");
          if (window.location.pathname !== "/login") {
            window.location.href = "/login";
          }
        }
      } else {
        localStorage.removeItem("gst_access_token");
        if (window.location.pathname !== "/login") {
          window.location.href = "/login";
        }
      }
    }
    return Promise.reject(error);
  }
);

export default api;
