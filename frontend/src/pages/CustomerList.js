import React, { useState, useEffect, useCallback, useRef } from 'react';
import useDebounce from '../hooks/useDebounce';
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

import apiClient, { createCancelToken } from '../api/client';
import { useRowClick } from '../utils/navigationHelpers';

function CustomerList() {
  // Initialize state with default values
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [businesses, setBusinesses] = useState([]);
  const [sortField, setSortField] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');

  // Row click handler
  const handleCustomerRowClick = useRowClick('/billing/customer/', {
    // Ignore clicks on action buttons and menus
    ignoreClasses: ['action-button', 'btn', 'relative'],
    // Special handling for business references
    specialHandling: {
      'business': (id) => navigate(`/billing/business/${id}`)
    }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Use a ref to track if the component is mounted
  const isMounted = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMounted.current = false;
      console.log('CustomerList component unmounting');
    };
  }, []);

  console.log('Initial state:', {
    customers,
    businesses,
    loading,
    error,
    currentPage,
    totalPages
  });
  // Local state for the search input field (updates immediately with typing)
  const [searchInput, setSearchInput] = useState('');

  // Reference to the search input element to maintain focus
  const searchInputRef = useRef(null);

  const [filters, setFilters] = useState({
    search: '',
    business_id: ''
  });

  // Debounce the search input with a 500ms delay
  // This will only update the actual search filter after the delay
  const debouncedSearchTerm = useDebounce(searchInput, 500);

  // No need for test API connection in production code

  // Handle sorting
  const handleSort = (field, direction) => {
    setSortField(field);
    setSortDirection(direction);
    setCurrentPage(1); // Reset to first page when sorting changes
  };

  // Use refs to track the current request and prevent duplicate requests in StrictMode
  const currentRequest = useRef(null);
  const requestCache = useRef(new Map());
  const requestId = useRef(0);

  // Single useEffect for fetching customers data
  useEffect(() => {
    // Debug log to track when this effect runs and with what dependencies
    console.log('CustomerList useEffect triggered with:', {
      currentPage,
      filters,
      sortField,
      sortDirection,
      customersLength: customers.length
    });

    // Skip if component is unmounted
    if (!isMounted.current) return;

    // Generate a cache key based on the current request parameters
    const cacheKey = JSON.stringify({
      page: currentPage,
      filters,
      sortField,
      sortDirection
    });

    // Check if we already have a request in progress with these exact parameters
    if (requestCache.current.has(cacheKey)) {
      console.log('Skipping duplicate request with same parameters');
      return;
    }

    // Increment request ID to track this specific request
    const thisRequestId = ++requestId.current;

    // Cancel any in-flight request
    if (currentRequest.current) {
      currentRequest.current.cancel('New request initiated');
    }

    // Create a new cancel token source
    const cancelTokenSource = createCancelToken();
    currentRequest.current = cancelTokenSource;

    // Add this request to the cache
    requestCache.current.set(cacheKey, thisRequestId);

    // Set loading state only if we don't already have data
    if (customers.length === 0) {
      setLoading(true);
    }

    const fetchCustomers = async () => {
      try {
        // Build request parameters
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

        // Make API request
        const response = await apiClient.get('/customers/', {
          params,
          cancelToken: cancelTokenSource.token
        });

        // Process response data
        let customerData;
        if (response.data && response.data.results) {
          customerData = response.data.results;
        } else if (Array.isArray(response.data)) {
          customerData = response.data;
        } else if (response.data && typeof response.data === 'object' && response.data.data && Array.isArray(response.data.data)) {
          customerData = response.data.data;
        } else {
          customerData = [];
        }

        // Filter valid customers
        const validCustomers = Array.isArray(customerData)
          ? customerData.filter(customer => customer && typeof customer === 'object' && customer.id)
          : [];

        // Update state if component is still mounted and this is still the current request
        if (isMounted.current && currentRequest.current === cancelTokenSource) {
          setCustomers(validCustomers);

          // Set pagination data
          if (response.data && response.data.count) {
            setTotalPages(Math.ceil(response.data.count / 15)); // Assuming 15 items per page
          } else if (validCustomers.length > 0) {
            setTotalPages(1);
          }

          setError(null);
          setLoading(false);
        }
      } catch (err) {
        // Only set error if this is still the current request and it wasn't cancelled
        if (isMounted.current && currentRequest.current === cancelTokenSource) {
          // Check if this is a cancellation error
          const isCancelled = err.constructor &&
                             (err.constructor.name === 'CanceledError' ||
                              err.constructor.name === 'Cancel' ||
                              err.name === 'CanceledError' ||
                              err.name === 'Cancel');

          if (!isCancelled) {
            console.error('Error fetching customers:', err);
            setError('Failed to load customers. Please try again.');
          } else {
            // This was a cancellation, don't show an error
            console.log('Request was cancelled, not showing error');
          }

          setLoading(false);
        }
      }
    };

    fetchCustomers();

    // Cleanup function
    return () => {
      // Cancel the request if it's still the current one
      if (currentRequest.current === cancelTokenSource) {
        cancelTokenSource.cancel('Component unmounted or dependencies changed');
        currentRequest.current = null;
      }

      // Remove this request from the cache
      requestCache.current.delete(cacheKey);
    };
  }, [currentPage, filters, sortField, sortDirection]);



  // Fetch businesses for filter
  useEffect(() => {
    console.log('fetchBusinesses useEffect triggered');
    if (!isMounted.current) {
      console.log('Component unmounted, not fetching businesses');
      return;
    }

    const cancelTokenSource = createCancelToken();

    const fetchBusinesses = async () => {
      console.log('fetchBusinesses function executing');
      try {
        console.log('Making API request to fetch businesses');
        // Use the correct API endpoint with apiClient
        console.log('Using apiClient for API endpoint: /businesses/');
        const response = await apiClient.get('/businesses/', {
          cancelToken: cancelTokenSource.token,
          // Don't show loading indicator for this secondary request
          showLoading: false
        });
        console.log('Business API response data type:', typeof response.data);
        console.log('Business API response data:', response.data);
        console.log('Business API response data structure:', {
          hasResults: response.data && response.data.results ? 'yes' : 'no',
          isArray: Array.isArray(response.data) ? 'yes' : 'no',
          keys: response.data ? Object.keys(response.data) : 'none'
        });

        // Ensure we have a valid array of businesses
        let businessData;
        if (response.data && response.data.results) {
          console.log('Using response.data.results for businesses');
          businessData = response.data.results;
        } else if (Array.isArray(response.data)) {
          console.log('Using response.data as array for businesses');
          businessData = response.data;
        } else if (response.data && typeof response.data === 'object') {
          // Try to extract data from response object
          console.log('Trying to extract data from response object for businesses');
          if (response.data.data && Array.isArray(response.data.data)) {
            console.log('Found data array in response.data.data for businesses');
            businessData = response.data.data;
          } else {
            console.log('No valid data format found in object for businesses, using empty array');
            businessData = [];
          }
        } else {
          console.log('No valid business data format found, using empty array');
          businessData = [];
        }

        // Validate that each business has the expected properties
        const validBusinesses = Array.isArray(businessData)
          ? businessData.filter(business => business && typeof business === 'object' && business.id && business.name)
          : [];

        console.log('Setting businesses:', validBusinesses);
        console.log('Setting businesses state with:', validBusinesses);
        if (isMounted.current) {
          setBusinesses([...validBusinesses]); // Create a new array to ensure state update
        } else {
          console.log('Component unmounted, not setting businesses state');
        }
      } catch (err) {
        if (!(err.constructor && err.constructor.name === 'CanceledError')) {
          console.error('Error fetching businesses:', err);
          // Set to empty array on error to prevent mapping issues
          if (isMounted.current) {
            setBusinesses([]);
          } else {
            console.log('Component unmounted, not setting businesses state');
          }
        }
      }
    };

    fetchBusinesses();

    // Cleanup function
    return () => {
      console.log('Cleaning up fetchBusinesses effect');
      cancelTokenSource.cancel('Component unmounted');
    };
  }, [isMounted]);

  // Update filters when debounced search term changes
  useEffect(() => {
    if (isMounted.current) {
      console.log('Debounced search term changed:', debouncedSearchTerm);
      setFilters(prev => ({
        ...prev,
        search: debouncedSearchTerm
      }));
      setCurrentPage(1); // Reset to first page when search changes

      // Maintain focus on the search input after the API call
      if (searchInputRef.current) {
        searchInputRef.current.focus();
      }
    }
  }, [debouncedSearchTerm, isMounted]);

  // Handle filter changes
  const handleFilterChange = useCallback((e) => {
    console.log('handleFilterChange called with', e?.target);
    try {
      if (!e || !e.target) {
        console.error('Invalid event object in handleFilterChange');
        return;
      }

      const { name, value } = e.target;
      if (!name) {
        console.error('Missing name in event target');
        return;
      }

      // Handle search input separately with debounce
      if (name === 'search') {
        console.log('Search input changed:', value);
        setSearchInput(value); // This updates the input field immediately
        return;
      }

      // Ensure value is properly formatted, especially for business_id
      console.log('Processing filter value:', { name, value, businessesLength: businesses.length });
      let processedValue = value || '';
      if (name === 'business_id' && value) {
        // Make sure business_id is a valid value
        const businessExists = Array.isArray(businesses) && businesses.some(business =>
          business && business.id && (business.id === parseInt(value) || business.id === value)
        );
        if (!businessExists) {
          console.warn('Selected business ID not found in businesses list:', value);
        }
      }

      console.log('Setting filters with processed value:', { name, processedValue });
      if (isMounted.current) {
        setFilters(prev => ({
          ...prev,
          [name]: processedValue
        }));
        setCurrentPage(1); // Reset to first page when filters change
      } else {
        console.log('Component unmounted, not setting filters state');
      }
    } catch (err) {
      console.error('Error handling filter change:', err);
      // Don't update filters if there's an error
    }
  }, [businesses, isMounted]);

  // Handle page change
  const handlePageChange = useCallback((page) => {
    console.log('handlePageChange called with', page);
    try {
      if (typeof page !== 'number' || isNaN(page) || page < 1) {
        console.error('Invalid page number:', page);
        return;
      }
      if (isMounted.current) {
        setCurrentPage(page);
      } else {
        console.log('Component unmounted, not setting currentPage state');
      }
    } catch (err) {
      console.error('Error handling page change:', err);
    }
  }, [isMounted]);

  // No debug logging in production

  // Add a key to force re-render when customers change
  const renderKey = `customers-${customers.length}-${loading}-${error}`;

  return (
    <div className="space-y-6 animate-fade-in" key={renderKey}>
      {/* Header Section with Responsive Design */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Customers</h1>
        <div className="flex flex-wrap gap-2">
          <Link to="/billing/customer/import">
            <Button
              variant="outline"
              className="mr-2"
              icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>}
            >
              Import CSV
            </Button>
          </Link>
          <Link to="/billing/customer">
            <Button
              variant="primary"
              icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
              </svg>}
            >
              Add Customer
            </Button>
          </Link>
        </div>
      </div>

      {/* Filters with Collapsible Panel for Mobile */}
      <Card>
        <div className="p-4">
          <div className="flex items-center justify-between cursor-pointer mb-2"
               onClick={() => document.getElementById('customerFilterContent').classList.toggle('hidden')}>
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
          <div id="customerFilterContent" className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormInput
              label="Customer Name"
              id="search"
              name="search"
              value={searchInput}
              onChange={handleFilterChange}
              placeholder="Search by name, GST or phone"
              ref={searchInputRef}
              autoFocus
            />

            <FormSelect
              label="Business"
              id="business_id"
              name="business_id"
              value={filters.business_id || ''}
              onChange={handleFilterChange}
              placeholder="All Businesses"
              options={Array.isArray(businesses) ? businesses.filter(business => {
                // Filter out invalid businesses
                if (!business || typeof business !== 'object' || !business.id || !business.name) {
                  return false;
                }
                return true;
              }).map(business => ({
                value: business.id,
                label: business.name
              })) : []}
            />
          </div>
        </div>
      </Card>

      {/* Customer List with Responsive Design */}
      <Card key={`card-${loading}-${error}-${customers.length}`}>
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
        ) : !customers || !Array.isArray(customers) || customers.length === 0 ? (
          <div className="text-center py-8">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-2 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <p className="text-gray-500 dark:text-gray-400">No customers found. Try adjusting your filters.</p>
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
                    <SortableHeader
                      label="Name"
                      field="name"
                      currentSortField={sortField}
                      currentSortDirection={sortDirection}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="GST Number"
                      field="gst_number"
                      currentSortField={sortField}
                      currentSortDirection={sortDirection}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="PAN Number"
                      field="pan_number"
                      currentSortField={sortField}
                      currentSortDirection={sortDirection}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Mobile"
                      field="mobile_number"
                      currentSortField={sortField}
                      currentSortDirection={sortDirection}
                      onSort={handleSort}
                    />
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700" key={`tbody-${customers.length}`}>
                  {Array.isArray(customers) && customers.length > 0 ? (
                    <React.Fragment key={`customers-${customers.length}`}>
                      {customers.map((customer, index) => {
                        // Skip rendering if customer doesn't have required properties
                        if (!customer || !customer.id) {
                          return null;
                        }

                        // Calculate the serial number based on the current page
                        const serialNumber = (currentPage - 1) * 15 + index + 1;

                        return (
                          <tr
                            key={customer.id}
                            className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-150 cursor-pointer"
                            onClick={(e) => handleCustomerRowClick(customer.id, e)}
                          >
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm font-medium text-gray-500 dark:text-gray-400">{serialNumber}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm font-medium text-gray-900 dark:text-white">{customer.name || 'Unnamed Customer'}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-gray-500 dark:text-gray-400">{customer.gst_number || '-'}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-gray-500 dark:text-gray-400">{customer.pan_number || '-'}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-gray-500 dark:text-gray-400">{customer.mobile_number || '-'}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                              {customer.id && (
                                <div className="flex items-center space-x-2">
                                  <ActionButton
                                    type="view"
                                    to={`/billing/customer/${customer.id}`}
                                    label="View Customer"
                                  />
                                  <ActionButton
                                    type="edit"
                                    to={`/billing/customer/edit/${customer.id}`}
                                    label="Edit Customer"
                                  />
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  ) : (
                    <tr>
                      <td colSpan="6" className="px-6 py-4 text-center text-gray-500 dark:text-gray-400">
                        No valid customer data found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile View - Card-based layout */}
            <div className="md:hidden">
              <div className="space-y-4">
                {Array.isArray(customers) && customers.length > 0 ? (
                  customers.map((customer, index) => {
                    if (!customer || !customer.id) {
                      return null;
                    }

                    // Calculate the serial number based on the current page
                    const serialNumber = (currentPage - 1) * 15 + index + 1;

                    return (
                      <div
                        key={customer.id}
                        className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 transition-all duration-200 hover:shadow-md cursor-pointer"
                        onClick={(e) => handleCustomerRowClick(customer.id, e)}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <span className="text-xs text-gray-500 dark:text-gray-400">#{serialNumber}</span>
                            <h3 className="text-lg font-medium text-gray-900 dark:text-white">{customer.name || 'Unnamed Customer'}</h3>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                          <div>
                            <p className="text-gray-500 dark:text-gray-400">GST Number</p>
                            <p className="font-medium text-gray-900 dark:text-white">{customer.gst_number || '-'}</p>
                          </div>
                          <div>
                            <p className="text-gray-500 dark:text-gray-400">PAN Number</p>
                            <p className="font-medium text-gray-900 dark:text-white">{customer.pan_number || '-'}</p>
                          </div>
                          <div>
                            <p className="text-gray-500 dark:text-gray-400">Mobile</p>
                            <p className="font-medium text-gray-900 dark:text-white">{customer.mobile_number || '-'}</p>
                          </div>
                        </div>

                        <div className="flex justify-end pt-2 border-t border-gray-200 dark:border-gray-700">
                          <ActionMenu
                            actions={[
                              {
                                type: 'view',
                                label: 'View Customer',
                                to: `/billing/customer/${customer.id}`
                              },
                              {
                                type: 'edit',
                                label: 'Edit Customer',
                                to: `/billing/customer/edit/${customer.id}`
                              }
                            ]}
                          />
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center py-4 text-gray-500 dark:text-gray-400">
                    No valid customer data found.
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {totalPages > 1 && typeof totalPages === 'number' && typeof currentPage === 'number' && (
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

// Wrap the component with React.memo to prevent unnecessary re-renders
export default React.memo(CustomerList);
