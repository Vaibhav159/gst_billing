import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Card from '../components/Card';
import Button from '../components/Button';
import FormInput from '../components/FormInput';
import LoadingSpinner from '../components/LoadingSpinner';
import Pagination from '../components/Pagination';
import axios from 'axios';
import { formatIndianCurrency } from '../utils/formatters';

function BusinessList() {
  const [businesses, setBusinesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');

  // Fetch businesses
  useEffect(() => {
    const fetchBusinesses = async () => {
      try {
        setLoading(true);
        const params = {
          page: currentPage,
          search: searchTerm
        };

        // Remove empty filters
        Object.keys(params).forEach(key => {
          if (params[key] === '') {
            delete params[key];
          }
        });

        const response = await axios.get('/api/businesses/', { params });
        setBusinesses(response.data.results || response.data);

        // Set pagination data if available
        if (response.data.count) {
          setTotalPages(Math.ceil(response.data.count / 15)); // Assuming 15 items per page
        }

        setError(null);
      } catch (err) {
        console.error('Error fetching businesses:', err);
        setError('Failed to load businesses. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchBusinesses();
  }, [currentPage, searchTerm]);

  // Handle search input change
  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1); // Reset to first page when search changes
  };

  // Handle page change
  const handlePageChange = (page) => {
    setCurrentPage(page);
  };

  // Handle business deletion
  const handleDelete = async (businessId) => {
    if (window.confirm('Are you sure you want to delete this business?')) {
      try {
        await axios.delete(`/api/businesses/${businessId}/`);

        // Refresh the business list
        setBusinesses(businesses.filter(business => business.id !== businessId));
      } catch (err) {
        console.error('Error deleting business:', err);
        alert('Failed to delete business. Please try again.');
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Businesses</h1>
        <Link to="/billing/business">
          <Button variant="primary">Add Business</Button>
        </Link>
      </div>

      <Card>
        <div className="p-4">
          <FormInput
            label="Search Businesses"
            id="search"
            name="search"
            value={searchTerm}
            onChange={handleSearchChange}
            placeholder="Search by name or GST number"
          />
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
        ) : businesses.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500">No businesses found. {searchTerm && 'Try adjusting your search.'}</p>
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
                    Address
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
                {businesses.map((business) => (
                  <tr key={business.id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{business.name}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-500">{business.gst_number || '-'}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-500">{business.address || '-'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-500">{business.mobile_number || business.phone_number || '-'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <Link to={`/billing/business/${business.id}`} className="text-blue-600 hover:text-blue-900 mr-4">
                        View
                      </Link>
                      <Link to={`/billing/business/edit/${business.id}`} className="text-indigo-600 hover:text-indigo-900 mr-4">
                        Edit
                      </Link>
                      <button
                        onClick={() => handleDelete(business.id)}
                        className="text-red-600 hover:text-red-900"
                      >
                        Delete
                      </button>
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

export default BusinessList;
