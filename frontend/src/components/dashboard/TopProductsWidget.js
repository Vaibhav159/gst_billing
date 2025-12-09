import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Card from '../Card';
import apiClient from '../../api/client';
import { formatIndianCurrency } from '../../utils/formatters';

/**
 * Top Products Widget for the dashboard
 * Shows top 5 products by sales volume
 * @param {Object} props - Component props
 * @param {Object} props.filters - Dashboard filters
 */
function TopProductsWidget({ filters = {} }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState('amount'); // 'amount' or 'quantity'

  useEffect(() => {
    const fetchTopProducts = async () => {
      try {
        setLoading(true);

        // Prepare params object
        const params = {
          sort_by: viewMode, // 'amount' or 'quantity'
          limit: 5
        };

        // Use dashboard filters if provided, otherwise use current financial year
        if (filters.startDate && filters.endDate) {
          params.start_date = filters.startDate;
          params.end_date = filters.endDate;
        } else {
          // Get current financial year dates
          const today = new Date();
          let startYear = today.getFullYear();
          let startMonth = 4; // April
          let startDay = 1;

          // If current month is before April, use previous year as start
          if (today.getMonth() < 3) { // 0-indexed, so 3 is April
            startYear -= 1;
          }

          // Format dates as YYYY-MM-DD
          const formatDate = (year, month, day) => {
            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          };

          params.start_date = formatDate(startYear, startMonth, startDay);
          params.end_date = formatDate(startYear + 1, 3, 31); // March 31st of next year
        }

        // Add business filter if present
        if (filters.business) {
          params.business = filters.business;
        }

        // Fetch top products data
        const response = await apiClient.get('/products/top/', { params });

        setProducts(response.data || []);
        setError(null);
      } catch (err) {
        console.error('Error fetching top products:', err);
        setError('Failed to load top products. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchTopProducts();
  }, [viewMode, filters.business, filters.startDate, filters.endDate]);

  // Generate a color based on the index
  const getBarColor = (index) => {
    const colors = [
      'bg-indigo-500',
      'bg-teal-500',
      'bg-amber-500',
      'bg-rose-500',
      'bg-cyan-500'
    ];
    return colors[index % colors.length];
  };

  // Calculate the percentage for the progress bar
  const calculatePercentage = (value, max) => {
    if (!max) return 0;
    return (value / max) * 100;
  };

  return (
    <Card className="w-full">
      <div className="p-4 md:p-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            Top Products
          </h2>

          <div className="mt-3 sm:mt-0">
            <div className="flex rounded-md shadow-sm">
              <button
                type="button"
                className={`relative inline-flex items-center px-4 py-2 rounded-l-md border border-gray-300 dark:border-gray-700 text-sm font-medium ${viewMode === 'amount'
                    ? 'bg-primary-500 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                onClick={() => setViewMode('amount')}
              >
                Amount
              </button>
              <button
                type="button"
                className={`relative inline-flex items-center px-4 py-2 rounded-r-md border border-gray-300 dark:border-gray-700 text-sm font-medium ${viewMode === 'quantity'
                    ? 'bg-primary-500 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                onClick={() => setViewMode('quantity')}
              >
                Quantity
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-64 animate-pulse">
            <div className="text-gray-500 dark:text-gray-400">Loading top products...</div>
          </div>
        ) : error ? (
          <div className="flex justify-center items-center h-64">
            <div className="text-red-500 dark:text-red-400">{error}</div>
          </div>
        ) : products.length > 0 ? (
          <div className="space-y-4">
            {products.map((product, index) => {
              const maxValue = viewMode === 'amount'
                ? products[0].total_amount
                : products[0].total_quantity;

              const value = viewMode === 'amount'
                ? product.total_amount
                : product.total_quantity;

              const percentage = calculatePercentage(value, maxValue);

              return (
                <div key={product.id} className="group">
                  <div className="flex justify-between items-center mb-1">
                    <Link
                      to={`/billing/product/${product.id}`}
                      className="text-sm font-medium text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                    >
                      {product.name}
                    </Link>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {viewMode === 'amount'
                        ? formatIndianCurrency(product.total_amount)
                        : `${product.total_quantity} ${product.unit ? (product.unit === 'gm' ? 'g' : product.unit) : 'units'}`}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                    <div
                      className={`h-2.5 rounded-full ${getBarColor(index)} transition-all duration-500 ease-in-out`}
                      style={{ width: `${percentage}%` }}
                    ></div>
                  </div>
                  <div className="flex justify-between items-center mt-1 text-xs text-gray-500 dark:text-gray-400">
                    <span>{product.invoice_count} invoices</span>
                    <span>
                      {product.hsn_code ? `HSN: ${product.hsn_code}` : 'No HSN'}
                    </span>
                  </div>
                </div>
              );
            })}

            <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
              <Link
                to="/billing/product/list"
                className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 flex items-center"
              >
                View all products
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex justify-center items-center h-64">
            <div className="text-gray-500 dark:text-gray-400">No product data available</div>
          </div>
        )}
      </div>
    </Card>
  );
}

export default TopProductsWidget;
