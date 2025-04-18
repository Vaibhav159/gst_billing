import apiClient from './client';

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
    const response = await apiClient.post('/products/', productData);
    return response.data;
  },

  // Update an existing product
  updateProduct: async (id, productData) => {
    const response = await apiClient.put(`/products/${id}/`, productData);
    return response.data;
  },

  // Delete a product
  deleteProduct: async (id) => {
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
  },

  // Import products from CSV
  importProducts: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('import_type', 'product');

    const response = await apiClient.post('/csv/import/', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  }
};

export default productService;
