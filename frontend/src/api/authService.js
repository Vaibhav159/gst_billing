import apiClient from './client';

// Local storage keys
const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

// Helper function to check if localStorage is available
const isLocalStorageAvailable = () => {
  try {
    const testKey = '__test__';
    localStorage.setItem(testKey, testKey);
    localStorage.removeItem(testKey);
    return true;
  } catch (e) {
    return false;
  }
};

// Check localStorage availability on load
isLocalStorageAvailable();

// Authentication service
const authService = {
  // Login user and get tokens
  login: async (username, password) => {
    try {
      const response = await apiClient.post('/token/', { username, password });
      const { access, refresh } = response.data;

      // Store tokens in local storage
      localStorage.setItem(ACCESS_TOKEN_KEY, access);
      localStorage.setItem(REFRESH_TOKEN_KEY, refresh);

      // Set the authorization header for future requests
      apiClient.defaults.headers.common['Authorization'] = `Bearer ${access}`;

      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // Logout user
  logout: () => {
    // Remove tokens from local storage
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);

    // Remove the authorization header
    delete apiClient.defaults.headers.common['Authorization'];
  },

  // Refresh the access token
  refreshToken: async () => {
    try {
      const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);

      if (!refreshToken) {
        throw new Error('No refresh token available');
      }

      const response = await apiClient.post('/token/refresh/', { refresh: refreshToken });
      const { access } = response.data;

      // Store the new access token
      localStorage.setItem(ACCESS_TOKEN_KEY, access);

      // Update the authorization header
      apiClient.defaults.headers.common['Authorization'] = `Bearer ${access}`;

      return access;
    } catch (error) {
      console.error('Token refresh error:', error);
      // If refresh fails, log the user out
      authService.logout();
      throw error;
    }
  },

  // Check if user is authenticated
  isAuthenticated: () => {
    return !!localStorage.getItem(ACCESS_TOKEN_KEY);
  },

  // Get the current access token
  getAccessToken: () => {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  },

  // Initialize authentication from local storage
  initializeAuth: () => {
    const token = localStorage.getItem(ACCESS_TOKEN_KEY);

    if (token) {
      apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      return true;
    }

    return false;
  }
};

export default authService;
