import React, { useState, useEffect, useCallback, useRef } from 'react';
import { debounce } from 'lodash'; // Import debounce from lodash
import { Link, useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import Button from '../components/Button';
import FormInput from '../components/FormInput';
import FormSelect from '../components/FormSelect';
import LoadingSpinner from '../components/LoadingSpinner';
import Pagination from '../components/Pagination';
import ActionButton from '../components/ActionButton';
import ActionMenu from '../components/ActionMenu';
import SortableHeader from '../components/SortableHeader';
import apiClient from '../api/client';
import customerService from '../api/customerService';
import invoiceService from '../api/invoiceService';
import { formatIndianCurrency, formatDate } from '../utils/formatters';
import { useRowClick } from '../utils/navigationHelpers';

function InvoiceList() {
  const navigate = useNavigate();
  const isInitialRender = useRef(true);
  const currentRequestRef = useRef(null);
  const [invoices, setInvoices] = useState([]);
  const [businesses, setBusinesses] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalAmountInward, setTotalAmountInward] = useState(0);
  const [totalAmountOutward, setTotalAmountOutward] = useState(0);
  const [sortField, setSortField] = useState('invoice_date');
  const [sortDirection, setSortDirection] = useState('desc');
  const [selectedInvoices, setSelectedInvoices] = useState([]);
  const [selectAll, setSelectAll] = useState(false);

  // Row click handler
  const handleInvoiceRowClick = useRowClick('/billing/invoice/', {
    // Ignore clicks on action buttons and menus
    ignoreClasses: ['action-button', 'btn', 'relative', 'checkbox-container', 'invoice-checkbox'],
    // Special handling for business and customer references
    specialHandling: {
      'business': (id) => navigate(`/billing/business/${id}`),
      'customer': (id) => navigate(`/billing/customer/${id}`)
    }
  });

  // Handle invoice selection
  const handleInvoiceSelection = (invoiceId) => {
    setSelectedInvoices(prev => {
      if (prev.includes(invoiceId)) {
        return prev.filter(id => id !== invoiceId);
      } else {
        return [...prev, invoiceId];
      }
    });
  };

  // Handle select all invoices (only affects current page)
  const handleSelectAll = () => {
    if (selectAll) {
      // Remove all current page invoices from selection
      const currentPageIds = invoices.map(invoice => invoice.id);
      setSelectedInvoices(prev => prev.filter(id => !currentPageIds.includes(id)));
    } else {
      // Add all current page invoices to selection
      const currentPageIds = invoices.map(invoice => invoice.id);
      setSelectedInvoices(prev => {
        // Create a new array with all previously selected IDs plus current page IDs
        // Use Set to remove duplicates
        return [...new Set([...prev, ...currentPageIds])];
      });
    }
    setSelectAll(!selectAll);
  };

  // Handle bulk print
  const handleBulkPrint = () => {
    if (selectedInvoices.length === 0) {
      alert('Please select at least one invoice to print.');
      return;
    }

    navigate(`/billing/invoice/bulk-print?ids=${selectedInvoices.join(',')}`);
  };

  // Handle select all filtered invoices
  const [selectingAll, setSelectingAll] = useState(false);
  const [totalFilteredCount, setTotalFilteredCount] = useState(0);

  const handleSelectAllFiltered = async () => {
    try {
      setSelectingAll(true);

      // Check if all filtered invoices are already selected
      if (totalFilteredCount > 0 && selectedInvoices.length === totalFilteredCount) {
        // If all are selected, unselect all
        setSelectedInvoices([]);
        setTotalFilteredCount(0);
        return;
      }

      // Prepare filter parameters (same as used for the current list view)
      const params = { ...filters };

      // Add sorting parameters if set
      if (sortField && sortDirection) {
        params.ordering = sortDirection === 'desc' ? `-${sortField}` : sortField;
      }

      // Remove empty filters
      Object.keys(params).forEach(key => {
        if (params[key] === '') {
          delete params[key];
        }
      });

      // Get all invoice IDs matching the current filters
      const result = await invoiceService.getAllInvoiceIds(params);

      // Update the total count for display
      setTotalFilteredCount(result.count);

      // Select all the IDs
      setSelectedInvoices(result.ids);

      // Show a success message
      if (result.count > 0) {
        alert(`Selected ${result.count} invoices matching your current filters.`);
      } else {
        alert('No invoices match your current filters.');
      }
    } catch (error) {
      console.error('Error selecting all filtered invoices:', error);
      alert('Failed to select all invoices. Please try again.');
    } finally {
      setSelectingAll(false);
    }
  };

  const [filters, setFilters] = useState({
    invoice_number: '',
    business_id: '',
    customer_id: '',
    start_date: '',
    end_date: '',
    type_of_invoice: ''
  });

  // Separate state for input values to maintain UI responsiveness
  const [inputValues, setInputValues] = useState({
    invoice_number: ''
  });

  // We've moved the fetchInvoices functionality directly into the useEffect

  // Handle sorting
  const handleSort = (field, direction) => {
    setSortField(field);
    setSortDirection(direction);
    setCurrentPage(1); // Reset to first page when sorting changes
  };

  // Handle invoice deletion
  const handleDeleteInvoice = useCallback(async (invoiceId) => {
    if (!window.confirm('Are you sure you want to delete this invoice? This action cannot be undone.')) {
      return;
    }

    try {
      setDeleting(true);
      await apiClient.delete(`/invoices/${invoiceId}/`);

      // Force a re-render to refresh the invoice list by updating a dependency of the main useEffect
      // We can do this by setting the current page to 1
      setCurrentPage(1);

      // Show success message
      alert('Invoice deleted successfully');
    } catch (err) {
      console.error('Error deleting invoice:', err);
      alert('Failed to delete invoice. Please try again.');
    } finally {
      setDeleting(false);
    }
  }, []);



  // Update selectAll state when invoices change
  useEffect(() => {
    if (invoices.length > 0) {
      // Check if all invoices on the current page are selected
      const allSelected = invoices.every(invoice => selectedInvoices.includes(invoice.id));
      setSelectAll(allSelected);
    } else {
      setSelectAll(false);
    }
  }, [invoices, selectedInvoices]);

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

  // Fetch customers for filter
  useEffect(() => {
    const fetchCustomers = async () => {
      try {
        const response = await customerService.getCustomers();
        setCustomers(response.results || response);
      } catch (err) {
        console.error('Error fetching customers:', err);
      }
    };

    fetchCustomers();
  }, []);

  // Initialize inputValues with filters
  useEffect(() => {
    setInputValues(prev => ({
      ...prev,
      invoice_number: filters.invoice_number
    }));
  }, [filters.invoice_number]);

  // Create a debounced version of setFilters for text inputs
  const debouncedSetFilters = useCallback(
    debounce((name, value) => {
      setFilters(prev => ({
        ...prev,
        [name]: value
      }));
      setCurrentPage(1); // Reset to first page when filters change
    }, 500), // 500ms debounce delay
    []
  );

  // Handle filter changes
  const handleFilterChange = (e) => {
    const { name, value, type } = e.target;

    // For text inputs (like invoice_number), use debounced update
    if (type === 'text') {
      // Update the input value immediately in the UI
      setInputValues(prev => ({
        ...prev,
        [name]: value
      }));

      // But debounce the actual API call
      debouncedSetFilters(name, value);
    } else {
      // For dropdowns and other non-text inputs, update immediately
      setFilters(prev => ({
        ...prev,
        [name]: value
      }));
      setCurrentPage(1); // Reset to first page when filters change
    }
  };

  // Handle page change
  const handlePageChange = (page) => {
    setCurrentPage(page);
    // Reset selectAll state when changing pages
    setSelectAll(false);
  };

  // Single useEffect to handle both setting default filter and fetching invoices
  useEffect(() => {
    // Function to set the current financial year filter
    const getCurrentFinancialYear = () => {
      const today = new Date();
      let startYear = today.getFullYear();
      let startMonth = 4; // April
      let startDay = 1;

      // If current month is before April, use previous year as start
      if (today.getMonth() < 3) { // 0-indexed, so 3 is April
        startYear -= 1;
      }

      // Format dates as YYYY-MM-DD strings
      const formatDate = (year, month, day) => {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      };

      return {
        startDate: formatDate(startYear, startMonth, startDay),
        endDate: formatDate(startYear + 1, 3, 31) // March 31st of next year
      };
    };

    const loadData = async () => {
      // Check if we need to set default financial year filter
      if (isInitialRender.current && !filters.start_date && !filters.end_date) {
        isInitialRender.current = false;
        const { startDate, endDate } = getCurrentFinancialYear();

        // Update filters with financial year dates
        setFilters(prev => ({
          ...prev,
          start_date: startDate,
          end_date: endDate
        }));

        // Don't fetch here - the filters update will trigger this effect again
        return;
      }

      // Fetch invoices
      try {
        setLoading(true);
        const params = {
          page: currentPage,
          ...filters
        };

        // Add sorting parameters if set
        if (sortField && sortDirection) {
          params.ordering = sortDirection === 'desc' ? `-${sortField}` : sortField;
        }

        // Remove empty filters
        Object.keys(params).forEach(key => {
          if (params[key] === '') {
            delete params[key];
          }
        });

        console.log('Fetching invoices with params:', params);

        // Create a request ID to track this specific request
        const requestId = Date.now() + Math.random(); // Add randomness to ensure uniqueness
        // Store the current request ID in a ref to ensure we're comparing the correct values
        currentRequestRef.current = requestId;

        // Fetch invoices for the current page
        const response = await apiClient.get('/invoices/', { params });

        // Only update state if this is still the most recent request
        // This prevents race conditions where older requests complete after newer ones
        if (currentRequestRef.current === requestId) {
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
        }
      } catch (err) {
        console.error('Error fetching invoices:', err);
        setError('Failed to load invoices. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [currentPage, filters, sortField, sortDirection]);

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
          <Button
            variant="secondary"
            onClick={handleBulkPrint}
            disabled={selectedInvoices.length === 0}
            icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a2 2 0 002 2h6a2 2 0 002-2v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a2 2 0 00-2-2H7a2 2 0 00-2 2zm8 0H7v3h6V4zm0 8H7v4h6v-4z" clipRule="evenodd" />
            </svg>}
            className={`relative ${selectedInvoices.length === 0 ? 'opacity-60 cursor-not-allowed' : ''}`}
            title={selectedInvoices.length === 0 ? "Select at least one invoice to print" : `Print ${selectedInvoices.length} selected invoice${selectedInvoices.length !== 1 ? 's' : ''}`}
          >
            <span>Print Selected</span>
            {selectedInvoices.length > 0 && (
              <span className="ml-2 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white bg-primary-600 rounded-full">
                {selectedInvoices.length}
              </span>
            )}
          </Button>
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

      {/* Selection notification */}
      {selectedInvoices.length > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4 flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-500 dark:text-blue-400 mr-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-sm text-blue-700 dark:text-blue-300">
            <p>
              <strong>{selectedInvoices.length}</strong> invoice{selectedInvoices.length !== 1 ? 's' : ''} selected across all pages.
              {totalFilteredCount > 0 && selectedInvoices.length === totalFilteredCount && (
                <span className="font-medium"> All invoices matching your current filters are selected.</span>
              )}
              <span className="block mt-1">Your selection is maintained when navigating between pages. Use the "Print Selected" button to download all selected invoices.</span>
            </p>
          </div>
        </div>
      )}

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
              value={inputValues.invoice_number}
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
              label="Customer"
              id="customer_id"
              name="customer_id"
              value={filters.customer_id}
              onChange={handleFilterChange}
              placeholder="All Customers"
              options={customers.map(customer => ({
                value: customer.id,
                label: customer.name
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
                    customer_id: '',
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
                      <div className="flex items-center">
                        <div className="checkbox-container mr-2">
                          <input
                            type="checkbox"
                            className="invoice-checkbox h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded cursor-pointer"
                            checked={selectAll}
                            onChange={handleSelectAll}
                          />
                        </div>
                        <span className="mr-2">#</span>

                        {/* Select All Filtered button - only shown when some items are selected */}
                        {selectedInvoices.length > 0 && (
                          <button
                            onClick={handleSelectAllFiltered}
                            disabled={selectingAll}
                            className="ml-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium flex items-center"
                            title={totalFilteredCount > 0 && selectedInvoices.length === totalFilteredCount
                              ? "Unselect all invoices"
                              : "Select all invoices matching your current filters"}
                          >
                            {selectingAll ? (
                              <>
                                <svg className="animate-spin -ml-1 mr-2 h-3 w-3 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                <span>Selecting...</span>
                              </>
                            ) : totalFilteredCount > 0 && selectedInvoices.length === totalFilteredCount ? (
                              <>
                                <svg className="h-3 w-3 mr-1" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                </svg>
                                <span>Unselect All</span>
                              </>
                            ) : (
                              <>
                                <svg className="h-3 w-3 mr-1" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                                  <path d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                                </svg>
                                <span>Select All Filtered</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </th>
                    <SortableHeader
                      label="Invoice Number"
                      field="invoice_number"
                      currentSortField={sortField}
                      currentSortDirection={sortDirection}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Date"
                      field="invoice_date"
                      currentSortField={sortField}
                      currentSortDirection={sortDirection}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Customer"
                      field="customer__name"
                      currentSortField={sortField}
                      currentSortDirection={sortDirection}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Business"
                      field="business__name"
                      currentSortField={sortField}
                      currentSortDirection={sortDirection}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Amount"
                      field="total_amount"
                      currentSortField={sortField}
                      currentSortDirection={sortDirection}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Type"
                      field="type_of_invoice"
                      currentSortField={sortField}
                      currentSortDirection={sortDirection}
                      onSort={handleSort}
                    />
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
                      <tr
                        key={invoice.id}
                        className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-150 cursor-pointer"
                        onClick={(e) => handleInvoiceRowClick(invoice.id, e)}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="checkbox-container mr-2" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                className="invoice-checkbox h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded cursor-pointer"
                                checked={selectedInvoices.includes(invoice.id)}
                                onChange={() => handleInvoiceSelection(invoice.id)}
                              />
                            </div>
                            <div className="text-sm font-medium text-gray-500 dark:text-gray-400">{serialNumber}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">{invoice.invoice_number}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-500 dark:text-gray-400">{formatDate(invoice.invoice_date)}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div
                            className="text-sm text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 hover:underline"
                            data-type="customer"
                            data-id={invoice.customer}
                          >
                            {invoice.customer_name}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div
                            className="text-sm text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 hover:underline"
                            data-type="business"
                            data-id={invoice.business}
                          >
                            {invoice.business_name}
                          </div>
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
                          <div className="flex items-center space-x-2">
                            <ActionButton
                              type="view"
                              to={`/billing/invoice/${invoice.id}`}
                              label="View Invoice"
                            />
                            <ActionButton
                              type="print"
                              to={`/billing/invoice/${invoice.id}/print`}
                              label="Print Invoice"
                            />
                            <ActionButton
                              type="delete"
                              onClick={() => handleDeleteInvoice(invoice.id)}
                              label="Delete Invoice"
                              disabled={deleting}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile View - Card-based layout */}
            <div className="md:hidden">
              {/* Mobile Select All controls - only shown when some items are selected */}
              {selectedInvoices.length > 0 && (
                <div className="mb-4 flex justify-between items-center bg-gray-50 dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      className="invoice-checkbox h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded cursor-pointer mr-2"
                      checked={selectAll}
                      onChange={handleSelectAll}
                    />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Current Page</span>
                  </div>

                  <button
                    onClick={handleSelectAllFiltered}
                    disabled={selectingAll}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium flex items-center"
                  >
                    {selectingAll ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-3 w-3 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Selecting...</span>
                      </>
                    ) : totalFilteredCount > 0 && selectedInvoices.length === totalFilteredCount ? (
                      <>
                        <svg className="h-3 w-3 mr-1" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                        <span>Unselect All</span>
                      </>
                    ) : (
                      <>
                        <svg className="h-3 w-3 mr-1" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                          <path d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                        </svg>
                        <span>Select All Filtered</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              <div className="space-y-4">
                {invoices.map((invoice, index) => {
                  // Calculate the serial number based on the current page
                  const serialNumber = (currentPage - 1) * 15 + index + 1;

                  return (
                    <div
                      key={invoice.id}
                      className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 transition-all duration-200 hover:shadow-md cursor-pointer"
                      onClick={(e) => handleInvoiceRowClick(invoice.id, e)}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center">
                          <div className="checkbox-container mr-2" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              className="invoice-checkbox h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded cursor-pointer"
                              checked={selectedInvoices.includes(invoice.id)}
                              onChange={() => handleInvoiceSelection(invoice.id)}
                            />
                          </div>
                          <div>
                            <span className="text-xs text-gray-500 dark:text-gray-400">#{serialNumber}</span>
                            <h3 className="text-lg font-medium text-gray-900 dark:text-white">{invoice.invoice_number}</h3>
                          </div>
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
                          <p
                            className="font-medium text-gray-900 dark:text-white truncate hover:text-primary-600 dark:hover:text-primary-400 hover:underline"
                            data-type="customer"
                            data-id={invoice.customer}
                          >
                            {invoice.customer_name}
                          </p>
                        </div>
                        <div>
                          <p className="text-gray-500 dark:text-gray-400">Business</p>
                          <p
                            className="font-medium text-gray-900 dark:text-white truncate hover:text-primary-600 dark:hover:text-primary-400 hover:underline"
                            data-type="business"
                            data-id={invoice.business}
                          >
                            {invoice.business_name}
                          </p>
                        </div>
                      </div>

                      <div className="flex justify-end pt-2 border-t border-gray-200 dark:border-gray-700">
                        <ActionMenu
                          actions={[
                            {
                              type: 'view',
                              label: 'View Invoice',
                              to: `/billing/invoice/${invoice.id}`
                            },
                            {
                              type: 'print',
                              label: 'Print Invoice',
                              to: `/billing/invoice/${invoice.id}/print`
                            },
                            {
                              type: 'delete',
                              label: 'Delete Invoice',
                              onClick: () => handleDeleteInvoice(invoice.id),
                              disabled: deleting
                            }
                          ]}
                        />
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
