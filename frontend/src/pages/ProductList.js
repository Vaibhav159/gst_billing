import React, { useState, useEffect, useCallback, useRef } from 'react';
import { debounce } from 'lodash'; // Import debounce from lodash
import { Link, useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import Button from '../components/Button';
import FormInput from '../components/FormInput';
import LoadingSpinner from '../components/LoadingSpinner';
import Pagination from '../components/Pagination';
import ActionButton from '../components/ActionButton';
import ActionMenu from '../components/ActionMenu';
import SortableHeader from '../components/SortableHeader';
import apiClient from '../api/client';
import productService from '../api/productService';
import { useRowClick } from '../utils/navigationHelpers';

function ProductList() {
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');

  // Row click handler
  const handleProductRowClick = useRowClick('/billing/product/', {
    // Ignore clicks on action buttons and menus
    ignoreClasses: ['action-button', 'btn', 'relative']
  });

  // Track the latest request
  const latestRequestIdRef = useRef(0);

  // Fetch products
  useEffect(() => {
    const fetchProducts = async () => {
      try {
        setLoading(true);
        const params = {
          page: currentPage,
          search: searchTerm
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

        // Create a request ID to track this specific request
        const requestId = ++latestRequestIdRef.current;

        const response = await apiClient.get('/products/', { params });

        // Only update state if this is still the most recent request
        // This prevents race conditions where older requests complete after newer ones
        if (requestId === latestRequestIdRef.current) {
          setProducts(response.data.results || response.data);

          // Set pagination data if available
          if (response.data.count) {
            setTotalPages(Math.ceil(response.data.count / 15)); // Assuming 15 items per page
          }

          setError(null);
        }
      } catch (err) {
        console.error('Error fetching products:', err);
        setError('Failed to load products. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, [currentPage, searchTerm, sortField, sortDirection]);

  // Handle sorting
  const handleSort = (field, direction) => {
    setSortField(field);
    setSortDirection(direction);
    setCurrentPage(1); // Reset to first page when sorting changes
  };

  // Create a debounced version of setSearchTerm
  const debouncedSetSearchTerm = useCallback(
    debounce((value) => {
      setSearchTerm(value);
      setCurrentPage(1); // Reset to first page when search changes
    }, 500), // 500ms debounce delay
    []
  );

  // State to track the input value separately from the search term
  const [inputValue, setInputValue] = useState('');

  // Initialize inputValue with searchTerm
  useEffect(() => {
    setInputValue(searchTerm);
  }, [searchTerm]);

  // Handle search input change
  const handleSearchChange = (e) => {
    const value = e.target.value;

    // Update the input value immediately for UI
    setInputValue(value);

    // Debounce the actual API call
    debouncedSetSearchTerm(value);
  };

  // Handle page change
  const handlePageChange = (page) => {
    setCurrentPage(page);
  };

  // Handle product deletion
  const handleDelete = async (productId) => {
    if (window.confirm('Are you sure you want to delete this product?')) {
      try {
        await productService.deleteProduct(productId);

        // Refresh the product list
        setProducts(products.filter(product => product.id !== productId));
      } catch (err) {
        console.error('Error deleting product:', err);
        alert('Failed to delete product. Please try again.');
      }
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header Section with Responsive Design */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Products</h1>
        <Link to="/billing/product">
          <Button
            variant="primary"
            icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>}
          >
            Add Product
          </Button>
        </Link>
      </div>

      {/* Search with Improved Styling */}
      <Card>
        <div className="p-4">
          <div className="flex items-center justify-between cursor-pointer mb-2"
               onClick={() => document.getElementById('productSearchContent').classList.toggle('hidden')}>
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
          <div id="productSearchContent">
            <FormInput
              label="Search Products"
              id="search"
              name="search"
              value={inputValue}
              onChange={handleSearchChange}
              placeholder="Search by name or HSN code"
            />
          </div>
        </div>
      </Card>

      {/* Product List with Responsive Design */}
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
        ) : products.length === 0 ? (
          <div className="text-center py-8">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-2 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <p className="text-gray-500 dark:text-gray-400">No products found. {searchTerm && 'Try adjusting your search.'}</p>
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
                      label="HSN Code"
                      field="hsn_code"
                      currentSortField={sortField}
                      currentSortDirection={sortDirection}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="GST Rate"
                      field="gst_tax_rate"
                      currentSortField={sortField}
                      currentSortDirection={sortDirection}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Description"
                      field="description"
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
                  {products.map((product, index) => {
                    // Calculate the serial number based on the current page
                    const serialNumber = (currentPage - 1) * 15 + index + 1;

                    return (
                      <tr
                        key={product.id}
                        className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-150 cursor-pointer"
                        onClick={(e) => handleProductRowClick(product.id, e)}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-500 dark:text-gray-400">{serialNumber}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">{product.name}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-500 dark:text-gray-400">{product.hsn_code || '-'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-500 dark:text-gray-400">{product.gst_tax_rate ? `${(product.gst_tax_rate * 100).toFixed(0)}%` : '-'}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-500 dark:text-gray-400">{product.description || '-'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <div className="flex items-center space-x-2">
                            <ActionButton
                              type="edit"
                              to={`/billing/product/edit/${product.id}`}
                              label="Edit Product"
                            />
                            <ActionButton
                              type="delete"
                              onClick={() => handleDelete(product.id)}
                              label="Delete Product"
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
                {products.map((product, index) => {
                  // Calculate the serial number based on the current page
                  const serialNumber = (currentPage - 1) * 15 + index + 1;

                  return (
                    <div
                      key={product.id}
                      className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 transition-all duration-200 hover:shadow-md cursor-pointer"
                      onClick={(e) => handleProductRowClick(product.id, e)}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <span className="text-xs text-gray-500 dark:text-gray-400">#{serialNumber}</span>
                          <h3 className="text-lg font-medium text-gray-900 dark:text-white">{product.name}</h3>
                        </div>
                        <div className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-xs px-2 py-1 rounded-full">
                          {product.gst_tax_rate ? `${(product.gst_tax_rate * 100).toFixed(0)}%` : '-'}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-2 text-sm mb-3">
                        <div>
                          <p className="text-gray-500 dark:text-gray-400">HSN Code</p>
                          <p className="font-medium text-gray-900 dark:text-white">{product.hsn_code || '-'}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 dark:text-gray-400">Description</p>
                          <p className="font-medium text-gray-900 dark:text-white">{product.description || '-'}</p>
                        </div>
                      </div>

                      <div className="flex justify-end pt-2 border-t border-gray-200 dark:border-gray-700">
                        <ActionMenu
                          actions={[
                            {
                              type: 'edit',
                              label: 'Edit Product',
                              to: `/billing/product/edit/${product.id}`
                            },
                            {
                              type: 'delete',
                              label: 'Delete Product',
                              onClick: () => handleDelete(product.id)
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

export default ProductList;
