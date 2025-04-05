import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import Button from '../components/Button';
import FormInput from '../components/FormInput';
import FormSelect from '../components/FormSelect';
import LoadingSpinner from '../components/LoadingSpinner';
import axios from 'axios';

function CustomerForm() {
  const { customerId } = useParams();
  const navigate = useNavigate();
  const isEditing = !!customerId;

  const [formData, setFormData] = useState({
    name: '',
    gst_number: '',
    phone_number: '',
    email: '',
    address: '',
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
        const response = await axios.get('/api/businesses/');
        // Ensure we have a valid array of businesses with required properties
        const businessData = response.data.results || response.data || [];
        const validBusinesses = Array.isArray(businessData)
          ? businessData.filter(business => business && typeof business === 'object' && business.id && business.name)
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
          const response = await axios.get(`/api/customers/${customerId}/`);

          // Validate customer data
          const customerData = response.data;
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
        await axios.put(`/api/customers/${customerId}/`, formData);
      } else {
        await axios.post('/api/customers/', formData);
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
      <div className="flex justify-center items-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">
          {isEditing ? 'Edit Customer' : 'Add Customer'}
        </h1>
        <Link to="/billing/customer/list">
          <Button variant="outline">Cancel</Button>
        </Link>
      </div>

      <Card>
        <form className="space-y-4 p-6" onSubmit={handleSubmit}>
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
            label="Phone Number"
            id="phone_number"
            name="phone_number"
            value={formData.phone_number}
            onChange={handleChange}
            placeholder="Enter phone number"
            error={errors.phone_number}
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

          <FormInput
            label="Address"
            id="address"
            name="address"
            value={formData.address}
            onChange={handleChange}
            placeholder="Enter address"
            error={errors.address}
          />

          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Associated Businesses</label>
            <div className="space-y-2">
              {businesses.length === 0 ? (
                <p className="text-sm text-gray-500">No businesses available</p>
              ) : (
                businesses.map(business => {
                  // Skip rendering if business doesn't have required properties
                  if (!business || !business.id) return null;

                  // Safely check if business is included
                  const isChecked = Array.isArray(formData.businesses) &&
                    formData.businesses.includes(business.id);

                  return (
                    <div key={business.id} className="flex items-center">
                      <input
                        type="checkbox"
                        id={`business-${business.id}`}
                        name="businesses"
                        value={business.id}
                        checked={isChecked}
                        onChange={handleBusinessChange}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <label htmlFor={`business-${business.id}`} className="ml-2 text-sm text-gray-700">
                        {business.name}
                      </label>
                    </div>
                  );
                })
              )}
            </div>
            {errors.businesses && <p className="mt-1 text-sm text-red-600">{errors.businesses}</p>}
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
