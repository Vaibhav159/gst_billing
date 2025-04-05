import axios from 'axios';

// Create an axios instance with default config
const apiClient = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  // Add timeout to prevent hanging requests
  timeout: 15000, // 15 seconds
  // Prevent broken pipe errors by properly handling request cancellation
  withCredentials: true,
});

// Global loading indicator reference
let loadingIndicator = null;

// Initialize loading indicator when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  loadingIndicator = document.getElementById('global-loading');
});

// Track active requests to show/hide loading indicator
let activeRequests = 0;

// Function to show loading indicator
const showLoading = () => {
  if (loadingIndicator) {
    loadingIndicator.classList.add('active');
  }
};

// Function to hide loading indicator
const hideLoading = () => {
  if (loadingIndicator && activeRequests === 0) {
    loadingIndicator.classList.remove('active');
  }
};

// Add a request interceptor to handle authentication and loading state
apiClient.interceptors.request.use(
  (config) => {
    // Add JWT token to request headers if available
    const token = localStorage.getItem('access_token');

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // JWT authentication is used, no need for CSRF tokens

    // Don't show loading indicator for certain requests
    if (config.showLoading !== false) {
      activeRequests++;
      showLoading();
    }

    return config;
  },
  (error) => {
    activeRequests = Math.max(0, activeRequests - 1);
    hideLoading();
    return Promise.reject(error);
  }
);

// Add a response interceptor to handle errors and loading state
apiClient.interceptors.response.use(
  (response) => {
    // Decrease active requests counter
    if (response.config.showLoading !== false) {
      activeRequests = Math.max(0, activeRequests - 1);
      hideLoading();
    }
    return response;
  },
  async (error) => {

    // Decrease active requests counter
    if (error.config && error.config.showLoading !== false) {
      activeRequests = Math.max(0, activeRequests - 1);
      hideLoading();
    }

    // Handle token expiration
    if (error.response && error.response.status === 401) {
      // Try to refresh the token
      const refreshToken = localStorage.getItem('refresh_token');

      if (refreshToken) {
        try {
          // Import here to avoid circular dependency
          const authService = await import('./authService').then(module => module.default);

          // Try to refresh the token
          await authService.refreshToken();

          // Retry the original request
          return apiClient(error.config);
        } catch (refreshError) {
          // If refresh fails, redirect to login
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          window.location.href = '/login';
        }
      } else {
        // No refresh token, redirect to login
        window.location.href = '/login';
      }
    }

    // Handle specific error types
    if (error.code === 'ECONNABORTED') {
      // Request timeout
      // You could show a user-friendly message here
    } else if (axios.isCancel(error)) {
      // Request was cancelled
    } else if (error.response) {
      // Server responded with an error status code

      // Handle authentication errors
      if (error.response.status === 401 || error.response.status === 403) {
        // Redirect to login or show auth error
      }
    } else if (error.request) {
      // Request was made but no response received (network error)
      // You could show a network error message
    } else {
      // Something else happened while setting up the request
    }

    return Promise.reject(error);
  }
);

// Helper function to get cookies
function getCookie(name) {
  let cookieValue = null;
  if (document.cookie && document.cookie !== '') {
    const cookies = document.cookie.split(';');
    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i].trim();
      if (cookie.substring(0, name.length + 1) === (name + '=')) {
        cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
        break;
      }
    }
  }
  return cookieValue;
}

// Create a request cancellation token source
export const createCancelToken = () => {
  return axios.CancelToken.source();
};

// No longer exporting getCookie as it's only used internally

export default apiClient;
