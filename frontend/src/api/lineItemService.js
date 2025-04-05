import apiClient, { fetchCSRFToken } from './client';

const lineItemService = {
  // Get all line items for an invoice
  getLineItems: async (invoiceId) => {
    const response = await apiClient.get(`/invoices/${invoiceId}/line-items/`);
    return response.data;
  },

  // Create a new line item
  createLineItem: async (invoiceId, lineItemData) => {
    // Ensure CSRF token is available
    await fetchCSRFToken();
    const response = await apiClient.post(`/invoices/${invoiceId}/line-items/`, lineItemData);
    return response.data;
  },

  // Update an existing line item
  updateLineItem: async (id, lineItemData) => {
    // Ensure CSRF token is available
    await fetchCSRFToken();
    const response = await apiClient.put(`/line-items/${id}/`, lineItemData);
    return response.data;
  },

  // Delete a line item
  deleteLineItem: async (id) => {
    // Ensure CSRF token is available
    await fetchCSRFToken();
    const response = await apiClient.delete(`/line-items/${id}/`);
    return response.data;
  }
};

export default lineItemService;
