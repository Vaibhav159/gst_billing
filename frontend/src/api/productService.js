import apiClient, { fetchCSRFToken } from './client';

const productService = {
  // Get all products with optional filters
  getProducts: async (filters = {}) => {
    const response = await apiClient.get('/products/', { params: filters });
    return response.data;
  },

  // Get a single product by ID
  getProduct: async (id) => {
    const response = await apiClient.get(`/products/${id}/`);
    return response.data;
  },

  // Create a new product
  createProduct: async (productData) => {
    // Ensure CSRF token is available
    await fetchCSRFToken();
    const response = await apiClient.post('/products/', productData);
    return response.data;
  },

  // Update an existing product
  updateProduct: async (id, productData) => {
    // Ensure CSRF token is available
    await fetchCSRFToken();
    const response = await apiClient.put(`/products/${id}/`, productData);
    return response.data;
  },

  // Delete a product
  deleteProduct: async (id) => {
    // Ensure CSRF token is available
    await fetchCSRFToken();
    const response = await apiClient.delete(`/products/${id}/`);
    return response.data;
  },

  // Search products by name
  searchProducts: async (query) => {
    const response = await apiClient.get('/products/search/', { params: { product_name: query } });
    return response.data;
  },

  // Get default values for products
  getDefaults: async () => {
    const response = await apiClient.get('/products/defaults/');
    return response.data;
  }
};

export default productService;
