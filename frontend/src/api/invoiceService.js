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

    // Try the new CSV import endpoint first
    try {
      const response = await apiClient.post('/csv/import/', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    } catch (error) {
      console.log('CSV import endpoint failed, trying legacy endpoint:', error);
      // Fall back to the old endpoint if the new one fails
      const response = await apiClient.post('/invoices/import/', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    }
  },

  // Get invoice totals
  getInvoiceTotals: async (filters = {}) => {
    const response = await apiClient.get('/invoices/totals/', { params: filters });
    return response.data;
  },

  // Get next invoice number
  getNextInvoiceNumber: async (businessId, invoiceType) => {
    const response = await apiClient.get('/invoices/next_invoice_number/', {
      params: {
        business_id: businessId,
        type_of_invoice: invoiceType
      }
    });
    return response.data.next_invoice_number;
  },

  // Get all invoice IDs matching filters
  getAllInvoiceIds: async (filters = {}) => {
    // Add limit=1000 to get all results (up to 1000)
    const params = { ...filters, limit: 1000 };

    // Remove pagination parameter if present
    if (params.page) {
      delete params.page;
    }

    const response = await apiClient.get('/invoices/', { params });

    // Extract just the IDs from the results
    const invoices = response.data.results || response.data;
    const ids = invoices.map(invoice => invoice.id);

    return {
      ids,
      count: ids.length
    };
  }
};

export default invoiceService;
