import React, { useState, useEffect } from 'react';
import Card from '../Card';
import FormSelect from '../FormSelect';
import apiClient from '../../api/client';

/**
 * Dashboard Filters component
 * Allows filtering dashboard data by business, financial year, and date range
 */
function DashboardFilters({ onFilterChange }) {
  const [businesses, setBusinesses] = useState([]);
  const [selectedBusiness, setSelectedBusiness] = useState('all');
  const [selectedFinancialYear, setSelectedFinancialYear] = useState('current');
  const [loading, setLoading] = useState(true);
  
  // Generate financial year options
  const generateFinancialYearOptions = () => {
    const currentYear = new Date().getFullYear();
    const options = [
      { value: 'current', label: 'Current Financial Year' },
      { value: 'all', label: 'All Time' }
    ];
    
    // Add last 3 financial years
    for (let i = 0; i < 3; i++) {
      const year = currentYear - i;
      options.push({
        value: `${year}-${year + 1}`,
        label: `FY ${year}-${year + 1}`
      });
    }
    
    return options;
  };
  
  // Fetch businesses for the filter
  useEffect(() => {
    const fetchBusinesses = async () => {
      try {
        setLoading(true);
        const response = await apiClient.get('/businesses/');
        
        const businessOptions = [
          { value: 'all', label: 'All Businesses' },
          ...response.data.map(business => ({
            value: business.id.toString(),
            label: business.name
          }))
        ];
        
        setBusinesses(businessOptions);
      } catch (err) {
        console.error('Error fetching businesses:', err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchBusinesses();
  }, []);
  
  // Handle filter changes
  useEffect(() => {
    // Calculate date range based on selected financial year
    let startDate = null;
    let endDate = null;
    
    if (selectedFinancialYear !== 'all') {
      const today = new Date();
      let startYear;
      
      if (selectedFinancialYear === 'current') {
        startYear = today.getFullYear();
        // If current month is before April, use previous year as start
        if (today.getMonth() < 3) { // 0-indexed, so 3 is April
          startYear -= 1;
        }
      } else {
        // Parse the selected year range (e.g., "2023-2024")
        startYear = parseInt(selectedFinancialYear.split('-')[0]);
      }
      
      // Format dates as YYYY-MM-DD
      const formatDate = (year, month, day) => {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      };
      
      startDate = formatDate(startYear, 4, 1); // April 1st
      endDate = formatDate(startYear + 1, 3, 31); // March 31st of next year
    }
    
    // Notify parent component of filter changes
    onFilterChange({
      business: selectedBusiness === 'all' ? null : selectedBusiness,
      startDate,
      endDate
    });
  }, [selectedBusiness, selectedFinancialYear, onFilterChange]);
  
  return (
    <Card className="w-full">
      <div className="p-4 md:p-6">
        <h2 className="text-lg font-medium text-gray-900 dark:text-white flex items-center mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          Dashboard Filters
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="business-filter" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Business
            </label>
            <FormSelect
              id="business-filter"
              value={selectedBusiness}
              onChange={(e) => setSelectedBusiness(e.target.value)}
              options={businesses}
              isLoading={loading}
              placeholder="Select Business"
            />
          </div>
          
          <div>
            <label htmlFor="financial-year-filter" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Financial Year
            </label>
            <FormSelect
              id="financial-year-filter"
              value={selectedFinancialYear}
              onChange={(e) => setSelectedFinancialYear(e.target.value)}
              options={generateFinancialYearOptions()}
              placeholder="Select Financial Year"
            />
          </div>
        </div>
        
        <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
          <p>
            <span className="font-medium">Note:</span> These filters will apply to all dashboard widgets.
          </p>
        </div>
      </div>
    </Card>
  );
}

export default DashboardFilters;
