import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Card from '../components/Card';
import Button from '../components/Button';
import FormInput from '../components/FormInput';
import FormSelect from '../components/FormSelect';
import LoadingSpinner from '../components/LoadingSpinner';
import Pagination from '../components/Pagination';
import apiClient from '../api/client';
import { formatIndianCurrency, formatDate } from '../utils/formatters';

function InvoiceList() {
  const [invoices, setInvoices] = useState([]);
  const [businesses, setBusinesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalAmountInward, setTotalAmountInward] = useState(0);
  const [totalAmountOutward, setTotalAmountOutward] = useState(0);
  const [filters, setFilters] = useState({
    invoice_number: '',
    business_id: '',
    start_date: '',
    end_date: '',
    type_of_invoice: ''
  });

  // Function to fetch invoices
  const fetchInvoices = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        page: currentPage,
        ...filters
      };

      // Remove empty filters
      Object.keys(params).forEach(key => {
        if (params[key] === '') {
          delete params[key];
        }
      });

      // Fetch invoices for the current page
      const response = await apiClient.get('/invoices/', { params });
      setInvoices(response.data.results || response.data);

      // Set pagination data if available
      if (response.data.count) {
        setTotalPages(Math.ceil(response.data.count / 15)); // Assuming 15 items per page
      }

      // Fetch total amounts (using the same filters but without pagination)
      const totalsParams = { ...params };
      delete totalsParams.page; // Remove pagination parameter

      const totalsResponse = await apiClient.get('/invoices/totals/', { params: totalsParams });

      // Set totals from the API response
      setTotalAmountInward(parseFloat(totalsResponse.data.inward_total || 0));
      setTotalAmountOutward(parseFloat(totalsResponse.data.outward_total || 0));

      setError(null);
    } catch (err) {
      console.error('Error fetching invoices:', err);
      setError('Failed to load invoices. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [currentPage, filters]);

  // Handle invoice deletion
  const handleDeleteInvoice = useCallback(async (invoiceId) => {
    if (!window.confirm('Are you sure you want to delete this invoice? This action cannot be undone.')) {
      return;
    }

    try {
      setDeleting(true);
      await apiClient.delete(`/invoices/${invoiceId}/`);

      // Refresh the invoice list
      await fetchInvoices();

      // Show success message
      alert('Invoice deleted successfully');
    } catch (err) {
      console.error('Error deleting invoice:', err);
      alert('Failed to delete invoice. Please try again.');
    } finally {
      setDeleting(false);
    }
  }, [fetchInvoices]);

  // Fetch invoices with filters
  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);



  // Fetch businesses for filter
  useEffect(() => {
    const fetchBusinesses = async () => {
      try {
        const response = await apiClient.get('/businesses/');
        setBusinesses(response.data.results || response.data);
      } catch (err) {
        console.error('Error fetching businesses:', err);
      }
    };

    fetchBusinesses();
  }, []);

  // Handle filter changes
  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({
      ...prev,
      [name]: value
    }));
    setCurrentPage(1); // Reset to first page when filters change
  };

  // Handle page change
  const handlePageChange = (page) => {
    setCurrentPage(page);
  };

  // Handle date range selection
  const handleDateRangeChange = (e) => {
    const financialYear = e.target.value;
    if (!financialYear) {
      setFilters(prev => ({
        ...prev,
        start_date: '',
        end_date: ''
      }));
      return;
    }

    const [startYear] = financialYear.split('-');
    const startDate = `${startYear}-04-01`; // April 1st
    const endDate = `${parseInt(startYear) + 1}-03-31`; // March 31st next year

    setFilters(prev => ({
      ...prev,
      start_date: startDate,
      end_date: endDate
    }));
  };

  // Generate financial year options
  const getFinancialYearOptions = () => {
    const currentYear = new Date().getFullYear();
    const years = [];

    // Generate last 5 financial years
    for (let i = 0; i < 5; i++) {
      const year = currentYear - i;
      years.push({
        value: `${year}-${year + 1}`,
        label: `FY ${year}-${year + 1}`
      });
    }

    return years;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header Section with Responsive Design */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Invoices</h1>
        <div className="flex flex-wrap gap-2">
          <Link to="/billing/invoice/import">
            <Button
              variant="outline"
              icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>}
            >
              Import CSV
            </Button>
          </Link>
          <Link to="/billing/invoice/new">
            <Button
              variant="primary"
              icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
              </svg>}
            >
              Create Invoice
            </Button>
          </Link>
        </div>
      </div>

      {/* Summary Cards with Improved Styling */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card className="transform transition-all duration-300 hover:scale-105">
          <div className="p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">Total Outward</h3>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-green-500 dark:text-green-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3.293 9.707a1 1 0 010-1.414l6-6a1 1 0 011.414 0l6 6a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L4.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <p className="mt-2 text-2xl font-semibold text-green-600 dark:text-green-400">
              {formatIndianCurrency(totalAmountOutward)}
            </p>
          </div>
        </Card>

        <Card className="transform transition-all duration-300 hover:scale-105">
          <div className="p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">Total Inward</h3>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-blue-500 dark:text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.707 10.293a1 1 0 010 1.414l-6 6a1 1 0 01-1.414 0l-6-6a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l4.293-4.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <p className="mt-2 text-2xl font-semibold text-blue-600 dark:text-blue-400">
              {formatIndianCurrency(totalAmountInward)}
            </p>
          </div>
        </Card>

        <Card className="transform transition-all duration-300 hover:scale-105 sm:col-span-2 lg:col-span-1">
          <div className="p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">Net Amount</h3>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-gray-500 dark:text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 14a6 6 0 110-12 6 6 0 010 12z" clipRule="evenodd" />
                <path d="M10 6a1 1 0 011 1v3.586l2.707 2.707a1 1 0 01-1.414 1.414l-3-3A1 1 0 019 11V7a1 1 0 011-1z" />
              </svg>
            </div>
            <p className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">
              {formatIndianCurrency(totalAmountOutward - totalAmountInward)}
            </p>
          </div>
        </Card>
      </div>

      {/* Filters with Collapsible Panel for Mobile */}
      <Card>
        <div className="p-4">
          <div className="flex items-center justify-between cursor-pointer mb-2"
               onClick={() => document.getElementById('filterContent').classList.toggle('hidden')}>
            <h2 className="text-lg font-medium text-gray-900 dark:text-white flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd" />
              </svg>
              Filters
            </h2>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-500 dark:text-gray-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </div>
          <div id="filterContent" className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FormInput
              label="Invoice Number"
              id="invoice_number"
              name="invoice_number"
              value={filters.invoice_number}
              onChange={handleFilterChange}
              placeholder="Search by invoice number"
            />

            <FormSelect
              label="Business"
              id="business_id"
              name="business_id"
              value={filters.business_id}
              onChange={handleFilterChange}
              placeholder="All Businesses"
              options={businesses.map(business => ({
                value: business.id,
                label: business.name
              }))}
            />

            <FormSelect
              label="Invoice Type"
              id="type_of_invoice"
              name="type_of_invoice"
              value={filters.type_of_invoice}
              onChange={handleFilterChange}
              placeholder="All Types"
              options={[
                { value: 'outward', label: 'Outward' },
                { value: 'inward', label: 'Inward' }
              ]}
            />

            <FormSelect
              label="Financial Year"
              id="financial_year"
              name="financial_year"
              value={filters.start_date ? `${filters.start_date.split('-')[0]}-${parseInt(filters.start_date.split('-')[0]) + 1}` : ''}
              onChange={handleDateRangeChange}
              placeholder="All Time"
              options={getFinancialYearOptions()}
            />

            <div className="md:col-span-2 flex items-end justify-end">
              <Button
                variant="outline"
                icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>}
                onClick={() => {
                  setFilters({
                    invoice_number: '',
                    business_id: '',
                    start_date: '',
                    end_date: '',
                    type_of_invoice: ''
                  });
                  setCurrentPage(1);
                }}
              >
                Clear Filters
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Invoice List with Responsive Design */}
      <Card>
        {loading ? (
          <div className="flex justify-center items-center py-8">
            <LoadingSpinner size="lg" />
          </div>
        ) : error ? (
          <div className="text-center py-8 text-red-500 dark:text-red-400">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p>{error}</p>
          </div>
        ) : invoices.length === 0 ? (
          <div className="text-center py-8">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-2 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-gray-500 dark:text-gray-400">No invoices found. Try adjusting your filters.</p>
          </div>
        ) : (
          <>
            {/* Desktop View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="table-modern min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      #
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Invoice Number
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Date
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Customer
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
                  {invoices.map((invoice, index) => {
                    // Calculate the serial number based on the current page
                    const serialNumber = (currentPage - 1) * 15 + index + 1;

                    return (
                      <tr key={invoice.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-150">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-500 dark:text-gray-400">{serialNumber}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">{invoice.invoice_number}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-500 dark:text-gray-400">{formatDate(invoice.invoice_date)}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-500 dark:text-gray-400">{invoice.customer_name}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-500 dark:text-gray-400">{invoice.business_name}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-500 dark:text-gray-400">{formatIndianCurrency(invoice.total_amount)}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${invoice.type_of_invoice === 'outward' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'}`}>
                            {invoice.type_of_invoice === 'outward' ? 'Outward' : 'Inward'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <Link to={`/billing/invoice/${invoice.id}`} className="text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-300 mr-4">
                            View
                          </Link>
                          <Link to={`/billing/invoice/${invoice.id}/print`} className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 mr-4">
                            Print
                          </Link>
                          <button
                            onClick={() => handleDeleteInvoice(invoice.id)}
                            className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                            disabled={deleting}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile View - Card-based layout */}
            <div className="md:hidden">
              <div className="space-y-4">
                {invoices.map((invoice, index) => {
                  // Calculate the serial number based on the current page
                  const serialNumber = (currentPage - 1) * 15 + index + 1;

                  return (
                    <div key={invoice.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 transition-all duration-200 hover:shadow-md">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <span className="text-xs text-gray-500 dark:text-gray-400">#{serialNumber}</span>
                          <h3 className="text-lg font-medium text-gray-900 dark:text-white">{invoice.invoice_number}</h3>
                        </div>
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${invoice.type_of_invoice === 'outward' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'}`}>
                          {invoice.type_of_invoice === 'outward' ? 'Outward' : 'Inward'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                        <div>
                          <p className="text-gray-500 dark:text-gray-400">Date</p>
                          <p className="font-medium text-gray-900 dark:text-white">{formatDate(invoice.invoice_date)}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 dark:text-gray-400">Amount</p>
                          <p className="font-medium text-gray-900 dark:text-white">{formatIndianCurrency(invoice.total_amount)}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 dark:text-gray-400">Customer</p>
                          <p className="font-medium text-gray-900 dark:text-white truncate">{invoice.customer_name}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 dark:text-gray-400">Business</p>
                          <p className="font-medium text-gray-900 dark:text-white truncate">{invoice.business_name}</p>
                        </div>
                      </div>

                      <div className="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
                        <Link to={`/billing/invoice/${invoice.id}`} className="text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-300 font-medium">
                          View
                        </Link>
                        <Link to={`/billing/invoice/${invoice.id}/print`} className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium">
                          Print
                        </Link>
                        <button
                          onClick={() => handleDeleteInvoice(invoice.id)}
                          className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 font-medium"
                          disabled={deleting}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {totalPages > 1 && (
          <div className="py-4">
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={handlePageChange}
            />
          </div>
        )}
      </Card>
    </div>
  );
}

export default InvoiceList;
