import apiClient from './client';

const businessService = {
  // Get all businesses with optional filters
  getBusinesses: async (filters = {}) => {
    const response = await apiClient.get('/businesses/', { params: filters });
    return response.data;
  },

  // Get a single business by ID
  getBusiness: async (id) => {
    const response = await apiClient.get(`/businesses/${id}/`);
    return response.data;
  },

  // Create a new business
  createBusiness: async (businessData) => {
    const response = await apiClient.post('/businesses/', businessData);
    return response.data;
  },

  // Update an existing business
  updateBusiness: async (id, businessData) => {
    const response = await apiClient.put(`/businesses/${id}/`, businessData);
    return response.data;
  },

  // Delete a business
  deleteBusiness: async (id) => {
    const response = await apiClient.delete(`/businesses/${id}/`);
    return response.data;
  }
};

export default businessService;
