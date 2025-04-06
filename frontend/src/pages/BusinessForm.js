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
      <div className="flex flex-col justify-center items-center h-64 animate-pulse">
        <LoadingSpinner size="lg" className="text-primary-600 dark:text-primary-400" />
        <p className="mt-4 text-gray-600 dark:text-gray-400 font-medium">
          {isEditing ? 'Loading business details...' : 'Preparing form...'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 mr-2 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
          {isEditing ? 'Edit Business' : 'Add Business'}
        </h1>
        <Link to="/billing/business/list">
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
              Basic Information
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
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
          </div>

          <div className="border-b border-gray-200 dark:border-gray-700 pb-4 mb-2 pt-4">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
              Bank Details
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
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
                isEditing ? 'Update Business' : 'Create Business'
              )}
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
            Business Information
          </h2>
          <p className="text-gray-700 dark:text-gray-300 mb-4">
            Business profiles are used to generate invoices. Each business should have the following information:
          </p>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm">
            <ul className="list-none space-y-3 text-gray-700 dark:text-gray-300">
              <li className="flex items-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-500 dark:text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span><strong className="text-gray-900 dark:text-white">Name:</strong> The legal name of your business</span>
              </li>
              <li className="flex items-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-500 dark:text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span><strong className="text-gray-900 dark:text-white">GST Number:</strong> Your business's GST identification number</span>
              </li>
              <li className="flex items-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-500 dark:text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span><strong className="text-gray-900 dark:text-white">Address:</strong> The registered address of your business</span>
              </li>
              <li className="flex items-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-500 dark:text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span><strong className="text-gray-900 dark:text-white">Contact Information:</strong> Phone number and email for business communications</span>
              </li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default BusinessForm;
