import apiClient from './client';

const invoiceService = {
  // Get all invoices with optional filters
  getInvoices: async (filters = {}) => {
    const response = await apiClient.get('/invoices/', { params: filters });
    return response.data;
  },

  // Get a single invoice by ID
  getInvoice: async (id) => {
    const response = await apiClient.get(`/invoices/${id}/`);
    return response.data;
  },

  // Create a new invoice
  createInvoice: async (invoiceData) => {
    const response = await apiClient.post('/invoices/', invoiceData);
    return response.data;
  },

  // Update an existing invoice
  updateInvoice: async (id, invoiceData) => {
    const response = await apiClient.put(`/invoices/${id}/`, invoiceData);
    return response.data;
  },

  // Get invoice summary
  getInvoiceSummary: async (id) => {
    const response = await apiClient.get(`/invoices/${id}/summary/`);
    return response.data;
  },

  // Delete an invoice
  deleteInvoice: async (id) => {
    const response = await apiClient.delete(`/invoices/${id}/`);
    return response.data;
  },

  // Print invoice
  printInvoice: async (id) => {
    const response = await apiClient.get(`/invoices/${id}/print/`);
    return response.data;
  },

  // Import invoices from CSV
  importInvoices: async (file, businessId) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('business_id', businessId);

    const response = await apiClient.post('/invoices/import/', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  }
};

export default invoiceService;
