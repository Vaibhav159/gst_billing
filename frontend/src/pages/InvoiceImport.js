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
      'invoice_number,invoice_date,customer_name,product_name,quantity,rate,hsn_code,gst_tax_rate',
      '1001,2023-01-15,Sample Customer,Gold Ring,10.5,4500,711319,0.03',
      '1001,2023-01-15,Sample Customer,Gold Chain,5.2,4800,711319,0.03',
      '1002,2023-01-20,Another Customer,Silver Bracelet,25,1200,711311,0.03'
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
      <div className="flex justify-center items-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Import Invoices from CSV</h1>
        <div className="flex space-x-2">
          <Button
            variant="outline"
            onClick={handleDownloadSample}
            className="text-sm"
          >
            Download Sample CSV
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate('/billing/invoice/list')}
            className="text-sm"
          >
            Back to Invoices
          </Button>
        </div>
      </div>

      <Card className="mb-6">
        <div className="p-4">
          <h2 className="text-lg font-semibold mb-4">CSV Format Instructions</h2>
          <p className="mb-2">Your CSV file should include the following columns:</p>
          <ul className="list-disc pl-5 mb-4">
            <li><strong>invoice_number</strong> - Unique identifier for the invoice</li>
            <li><strong>invoice_date</strong> - Date in YYYY-MM-DD format</li>
            <li><strong>customer_name</strong> - Name of the customer</li>
            <li><strong>product_name</strong> - Name of the product</li>
            <li><strong>quantity</strong> - Quantity of the product</li>
            <li><strong>rate</strong> - Rate per unit</li>
            <li><strong>hsn_code</strong> - (Optional) HSN code for the product</li>
            <li><strong>gst_tax_rate</strong> - (Optional) GST tax rate as a decimal (e.g., 0.03 for 3%)</li>
          </ul>
          <p className="text-sm text-gray-600">
            Note: Multiple rows with the same invoice_number will be treated as multiple line items for the same invoice.
          </p>
        </div>
      </Card>

      <Card>
        <form onSubmit={handleSubmit} className="p-4">
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">
              <p><strong>Import Successful!</strong></p>
              <p>Created {success.invoicesCreated} invoice(s) with {success.lineItemsCreated} line item(s).</p>
              {success.errors && success.errors.length > 0 && (
                <div className="mt-2">
                  <p><strong>Warnings/Errors:</strong></p>
                  <ul className="list-disc pl-5">
                    {success.errors.map((err, index) => (
                      <li key={index}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="mb-4">
            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="business">
              Business
            </label>
            <select
              id="business"
              className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
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

          <div className="mb-6">
            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="csv-file-input">
              CSV File
            </label>
            <input
              id="csv-file-input"
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
              required
            />
            <p className="text-sm text-gray-600 mt-1">
              Only CSV files are accepted
            </p>
          </div>

          <div className="flex items-center justify-end">
            <Button
              type="submit"
              disabled={importing}
              className="w-full sm:w-auto"
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
