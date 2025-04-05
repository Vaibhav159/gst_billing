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
    console.error('localStorage is not available:', e);
    return false;
  }
};

// Check localStorage availability on load
console.log('localStorage is available:', isLocalStorageAvailable());

// Authentication service
const authService = {
  // Login user and get tokens
  login: async (username, password) => {
    try {
      console.log('Attempting login for user:', username);

      const response = await apiClient.post('/token/', { username, password });
      console.log('Login response:', response.data);

      const { access, refresh } = response.data;

      // Store tokens in local storage
      localStorage.setItem(ACCESS_TOKEN_KEY, access);
      localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
      console.log('Tokens stored in localStorage');

      // Set the authorization header for future requests
      apiClient.defaults.headers.common['Authorization'] = `Bearer ${access}`;
      console.log('Authorization header set for apiClient');

      // Log the current headers
      console.log('Current apiClient headers:', apiClient.defaults.headers.common);

      return response.data;
    } catch (error) {
      console.error('Login error:', error);
      console.error('Login error details:', error.response ? error.response.data : 'No response data');
      throw error;
    }
  },

  // Logout user
  logout: () => {
    console.log('Logging out user');

    // Remove tokens from local storage
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    console.log('Tokens removed from localStorage');

    // Remove the authorization header
    delete apiClient.defaults.headers.common['Authorization'];
    console.log('Authorization header removed from apiClient');
    console.log('Current apiClient headers:', apiClient.defaults.headers.common);
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
    console.log('Initializing authentication from localStorage');

    const token = localStorage.getItem(ACCESS_TOKEN_KEY);
    console.log('Access token in localStorage:', token ? 'Present' : 'Not found');

    if (token) {
      apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      console.log('Authorization header set for apiClient:', `Bearer ${token.substring(0, 10)}...`);
      console.log('Current apiClient headers:', apiClient.defaults.headers.common);
      return true;
    }

    console.warn('No access token found in localStorage, user is not authenticated');
    return false;
  }
};

export default authService;
