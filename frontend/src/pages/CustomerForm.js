import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import Button from '../components/Button';
import FormInput from '../components/FormInput';
import StateDropdown from '../components/StateDropdown';
import LoadingSpinner from '../components/LoadingSpinner';
import customerService from '../api/customerService';
import businessService from '../api/businessService';

function CustomerForm() {
  const { customerId } = useParams();
  const navigate = useNavigate();
  const isEditing = !!customerId;

  const [formData, setFormData] = useState({
    name: '',
    gst_number: '',
    mobile_number: '',
    email: '',
    address: '',
    state_name: '',
    businesses: []
  });

  const [businesses, setBusinesses] = useState([]);
  const [loading, setLoading] = useState(isEditing);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});

  // Fetch businesses for the dropdown
  useEffect(() => {
    const fetchBusinesses = async () => {
      try {
        const businessData = await businessService.getBusinesses();
        // Ensure we have a valid array of businesses with required properties
        const businesses = businessData.results || businessData || [];
        const validBusinesses = Array.isArray(businesses)
          ? businesses.filter(business => business && typeof business === 'object' && business.id && business.name)
          : [];

        setBusinesses(validBusinesses);
      } catch (err) {
        console.error('Error fetching businesses:', err);
        // Set to empty array on error to prevent mapping issues
        setBusinesses([]);
      }
    };

    fetchBusinesses();
  }, []);

  // If editing, fetch customer data
  useEffect(() => {
    if (isEditing) {
      const fetchCustomer = async () => {
        try {
          setLoading(true);
          const customerData = await customerService.getCustomer(customerId);

          // Validate customer data
          if (!customerData || typeof customerData !== 'object') {
            throw new Error('Invalid customer data received');
          }

          // Ensure businesses is an array
          let businessIds = [];
          if (Array.isArray(customerData.businesses)) {
            businessIds = customerData.businesses.filter(id => id !== null && id !== undefined);
          }

          setFormData({
            name: customerData.name || '',
            gst_number: customerData.gst_number || '',
            phone_number: customerData.phone_number || '',
            email: customerData.email || '',
            address: customerData.address || '',
            businesses: businessIds
          });
        } catch (err) {
          console.error('Error fetching customer:', err);
          alert('Failed to load customer data. Please try again.');
        } finally {
          setLoading(false);
        }
      };

      fetchCustomer();
    }
  }, [customerId, isEditing]);

  // Handle form input changes
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));

    // Clear error for this field when user types
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: null
      }));
    }
  };

  // Handle business selection changes
  const handleBusinessChange = (e) => {
    try {
      const { value, checked } = e.target;
      // Safely parse the business ID
      let businessId;
      try {
        businessId = parseInt(value, 10);
        if (isNaN(businessId)) {
          console.warn('Invalid business ID:', value);
          return; // Skip if not a valid number
        }
      } catch (err) {
        console.error('Error parsing business ID:', err);
        return; // Skip if parsing fails
      }

      setFormData(prev => {
        // Ensure businesses is an array
        const currentBusinesses = Array.isArray(prev.businesses) ? prev.businesses : [];

        if (checked) {
          // Add the business ID if it's not already in the array
          return {
            ...prev,
            businesses: currentBusinesses.includes(businessId)
              ? currentBusinesses
              : [...currentBusinesses, businessId]
          };
        } else {
          // Remove the business ID
          return {
            ...prev,
            businesses: currentBusinesses.filter(id => id !== businessId)
          };
        }
      });
    } catch (err) {
      console.error('Error handling business change:', err);
    }
  };

  // Form validation
  const validateForm = () => {
    const newErrors = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Customer name is required';
    }

    if (formData.gst_number && formData.gst_number.length !== 15) {
      newErrors.gst_number = 'GST number must be 15 characters';
    }

    if (formData.email && !/^\S+@\S+\.\S+$/.test(formData.email)) {
      newErrors.email = 'Invalid email format';
    }

    if (!formData.state_name) {
      newErrors.state_name = 'State is required';
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

      if (isEditing) {
        await customerService.updateCustomer(customerId, formData);
      } else {
        await customerService.createCustomer(formData);
      }

      navigate('/billing/customer/list');
    } catch (err) {
      console.error('Error saving customer:', err);

      // Handle validation errors from the server
      if (err.response && err.response.data) {
        setErrors(err.response.data);
      } else {
        alert(`Failed to ${isEditing ? 'update' : 'create'} customer. Please try again.`);
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
          {isEditing ? 'Loading customer details...' : 'Preparing form...'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 mr-2 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          {isEditing ? 'Edit Customer' : 'Add Customer'}
        </h1>
        <Link to="/billing/customer/list">
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
              Customer Information
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            <FormInput
              label="Customer Name"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="Enter customer name"
              error={errors.name}
              required
            />

            <FormInput
              label="GST Number"
              id="gst_number"
              name="gst_number"
              value={formData.gst_number}
              onChange={handleChange}
              placeholder="Enter GST number"
              error={errors.gst_number}
            />

            <FormInput
              label="Mobile Number"
              id="mobile_number"
              name="mobile_number"
              value={formData.mobile_number}
              onChange={handleChange}
              placeholder="Enter mobile number"
              error={errors.mobile_number}
            />

            <FormInput
              label="Email"
              id="email"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="Enter email address"
              error={errors.email}
            />

            <div className="md:col-span-2">
              <FormInput
                label="Address"
                id="address"
                name="address"
                value={formData.address}
                onChange={handleChange}
                placeholder="Enter address"
                error={errors.address}
              />
            </div>

            <StateDropdown
              label="State"
              id="state_name"
              name="state_name"
              value={formData.state_name}
              onChange={handleChange}
              error={errors.state_name}
              required
            />
          </div>

          <div className="border-b border-gray-200 dark:border-gray-700 pb-4 mb-2 pt-4">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              Associated Businesses
            </h3>
          </div>

          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {businesses.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 col-span-full text-center py-4">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 mx-auto mb-2 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                  No businesses available
                </p>
              ) : (
                businesses.map(business => {
                  // Skip rendering if business doesn't have required properties
                  if (!business || !business.id) return null;

                  // Safely check if business is included
                  const isChecked = Array.isArray(formData.businesses) &&
                    formData.businesses.includes(business.id);

                  return (
                    <div key={business.id} className="flex items-center p-3 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md transition-all duration-200">
                      <input
                        type="checkbox"
                        id={`business-${business.id}`}
                        name="businesses"
                        value={business.id}
                        checked={isChecked}
                        onChange={handleBusinessChange}
                        className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                      />
                      <label htmlFor={`business-${business.id}`} className="ml-2 text-sm text-gray-700 dark:text-gray-300 font-medium">
                        {business.name}
                      </label>
                    </div>
                  );
                })
              )}
            </div>
            {errors.businesses && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{errors.businesses}</p>}
          </div>

          <div className="flex justify-end space-x-2 pt-6 border-t border-gray-200 dark:border-gray-700 mt-4">
            <Button
              type="submit"
              variant="primary"
              disabled={submitting}
              icon={isEditing ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              )}
            >
              {submitting ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2" />
                  {isEditing ? 'Updating...' : 'Creating...'}
                </>
              ) : (
                isEditing ? 'Update Customer' : 'Create Customer'
              )}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

export default CustomerForm;
