import React, { useState, useEffect, useRef } from 'react';
import useDebounce from '../hooks/useDebounce';
import { Link, useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import Button from '../components/Button';
import FormInput from '../components/FormInput';
import LoadingSpinner from '../components/LoadingSpinner';
import Pagination from '../components/Pagination';
import ActionButton from '../components/ActionButton';
import ActionMenu from '../components/ActionMenu';
import apiClient from '../api/client';
import businessService from '../api/businessService';
import { useRowClick } from '../utils/navigationHelpers';

function BusinessList() {
  const navigate = useNavigate();
  const [businesses, setBusinesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Row click handler
  const handleBusinessRowClick = useRowClick('/billing/business/', {
    // Ignore clicks on action buttons
    ignoreClasses: ['action-button', 'btn']
  });
  // Local state for the search input field (updates immediately with typing)
  const [searchInput, setSearchInput] = useState('');
  // State for the actual search term used in API calls (updated after debounce)
  const [searchTerm, setSearchTerm] = useState('');
  // Reference to the search input element to maintain focus
  const searchInputRef = useRef(null);

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

        const response = await apiClient.get('/businesses/', { params });
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

  // Debounce the search input with a 500ms delay
  const debouncedSearchTerm = useDebounce(searchInput, 500);

  // Update searchTerm when debounced search term changes
  useEffect(() => {
    setSearchTerm(debouncedSearchTerm);
    setCurrentPage(1); // Reset to first page when search changes

    // Maintain focus on the search input after the API call
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [debouncedSearchTerm]);

  // Handle search input change - updates immediately for visual feedback
  const handleSearchChange = (e) => {
    setSearchInput(e.target.value);
  };

  // Handle page change
  const handlePageChange = (page) => {
    setCurrentPage(page);
  };

  // Handle business deletion
  const handleDelete = async (businessId) => {
    if (window.confirm('Are you sure you want to delete this business?')) {
      try {
        await businessService.deleteBusiness(businessId);

        // Refresh the business list
        setBusinesses(businesses.filter(business => business.id !== businessId));
      } catch (err) {
        console.error('Error deleting business:', err);
        alert('Failed to delete business. Please try again.');
      }
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header Section with Responsive Design */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Businesses</h1>
        <Link to="/billing/business">
          <Button
            variant="primary"
            icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>}
          >
            Add Business
          </Button>
        </Link>
      </div>

      {/* Search with Improved Styling */}
      <Card>
        <div className="p-4">
          <div className="flex items-center justify-between cursor-pointer mb-2"
               onClick={() => document.getElementById('businessSearchContent').classList.toggle('hidden')}>
            <h2 className="text-lg font-medium text-gray-900 dark:text-white flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
              </svg>
              Search
            </h2>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-500 dark:text-gray-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </div>
          <div id="businessSearchContent">
            <FormInput
              label="Search Businesses"
              id="search"
              name="search"
              value={searchInput}
              onChange={handleSearchChange}
              placeholder="Search by name or GST number"
              ref={searchInputRef}
              autoFocus
            />
          </div>
        </div>
      </Card>

      {/* Business List with Responsive Design */}
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
        ) : businesses.length === 0 ? (
          <div className="text-center py-8">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-2 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            <p className="text-gray-500 dark:text-gray-400">No businesses found. {searchTerm && 'Try adjusting your search.'}</p>
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
                      Name
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      GST Number
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Address
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Phone
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {businesses.map((business, index) => {
                    // Calculate the serial number based on the current page
                    const serialNumber = (currentPage - 1) * 15 + index + 1;

                    return (
                      <tr
                        key={business.id}
                        className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-150 cursor-pointer"
                        onClick={(e) => handleBusinessRowClick(business.id, e)}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-500 dark:text-gray-400">{serialNumber}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">{business.name}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-500 dark:text-gray-400">{business.gst_number || '-'}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-500 dark:text-gray-400">{business.address || '-'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-500 dark:text-gray-400">{business.mobile_number || business.phone_number || '-'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <div className="flex items-center space-x-2">
                            <ActionButton
                              type="view"
                              to={`/billing/business/${business.id}`}
                              label="View Business"
                            />
                            <ActionButton
                              type="edit"
                              to={`/billing/business/edit/${business.id}`}
                              label="Edit Business"
                            />
                            <ActionButton
                              type="delete"
                              onClick={() => handleDelete(business.id)}
                              label="Delete Business"
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
              <div className="space-y-4">
                {businesses.map((business, index) => {
                  // Calculate the serial number based on the current page
                  const serialNumber = (currentPage - 1) * 15 + index + 1;

                  return (
                    <div
                      key={business.id}
                      className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 transition-all duration-200 hover:shadow-md cursor-pointer"
                      onClick={(e) => handleBusinessRowClick(business.id, e)}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <span className="text-xs text-gray-500 dark:text-gray-400">#{serialNumber}</span>
                          <h3 className="text-lg font-medium text-gray-900 dark:text-white">{business.name}</h3>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-2 text-sm mb-3">
                        <div>
                          <p className="text-gray-500 dark:text-gray-400">GST Number</p>
                          <p className="font-medium text-gray-900 dark:text-white">{business.gst_number || '-'}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 dark:text-gray-400">Address</p>
                          <p className="font-medium text-gray-900 dark:text-white">{business.address || '-'}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 dark:text-gray-400">Phone</p>
                          <p className="font-medium text-gray-900 dark:text-white">{business.mobile_number || business.phone_number || '-'}</p>
                        </div>
                      </div>

                      <div className="flex justify-end pt-2 border-t border-gray-200 dark:border-gray-700">
                        <ActionMenu
                          actions={[
                            {
                              type: 'view',
                              label: 'View Business',
                              to: `/billing/business/${business.id}`
                            },
                            {
                              type: 'edit',
                              label: 'Edit Business',
                              to: `/billing/business/edit/${business.id}`
                            },
                            {
                              type: 'delete',
                              label: 'Delete Business',
                              onClick: () => handleDelete(business.id)
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

export default BusinessList;
