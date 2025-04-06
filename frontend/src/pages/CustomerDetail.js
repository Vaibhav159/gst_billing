import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import Button from '../components/Button';
import LoadingSpinner from '../components/LoadingSpinner';
import ActionButton from '../components/ActionButton';
import ActionMenu from '../components/ActionMenu';
import apiClient from '../api/client';
import { formatIndianCurrency, formatDate } from '../utils/formatters';

function CustomerDetail() {
  const { customerId } = useParams();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [loadingStates, setLoadingStates] = useState({
    customer: true,
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

  // Fetch customer details
  useEffect(() => {
    // Fetch customer data
    const fetchCustomer = async () => {
      try {
        updateLoadingState('customer', true);
        const customerResponse = await apiClient.get(`/customers/${customerId}/`);

        // Validate customer data
        const customerData = customerResponse.data;
        if (!customerData || typeof customerData !== 'object') {
          throw new Error('Invalid customer data received');
        }

        setCustomer(customerData);
        setError(null);
      } catch (err) {
        console.error('Error fetching customer details:', err);
        setError('Failed to load customer details. Please try again.');
      } finally {
        updateLoadingState('customer', false);
      }
    };

    // Fetch invoices for this customer
    const fetchInvoices = async () => {
      try {
        updateLoadingState('invoices', true);
        const invoicesResponse = await apiClient.get(`/invoices/`, {
          params: { customer_id: customerId }
        });

        // Validate invoices data
        const invoiceData = invoicesResponse.data.results || invoicesResponse.data || [];
        const validInvoices = Array.isArray(invoiceData)
          ? invoiceData.filter(invoice => invoice && typeof invoice === 'object' && invoice.id)
          : [];

        setInvoices(validInvoices);
      } catch (err) {
        console.error('Error fetching customer invoices:', err);
        // Don't set global error for invoices - just log it
      } finally {
        updateLoadingState('invoices', false);
      }
    };

    // Start fetching data in parallel
    fetchCustomer();
    fetchInvoices();
  }, [customerId]);

  // Handle customer deletion
  const handleDelete = async () => {
    if (window.confirm('Are you sure you want to delete this customer?')) {
      try {
        await apiClient.delete(`/customers/${customerId}/`);
        navigate('/billing/customer/list');
      } catch (err) {
        console.error('Error deleting customer:', err);
        alert('Failed to delete customer. Please try again.');
      }
    }
  };

  // Check if the main customer data is still loading
  const isMainDataLoading = loadingStates.customer;

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
      <div className="flex flex-col justify-center items-center h-64 animate-pulse">
        <LoadingSpinner size="lg" className="text-primary-600 dark:text-primary-400" />
        <p className="mt-4 text-gray-600 dark:text-gray-400 font-medium">
          Loading customer details...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 max-w-md mx-auto">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 rounded-lg p-6 mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-4 text-red-500 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => navigate('/billing/customer/list')}
            icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>}
          >
            Back to List
          </Button>
        </div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="text-center py-8 max-w-md mx-auto">
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-6 mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-4 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <p className="text-gray-600 dark:text-gray-400 mb-4">Customer not found.</p>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => navigate('/billing/customer/list')}
            icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>}
          >
            Back to List
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 mr-2 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          {customer.name}
        </h1>
        <div className="flex flex-wrap gap-2">
          <Link to={`/billing/customer/edit/${customerId}`}>
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
          <Link to="/billing/customer/list">
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

      <Card className="transform transition-all duration-300 hover:shadow-md">
        <div className="p-4 md:p-6">
          <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Customer Information
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Name</p>
              <p className="mt-1 text-base md:text-lg font-medium text-gray-900 dark:text-white">{customer.name}</p>
            </div>

            <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">GST Number</p>
              <p className="mt-1 text-base md:text-lg font-medium text-gray-900 dark:text-white">{customer.gst_number || '-'}</p>
            </div>

            <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Phone Number</p>
              <p className="mt-1 text-base md:text-lg font-medium text-gray-900 dark:text-white">{customer.phone_number || '-'}</p>
            </div>

            <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Email</p>
              <p className="mt-1 text-base md:text-lg font-medium text-gray-900 dark:text-white">{customer.email || '-'}</p>
            </div>

            <div className="md:col-span-2 bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Address</p>
              <p className="mt-1 text-base md:text-lg font-medium text-gray-900 dark:text-white">{customer.address || '-'}</p>
            </div>
          </div>
        </div>
      </Card>

      <Card className="transform transition-all duration-300 hover:shadow-md">
        <div className="p-4 md:p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Invoices
            </h2>
            <div className="text-sm text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-full">
              Total: {invoices.length} invoice{invoices.length !== 1 ? 's' : ''}
            </div>
          </div>

          {renderWithLoading(loadingStates.invoices, (
            invoices.length === 0 ? (
            <div className="text-center py-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-2 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-gray-500 dark:text-gray-400">No invoices found for this customer.</p>
              <Link to="/billing/invoice/new" className="mt-2 inline-block text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-300 font-medium">
                Create an invoice
              </Link>
            </div>
          ) : (
            <>
              {/* Desktop View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-800">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Invoice Number
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Date
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Business
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Amount
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Type
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {invoices.map((invoice) => {
                      // Skip rendering if invoice doesn't have required properties
                      if (!invoice || !invoice.id) return null;

                      return (
                        <tr key={invoice.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-150">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900 dark:text-white">{invoice.invoice_number || '-'}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-500 dark:text-gray-400">{formatDate(invoice.invoice_date) || '-'}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-500 dark:text-gray-400">{invoice.business_name || '-'}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-500 dark:text-gray-400">{formatIndianCurrency(invoice.total_amount) || '-'}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${invoice.type_of_invoice === 'outward' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'}`}>
                              {invoice.type_of_invoice === 'outward' ? 'Outward' : 'Inward'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                            <ActionButton
                              type="view"
                              to={`/billing/invoice/${invoice.id}`}
                              label="View Invoice"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile View - Card-based layout */}
              <div className="md:hidden space-y-4">
                {invoices.map((invoice) => {
                  if (!invoice || !invoice.id) return null;

                  return (
                    <div key={invoice.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 transition-all duration-200 hover:shadow-md">
                      <div className="flex justify-between items-start mb-2">
                        <Link to={`/billing/invoice/${invoice.id}`} className="text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-300 font-medium">
                          {invoice.invoice_number || '-'}
                        </Link>
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${invoice.type_of_invoice === 'outward' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'}`}>
                          {invoice.type_of_invoice === 'outward' ? 'Outward' : 'Inward'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-sm mb-2">
                        <div>
                          <p className="text-gray-500 dark:text-gray-400 text-xs">Date</p>
                          <p className="font-medium text-gray-900 dark:text-white">{formatDate(invoice.invoice_date) || '-'}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 dark:text-gray-400 text-xs">Amount</p>
                          <p className="font-medium text-gray-900 dark:text-white">{formatIndianCurrency(invoice.total_amount) || '-'}</p>
                        </div>
                      </div>

                      <div>
                        <p className="text-gray-500 dark:text-gray-400 text-xs">Business</p>
                        <p className="font-medium text-gray-900 dark:text-white truncate">{invoice.business_name || '-'}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )
          ))}
        </div>
      </Card>
    </div>
  );
}

export default CustomerDetail;
