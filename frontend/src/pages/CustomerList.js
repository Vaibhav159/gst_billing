import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Card from '../components/Card';
import Button from '../components/Button';
import FormInput from '../components/FormInput';
import FormSelect from '../components/FormSelect';
import LoadingSpinner from '../components/LoadingSpinner';
import Pagination from '../components/Pagination';
import axios from 'axios';
import apiClient, { createCancelToken } from '../api/client';

function CustomerList() {
  const [customers, setCustomers] = useState([]);
  const [businesses, setBusinesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filters, setFilters] = useState({
    customer_name: '',
    business_id: ''
  });

  // Fetch customers with filters - memoized to prevent unnecessary re-renders
  const fetchCustomers = useCallback(async () => {
    // Create a cancel token for this request
    const cancelTokenSource = createCancelToken();

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

      const response = await apiClient.get('/customers/', {
        params,
        cancelToken: cancelTokenSource.token
      });

      setCustomers(response.data.results || response.data);

      // Set pagination data if available
      if (response.data.count) {
        setTotalPages(Math.ceil(response.data.count / 15)); // Assuming 15 items per page
      }

      setError(null);
    } catch (err) {
      if (!axios.isCancel(err)) {
        console.error('Error fetching customers:', err);
        setError('Failed to load customers. Please try again.');
      }
    } finally {
      setLoading(false);
    }

    // Return the cancel function
    return () => cancelTokenSource.cancel('Component unmounted');
  }, [currentPage, filters]);

  // Call fetchCustomers when dependencies change
  useEffect(() => {
    const cancelFetch = fetchCustomers();

    // Cleanup function to cancel request when component unmounts or dependencies change
    return cancelFetch;
  }, [fetchCustomers]);

  // Fetch businesses for filter
  useEffect(() => {
    const cancelTokenSource = createCancelToken();

    const fetchBusinesses = async () => {
      try {
        const response = await apiClient.get('/businesses/', {
          cancelToken: cancelTokenSource.token,
          // Don't show loading indicator for this secondary request
          showLoading: false
        });
        setBusinesses(response.data.results || response.data);
      } catch (err) {
        if (!axios.isCancel(err)) {
          console.error('Error fetching businesses:', err);
        }
      }
    };

    fetchBusinesses();

    // Cleanup function
    return () => cancelTokenSource.cancel('Component unmounted');
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

  return (
    <div className="space-y-6">
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
              id="customer_name"
              name="customer_name"
              value={filters.customer_name}
              onChange={handleFilterChange}
              placeholder="Search by name"
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
          </div>
        </div>
      </Card>

      <Card>
        {loading ? (
          <div className="flex justify-center items-center py-8">
            <LoadingSpinner size="lg" />
          </div>
        ) : error ? (
          <div className="text-center py-8 text-red-500">
            <p>{error}</p>
          </div>
        ) : customers.length === 0 ? (
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
                    Phone
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {customers.map((customer) => (
                  <tr key={customer.id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{customer.name}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-500">{customer.gst_number || '-'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-500">{customer.phone_number || '-'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <Link to={`/billing/customer/${customer.id}`} className="text-blue-600 hover:text-blue-900 mr-4">
                        View
                      </Link>
                      <Link to={`/billing/customer/edit/${customer.id}`} className="text-indigo-600 hover:text-indigo-900 mr-4">
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
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

export default CustomerList;
