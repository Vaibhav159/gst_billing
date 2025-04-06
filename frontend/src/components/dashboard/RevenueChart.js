import React, { useState, useEffect } from 'react';
import BarChart from '../charts/BarChart';
import Card from '../Card';
import apiClient from '../../api/client';
import { formatIndianCurrency } from '../../utils/formatters';

/**
 * Revenue Chart widget for the dashboard
 * Shows monthly revenue comparison (outward vs inward)
 * @param {Object} props - Component props
 * @param {Object} props.filters - Dashboard filters
 */
function RevenueChart({ filters = {} }) {
  const [chartData, setChartData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState('6months'); // '3months', '6months', '1year'

  useEffect(() => {
    const fetchRevenueData = async () => {
      try {
        setLoading(true);

        // Calculate date range based on selected period
        const endDate = new Date();
        const startDate = new Date();

        if (period === '3months') {
          startDate.setMonth(startDate.getMonth() - 3);
        } else if (period === '6months') {
          startDate.setMonth(startDate.getMonth() - 6);
        } else if (period === '1year') {
          startDate.setFullYear(startDate.getFullYear() - 1);
        }

        // Format dates as YYYY-MM-DD
        const formatDate = (date) => {
          return date.toISOString().split('T')[0];
        };

        // Prepare params with period dates and dashboard filters
        const params = {
          start_date: formatDate(startDate),
          end_date: formatDate(endDate)
        };

        // Add business filter if present
        if (filters.business) {
          params.business = filters.business;
        }

        // If dashboard filters include date range, use those instead
        if (filters.startDate && filters.endDate) {
          params.start_date = filters.startDate;
          params.end_date = filters.endDate;
        }

        // Fetch revenue data
        const response = await apiClient.get('/invoices/monthly_totals/', { params });

        // Process the data for the chart
        const months = [];
        const outwardData = [];
        const inwardData = [];

        // Sort the data by month
        const sortedData = [...response.data].sort((a, b) => {
          const dateA = new Date(a.year, a.month - 1);
          const dateB = new Date(b.year, b.month - 1);
          return dateA - dateB;
        });

        // Extract the data for the chart
        sortedData.forEach(item => {
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const monthName = `${monthNames[item.month - 1]} ${item.year}`;

          months.push(monthName);
          outwardData.push(item.outward_total || 0);
          inwardData.push(item.inward_total || 0);
        });

        // Set the chart data
        setChartData({
          labels: months,
          datasets: [
            {
              label: 'Outward',
              data: outwardData,
              backgroundColor: 'rgba(59, 130, 246, 0.7)',
              borderColor: 'rgb(59, 130, 246)',
              borderWidth: 1
            },
            {
              label: 'Inward',
              data: inwardData,
              backgroundColor: 'rgba(16, 185, 129, 0.7)',
              borderColor: 'rgb(16, 185, 129)',
              borderWidth: 1
            }
          ]
        });

        setError(null);
      } catch (err) {
        console.error('Error fetching revenue data:', err);
        setError('Failed to load revenue data. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchRevenueData();
  }, [period, filters.business, filters.startDate, filters.endDate]);

  // Custom tooltip to format currency values
  const customTooltip = {
    callbacks: {
      label: function(context) {
        let label = context.dataset.label || '';
        if (label) {
          label += ': ';
        }
        if (context.parsed.y !== null) {
          label += formatIndianCurrency(context.parsed.y);
        }
        return label;
      }
    }
  };

  return (
    <Card className="w-full">
      <div className="p-4 md:p-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Revenue Overview
          </h2>

          <div className="mt-3 sm:mt-0">
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 dark:border-gray-700 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            >
              <option value="3months">Last 3 Months</option>
              <option value="6months">Last 6 Months</option>
              <option value="1year">Last 12 Months</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-64 animate-pulse">
            <div className="text-gray-500 dark:text-gray-400">Loading chart data...</div>
          </div>
        ) : error ? (
          <div className="flex justify-center items-center h-64">
            <div className="text-red-500 dark:text-red-400">{error}</div>
          </div>
        ) : chartData ? (
          <BarChart
            data={chartData}
            height={350}
            options={{
              plugins: {
                tooltip: customTooltip
              }
            }}
          />
        ) : (
          <div className="flex justify-center items-center h-64">
            <div className="text-gray-500 dark:text-gray-400">No data available</div>
          </div>
        )}
      </div>
    </Card>
  );
}

export default RevenueChart;
