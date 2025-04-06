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
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Invoices</h1>
        <div className="flex space-x-2">
          <Link to="/billing/invoice/import">
            <Button variant="outline">Import from CSV</Button>
          </Link>
          <Link to="/billing/invoice/new">
            <Button variant="primary">Create Invoice</Button>
          </Link>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <div className="p-4">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">Total Outward</h3>
            <p className="mt-2 text-2xl font-semibold text-green-600 dark:text-green-400">
              {formatIndianCurrency(totalAmountOutward)}
            </p>
          </div>
        </Card>

        <Card>
          <div className="p-4">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">Total Inward</h3>
            <p className="mt-2 text-2xl font-semibold text-blue-600 dark:text-blue-400">
              {formatIndianCurrency(totalAmountInward)}
            </p>
          </div>
        </Card>

        <Card>
          <div className="p-4">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">Net Amount</h3>
            <p className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">
              {formatIndianCurrency(totalAmountOutward - totalAmountInward)}
            </p>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <div className="p-4">
          <h2 className="text-lg font-medium mb-4 text-gray-900 dark:text-white">Filters</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

            <div className="md:col-span-2 flex items-end">
              <Button
                variant="outline"
                className="ml-auto"
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

      {/* Invoice List */}
      <Card>
        {loading ? (
          <div className="flex justify-center items-center py-8">
            <LoadingSpinner size="lg" />
          </div>
        ) : error ? (
          <div className="text-center py-8 text-red-500">
            <p>{error}</p>
          </div>
        ) : invoices.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500 dark:text-gray-400">No invoices found. Try adjusting your filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
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
                    <tr key={invoice.id}>
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
