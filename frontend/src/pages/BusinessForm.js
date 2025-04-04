import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import Button from '../components/Button';
import FormInput from '../components/FormInput';
import LoadingSpinner from '../components/LoadingSpinner';
import axios from 'axios';

function BusinessForm() {
  const { businessId } = useParams();
  const navigate = useNavigate();
  const isEditing = !!businessId;

  const [formData, setFormData] = useState({
    name: '',
    gst_number: '',
    address: '',
    phone_number: '',
    email: ''
  });

  const [loading, setLoading] = useState(isEditing);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});

  // If editing, fetch business data
  useEffect(() => {
    if (isEditing) {
      const fetchBusiness = async () => {
        try {
          setLoading(true);
          const response = await axios.get(`/api/businesses/${businessId}/`);
          setFormData({
            name: response.data.name || '',
            gst_number: response.data.gst_number || '',
            address: response.data.address || '',
            phone_number: response.data.phone_number || '',
            email: response.data.email || ''
          });
        } catch (err) {
          console.error('Error fetching business:', err);
          alert('Failed to load business data. Please try again.');
        } finally {
          setLoading(false);
        }
      };

      fetchBusiness();
    }
  }, [businessId, isEditing]);

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

  // Form validation
  const validateForm = () => {
    const newErrors = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Business name is required';
    }

    if (!formData.gst_number.trim()) {
      newErrors.gst_number = 'GST number is required';
    } else if (formData.gst_number.length !== 15) {
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
        await axios.put(`/api/businesses/${businessId}/`, formData);
      } else {
        await axios.post('/api/businesses/', formData);
      }

      navigate('/billing/business/list');
    } catch (err) {
      console.error('Error saving business:', err);

      // Handle validation errors from the server
      if (err.response && err.response.data) {
        setErrors(err.response.data);
      } else {
        alert(`Failed to ${isEditing ? 'update' : 'create'} business. Please try again.`);
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
          {isEditing ? 'Edit Business' : 'Add Business'}
        </h1>
        <Link to="/billing/business/list">
          <Button variant="outline">Cancel</Button>
        </Link>
      </div>

      <Card>
        <form className="space-y-4 p-6" onSubmit={handleSubmit}>
          <FormInput
            label="Business Name"
            id="name"
            name="name"
            value={formData.name}
            onChange={handleChange}
            placeholder="Enter business name"
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
            required
          />

          <FormInput
            label="Address"
            id="address"
            name="address"
            value={formData.address}
            onChange={handleChange}
            placeholder="Enter business address"
            error={errors.address}
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
                isEditing ? 'Update Business' : 'Create Business'
              )}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <div className="p-6">
          <h2 className="text-lg font-medium mb-4">Business Information</h2>
          <p className="text-gray-600 mb-2">
            Business profiles are used to generate invoices. Each business should have the following information:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-gray-600">
            <li><strong>Name:</strong> The legal name of your business</li>
            <li><strong>GST Number:</strong> Your business's GST identification number</li>
            <li><strong>Address:</strong> The registered address of your business</li>
            <li><strong>Contact Information:</strong> Phone number and email for business communications</li>
          </ul>
        </div>
      </Card>
    </div>
  );
}

export default BusinessForm;
