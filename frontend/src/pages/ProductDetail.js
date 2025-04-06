import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import Button from '../components/Button';
import LoadingSpinner from '../components/LoadingSpinner';
import productService from '../api/productService';

function ProductDetail() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Helper function to update loading state
  const updateLoadingState = (key, value) => {
    setLoading(value);
  };

  // Fetch product details
  useEffect(() => {
    const fetchProduct = async () => {
      try {
        updateLoadingState('product', true);
        const productData = await productService.getProduct(productId);
        setProduct(productData);
        setError(null);
      } catch (err) {
        console.error('Error fetching product details:', err);
        setError('Failed to load product details. Please try again.');
      } finally {
        updateLoadingState('product', false);
      }
    };

    fetchProduct();
  }, [productId]);

  // Handle product deletion
  const handleDelete = async () => {
    if (window.confirm('Are you sure you want to delete this product?')) {
      try {
        setDeleting(true);
        await productService.deleteProduct(productId);
        navigate('/billing/product/list');
      } catch (err) {
        console.error('Error deleting product:', err);
        alert('Failed to delete product. Please try again.');
        setDeleting(false);
      }
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col justify-center items-center h-64 animate-pulse">
        <LoadingSpinner size="lg" className="text-primary-600 dark:text-primary-400" />
        <p className="mt-4 text-gray-600 dark:text-gray-400 font-medium">
          Loading product details...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 dark:border-red-600 p-4 rounded-md">
        <div className="flex items-start">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-3 text-red-500 dark:text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="font-bold text-red-700 dark:text-red-400">Error</p>
            <p className="text-red-600 dark:text-red-300">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500 dark:text-gray-400">Product not found.</p>
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
          {product.name}
        </h1>
        <div className="flex flex-wrap gap-2">
          <Link to={`/billing/product/edit/${productId}`}>
            <Button
              variant="secondary"
              icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>}
            >
              Edit
            </Button>
          </Link>
          <Button
            variant="danger"
            onClick={handleDelete}
            disabled={deleting}
            icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>}
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </div>

      {/* Product Information Card */}
      <Card className="transform transition-all duration-300 hover:shadow-md">
        <div className="p-4 md:p-6">
          <h2 className="text-lg font-medium mb-4 text-gray-900 dark:text-white flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Product Information
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Product Name</h3>
              <p className="text-lg font-medium text-gray-900 dark:text-white">{product.name}</p>
            </div>
            
            <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">HSN Code</h3>
              <p className="text-lg font-medium text-gray-900 dark:text-white">{product.hsn_code || '-'}</p>
            </div>
            
            <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">GST Tax Rate</h3>
              <p className="text-lg font-medium text-gray-900 dark:text-white">
                {product.gst_tax_rate ? `${(product.gst_tax_rate * 100).toFixed(0)}%` : '-'}
              </p>
            </div>
            
            <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Created At</h3>
              <p className="text-lg font-medium text-gray-900 dark:text-white">
                {new Date(product.created_at).toLocaleDateString()}
              </p>
            </div>
          </div>
          
          {product.description && (
            <div className="mt-6 bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Description</h3>
              <p className="text-gray-900 dark:text-white">{product.description}</p>
            </div>
          )}
        </div>
      </Card>

      {/* Usage Information Card */}
      <Card className="transform transition-all duration-300 hover:shadow-md bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 border border-blue-200 dark:border-blue-800/30">
        <div className="p-4 md:p-6">
          <h2 className="text-lg font-medium mb-4 text-gray-900 dark:text-white flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Usage Information
          </h2>
          
          <p className="text-gray-700 dark:text-gray-300 mb-4">
            This product can be used in invoices as a line item. When creating an invoice, you can select this product and specify the quantity and rate.
          </p>
          
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm">
            <ul className="space-y-2 text-gray-700 dark:text-gray-300">
              <li className="flex items-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-500 dark:text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>The HSN code and GST tax rate will be automatically applied.</span>
              </li>
              <li className="flex items-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-500 dark:text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>The amount will be calculated based on the quantity and rate.</span>
              </li>
              <li className="flex items-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-500 dark:text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>The GST tax will be calculated based on the GST tax rate.</span>
              </li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default ProductDetail;
