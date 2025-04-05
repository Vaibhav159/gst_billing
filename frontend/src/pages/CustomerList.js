import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import Card from '../components/Card';
import Button from '../components/Button';
import FormInput from '../components/FormInput';
import FormSelect from '../components/FormSelect';
import LoadingSpinner from '../components/LoadingSpinner';
import Pagination from '../components/Pagination';
import axios from 'axios';
import { createCancelToken } from '../api/client';
// import { formatIndianCurrency } from '../utils/formatters';

console.log('CustomerList component loading');

function CustomerList() {
  console.log('CustomerList function initializing');
  console.log('Initial render of CustomerList component');
  // Initialize state with default values
  const [customers, setCustomers] = useState([]);
  const [businesses, setBusinesses] = useState([]);
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
  const [filters, setFilters] = useState({
    search: '',
    business_id: ''
  });

  // Test API connection on component mount using fetch API
  useEffect(() => {
    if (!isMounted.current) {
      console.log('Component unmounted, not testing API connection');
      return;
    }

    const testApiConnection = async () => {
      try {
        console.log('Testing API connection with fetch...');
        console.log('Testing with correct endpoint: /api/customers/');
        const response = await fetch('/api/customers/');
        const data = await response.json();
        console.log('API test successful with fetch:', { status: response.status, data });
      } catch (error) {
        console.error('API test failed with fetch:', error);
      }

      // Also try with axios
      try {
        console.log('Testing API connection with axios...');
        console.log('Testing with correct endpoint: /api/customers/');
        const response = await axios.get('/api/customers/');
        console.log('API test successful with axios:', response);
      } catch (error) {
        console.error('API test failed with axios:', error);
      }
    };

    testApiConnection();
  }, [isMounted]);

  // Fetch customers with filters - memoized to prevent unnecessary re-renders
  const fetchCustomers = useCallback(async () => {
    console.log('fetchCustomers callback executing');
    // Create a cancel token for this request
    const cancelTokenSource = createCancelToken();

    try {
      console.log('Setting loading state to true');
      if (isMounted.current) {
        setLoading(true);
      } else {
        console.log('Component unmounted, not setting loading state');
        return;
      }
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

      console.log('Making API request to fetch customers');
      // Use the correct API endpoint
      console.log('Using correct API endpoint: /api/customers/');
      // Use axios directly like in BusinessList.js instead of apiClient
      const response = await axios.get('/api/customers/', {
        params,
        cancelToken: cancelTokenSource.token
      });

      // Log the full response object
      console.log('Customer API response object:', response);
      console.log('Customer API response data type:', typeof response.data);
      console.log('Customer API response data:', response.data);
      console.log('Customer API response data structure:', {
        hasResults: response.data && response.data.results ? 'yes' : 'no',
        isArray: Array.isArray(response.data) ? 'yes' : 'no',
        keys: response.data ? Object.keys(response.data) : 'none'
      });

      // Ensure we have a valid array of customers with required properties
      let customerData;
      if (response.data && response.data.results) {
        console.log('Using response.data.results');
        customerData = response.data.results;
      } else if (Array.isArray(response.data)) {
        console.log('Using response.data as array');
        customerData = response.data;
      } else if (response.data && typeof response.data === 'object') {
        // Try to extract data from response object
        console.log('Trying to extract data from response object');
        if (response.data.data && Array.isArray(response.data.data)) {
          console.log('Found data array in response.data.data');
          customerData = response.data.data;
        } else {
          console.log('No valid data format found in object, using empty array');
          customerData = [];
        }
      } else {
        console.log('No valid data format found, using empty array');
        customerData = [];
      }
      console.log('Customer data extracted from response:', customerData);

      const validCustomers = Array.isArray(customerData)
        ? customerData.filter(customer => {
            const isValid = customer && typeof customer === 'object' && customer.id;
            if (!isValid) {
              console.warn('Invalid customer object found:', customer);
            }
            return isValid;
          })
        : [];

      console.log('Valid customers after filtering:', validCustomers);
      console.log('Setting customers state with:', validCustomers);
      if (isMounted.current) {
        setCustomers([...validCustomers]); // Create a new array to ensure state update
      } else {
        console.log('Component unmounted, not setting customers state');
      }

      // Set pagination data if available
      console.log('Checking pagination data:', {
        hasCount: response.data && response.data.count ? 'yes' : 'no',
        count: response.data && response.data.count ? response.data.count : 'none'
      });
      if (response.data && response.data.count) {
        const calculatedPages = Math.ceil(response.data.count / 15); // Assuming 15 items per page
        console.log('Setting totalPages to:', calculatedPages);
        if (isMounted.current) {
          setTotalPages(calculatedPages);
        } else {
          console.log('Component unmounted, not setting totalPages state');
        }
      } else if (validCustomers.length > 0) {
        // If we have customers but no pagination data, set totalPages to 1
        console.log('No pagination data available but we have customers, setting totalPages to 1');
        if (isMounted.current) {
          setTotalPages(1);
        } else {
          console.log('Component unmounted, not setting totalPages state');
        }
      } else {
        console.log('No pagination data available, keeping totalPages as:', totalPages);
      }

      console.log('Clearing error state');
      if (isMounted.current) {
        setError(null);
      } else {
        console.log('Component unmounted, not clearing error state');
      }
    } catch (err) {
      if (!axios.isCancel(err)) {
        console.error('Error fetching customers:', err);
        const errorMessage = 'Failed to load customers. Please try again.';
        console.log('Setting error state to:', errorMessage);
        if (isMounted.current) {
          setError(errorMessage);
        } else {
          console.log('Component unmounted, not setting error state');
        }
      } else {
        console.log('Request was cancelled, not setting error state');
      }
    } finally {
      console.log('Setting loading state to false');
      if (isMounted.current) {
        setLoading(false);
      } else {
        console.log('Component unmounted, not setting loading state');
      }
    }

    // Return the cancel function
    return () => cancelTokenSource.cancel('Component unmounted');
  }, [currentPage, filters, isMounted]);

  // Call fetchCustomers when dependencies change
  useEffect(() => {
    console.log('fetchCustomers useEffect triggered', { currentPage, filters });
    if (isMounted.current) {
      const cancelFetch = fetchCustomers();

      // Cleanup function to cancel request when component unmounts or dependencies change
      return () => {
        console.log('Cleaning up fetchCustomers effect');
        if (typeof cancelFetch === 'function') {
          cancelFetch();
        }
      };
    }
  }, [fetchCustomers, isMounted]);

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
        // Use the correct API endpoint
        console.log('Using correct API endpoint: /api/businesses/');
        // Use axios directly like in BusinessList.js
        const response = await axios.get('/api/businesses/', {
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
        if (!axios.isCancel(err)) {
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

  // Log the current state for debugging
  useEffect(() => {
    console.log('CustomerList state updated:', {
      customersLength: customers ? customers.length : 'undefined',
      customersIsArray: Array.isArray(customers),
      customersData: customers,
      businessesLength: businesses ? businesses.length : 'undefined',
      businessesIsArray: Array.isArray(businesses),
      loading,
      error,
      currentPage,
      totalPages,
      filters
    });
  }, [customers, businesses, loading, error, currentPage, totalPages, filters]);

  // Add a key to force re-render when customers change
  const renderKey = `customers-${customers.length}-${loading}-${error}`;

  return (
    <div className="space-y-6" key={renderKey}>
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Customers</h1>
        <Link to="/billing/customer">
          <Button variant="primary">Add Customer</Button>
        </Link>
      </div>

      <Card>
        <div className="p-4">
          <h2 className="text-lg font-medium mb-4">Filters</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormInput
              label="Customer Name"
              id="search"
              name="search"
              value={filters.search}
              onChange={handleFilterChange}
              placeholder="Search by name, GST or phone"
            />

            {console.log('Rendering FormSelect with businesses:', businesses)}
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
                  console.warn('Invalid business object found:', business);
                  return false;
                }
                return true;
              }).map(business => {
                console.log('Mapping business to option:', business);
                return {
                  value: business.id,
                  label: business.name
                };
              }) : []}
            />
          </div>
        </div>
      </Card>

      <Card key={`card-${loading}-${error}-${customers.length}`}>
        {loading ? (
          <div className="flex justify-center items-center py-8">
            <LoadingSpinner size="lg" />
          </div>
        ) : error ? (
          <div className="text-center py-8 text-red-500">
            <p>{error}</p>
          </div>
        ) : !customers || !Array.isArray(customers) || customers.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500">No customers found. Try adjusting your filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    GST Number
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    PAN Number
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Mobile
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200" key={`tbody-${customers.length}`}>
                {console.log('Rendering customer table with:', customers)}
                {Array.isArray(customers) && customers.length > 0 ? (
                  // Add a key to force re-render when customers change
                  <React.Fragment key={`customers-${customers.length}`}>
                    {customers.map((customer) => {
                      // Skip rendering if customer doesn't have required properties
                      console.log('Processing customer in map:', customer);
                      if (!customer || !customer.id) {
                        console.warn('Invalid customer found:', customer);
                        return null;
                      }

                      return (
                        <tr key={customer.id}>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">{customer.name || 'Unnamed Customer'}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-500">{customer.gst_number || '-'}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-500">{customer.pan_number || '-'}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-500">{customer.mobile_number || '-'}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                            {customer.id && (
                              <>
                                <Link to={`/billing/customer/${customer.id}`} className="text-blue-600 hover:text-blue-900 mr-4">
                                  View
                                </Link>
                                <Link to={`/billing/customer/edit/${customer.id}`} className="text-indigo-600 hover:text-indigo-900 mr-4">
                                  Edit
                                </Link>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ) : (
                  <tr>
                    <td colSpan="5" className="px-6 py-4 text-center text-gray-500">
                      No valid customer data found. {customers ? `Found ${customers.length} customers.` : 'Customers array is undefined.'}
                      <div className="mt-2 text-xs text-red-500">
                        Debug info: {JSON.stringify({ customersType: typeof customers, isArray: Array.isArray(customers) })}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {console.log('Checking pagination rendering:', { totalPages, currentPage })}
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
