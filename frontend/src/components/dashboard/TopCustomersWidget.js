import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Card from '../Card';
import apiClient from '../../api/client';
import { formatIndianCurrency } from '../../utils/formatters';

/**
 * Top Customers Widget for the dashboard
 * Shows top 5 customers by revenue
 * @param {Object} props - Component props
 * @param {Object} props.filters - Dashboard filters
 */
function TopCustomersWidget({ filters = {} }) {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchTopCustomers = async () => {
      try {
        setLoading(true);

        // Prepare params object
        const params = {
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

        // Fetch top customers data
        const response = await apiClient.get('/customers/top/', { params });

        setCustomers(response.data || []);
        setError(null);
      } catch (err) {
        console.error('Error fetching top customers:', err);
        setError('Failed to load top customers. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchTopCustomers();
  }, [filters.business, filters.startDate, filters.endDate]);

  // Generate a color based on the index
  const getBarColor = (index) => {
    const colors = [
      'bg-blue-500',
      'bg-green-500',
      'bg-yellow-500',
      'bg-purple-500',
      'bg-pink-500'
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
        <h2 className="text-lg font-medium text-gray-900 dark:text-white flex items-center mb-6">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          Top Customers
        </h2>

        {loading ? (
          <div className="flex justify-center items-center h-64 animate-pulse">
            <div className="text-gray-500 dark:text-gray-400">Loading top customers...</div>
          </div>
        ) : error ? (
          <div className="flex justify-center items-center h-64">
            <div className="text-red-500 dark:text-red-400">{error}</div>
          </div>
        ) : customers.length > 0 ? (
          <div className="space-y-4">
            {customers.map((customer, index) => {
              const maxValue = customers[0].total_amount;
              const percentage = calculatePercentage(customer.total_amount, maxValue);

              return (
                <div key={customer.id} className="group">
                  <div className="flex justify-between items-center mb-1">
                    <Link
                      to={`/billing/customer/${customer.id}`}
                      className="text-sm font-medium text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                    >
                      {customer.name}
                    </Link>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {formatIndianCurrency(customer.total_amount)}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                    <div
                      className={`h-2.5 rounded-full ${getBarColor(index)} transition-all duration-500 ease-in-out`}
                      style={{ width: `${percentage}%` }}
                    ></div>
                  </div>
                  <div className="flex justify-between items-center mt-1 text-xs text-gray-500 dark:text-gray-400">
                    <span>{customer.invoice_count} invoices</span>
                    <span>
                      {customer.type_of_invoice === 'outward' ? 'Sales' :
                       customer.type_of_invoice === 'inward' ? 'Purchases' : 'Mixed'}
                    </span>
                  </div>
                </div>
              );
            })}

            <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
              <Link
                to="/billing/customer/list"
                className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 flex items-center"
              >
                View all customers
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex justify-center items-center h-64">
            <div className="text-gray-500 dark:text-gray-400">No customer data available</div>
          </div>
        )}
      </div>
    </Card>
  );
}

export default TopCustomersWidget;
