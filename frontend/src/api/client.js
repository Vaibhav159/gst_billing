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

// Add a request interceptor to include CSRF token and handle loading state
apiClient.interceptors.request.use(
  (config) => {
    // Get CSRF token from cookie
    const csrfToken = getCookie('csrftoken');
    if (csrfToken) {
      config.headers['X-CSRFToken'] = csrfToken;
    }

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
  (error) => {
    // Decrease active requests counter
    if (error.config && error.config.showLoading !== false) {
      activeRequests = Math.max(0, activeRequests - 1);
      hideLoading();
    }

    // Handle specific error types
    if (error.code === 'ECONNABORTED') {
      console.error('Request timeout:', error);
      // You could show a user-friendly message here
    } else if (axios.isCancel(error)) {
      console.log('Request cancelled:', error.message);
    } else if (error.response) {
      // Server responded with an error status code
      console.error(`API Error (${error.response.status}):`, error.response.data);

      // Handle authentication errors
      if (error.response.status === 401 || error.response.status === 403) {
        // Redirect to login or show auth error
      }
    } else if (error.request) {
      // Request was made but no response received (network error)
      console.error('Network Error:', error);
      // You could show a network error message
    } else {
      // Something else happened while setting up the request
      console.error('Request Error:', error.message);
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

// Function to fetch CSRF token
export const fetchCSRFToken = async () => {
  try {
    await apiClient.get('/csrf-token/');
    return getCookie('csrftoken');
  } catch (error) {
    console.error('Error fetching CSRF token:', error);
    return null;
  }
};

// Export the getCookie function for use in other files
export { getCookie };

export default apiClient;
