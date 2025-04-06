import React, { useState, useEffect } from 'react';
import PieChart from '../charts/PieChart';
import Card from '../Card';
import apiClient from '../../api/client';
import { formatIndianCurrency } from '../../utils/formatters';

/**
 * Invoice Distribution Chart widget for the dashboard
 * Shows distribution of invoices by type
 * @param {Object} props - Component props
 * @param {Object} props.filters - Dashboard filters
 */
function InvoiceDistributionChart({ filters = {} }) {
  const [chartData, setChartData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState('amount'); // 'amount' or 'count'

  useEffect(() => {
    const fetchDistributionData = async () => {
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

        // Fetch invoice distribution data
        const response = await apiClient.get('/invoices/distribution/', { params });

        // Process the data for the chart
        const data = response.data;

        // Set the chart data based on view mode
        if (viewMode === 'amount') {
          setChartData({
            labels: ['Outward (Sales)', 'Inward (Purchases)', 'Other'],
            datasets: [
              {
                data: [
                  data.outward_total || 0,
                  data.inward_total || 0,
                  data.other_total || 0
                ],
                backgroundColor: [
                  'rgba(59, 130, 246, 0.7)', // Blue for outward
                  'rgba(16, 185, 129, 0.7)', // Green for inward
                  'rgba(249, 115, 22, 0.7)'  // Orange for other
                ],
                borderColor: [
                  'rgb(59, 130, 246)',
                  'rgb(16, 185, 129)',
                  'rgb(249, 115, 22)'
                ],
                borderWidth: 1
              }
            ]
          });
        } else {
          setChartData({
            labels: ['Outward (Sales)', 'Inward (Purchases)', 'Other'],
            datasets: [
              {
                data: [
                  data.outward_count || 0,
                  data.inward_count || 0,
                  data.other_count || 0
                ],
                backgroundColor: [
                  'rgba(59, 130, 246, 0.7)', // Blue for outward
                  'rgba(16, 185, 129, 0.7)', // Green for inward
                  'rgba(249, 115, 22, 0.7)'  // Orange for other
                ],
                borderColor: [
                  'rgb(59, 130, 246)',
                  'rgb(16, 185, 129)',
                  'rgb(249, 115, 22)'
                ],
                borderWidth: 1
              }
            ]
          });
        }

        setError(null);
      } catch (err) {
        console.error('Error fetching invoice distribution data:', err);
        setError('Failed to load invoice distribution data. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchDistributionData();
  }, [viewMode, filters.business, filters.startDate, filters.endDate]);

  // Custom tooltip to format values
  const customTooltip = {
    callbacks: {
      label: function(context) {
        let label = context.label || '';
        if (label) {
          label += ': ';
        }
        if (context.parsed !== null) {
          if (viewMode === 'amount') {
            label += formatIndianCurrency(context.parsed);
          } else {
            label += context.parsed + ' invoices';
          }
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
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
            </svg>
            Invoice Distribution
          </h2>

          <div className="mt-3 sm:mt-0">
            <div className="flex rounded-md shadow-sm">
              <button
                type="button"
                className={`relative inline-flex items-center px-4 py-2 rounded-l-md border border-gray-300 dark:border-gray-700 text-sm font-medium ${
                  viewMode === 'amount'
                    ? 'bg-primary-500 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
                onClick={() => setViewMode('amount')}
              >
                Amount
              </button>
              <button
                type="button"
                className={`relative inline-flex items-center px-4 py-2 rounded-r-md border border-gray-300 dark:border-gray-700 text-sm font-medium ${
                  viewMode === 'count'
                    ? 'bg-primary-500 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
                onClick={() => setViewMode('count')}
              >
                Count
              </button>
            </div>
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
          <PieChart
            data={chartData}
            height={300}
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

        <div className="mt-4 text-sm text-gray-500 dark:text-gray-400 text-center">
          Current Financial Year (FY {new Date().getFullYear()}-{new Date().getFullYear() + 1})
        </div>
      </div>
    </Card>
  );
}

export default InvoiceDistributionChart;
