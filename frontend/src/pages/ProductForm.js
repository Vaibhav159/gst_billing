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
      <div className="flex justify-center items-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">
          {isEditing ? 'Edit Product' : 'Add Product'}
        </h1>
        <Link to="/billing/product/list">
          <Button variant="outline">Cancel</Button>
        </Link>
      </div>

      <Card>
        <form className="space-y-4 p-6" onSubmit={handleSubmit}>
          <FormInput
            label="Product Name"
            id="name"
            name="name"
            value={formData.name}
            onChange={handleChange}
            placeholder="Enter product name"
            error={errors.name}
            required
          />

          <FormInput
            label="HSN Code"
            id="hsn_code"
            name="hsn_code"
            value={formData.hsn_code}
            onChange={handleChange}
            placeholder="Enter HSN code"
            error={errors.hsn_code}
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
            />
          </div>

          <FormInput
            label="Description"
            id="description"
            name="description"
            value={formData.description}
            onChange={handleChange}
            placeholder="Enter product description"
            error={errors.description}
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
                isEditing ? 'Update Product' : 'Create Product'
              )}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <div className="p-6">
          <h2 className="text-lg font-medium mb-4">Product Information</h2>
          <p className="text-gray-600 mb-2">
            Products are used in invoices as line items. Each product can have the following information:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-gray-600">
            <li><strong>Name:</strong> The name of the product or service</li>
            <li><strong>HSN Code:</strong> Harmonized System of Nomenclature code for GST classification</li>
            <li><strong>GST Tax Rate:</strong> The GST tax rate applicable to this product (e.g., 3% for gold)</li>
            <li><strong>Description:</strong> Additional details about the product</li>
          </ul>
        </div>
      </Card>
    </div>
  );
}

export default ProductForm;
