import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import Button from '../components/Button';
import LoadingSpinner from '../components/LoadingSpinner';
import invoiceService from '../api/invoiceService';
import businessService from '../api/businessService';

const InvoiceImport = () => {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [businessId, setBusinessId] = useState('');
  const [businesses, setBusinesses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);

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

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setFile(selectedFile);
    setError('');
  };

  const handleBusinessChange = (e) => {
    setBusinessId(e.target.value);
    setError('');
  };

  const validateForm = () => {
    if (!file) {
      setError('Please select a CSV file');
      return false;
    }

    if (!file.name.endsWith('.csv')) {
      setError('Please select a valid CSV file');
      return false;
    }

    if (!businessId) {
      setError('Please select a business');
      return false;
    }

    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    try {
      setImporting(true);
      setError('');
      setSuccess(null);

      const result = await invoiceService.importInvoices(file, businessId);

      setSuccess({
        invoicesCreated: result.invoices_created,
        lineItemsCreated: result.line_items_created,
        errors: result.errors || []
      });

      // Reset file input
      setFile(null);
      document.getElementById('csv-file-input').value = '';

    } catch (err) {
      console.error('Error importing invoices:', err);

      if (err.response && err.response.data && err.response.data.error) {
        setError(err.response.data.error);
      } else {
        setError('Failed to import invoices. Please try again.');
      }
    } finally {
      setImporting(false);
    }
  };

  const handleDownloadSample = () => {
    // Create sample CSV content
    const csvContent = [
      'invoice_number,invoice_date,customer_name,product_name,quantity,unit,rate,hsn_code,gst_tax_rate',
      '1001,2023-01-15,Sample Customer,Gold Ring,10.5,gm,4500,711319,0.03',
      '1001,2023-01-15,Sample Customer,Gold Chain,5.2,gm,4800,711319,0.03',
      '1002,2023-01-20,Another Customer,Silver Bracelet,25,pcs,1200,711311,0.03'
    ].join('\n');

    // Create a blob and download link
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', 'sample_invoice_import.csv');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          Import Invoices from CSV
        </h1>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={handleDownloadSample}
            className="text-sm"
            icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>}
          >
            Download Sample
          </Button>
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

      <Card className="mb-6 transform transition-all duration-300 hover:shadow-md bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 border border-blue-200 dark:border-blue-800/30">
        <div className="p-4 md:p-6">
          <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            CSV Format Instructions
          </h2>
          <p className="mb-4 text-gray-700 dark:text-gray-300">
            Your CSV file should include the following columns:
          </p>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm mb-4">
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 text-gray-700 dark:text-gray-300">
              <li className="flex items-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-500 dark:text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span><strong className="text-gray-900 dark:text-white">invoice_number</strong> - Unique identifier for the invoice</span>
              </li>
              <li className="flex items-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-500 dark:text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span><strong className="text-gray-900 dark:text-white">invoice_date</strong> - Date in YYYY-MM-DD format</span>
              </li>
              <li className="flex items-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-500 dark:text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span><strong className="text-gray-900 dark:text-white">customer_name</strong> - Name of the customer</span>
              </li>
              <li className="flex items-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-500 dark:text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span><strong className="text-gray-900 dark:text-white">product_name</strong> - Name of the product</span>
              </li>
              <li className="flex items-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-500 dark:text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span><strong className="text-gray-900 dark:text-white">quantity</strong> - Quantity of the product</span>
              </li>
              <li className="flex items-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-500 dark:text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span><strong className="text-gray-900 dark:text-white">unit</strong> - Unit for the quantity (e.g., gm, kg, pcs). If omitted, 'gm' is assumed.</span>
              </li>
              <li className="flex items-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-500 dark:text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span><strong className="text-gray-900 dark:text-white">rate</strong> - Rate per unit</span>
              </li>
              <li className="flex items-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-blue-500 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span><strong className="text-gray-900 dark:text-white">hsn_code</strong> - (Optional) HSN code for the product</span>
              </li>
              <li className="flex items-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-blue-500 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span><strong className="text-gray-900 dark:text-white">gst_tax_rate</strong> - (Optional) GST tax rate as a decimal (e.g., 0.03 for 3%)</span>
              </li>
            </ul>
          </div>
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-400 dark:border-yellow-600 p-4 rounded-r-md">
            <p className="text-sm text-yellow-700 dark:text-yellow-300 flex items-start">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>Multiple rows with the same invoice_number will be treated as multiple line items for the same invoice.</span>
            </p>
          </div>
        </div>
      </Card>

      <Card className="transform transition-all duration-300 hover:shadow-md">
        <form onSubmit={handleSubmit} className="p-4 md:p-6">
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
                  <p className="font-bold text-green-700 dark:text-green-400">Import Successful!</p>
                  <p className="text-green-600 dark:text-green-300">Created {success.invoicesCreated} invoice(s) with {success.lineItemsCreated} line item(s).</p>
                  {success.errors && success.errors.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-green-200 dark:border-green-800">
                      <p className="font-bold text-amber-700 dark:text-amber-400">Warnings/Errors:</p>
                      <ul className="list-none space-y-1 mt-1">
                        {success.errors.map((err, index) => (
                          <li key={index} className="flex items-start">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-amber-500 dark:text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            <span className="text-amber-600 dark:text-amber-300">{err}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="border-b border-gray-200 dark:border-gray-700 pb-4 mb-6">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              Import Details
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
              <label className="block text-gray-700 dark:text-gray-300 text-sm font-medium mb-2" htmlFor="csv-file-input">
                CSV File
              </label>
              <div className="relative">
                <input
                  id="csv-file-input"
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  className="shadow appearance-none border dark:border-gray-700 rounded w-full py-2 px-3 text-gray-700 dark:text-gray-300 dark:bg-gray-800 leading-tight focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  required
                />
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 flex items-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Only CSV files are accepted
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end pt-4 border-t border-gray-200 dark:border-gray-700">
            <Button
              type="submit"
              disabled={importing}
              className="w-full sm:w-auto"
              icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>}
            >
              {importing ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2" />
                  Importing...
                </>
              ) : (
                'Import Invoices'
              )}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};

export default InvoiceImport;
