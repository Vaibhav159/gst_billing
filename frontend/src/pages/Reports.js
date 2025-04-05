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

  // Get CSRF token from cookie
  const getCookie = (name) => {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
      const cookies = document.cookie.split(';');
      for (let i = 0; i < cookies.length; i++) {
        const cookie = cookies[i].trim();
        if (cookie.substring(0, name.length + 1) === (name + '=')) {
          cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
          break;
        }
      }
    }
    return cookieValue;
  };

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

      // Create a form to submit (this will trigger a file download)
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = '/api/reports/generate/';
      form.target = '_blank'; // Open in new tab

      // JWT token is sent in the Authorization header automatically
      // No need for CSRF token with JWT authentication

      // Add form data
      Object.entries(formData).forEach(([key, value]) => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = key;
        input.value = value;
        form.appendChild(input);
      });

      // Submit the form
      document.body.appendChild(form);
      form.submit();
      document.body.removeChild(form);

    } catch (err) {
      console.error('Error generating report:', err);
      setError('Failed to generate report. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900">Reports</h1>

      <Card>
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h2 className="text-lg font-medium mb-4">Date Range</h2>

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
              <h2 className="text-lg font-medium mb-4">Report Options</h2>

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
                <h3 className="text-sm font-medium text-gray-500 mb-2">Report Format</h3>
                <div className="flex items-center space-x-2">
                  <input
                    type="radio"
                    id="format_excel"
                    name="format"
                    value="excel"
                    checked
                    readOnly
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                  />
                  <label htmlFor="format_excel" className="text-sm text-gray-700">
                    Excel (.xlsx)
                  </label>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <div className="flex justify-end">
            <Button
              type="submit"
              variant="primary"
              disabled={loading}
            >
              {loading ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2" />
                  Generating...
                </>
              ) : (
                'Generate Report'
              )}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <div className="p-6">
          <h2 className="text-lg font-medium mb-4">About Reports</h2>
          <p className="text-gray-600 mb-4">
            Reports provide a comprehensive summary of your invoices for the selected period.
            The generated Excel file includes:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-gray-600">
            <li>Detailed list of all invoices in the selected date range</li>
            <li>Separate sheets for each business</li>
            <li>Breakdown of taxable value, CGST, SGST, and IGST</li>
            <li>Summary totals for inward and outward supplies</li>
            <li>Net tax liability calculation</li>
          </ul>
          <p className="text-gray-600 mt-4">
            These reports can be used for GST filing, tax planning, and business analysis.
          </p>
        </div>
      </Card>
    </div>
  );
}

export default Reports;
