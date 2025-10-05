import apiClient from './client';

const aiInvoiceService = {
  // Process invoice image with AI
  processInvoiceImage: async (imageFile) => {
    const formData = new FormData();
    formData.append('image', imageFile);

    const response = await apiClient.post('/ai/invoice/process/', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  // Create invoice from AI-extracted data
  createInvoice: async (businessId, invoiceData) => {
    const response = await apiClient.post('/ai/invoice/create/', {
      business_id: businessId,
      invoice_data: invoiceData,
    });
    return response.data;
  },
};

export default aiInvoiceService;
