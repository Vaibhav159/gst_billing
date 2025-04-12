import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Card from '../components/Card';
import Button from '../components/Button';
import LoadingSpinner from '../components/LoadingSpinner';
import Alert from '../components/Alert';
import productService from '../api/productService';

function ProductImport() {
  const [importing, setImporting] = useState(false);
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [inputValue, setInputValue] = useState('');

  // Handle file input change
  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setFile(selectedFile);
    setInputValue(e.target.value);
    setError('');
  };

  // Validate form before submission
  const validateForm = () => {
    if (!file) {
      setError('Please select a CSV file to import.');
      return false;
    }

    if (!file.name.endsWith('.csv')) {
      setError('Please select a valid CSV file.');
      return false;
    }

    return true;
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    try {
      setImporting(true);
      setError('');
      setSuccess(null);

      const result = await productService.importProducts(file);

      setSuccess({
        productsCreated: result.products_created,
        errors: result.errors || []
      });

      // Reset file input
      setFile(null);
      document.getElementById('csv-file-input').value = '';

    } catch (err) {
      console.error('Error importing products:', err);

      if (err.response && err.response.data && err.response.data.error) {
        setError(err.response.data.error);
      } else {
        setError('Failed to import products. Please try again.');
      }
    } finally {
      setImporting(false);
    }
  };

  const handleDownloadSample = () => {
    // Create sample CSV content
    const csvContent = [
      'name,hsn_code,gst_tax_rate,description',
      'Gold Ring,711319,3%,22 Carat Gold Ring',
      'Silver Bracelet,711311,3,925 Sterling Silver Bracelet',
      'Diamond Necklace,711319,0.03,18 Carat Gold with Diamonds'
    ].join('\n');

    // Create a blob and download link
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', 'sample_product_import.csv');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="container mx-auto px-4 py-8 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 mr-2 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          Import Products from CSV
        </h1>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={handleDownloadSample}
            className="text-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
            </svg>
            Download Sample CSV
          </Button>
          <Link to="/billing/product/list">
            <Button
              variant="outline"
              className="text-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to Products
            </Button>
          </Link>
        </div>
      </div>

      <Card>
        <div className="p-6">
          <div className="mb-6">
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              Upload a CSV file to import multiple products at once. The CSV file should have the following columns:
            </p>
            <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-md overflow-x-auto">
              <code className="text-sm text-gray-800 dark:text-gray-200 whitespace-nowrap">
                name,hsn_code,gst_tax_rate,description
              </code>
            </div>
            <p className="text-gray-700 dark:text-gray-300 mt-4">
              <span className="font-semibold">Note:</span> Only the <span className="font-semibold">name</span> field is required. All other fields are optional.
            </p>
            <p className="text-gray-700 dark:text-gray-300 mt-2">
              The <span className="font-semibold">gst_tax_rate</span> can be provided as a percentage (e.g., "3%"), a decimal (e.g., "0.03"), or a number (e.g., "3" which will be interpreted as 3%).
            </p>
          </div>

          {error && (
            <Alert type="error" className="mb-6">
              {error}
            </Alert>
          )}

          {success && (
            <Alert type="success" className="mb-6">
              <div className="font-medium">Import completed successfully!</div>
              <div className="mt-2">
                <p>• {success.productsCreated} products created</p>
                {success.errors && success.errors.length > 0 && (
                  <div className="mt-2">
                    <p className="font-medium">Warnings/Errors:</p>
                    <ul className="list-disc pl-5 mt-1 text-sm">
                      {success.errors.map((err, index) => (
                        <li key={index}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Alert>
          )}

          <form onSubmit={handleSubmit}>
            <div className="mb-6">
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
                  Only CSV files are supported
                </p>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                type="submit"
                variant="primary"
                disabled={importing}
                className="w-full md:w-auto"
              >
                {importing ? (
                  <>
                    <LoadingSpinner size="sm" className="mr-2" />
                    Importing...
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    Import Products
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>
      </Card>
    </div>
  );
}

export default ProductImport;
