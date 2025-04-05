import React, { useState, useEffect } from 'react';
import Card from '../components/Card';
import Button from '../components/Button';
import FormInput from '../components/FormInput';
import FormSelect from '../components/FormSelect';
import LoadingSpinner from '../components/LoadingSpinner';
import apiClient from '../api/client';

function Reports() {
  const [formData, setFormData] = useState({
    start_date: '',
    end_date: '',
    invoice_type: 'both'
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Get current financial year dates
  const getCurrentFinancialYear = () => {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1; // JavaScript months are 0-indexed

    let startYear, endYear;
    if (currentMonth >= 4) { // April onwards is the new financial year
      startYear = currentYear;
      endYear = currentYear + 1;
    } else {
      startYear = currentYear - 1;
      endYear = currentYear;
    }

    return {
      start: `${startYear}-04-01`, // April 1st
      end: `${endYear}-03-31` // March 31st
    };
  };

  // Set default dates to current financial year
  const setCurrentFinancialYear = () => {
    const { start, end } = getCurrentFinancialYear();
    setFormData(prev => ({
      ...prev,
      start_date: start,
      end_date: end
    }));
  };

  // Handle form input changes
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // Handle financial year selection
  const handleFinancialYearChange = (e) => {
    const financialYear = e.target.value;
    if (!financialYear) return;

    const [startYear] = financialYear.split('-');
    const startDate = `${startYear}-04-01`; // April 1st
    const endDate = `${parseInt(startYear) + 1}-03-31`; // March 31st next year

    setFormData(prev => ({
      ...prev,
      start_date: startDate,
      end_date: endDate
    }));
  };

  // Generate financial year options
  const getFinancialYearOptions = () => {
    const currentYear = new Date().getFullYear();
    const years = [];

    // Generate last 5 financial years
    for (let i = 0; i < 5; i++) {
      const year = currentYear - i;
      years.push({
        value: `${year}-${year + 1}`,
        label: `FY ${year}-${year + 1}`
      });
    }

    return years;
  };

  // Import apiClient
  const apiClient = require('../api/client').default;

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.start_date || !formData.end_date) {
      setError('Start date and end date are required');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Show a more detailed loading message
      setError('Generating report... This may take up to 5 minutes for large datasets.');

      // Use apiClient to make the request with proper JWT authentication and extended timeout
      const response = await apiClient.post('/reports/generate/', formData, {
        responseType: 'blob', // Important for file downloads
        timeout: 300000, // 5 minutes timeout specifically for this request
      });

      // Create a blob URL and open it in a new tab
      const blob = new Blob([response.data], {
        type: formData.format === 'excel' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv'
      });
      const url = window.URL.createObjectURL(blob);

      // Open the report in a new tab
      window.open(url, '_blank');

    } catch (err) {
      console.error('Error generating report:', err);
      setError('Failed to generate report. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Reports</h1>

      <Card>
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h2 className="text-lg font-medium mb-4 text-gray-900 dark:text-white">Date Range</h2>

              <FormSelect
                label="Financial Year"
                id="financial_year"
                name="financial_year"
                value={`${formData.start_date.split('-')[0]}-${parseInt(formData.start_date.split('-')[0]) + 1}`}
                onChange={handleFinancialYearChange}
                placeholder="Select Financial Year"
                options={getFinancialYearOptions()}
              />

              <div className="flex space-x-4 mt-4">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={setCurrentFinancialYear}
                >
                  Current FY
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    // Get current date in local time zone
                    const today = new Date();

                    // Create first day of current month (set to day 1)
                    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);

                    // Create last day of current month (set to day 0 of next month)
                    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);

                    // Format dates as YYYY-MM-DD strings in local time zone
                    const formatDate = (date) => {
                      const year = date.getFullYear();
                      const month = String(date.getMonth() + 1).padStart(2, '0');
                      const day = String(date.getDate()).padStart(2, '0');
                      return `${year}-${month}-${day}`;
                    };

                    setFormData(prev => ({
                      ...prev,
                      start_date: formatDate(firstDay),
                      end_date: formatDate(lastDay)
                    }));
                  }}
                >
                  Current Month
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-4 mt-4">
                <FormInput
                  label="Start Date"
                  id="start_date"
                  name="start_date"
                  type="date"
                  value={formData.start_date}
                  onChange={handleChange}
                  required
                />

                <FormInput
                  label="End Date"
                  id="end_date"
                  name="end_date"
                  type="date"
                  value={formData.end_date}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>

            <div>
              <h2 className="text-lg font-medium mb-4 text-gray-900 dark:text-white">Report Options</h2>

              <FormSelect
                label="Invoice Type"
                id="invoice_type"
                name="invoice_type"
                value={formData.invoice_type}
                onChange={handleChange}
                options={[
                  { value: 'both', label: 'Both Inward and Outward' },
                  { value: 'outward', label: 'Outward Only' },
                  { value: 'inward', label: 'Inward Only' }
                ]}
              />

              <div className="mt-8">
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Report Format</h3>
                <div className="flex items-center space-x-2">
                  <input
                    type="radio"
                    id="format_excel"
                    name="format"
                    value="excel"
                    checked
                    readOnly
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 dark:border-gray-600"
                  />
                  <label htmlFor="format_excel" className="text-sm text-gray-700 dark:text-gray-300">
                    Excel (.xlsx)
                  </label>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className={`px-4 py-3 rounded flex items-center ${loading ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400' : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'}`}>
              {loading && (
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              {error}
            </div>
          )}

          <div className="flex justify-end">
            <Button
              type="submit"
              variant="primary"
              disabled={loading}
              className={loading ? 'opacity-80 cursor-not-allowed' : ''}
            >
              {loading ? (
                <span className="flex items-center">
                  <LoadingSpinner size="sm" className="mr-2" />
                  Generating Report... (may take up to 5 minutes)
                </span>
              ) : 'Generate Report'}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <div className="p-6">
          <h2 className="text-lg font-medium mb-4 text-gray-900 dark:text-white">About Reports</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Reports provide a comprehensive summary of your invoices for the selected period.
            The generated Excel file includes:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-gray-600 dark:text-gray-400">
            <li>Detailed list of all invoices in the selected date range</li>
            <li>Separate sheets for each business</li>
            <li>Breakdown of taxable value, CGST, SGST, and IGST</li>
            <li>Summary totals for inward and outward supplies</li>
            <li>Net tax liability calculation</li>
          </ul>
          <p className="text-gray-600 dark:text-gray-400 mt-4">
            These reports can be used for GST filing, tax planning, and business analysis.
          </p>
        </div>
      </Card>
    </div>
  );
}

export default Reports;
