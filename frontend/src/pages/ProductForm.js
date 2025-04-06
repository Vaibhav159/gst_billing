import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import Button from '../components/Button';
import FormInput from '../components/FormInput';
import LoadingSpinner from '../components/LoadingSpinner';
import productService from '../api/productService';

function ProductForm() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const isEditing = !!productId;

  const [formData, setFormData] = useState({
    name: '',
    hsn_code: '',
    gst_tax_rate: 0.03, // Default to 3%
    description: ''
  });

  const [loading, setLoading] = useState(isEditing);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});

  // If editing, fetch product data
  useEffect(() => {
    if (isEditing) {
      const fetchProduct = async () => {
        try {
          setLoading(true);
          const productData = await productService.getProduct(productId);
          setFormData({
            name: productData.name || '',
            hsn_code: productData.hsn_code || '',
            gst_tax_rate: productData.gst_tax_rate || 0.03,
            description: productData.description || ''
          });
        } catch (err) {
          console.error('Error fetching product:', err);
          alert('Failed to load product data. Please try again.');
        } finally {
          setLoading(false);
        }
      };

      fetchProduct();
    }
  }, [productId, isEditing]);

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
      newErrors.name = 'Product name is required';
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
        await productService.updateProduct(productId, formData);
      } else {
        await productService.createProduct(formData);
      }

      navigate('/billing/product/list');
    } catch (err) {
      console.error('Error saving product:', err);

      // Handle validation errors from the server
      if (err.response && err.response.data) {
        setErrors(err.response.data);
      } else {
        alert(`Failed to ${isEditing ? 'update' : 'create'} product. Please try again.`);
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
          {isEditing ? 'Loading product details...' : 'Preparing form...'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 mr-2 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
          {isEditing ? 'Edit Product' : 'Add Product'}
        </h1>
        <Link to="/billing/product/list">
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
              Product Details
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            <FormInput
              label="Product Name"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="Enter product name"
              error={errors.name}
              required
              icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>}
            />

            <FormInput
              label="HSN Code"
              id="hsn_code"
              name="hsn_code"
              value={formData.hsn_code}
              onChange={handleChange}
              placeholder="Enter HSN code"
              error={errors.hsn_code}
              icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
              </svg>}
            />

            <FormInput
              label="GST Tax Rate (%)"
              id="gst_tax_rate"
              name="gst_tax_rate"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={formData.gst_tax_rate * 100} // Convert decimal to percentage for display
              onChange={(e) => {
                // Convert percentage back to decimal for storage
                const percentValue = parseFloat(e.target.value);
                const decimalValue = isNaN(percentValue) ? 0 : percentValue / 100;

                setFormData(prev => ({
                  ...prev,
                  gst_tax_rate: decimalValue
                }));

                // Clear error
                if (errors.gst_tax_rate) {
                  setErrors(prev => ({
                    ...prev,
                    gst_tax_rate: null
                  }));
                }
              }}
              placeholder="Enter GST tax rate"
              error={errors.gst_tax_rate}
              helpText="Enter the GST tax rate as a percentage (e.g., 3 for 3%)"
              icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>}
            />

            <div className="md:col-span-2">
              <FormInput
                label="Description"
                id="description"
                name="description"
                value={formData.description}
                onChange={handleChange}
                placeholder="Enter product description"
                error={errors.description}
                icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                </svg>}
              />
            </div>
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
                isEditing ? 'Update Product' : 'Create Product'
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
            Product Information
          </h2>
          <p className="text-gray-700 dark:text-gray-300 mb-4">
            Products are used in invoices as line items. Each product can have the following information:
          </p>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm">
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 text-gray-700 dark:text-gray-300">
              <li className="flex items-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-500 dark:text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span><strong className="text-gray-900 dark:text-white">Name:</strong> The name of the product or service</span>
              </li>
              <li className="flex items-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-500 dark:text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span><strong className="text-gray-900 dark:text-white">HSN Code:</strong> Harmonized System of Nomenclature code for GST classification</span>
              </li>
              <li className="flex items-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-500 dark:text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span><strong className="text-gray-900 dark:text-white">GST Tax Rate:</strong> The GST tax rate applicable to this product (e.g., 3% for gold)</span>
              </li>
              <li className="flex items-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-500 dark:text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span><strong className="text-gray-900 dark:text-white">Description:</strong> Additional details about the product</span>
              </li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default ProductForm;
