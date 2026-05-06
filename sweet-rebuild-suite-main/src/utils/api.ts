import axios from "axios";

// Create an Axios instance for API requests
const api = axios.create({
  baseURL: "/api/",
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

// Response interceptor to handle token expiration/refresh (basic implementation)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    // If unauthorized, you might want to try refreshing the token here.
    // For now, we'll just log out or bounce to login on 401s if it's not the login request itself.
    if (error.response?.status === 401 && !originalRequest._retry && originalRequest.url !== "token/") {
      originalRequest._retry = true;
      const refreshToken = localStorage.getItem("gst_refresh_token");
      if (refreshToken) {
        try {
          const response = await axios.post("/api/token/refresh/", { refresh: refreshToken });
          localStorage.setItem("gst_access_token", response.data.access);
          api.defaults.headers.common["Authorization"] = `Bearer ${response.data.access}`;
          originalRequest.headers["Authorization"] = `Bearer ${response.data.access}`;
          return api(originalRequest);
        } catch (refreshError) {
          // Refresh token failed, force logout
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
