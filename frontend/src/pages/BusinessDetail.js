import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import Button from '../components/Button';
import LoadingSpinner from '../components/LoadingSpinner';
import apiClient from '../api/client';
import { formatIndianCurrency, formatDate } from '../utils/formatters';
import businessService from '../api/businessService';

function BusinessDetail() {
  const { businessId } = useParams();
  const navigate = useNavigate();
  const [business, setBusiness] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loadingStates, setLoadingStates] = useState({
    business: true,
    invoices: true
  });
  const [error, setError] = useState(null);

  // Helper function to update a specific loading state
  const updateLoadingState = (key, value) => {
    setLoadingStates(prev => ({
      ...prev,
      [key]: value
    }));
  };

  // Fetch business details
  useEffect(() => {
    // Fetch business data
    const fetchBusiness = async () => {
      try {
        updateLoadingState('business', true);
        const businessResponse = await apiClient.get(`/businesses/${businessId}/`);
        setBusiness(businessResponse.data);
        setError(null);
      } catch (err) {
        console.error('Error fetching business details:', err);
        setError('Failed to load business details. Please try again.');
      } finally {
        updateLoadingState('business', false);
      }
    };

    // Fetch invoices for this business
    const fetchInvoices = async () => {
      try {
        updateLoadingState('invoices', true);
        const invoicesResponse = await apiClient.get(`/invoices/`, {
          params: { business_id: businessId }
        });
        setInvoices(invoicesResponse.data.results || invoicesResponse.data);
      } catch (err) {
        console.error('Error fetching business invoices:', err);
        // Don't set global error for invoices - just log it
      } finally {
        updateLoadingState('invoices', false);
      }
    };

    // Fetch customers for this business
    const fetchCustomers = async () => {
      try {
        const customersResponse = await apiClient.get(`/customers/`);
        const allCustomers = customersResponse.data.results || customersResponse.data;

        // Filter customers that have this business in their businesses array
        const businessCustomers = allCustomers.filter(customer =>
          customer.businesses && customer.businesses.includes(parseInt(businessId))
        );
        setCustomers(businessCustomers);
      } catch (err) {
        console.error('Error fetching business customers:', err);
        // Don't set global error for customers - just log it
      }
    };

    // Start fetching data in parallel
    fetchBusiness();
    fetchInvoices();
    fetchCustomers();
  }, [businessId]);

  // Handle business deletion
  const handleDelete = async () => {
    if (window.confirm('Are you sure you want to delete this business?')) {
      try {
        // Use businessService to delete the business
        await businessService.deleteBusiness(businessId);
        navigate('/billing/business/list');
      } catch (err) {
        console.error('Error deleting business:', err);
        alert('Failed to delete business. Please try again.');
      }
    }
  };

  // Check if the main business data is still loading
  const isMainDataLoading = loadingStates.business;

  // Helper function to render a section with a loading indicator
  const renderWithLoading = (isLoading, content) => {
    if (isLoading) {
      return (
        <div className="flex justify-center items-center py-8">
          <LoadingSpinner size="md" />
        </div>
      );
    }
    return content;
  };

  if (isMainDataLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 text-red-500">
        <p>{error}</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => navigate('/billing/business/list')}
        >
          Back to List
        </Button>
      </div>
    );
  }

  if (!business) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">Business not found.</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => navigate('/billing/business/list')}
        >
          Back to List
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{business.name}</h1>
        <div className="flex flex-wrap gap-2">
          <Link to={`/billing/business/edit/${businessId}`}>
            <Button
              variant="secondary"
              icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>}
            >
              Edit
            </Button>
          </Link>
          <Button
            variant="danger"
            onClick={handleDelete}
            icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>}
          >
            Delete
          </Button>
          <Link to="/billing/business/list">
            <Button
              variant="outline"
              icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>}
            >
              Back
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        <Card className="transform transition-all duration-300 hover:shadow-md">
          <div className="p-4 md:p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              Business Information
            </h2>
            <div className="space-y-4">
              <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg">
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Name</p>
                <p className="mt-1 text-base md:text-lg font-medium text-gray-900 dark:text-white">{business.name}</p>
              </div>

              <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg">
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">GST Number</p>
                <p className="mt-1 text-base md:text-lg font-medium text-gray-900 dark:text-white">{business.gst_number || '-'}</p>
              </div>

              <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg">
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">PAN Number</p>
                <p className="mt-1 text-base md:text-lg font-medium text-gray-900 dark:text-white">{business.pan_number || '-'}</p>
              </div>

              <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg">
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">State</p>
                <p className="mt-1 text-base md:text-lg font-medium text-gray-900 dark:text-white">{business.state_name || '-'}</p>
              </div>

              <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg">
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Address</p>
                <p className="mt-1 text-base md:text-lg font-medium text-gray-900 dark:text-white">{business.address || '-'}</p>
              </div>
            </div>
          </div>
        </Card>

        <Card className="transform transition-all duration-300 hover:shadow-md">
          <div className="p-4 md:p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
              Contact & Bank Details
            </h2>
            <div className="space-y-4">
              <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg">
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Mobile Number</p>
                <p className="mt-1 text-base md:text-lg font-medium text-gray-900 dark:text-white">{business.mobile_number || '-'}</p>
              </div>

              <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg">
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Bank Name</p>
                <p className="mt-1 text-base md:text-lg font-medium text-gray-900 dark:text-white">{business.bank_name || '-'}</p>
              </div>

              <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg">
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Account Number</p>
                <p className="mt-1 text-base md:text-lg font-medium text-gray-900 dark:text-white">{business.bank_account_number || '-'}</p>
              </div>

              <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg">
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">IFSC Code</p>
                <p className="mt-1 text-base md:text-lg font-medium text-gray-900 dark:text-white">{business.bank_ifsc_code || '-'}</p>
              </div>

              <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg">
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Branch Name</p>
                <p className="mt-1 text-base md:text-lg font-medium text-gray-900 dark:text-white">{business.bank_branch_name || '-'}</p>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        <Card className="transform transition-all duration-300 hover:shadow-md">
          <div className="p-4 md:p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                Customers <span className="ml-1 text-sm text-gray-500 dark:text-gray-400">({customers.length})</span>
              </h2>
              <Link to={`/billing/customer?business=${businessId}`} className="text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-300 flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                Add
              </Link>
            </div>

            {customers.length === 0 ? (
              <div className="text-center py-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-2 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <p className="text-gray-500 dark:text-gray-400">No customers linked to this business.</p>
                <Link to="/billing/customer" className="mt-2 inline-block text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-300 font-medium">
                  Add a customer
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {customers.map((customer) => (
                  <div key={customer.id} className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors duration-150">
                    <Link to={`/billing/customer/${customer.id}`} className="text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-300 font-medium block">
                      {customer.name}
                    </Link>
                    <div className="flex justify-between mt-1">
                      <p className="text-sm text-gray-600 dark:text-gray-400">{customer.gst_number || 'No GST'}</p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">{customer.mobile_number || 'No Phone'}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card className="transform transition-all duration-300 hover:shadow-md">
          <div className="p-4 md:p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Recent Invoices <span className="ml-1 text-sm text-gray-500 dark:text-gray-400">({invoices.length})</span>
              </h2>
              <Link to={`/billing/invoice/list?business_id=${businessId}`} className="text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-300 flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                View All
              </Link>
            </div>

            {renderWithLoading(loadingStates.invoices, (
              invoices.length === 0 ? (
              <div className="text-center py-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-2 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-gray-500 dark:text-gray-400">No invoices found for this business.</p>
                <Link to="/billing/invoice/new" className="mt-2 inline-block text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-300 font-medium">
                  Create an invoice
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {invoices.slice(0, 5).map((invoice) => (
                  <div key={invoice.id} className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors duration-150">
                    <div className="flex justify-between items-start">
                      <Link to={`/billing/invoice/${invoice.id}`} className="text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-300 font-medium">
                        {invoice.invoice_number}
                      </Link>
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${invoice.type_of_invoice === 'outward' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'}`}>
                        {invoice.type_of_invoice === 'outward' ? 'Outward' : 'Inward'}
                      </span>
                    </div>
                    <div className="flex justify-between mt-1">
                      <p className="text-sm text-gray-600 dark:text-gray-400">{formatDate(invoice.invoice_date)}</p>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{formatIndianCurrency(invoice.total_amount)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

export default BusinessDetail;
