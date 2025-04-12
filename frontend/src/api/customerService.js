import apiClient from './client';

const customerService = {
  // Get all customers with optional filters
  getCustomers: async (filters = {}) => {
    const response = await apiClient.get('/customers/', { params: filters });
    return response.data;
  },

  // Get a single customer by ID
  getCustomer: async (id) => {
    const response = await apiClient.get(`/customers/${id}/`);
    return response.data;
  },

  // Create a new customer
  createCustomer: async (customerData) => {
    const response = await apiClient.post('/customers/', customerData);
    return response.data;
  },

  // Update an existing customer
  updateCustomer: async (id, customerData) => {
    const response = await apiClient.put(`/customers/${id}/`, customerData);
    return response.data;
  },

  // Delete a customer
  deleteCustomer: async (id) => {
    const response = await apiClient.delete(`/customers/${id}/`);
    return response.data;
  },

  // Search customers by name
  searchCustomers: async (query) => {
    const response = await apiClient.get('/customers/search/', { params: { customer_name: query } });
    return response.data;
  },

  // Import customers from CSV
  importCustomers: async (file, businessId) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('business_id', businessId);
    formData.append('import_type', 'customer');

    const response = await apiClient.post('/csv/import/', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  }
};

export default customerService;
