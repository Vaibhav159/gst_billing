import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import Button from '../components/Button';
import FormInput from '../components/FormInput';
import FormSelect from '../components/FormSelect';
import SearchableDropdown from '../components/SearchableDropdown';
import LoadingSpinner from '../components/LoadingSpinner';

import invoiceService from '../api/invoiceService';
import businessService from '../api/businessService';
import customerService from '../api/customerService';

function InvoiceForm() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    business: '',
    customer: '',
    invoice_number: '',
    invoice_date: new Date().toISOString().split('T')[0], // Today's date
    type_of_invoice: 'outward',
    is_igst_applicable: false
  });

  const [businesses, setBusinesses] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});

  // Fetch businesses
  useEffect(() => {
    const fetchBusinesses = async () => {
      try {
        setLoading(true);
        const businessesData = await businessService.getBusinesses();
        setBusinesses(businessesData.results || businessesData);
      } catch (err) {
        console.error('Error fetching businesses:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchBusinesses();
  }, []);

  // Fetch customers filtered by business
  useEffect(() => {
    const fetchCustomers = async () => {
      try {
        setLoading(true);

        // If a business is selected, filter customers by that business
        const filters = {};
        if (formData.business) {
          filters.business_id = formData.business;
        }

        const customersData = await customerService.getCustomers(filters);
        setCustomers(customersData.results || customersData);

        // If the currently selected customer is not associated with the selected business,
        // clear the customer selection
        if (formData.business && formData.customer) {
          const customerStillValid = (customersData.results || customersData).some(
            customer => customer.id.toString() === formData.customer.toString()
          );

          if (!customerStillValid) {
            setFormData(prev => ({
              ...prev,
              customer: ''
            }));
          }
        }
      } catch (err) {
        console.error('Error fetching customers:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchCustomers();
  }, [formData.business]);

  // Function to search customers
  const searchCustomers = async (query) => {
    try {
      if (!formData.business) {
        return [];
      }

      const filters = {
        business_id: formData.business,
        search: query
      };

      const response = await customerService.getCustomers(filters);
      return response.results || response || [];
    } catch (error) {
      console.error('Error searching customers:', error);
      return [];
    }
  };

  // Generate next invoice number
  useEffect(() => {
    if (formData.business && formData.type_of_invoice) {
      const generateInvoiceNumber = async () => {
        try {
          // Call the API to get the next invoice number
          const nextInvoiceNumber = await invoiceService.getNextInvoiceNumber(
            formData.business,
            formData.type_of_invoice
          );

          setFormData(prev => ({
            ...prev,
            invoice_number: nextInvoiceNumber
          }));
        } catch (err) {
          console.error('Error generating invoice number:', err);

          // Fallback to a simple invoice number if the API call fails
          const today = new Date();
          const year = today.getFullYear();
          const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');

          const prefix = formData.type_of_invoice === 'outward' ? 'OUT' : 'IN';
          const financialYear = today.getMonth() < 3 ?
            `${year-1}-${year.toString().slice(2)}` :
            `${year}-${(year+1).toString().slice(2)}`;
          const fallbackInvoiceNumber = `${prefix}/${financialYear}/${random}`;

          setFormData(prev => ({
            ...prev,
            invoice_number: fallbackInvoiceNumber
          }));
        }
      };

      generateInvoiceNumber();
    }
  }, [formData.business, formData.type_of_invoice]);

  // Handle form input changes
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));

    // Clear error for this field when user types
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: null
      }));
    }
  };

  // Form validation
  const validateForm = () => {
    const newErrors = {};

    if (!formData.business) {
      newErrors.business = 'Business is required';
    }

    if (!formData.customer) {
      newErrors.customer = 'Customer is required';
    }

    if (!formData.invoice_number) {
      newErrors.invoice_number = 'Invoice number is required';
    }

    if (!formData.invoice_date) {
      newErrors.invoice_date = 'Invoice date is required';
    }

    if (!formData.type_of_invoice) {
      newErrors.type_of_invoice = 'Invoice type is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    try {
      setSubmitting(true);

      const response = await invoiceService.createInvoice(formData);

      // Navigate to the invoice detail page
      navigate(`/billing/invoice/${response.id}`);
    } catch (err) {
      console.error('Error creating invoice:', err);

      // Handle validation errors from the server
      if (err.response && err.response.data) {
        setErrors(err.response.data);
      } else {
        alert('Failed to create invoice. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col justify-center items-center h-64 animate-pulse">
        <LoadingSpinner size="lg" className="text-primary-600 dark:text-primary-400" />
        <p className="mt-4 text-gray-600 dark:text-gray-400 font-medium">
          Loading form data...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 mr-2 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Create Invoice
        </h1>
        <Link to="/billing/invoice/list">
          <Button
            variant="outline"
            icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>}
          >
            Cancel
          </Button>
        </Link>
      </div>

      <Card className="transform transition-all duration-300 hover:shadow-md">
        <form className="space-y-6 p-4 md:p-6" onSubmit={handleSubmit}>
          <div className="border-b border-gray-200 dark:border-gray-700 pb-4 mb-2">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Invoice Information
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            <FormSelect
              label="Business"
              id="business"
              name="business"
              value={formData.business}
              onChange={handleChange}
              placeholder="Select a business"
              options={businesses.map(business => ({
                value: business.id,
                label: business.name
              }))}
              error={errors.business}
              required
            />

            <SearchableDropdown
              label="Customer"
              id="customer"
              name="customer"
              value={formData.customer}
              onChange={handleChange}
              onSelect={(customer) => {
                setFormData(prev => ({
                  ...prev,
                  customer: customer.id
                }));
              }}
              placeholder={formData.business ? "Search for a customer" : "Select a business first"}
              searchFunction={searchCustomers}
              displayProperty="name"
              valueProperty="id"
              error={errors.customer}
              required
              disabled={!formData.business}
            />
            {formData.business && customers.length === 0 && (
              <p className="text-sm text-red-500 -mt-3 ml-1">
                No customers associated with this business. <Link to="/billing/customer" className="underline">Add a customer</Link>
              </p>
            )}

            <FormInput
              label="Invoice Number"
              id="invoice_number"
              name="invoice_number"
              value={formData.invoice_number}
              onChange={handleChange}
              placeholder="Enter invoice number"
              error={errors.invoice_number}
              required
            />

            <FormInput
              label="Invoice Date"
              id="invoice_date"
              name="invoice_date"
              type="date"
              value={formData.invoice_date}
              onChange={handleChange}
              error={errors.invoice_date}
              required
            />

            <FormSelect
              label="Invoice Type"
              id="type_of_invoice"
              name="type_of_invoice"
              value={formData.type_of_invoice}
              onChange={handleChange}
              placeholder="Select invoice type"
              options={[
                { value: 'outward', label: 'Outward' },
                { value: 'inward', label: 'Inward' },
              ]}
              error={errors.type_of_invoice}
              required
            />

            <div className="md:col-span-2 bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg flex items-center">
              <input
                id="is_igst_applicable"
                name="is_igst_applicable"
                type="checkbox"
                checked={formData.is_igst_applicable}
                onChange={handleChange}
                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
              />
              <label htmlFor="is_igst_applicable" className="ml-2 block text-sm text-gray-900 dark:text-gray-100">
                Apply IGST (for inter-state transactions)
              </label>
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-6 border-t border-gray-200 dark:border-gray-700 mt-4">
            <Button
              type="submit"
              variant="primary"
              disabled={submitting}
              icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>}
            >
              {submitting ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2" />
                  Creating...
                </>
              ) : 'Create Invoice'}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="transform transition-all duration-300 hover:shadow-md bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 border border-blue-200 dark:border-blue-800/30">
        <div className="p-4 md:p-6">
          <h2 className="text-lg font-medium mb-4 text-gray-900 dark:text-white flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Next Steps
          </h2>
          <p className="text-gray-700 dark:text-gray-300 mb-4">
            After creating the invoice, you'll be redirected to the invoice detail page where you can:
          </p>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm">
            <ul className="list-none space-y-3 text-gray-700 dark:text-gray-300">
              <li className="flex items-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-500 dark:text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span><strong className="text-gray-900 dark:text-white">Add line items</strong> to the invoice</span>
              </li>
              <li className="flex items-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-500 dark:text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span><strong className="text-gray-900 dark:text-white">View the invoice summary</strong> with tax calculations</span>
              </li>
              <li className="flex items-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-500 dark:text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span><strong className="text-gray-900 dark:text-white">Print the invoice</strong> for your records</span>
              </li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default InvoiceForm;
