import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import Button from '../components/Button';
import LoadingSpinner from '../components/LoadingSpinner';
import FormInput from '../components/FormInput';
import businessService from '../api/businessService';
import customerService from '../api/customerService';
import aiInvoiceService from '../api/aiInvoiceService';
import { displayUnit } from '../utils/units';

const AIInvoiceImport = () => {
  const navigate = useNavigate();
  const [imageFile, setImageFile] = useState(null);
  const [businessId, setBusinessId] = useState('');
  const [businesses, setBusinesses] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [extractedData, setExtractedData] = useState(null);
  const [editableData, setEditableData] = useState(null);

  // Fetch businesses on component mount
  useEffect(() => {
    const fetchBusinesses = async () => {
      try {
        setLoading(true);
        const businessData = await businessService.getBusinesses();
        setBusinesses(businessData.results || []);

        // Set default business if available
        if (businessData.results && businessData.results.length > 0) {
          setBusinessId(businessData.results[0].id.toString());
        }
      } catch (err) {
        console.error('Error fetching businesses:', err);
        setError('Failed to load businesses. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchBusinesses();
  }, []);

  // Fetch customers when businessId changes
  useEffect(() => {
    const fetchCustomers = async () => {
      if (businessId) {
        try {
          const customerData = await customerService.getCustomers({ business_id: businessId, limit: 1000 });
          console.log('Fetched customers:', customerData);
          setCustomers(customerData.results || []);
        } catch (err) {
          console.error('Error fetching customers:', err);
          setError('Failed to load customers for the selected business.');
        }
      } else {
        setCustomers([]);
      }
    };

    fetchCustomers();
  }, [businessId]);

  const handleImageChange = (e) => {
    const selectedFile = e.target.files[0];
    setImageFile(selectedFile);
    setError('');
    setExtractedData(null);
    setEditableData(null);
  };

  const handleBusinessChange = (e) => {
    setBusinessId(e.target.value);
    setError('');
  };

  const validateForm = () => {
    if (!imageFile) {
      setError('Please select an image file');
      return false;
    }

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(imageFile.type)) {
      setError('Please select a valid image file (JPEG, PNG, or WebP)');
      return false;
    }

    if (imageFile.size > 10 * 1024 * 1024) {
      setError('File size too large. Please upload an image smaller than 10MB');
      return false;
    }

    if (!businessId) {
      setError('Please select a business');
      return false;
    }

    return true;
  };

  const handleProcessImage = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    try {
      setProcessing(true);
      setError('');
      setSuccess(null);

      const result = await aiInvoiceService.processInvoiceImage(imageFile, businessId);
      
      setExtractedData(result.data);
      setEditableData(JSON.parse(JSON.stringify(result.data))); // Deep copy for editing

    } catch (err) {
      console.error('Error processing image:', err);

      if (err.response && err.response.data && err.response.data.error) {
        setError(err.response.data.error);
      } else {
        setError('Failed to process invoice image. Please try again.');
      }
    } finally {
      setProcessing(false);
    }
  };

  const handleDataChange = (field, value, itemIndex = null) => {
    if (itemIndex !== null) {
      // Update line item
      const newData = { ...editableData };
      newData.line_items[itemIndex][field] = value;
      setEditableData(newData);
    } else {
      // Update main invoice data
      setEditableData({
        ...editableData,
        [field]: value
      });
    }
  };

  const handleCreateInvoice = async () => {
    try {
      setCreating(true);
      setError('');

      const result = await aiInvoiceService.createInvoice(businessId, editableData);
      
      setSuccess({
        invoiceId: result.invoice_id,
        invoiceNumber: result.invoice_number,
        customerName: result.customer_name,
        lineItemsCreated: result.line_items_created,
        totalAmount: result.total_amount
      });

      // Reset form
      setImageFile(null);
      setExtractedData(null);
      setEditableData(null);
      
      // Safely clear the file input
      const fileInput = document.getElementById('image-file-input');
      if (fileInput) {
        fileInput.value = '';
      }

    } catch (err) {
      console.error('Error creating invoice:', err);

      if (err.response && err.response.data && err.response.data.error) {
        setError(err.response.data.error);
      } else {
        setError('Failed to create invoice. Please try again.');
      }
    } finally {
      setCreating(false);
    }
  };

  const handleReset = () => {
    setImageFile(null);
    setExtractedData(null);
    setEditableData(null);
    setError('');
    setSuccess(null);
    
    // Safely clear the file input
    const fileInput = document.getElementById('image-file-input');
    if (fileInput) {
      fileInput.value = '';
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col justify-center items-center h-64 animate-pulse">
        <LoadingSpinner size="lg" className="text-primary-600 dark:text-primary-400" />
        <p className="mt-4 text-gray-600 dark:text-gray-400 font-medium">
          Loading businesses...
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 mr-2 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          AI Invoice Import
        </h1>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => navigate('/billing/invoice/list')}
            className="text-sm"
            icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>}
          >
            Back to Invoices
          </Button>
        </div>
      </div>

      <Card className="mb-6 transform transition-all duration-300 hover:shadow-md bg-gradient-to-br from-purple-50 to-blue-100 dark:from-purple-900/20 dark:to-blue-800/20 border border-purple-200 dark:border-purple-800/30">
        <div className="p-4 md:p-6">
          <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            How AI Invoice Import Works
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="text-center p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm">
              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-white mb-2">1. Upload Image</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">Upload a clear photo of your invoice</p>
            </div>
            <div className="text-center p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm">
              <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-white mb-2">2. AI Processing</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">AI extracts all invoice data automatically</p>
            </div>
            <div className="text-center p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm">
              <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-white mb-2">3. Review & Create</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">Edit data if needed and create invoice</p>
            </div>
          </div>
        </div>
      </Card>

      {!extractedData ? (
        <Card className="transform transition-all duration-300 hover:shadow-md">
          <form onSubmit={handleProcessImage} className="p-4 md:p-6">
            {error && (
              <div className="mb-6 bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 dark:border-red-600 p-4 rounded-r-md">
                <div className="flex items-start">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-3 text-red-500 dark:text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <p className="font-bold text-red-700 dark:text-red-400">Error</p>
                    <p className="text-red-600 dark:text-red-300">{error}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="border-b border-gray-200 dark:border-gray-700 pb-4 mb-6">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Upload Invoice Image
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div>
                <label className="block text-gray-700 dark:text-gray-300 text-sm font-medium mb-2" htmlFor="business">
                  Business
                </label>
                <select
                  id="business"
                  className="shadow appearance-none border dark:border-gray-700 rounded w-full py-2 px-3 text-gray-700 dark:text-gray-300 dark:bg-gray-800 leading-tight focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  value={businessId}
                  onChange={handleBusinessChange}
                  required
                >
                  <option value="">Select a business</option>
                  {businesses.map((business) => (
                    <option key={business.id} value={business.id}>
                      {business.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-gray-700 dark:text-gray-300 text-sm font-medium mb-2" htmlFor="image-file-input">
                  Invoice Image
                </label>
                <div className="relative">
                  <input
                    id="image-file-input"
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp"
                    onChange={handleImageChange}
                    className="shadow appearance-none border dark:border-gray-700 rounded w-full py-2 px-3 text-gray-700 dark:text-gray-300 dark:bg-gray-800 leading-tight focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    required
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 flex items-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Supported formats: JPEG, PNG, WebP (max 10MB)
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end pt-4 border-t border-gray-200 dark:border-gray-700">
              <Button
                type="submit"
                disabled={processing}
                className="w-full sm:w-auto"
                icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>}
              >
                {processing ? (
                  <>
                    <LoadingSpinner size="sm" className="mr-2" />
                    Processing with AI...
                  </>
                ) : (
                  'Process Invoice'
                )}
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Success message for processing */}
          <Card className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/30">
            <div className="p-4 md:p-6">
              <div className="flex items-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-3 text-green-500 dark:text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <div>
                  <p className="font-bold text-green-700 dark:text-green-400">AI Processing Complete!</p>
                  <p className="text-green-600 dark:text-green-300">Invoice data has been extracted. Please review and edit if necessary before creating the invoice.</p>
                </div>
              </div>
            </div>
          </Card>

          {/* Invoice Data Review Form */}
          <Card className="transform transition-all duration-300 hover:shadow-md">
            <div className="p-4 md:p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white flex items-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Review & Edit Invoice Data
                </h3>
                <Button
                  variant="outline"
                  onClick={handleReset}
                  className="text-sm"
                  icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>}
                >
                  Start Over
                </Button>
              </div>

              {error && (
                <div className="mb-6 bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 dark:border-red-600 p-4 rounded-r-md">
                  <div className="flex items-start">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-3 text-red-500 dark:text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <p className="font-bold text-red-700 dark:text-red-400">Error</p>
                      <p className="text-red-600 dark:text-red-300">{error}</p>
                    </div>
                  </div>
                </div>
              )}

              {success && (
                <div className="mb-6 bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500 dark:border-green-600 p-4 rounded-r-md">
                  <div className="flex items-start">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-3 text-green-500 dark:text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <div>
                      <p className="font-bold text-green-700 dark:text-green-400">Invoice Created Successfully!</p>
                      <p className="text-green-600 dark:text-green-300">
                        Invoice #{success.invoiceNumber} created for {success.customerName} with {success.lineItemsCreated} line item(s). 
                        Total amount: ₹{success.totalAmount}
                      </p>
                      <div className="mt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigate(`/billing/invoice/${success.invoiceId}`)}
                          className="text-sm"
                        >
                          View Invoice
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Invoice Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <FormInput
                  label="Invoice Number"
                  value={editableData?.invoice_number || ''}
                  onChange={(e) => handleDataChange('invoice_number', e.target.value)}
                  placeholder="Enter invoice number"
                />
                <FormInput
                  label="Invoice Date"
                  type="date"
                  value={editableData?.invoice_date || ''}
                  onChange={(e) => handleDataChange('invoice_date', e.target.value)}
                />
              </div>

              {/* Customer Details */}
              <div className="mb-6">
                <h4 className="text-md font-medium text-gray-900 dark:text-white mb-4">Customer Details</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-gray-700 dark:text-gray-300 text-sm font-medium mb-2" htmlFor="customer_name">
                      Customer Name
                    </label>
                    <select
                      id="customer_name"
                      className="shadow appearance-none border dark:border-gray-700 rounded w-full py-2 px-3 text-gray-700 dark:text-gray-300 dark:bg-gray-800 leading-tight focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      value={editableData?.customer_name || ''}
                      onChange={(e) => handleDataChange('customer_name', e.target.value)}
                    >
                      <option value="">Select a customer</option>
                      {/* Add the AI-detected name as an option if it's not in the list */}
                      {editableData?.customer_name && !customers.some(c => c.name === editableData.customer_name) && (
                        <option value={editableData.customer_name}>
                          {editableData.customer_name} (AI Detected)
                        </option>
                      )}
                      {customers.map((customer) => (
                        <option key={customer.id} value={customer.name}>
                          {customer.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <FormInput
                    label="GST Number"
                    value={editableData?.customer_gst_number || ''}
                    onChange={(e) => handleDataChange('customer_gst_number', e.target.value)}
                    placeholder="Enter GST number"
                  />
                  <FormInput
                    label="PAN Number"
                    value={editableData?.customer_pan_number || ''}
                    onChange={(e) => handleDataChange('customer_pan_number', e.target.value)}
                    placeholder="Enter PAN number"
                  />
                  <FormInput
                    label="Mobile Number"
                    value={editableData?.customer_mobile_number || ''}
                    onChange={(e) => handleDataChange('customer_mobile_number', e.target.value)}
                    placeholder="Enter mobile number"
                  />
                </div>
                <FormInput
                  label="Address"
                  value={editableData?.customer_address || ''}
                  onChange={(e) => handleDataChange('customer_address', e.target.value)}
                  placeholder="Enter customer address"
                  className="mt-4"
                />
              </div>

              {/* Line Items */}
              <div className="mb-6">
                <h4 className="text-md font-medium text-gray-900 dark:text-white mb-4">Line Items</h4>
                <div className="space-y-4">
                  {editableData?.line_items?.map((item, index) => (
                    <div key={index} className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                      <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                        <FormInput
                          label="Product Name"
                          value={item.product_name || ''}
                          onChange={(e) => handleDataChange('product_name', e.target.value, index)}
                          placeholder="Product name"
                        />

                        {/* Quantity + Unit */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Quantity</label>
                          <div className="mt-1 flex space-x-2">
                            <input
                              type="number"
                              step="0.001"
                              value={item.quantity || ''}
                              onChange={(e) => handleDataChange('quantity', parseFloat(e.target.value) || 0, index)}
                              placeholder="0.000"
                              className="flex-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                            />
                            <select
                              value={item.unit || 'gm'}
                              onChange={(e) => handleDataChange('unit', e.target.value, index)}
                              className="w-28 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                            >
                              <option value="gm">{displayUnit('gm')}</option>
                              <option value="kg">{displayUnit('kg')}</option>
                              <option value="pcs">{displayUnit('pcs')}</option>
                            </select>
                          </div>
                        </div>

                        <FormInput
                          label={`Rate (₹/${displayUnit(item.unit || 'gm')})`}
                          type="number"
                          step="0.01"
                          value={item.rate || ''}
                          onChange={(e) => handleDataChange('rate', parseFloat(e.target.value) || 0, index)}
                          placeholder={`0.00 per ${displayUnit(item.unit || 'gm')}`}
                        />
                        <FormInput
                          label="HSN Code"
                          value={item.hsn_code || ''}
                          onChange={(e) => handleDataChange('hsn_code', e.target.value, index)}
                          placeholder="HSN code"
                        />
                        <FormInput
                          label="GST Rate"
                          type="number"
                          step="0.01"
                          value={item.gst_tax_rate || ''}
                          onChange={(e) => handleDataChange('gst_tax_rate', parseFloat(e.target.value) || 0, index)}
                          placeholder="0.03"
                        />
                        <FormInput
                          label="Amount"
                          type="number"
                          step="0.01"
                          value={item.amount || ''}
                          onChange={(e) => handleDataChange('amount', parseFloat(e.target.value) || 0, index)}
                          placeholder="0.00"
                          disabled
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Total Amount */}
              <div className="mb-6">
                <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                  <div className="flex justify-between items-center">
                    <span className="text-lg font-medium text-gray-900 dark:text-white">Total Amount:</span>
                    <span className="text-xl font-bold text-blue-600 dark:text-blue-400">
                      ₹{editableData?.total_amount || 0}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end pt-4 border-t border-gray-200 dark:border-gray-700 space-x-4">
                <Button
                  variant="outline"
                  onClick={handleReset}
                  disabled={creating}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateInvoice}
                  disabled={creating}
                  icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>}
                >
                  {creating ? (
                    <>
                      <LoadingSpinner size="sm" className="mr-2" />
                      Creating Invoice...
                    </>
                  ) : (
                    'Create Invoice'
                  )}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

export default AIInvoiceImport;
