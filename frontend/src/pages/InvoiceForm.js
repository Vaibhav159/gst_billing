import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import Button from '../components/Button';
import FormInput from '../components/FormInput';
import FormSelect from '../components/FormSelect';
import LoadingSpinner from '../components/LoadingSpinner';
import axios from 'axios';

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

  // Fetch businesses and customers
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);

        // Fetch businesses
        const businessesResponse = await axios.get('/api/businesses/');
        setBusinesses(businessesResponse.data.results || businessesResponse.data);

        // Fetch customers
        const customersResponse = await axios.get('/api/customers/');
        setCustomers(customersResponse.data.results || customersResponse.data);

      } catch (err) {
        console.error('Error fetching data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Generate next invoice number
  useEffect(() => {
    if (formData.business && formData.type_of_invoice) {
      const generateInvoiceNumber = async () => {
        try {
          // In a real implementation, you would call an API endpoint to get the next invoice number
          // For now, we'll just generate a simple one based on the current date
          const today = new Date();
          const year = today.getFullYear().toString().slice(2); // Get last 2 digits of year
          const month = (today.getMonth() + 1).toString().padStart(2, '0');
          const day = today.getDate().toString().padStart(2, '0');
          const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');

          const prefix = formData.type_of_invoice === 'outward' ? 'OUT' : 'IN';
          const invoiceNumber = `${prefix}/${year}${month}${day}/${random}`;

          setFormData(prev => ({
            ...prev,
            invoice_number: invoiceNumber
          }));
        } catch (err) {
          console.error('Error generating invoice number:', err);
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

      const response = await axios.post('/api/invoices/', formData);

      // Navigate to the invoice detail page
      navigate(`/billing/invoice/${response.data.id}`);
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
      <div className="flex justify-center items-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Create Invoice</h1>
        <Link to="/billing/invoice/list">
          <Button variant="outline">Cancel</Button>
        </Link>
      </div>

      <Card>
        <form className="space-y-4 p-6" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

            <FormSelect
              label="Customer"
              id="customer"
              name="customer"
              value={formData.customer}
              onChange={handleChange}
              placeholder="Select a customer"
              options={customers.map(customer => ({
                value: customer.id,
                label: customer.name
              }))}
              error={errors.customer}
              required
            />

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

            <div className="flex items-center h-full pt-6">
              <input
                id="is_igst_applicable"
                name="is_igst_applicable"
                type="checkbox"
                checked={formData.is_igst_applicable}
                onChange={handleChange}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor="is_igst_applicable" className="ml-2 block text-sm text-gray-900">
                Apply IGST (for inter-state transactions)
              </label>
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button
              type="submit"
              variant="primary"
              disabled={submitting}
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

      <Card>
        <div className="p-6">
          <h2 className="text-lg font-medium mb-4">Next Steps</h2>
          <p className="text-gray-600 mb-2">
            After creating the invoice, you'll be redirected to the invoice detail page where you can:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-gray-600">
            <li>Add line items to the invoice</li>
            <li>View the invoice summary with tax calculations</li>
            <li>Print the invoice</li>
          </ul>
        </div>
      </Card>
    </div>
  );
}

export default InvoiceForm;
