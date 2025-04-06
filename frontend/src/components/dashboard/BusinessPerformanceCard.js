import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Card from '../Card';
import apiClient from '../../api/client';
import { formatIndianCurrency } from '../../utils/formatters';

/**
 * Business Performance Card for the dashboard
 * Shows performance metrics for each business
 * @param {Object} props - Component props
 * @param {Object} props.filters - Dashboard filters
 */
function BusinessPerformanceCard({ filters = {} }) {
  const [businesses, setBusinesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchBusinessPerformance = async () => {
      try {
        setLoading(true);

        // Prepare params object
        const params = {};

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

        // Fetch business performance data
        const response = await apiClient.get('/businesses/performance/', { params });

        setBusinesses(response.data || []);
        setError(null);
      } catch (err) {
        console.error('Error fetching business performance:', err);
        setError('Failed to load business performance data. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchBusinessPerformance();
  }, [filters.business, filters.startDate, filters.endDate]);

  // Calculate profit percentage
  const calculateProfitPercentage = (outward, inward) => {
    if (!outward || !inward || inward === 0) return 0;
    return ((outward - inward) / inward) * 100;
  };

  // Get trend icon based on percentage
  const getTrendIcon = (percentage) => {
    if (percentage > 0) {
      return (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-500" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M12 7a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0V8.414l-4.293 4.293a1 1 0 01-1.414 0L8 10.414l-4.293 4.293a1 1 0 01-1.414-1.414l5-5a1 1 0 011.414 0L11 10.586 14.586 7H12z" clipRule="evenodd" />
        </svg>
      );
    } else if (percentage < 0) {
      return (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-red-500" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M12 13a1 1 0 100 2h5a1 1 0 001-1v-5a1 1 0 10-2 0v2.586l-4.293-4.293a1 1 0 00-1.414 0L8 9.586 3.707 5.293a1 1 0 00-1.414 1.414l5 5a1 1 0 001.414 0L11 9.414 14.586 13H12z" clipRule="evenodd" />
        </svg>
      );
    } else {
      return (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-500" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5 10a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1z" clipRule="evenodd" />
        </svg>
      );
    }
  };

  return (
    <Card className="w-full">
      <div className="p-4 md:p-6">
        <h2 className="text-lg font-medium text-gray-900 dark:text-white flex items-center mb-6">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
          Business Performance
        </h2>

        {loading ? (
          <div className="flex justify-center items-center h-64 animate-pulse">
            <div className="text-gray-500 dark:text-gray-400">Loading business performance data...</div>
          </div>
        ) : error ? (
          <div className="flex justify-center items-center h-64">
            <div className="text-red-500 dark:text-red-400">{error}</div>
          </div>
        ) : businesses.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {businesses.map(business => {
              const profitPercentage = calculateProfitPercentage(
                business.outward_total,
                business.inward_total
              );

              return (
                <div
                  key={business.id}
                  className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 transition-all duration-200 hover:shadow-md"
                >
                  <Link
                    to={`/billing/business/${business.id}`}
                    className="text-base font-medium text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                  >
                    {business.name}
                  </Link>

                  <div className="mt-4 grid grid-cols-2 gap-4">
                    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
                      <div className="text-xs font-medium text-blue-700 dark:text-blue-300 mb-1">Sales (Outward)</div>
                      <div className="text-lg font-semibold text-gray-900 dark:text-white">
                        {formatIndianCurrency(business.outward_total || 0)}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {business.outward_count || 0} invoices
                      </div>
                    </div>

                    <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                      <div className="text-xs font-medium text-green-700 dark:text-green-300 mb-1">Purchases (Inward)</div>
                      <div className="text-lg font-semibold text-gray-900 dark:text-white">
                        {formatIndianCurrency(business.inward_total || 0)}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {business.inward_count || 0} invoices
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Profit Margin</div>
                      <div className="flex items-center">
                        {getTrendIcon(profitPercentage)}
                        <span className={`text-sm font-medium ml-1 ${
                          profitPercentage > 0 ? 'text-green-600 dark:text-green-400' :
                          profitPercentage < 0 ? 'text-red-600 dark:text-red-400' :
                          'text-gray-600 dark:text-gray-400'
                        }`}>
                          {Math.abs(profitPercentage).toFixed(2)}%
                        </span>
                      </div>
                    </div>

                    <Link
                      to={`/billing/invoice/list?business=${business.id}`}
                      className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
                    >
                      View Invoices
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex justify-center items-center h-64">
            <div className="text-gray-500 dark:text-gray-400">No business data available</div>
          </div>
        )}

        {businesses.length > 0 && (
          <div className="mt-6 text-center">
            <Link
              to="/billing/business/list"
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            >
              View All Businesses
            </Link>
          </div>
        )}
      </div>
    </Card>
  );
}

export default BusinessPerformanceCard;
