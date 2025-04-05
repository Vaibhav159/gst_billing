import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import Button from '../components/Button';
import FormInput from '../components/FormInput';
import LoadingSpinner from '../components/LoadingSpinner';

import StateDropdown from '../components/StateDropdown';
import businessService from '../api/businessService';

function BusinessForm() {
  const { businessId } = useParams();
  const navigate = useNavigate();
  const isEditing = !!businessId;

  const [formData, setFormData] = useState({
    name: '',
    gst_number: '',
    address: '',
    mobile_number: '',
    pan_number: '',
    state_name: '',
    bank_name: '',
    bank_account_number: '',
    bank_ifsc_code: '',
    bank_branch_name: ''
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
          const businessData = await businessService.getBusiness(businessId);
          setFormData({
            name: businessData.name || '',
            gst_number: businessData.gst_number || '',
            address: businessData.address || '',
            mobile_number: businessData.mobile_number || '',
            pan_number: businessData.pan_number || '',
            state_name: businessData.state_name || '',
            bank_name: businessData.bank_name || '',
            bank_account_number: businessData.bank_account_number || '',
            bank_ifsc_code: businessData.bank_ifsc_code || '',
            bank_branch_name: businessData.bank_branch_name || ''
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
        await businessService.updateBusiness(businessId, formData);
      } else {
        await businessService.createBusiness(formData);
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2">
              <h3 className="text-lg font-medium mb-4">Basic Information</h3>
            </div>

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
              label="PAN Number"
              id="pan_number"
              name="pan_number"
              value={formData.pan_number}
              onChange={handleChange}
              placeholder="Enter PAN number"
              error={errors.pan_number}
            />

            <StateDropdown
              label="State"
              id="state_name"
              name="state_name"
              value={formData.state_name}
              onChange={handleChange}
              error={errors.state_name}
              required
            />

            <div className="md:col-span-2">
              <FormInput
                label="Address"
                id="address"
                name="address"
                value={formData.address}
                onChange={handleChange}
                placeholder="Enter business address"
                error={errors.address}
              />
            </div>

            <FormInput
              label="Mobile Number"
              id="mobile_number"
              name="mobile_number"
              value={formData.mobile_number}
              onChange={handleChange}
              placeholder="Enter mobile number"
              error={errors.mobile_number}
            />

            <div className="md:col-span-2 pt-4">
              <h3 className="text-lg font-medium mb-4">Bank Details</h3>
            </div>

            <FormInput
              label="Bank Name"
              id="bank_name"
              name="bank_name"
              value={formData.bank_name}
              onChange={handleChange}
              placeholder="Enter bank name"
              error={errors.bank_name}
            />

            <FormInput
              label="Account Number"
              id="bank_account_number"
              name="bank_account_number"
              value={formData.bank_account_number}
              onChange={handleChange}
              placeholder="Enter account number"
              error={errors.bank_account_number}
            />

            <FormInput
              label="IFSC Code"
              id="bank_ifsc_code"
              name="bank_ifsc_code"
              value={formData.bank_ifsc_code}
              onChange={handleChange}
              placeholder="Enter IFSC code"
              error={errors.bank_ifsc_code}
            />

            <FormInput
              label="Branch Name"
              id="bank_branch_name"
              name="bank_branch_name"
              value={formData.bank_branch_name}
              onChange={handleChange}
              placeholder="Enter branch name"
              error={errors.bank_branch_name}
            />
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
