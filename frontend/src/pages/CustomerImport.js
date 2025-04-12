import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Card from '../components/Card';
import Button from '../components/Button';
import FormSelect from '../components/FormSelect';
import LoadingSpinner from '../components/LoadingSpinner';
import Alert from '../components/Alert';
import businessService from '../api/businessService';
import customerService from '../api/customerService';

function CustomerImport() {
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [businesses, setBusinesses] = useState([]);
  const [businessId, setBusinessId] = useState('');
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);

  // Fetch businesses on component mount
  useEffect(() => {
    const fetchBusinesses = async () => {
      try {
        const response = await businessService.getBusinesses();
        const businessList = response.results || response;

        // Ensure we have a valid array of businesses
        if (Array.isArray(businessList) && businessList.length > 0) {
          setBusinesses(businessList);

          // Set default business if available
          // Convert ID to number to ensure consistency
          if (businessList[0] && businessList[0].id) {
            const defaultId = Number(businessList[0].id);
            setBusinessId(defaultId);
            console.log('Setting default business ID:', defaultId);
          }
        } else {
          console.warn('No businesses found or invalid response format');
          setBusinesses([]);
        }
      } catch (err) {
        console.error('Error fetching businesses:', err);
        setError('Failed to load businesses. Please try again.');
        setBusinesses([]);
      } finally {
        setLoading(false);
      }
    };

    fetchBusinesses();
  }, []);

  // Handle file input change
  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setFile(selectedFile);
    setError('');
  };

  // Handle business selection change
  const handleBusinessChange = (e) => {
    // Convert to number if it's a numeric string
    const value = e.target.value;
    const businessId = !isNaN(value) && value !== '' ? Number(value) : value;
    setBusinessId(businessId);
    setError('');
  };

  // Validate form before submission
  const validateForm = () => {
    if (!businessId) {
      setError('Please select a business.');
      return false;
    }

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

      console.log('Submitting with business ID:', businessId);
      // Ensure businessId is a number
      const numericBusinessId = Number(businessId);
      const result = await customerService.importCustomers(file, numericBusinessId);

      setSuccess({
        customersCreated: result.customers_created,
        errors: result.errors || []
      });

      // Reset file input
      setFile(null);
      document.getElementById('csv-file-input').value = '';

    } catch (err) {
      console.error('Error importing customers:', err);

      if (err.response && err.response.data && err.response.data.error) {
        setError(err.response.data.error);
      } else {
        setError('Failed to import customers. Please try again.');
      }
    } finally {
      setImporting(false);
    }
  };

  const handleDownloadSample = () => {
    // Create sample CSV content
    const csvContent = [
      'name,address,gst_number,mobile_number,pan_number,state_name',
      'Sample Customer,123 Main St Mumbai,27AAPFU0939F1ZV,9876543210,ABCDE1234F,MAHARASHTRA',
      'Another Customer,456 Park Ave Delhi,07AABCU9603R1ZP,8765432109,FGHIJ5678G,DELHI',
      'Third Customer,789 Lake Blvd Bangalore,29AADCB2230M1ZU,7654321098,KLMNO9012H,KARNATAKA'
    ].join('\n');

    // Create a blob and download link
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', 'sample_customer_import.csv');
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
          Import Customers from CSV
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
          <Link to="/billing/customer/list">
            <Button
              variant="outline"
              className="text-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to Customers
            </Button>
          </Link>
        </div>
      </div>

      <Card>
        <div className="p-6">
          <div className="mb-6">
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              Upload a CSV file to import multiple customers at once. The CSV file should have the following columns:
            </p>
            <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-md overflow-x-auto">
              <code className="text-sm text-gray-800 dark:text-gray-200 whitespace-nowrap">
                name,address,gst_number,mobile_number,pan_number,state_name
              </code>
            </div>
            <p className="text-gray-700 dark:text-gray-300 mt-4">
              <span className="font-semibold">Note:</span> Only the <span className="font-semibold">name</span> field is required. All other fields are optional.
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
                <p>• {success.customersCreated} customers created</p>
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div>
                <FormSelect
                  id="business-select"
                  label="Business"
                  name="business_id"
                  value={businessId}
                  onChange={handleBusinessChange}
                  options={businesses.map(business => ({
                    value: business.id,
                    label: business.name
                  }))}
                  placeholder="Select a business"
                  required
                />
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
                    Only CSV files are supported
                  </p>
                </div>
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
                    Import Customers
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

export default CustomerImport;
