import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import Button from '../components/Button';
import LoadingSpinner from '../components/LoadingSpinner';
import apiClient from '../api/client';
import { formatIndianCurrency } from '../utils/formatters';
import businessService from '../api/businessService';

function BusinessDetail() {
  const { businessId } = useParams();
  const navigate = useNavigate();
  const [business, setBusiness] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loadingStates, setLoadingStates] = useState({
    business: true,
    invoices: true
  });
  const [error, setError] = useState(null);

  // Helper function to update a specific loading state
  const updateLoadingState = (key, value) => {
    setLoadingStates(prev => ({
      ...prev,
      [key]: value
    }));
  };

  // Fetch business details
  useEffect(() => {
    // Fetch business data
    const fetchBusiness = async () => {
      try {
        updateLoadingState('business', true);
        const businessResponse = await apiClient.get(`/businesses/${businessId}/`);
        setBusiness(businessResponse.data);
        setError(null);
      } catch (err) {
        console.error('Error fetching business details:', err);
        setError('Failed to load business details. Please try again.');
      } finally {
        updateLoadingState('business', false);
      }
    };

    // Fetch invoices for this business
    const fetchInvoices = async () => {
      try {
        updateLoadingState('invoices', true);
        const invoicesResponse = await apiClient.get(`/invoices/`, {
          params: { business_id: businessId }
        });
        setInvoices(invoicesResponse.data.results || invoicesResponse.data);
      } catch (err) {
        console.error('Error fetching business invoices:', err);
        // Don't set global error for invoices - just log it
      } finally {
        updateLoadingState('invoices', false);
      }
    };

    // Fetch customers for this business
    const fetchCustomers = async () => {
      try {
        const customersResponse = await apiClient.get(`/customers/`);
        const allCustomers = customersResponse.data.results || customersResponse.data;

        // Filter customers that have this business in their businesses array
        const businessCustomers = allCustomers.filter(customer =>
          customer.businesses && customer.businesses.includes(parseInt(businessId))
        );
        setCustomers(businessCustomers);
      } catch (err) {
        console.error('Error fetching business customers:', err);
        // Don't set global error for customers - just log it
      }
    };

    // Start fetching data in parallel
    fetchBusiness();
    fetchInvoices();
    fetchCustomers();
  }, [businessId]);

  // Handle business deletion
  const handleDelete = async () => {
    if (window.confirm('Are you sure you want to delete this business?')) {
      try {
        // Use businessService to delete the business
        await businessService.deleteBusiness(businessId);
        navigate('/billing/business/list');
      } catch (err) {
        console.error('Error deleting business:', err);
        alert('Failed to delete business. Please try again.');
      }
    }
  };

  // Check if the main business data is still loading
  const isMainDataLoading = loadingStates.business;

  // Helper function to render a section with a loading indicator
  const renderWithLoading = (isLoading, content) => {
    if (isLoading) {
      return (
        <div className="flex justify-center items-center py-8">
          <LoadingSpinner size="md" />
        </div>
      );
    }
    return content;
  };

  if (isMainDataLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 text-red-500">
        <p>{error}</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => navigate('/billing/business/list')}
        >
          Back to List
        </Button>
      </div>
    );
  }

  if (!business) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">Business not found.</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => navigate('/billing/business/list')}
        >
          Back to List
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">{business.name}</h1>
        <div className="space-x-2">
          <Link to={`/billing/business/edit/${businessId}`}>
            <Button variant="secondary">Edit</Button>
          </Link>
          <Button variant="danger" onClick={handleDelete}>Delete</Button>
          <Link to="/billing/business/list">
            <Button variant="outline">Back to List</Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <div className="p-6">
            <h2 className="text-xl font-semibold mb-4">Business Information</h2>
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-gray-500">Name</p>
                <p className="mt-1 text-lg">{business.name}</p>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-500">GST Number</p>
                <p className="mt-1 text-lg">{business.gst_number || '-'}</p>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-500">PAN Number</p>
                <p className="mt-1 text-lg">{business.pan_number || '-'}</p>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-500">State</p>
                <p className="mt-1 text-lg">{business.state_name || '-'}</p>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-500">Address</p>
                <p className="mt-1 text-lg">{business.address || '-'}</p>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <div className="p-6">
            <h2 className="text-xl font-semibold mb-4">Contact & Bank Details</h2>
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-gray-500">Mobile Number</p>
                <p className="mt-1 text-lg">{business.mobile_number || '-'}</p>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-500">Bank Name</p>
                <p className="mt-1 text-lg">{business.bank_name || '-'}</p>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-500">Account Number</p>
                <p className="mt-1 text-lg">{business.bank_account_number || '-'}</p>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-500">IFSC Code</p>
                <p className="mt-1 text-lg">{business.bank_ifsc_code || '-'}</p>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-500">Branch Name</p>
                <p className="mt-1 text-lg">{business.bank_branch_name || '-'}</p>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <div className="p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Customers ({customers.length})</h2>
              <Link to={`/billing/customer?business=${businessId}`} className="text-blue-600 hover:text-blue-800">
                Add Customer
              </Link>
            </div>

            {customers.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-gray-500">No customers linked to this business.</p>
                <Link to="/billing/customer" className="mt-2 inline-block text-blue-600 hover:text-blue-800">
                  Add a customer
                </Link>
              </div>
            ) : (
              <div className="divide-y">
                {customers.map((customer) => (
                  <div key={customer.id} className="py-3">
                    <Link to={`/billing/customer/${customer.id}`} className="text-blue-600 hover:text-blue-800 font-medium">
                      {customer.name}
                    </Link>
                    <p className="text-sm text-gray-600">{customer.gst_number || 'No GST'}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <div className="p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Recent Invoices ({invoices.length})</h2>
              <Link to={`/billing/invoice/list?business_id=${businessId}`} className="text-blue-600 hover:text-blue-800">
                View All
              </Link>
            </div>

            {renderWithLoading(loadingStates.invoices, (
              invoices.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-gray-500">No invoices found for this business.</p>
                <Link to="/billing/invoice/new" className="mt-2 inline-block text-blue-600 hover:text-blue-800">
                  Create an invoice
                </Link>
              </div>
            ) : (
              <div className="divide-y">
                {invoices.slice(0, 5).map((invoice) => (
                  <div key={invoice.id} className="py-3 flex justify-between items-center">
                    <div>
                      <Link to={`/billing/invoice/${invoice.id}`} className="text-blue-600 hover:text-blue-800 font-medium">
                        {invoice.invoice_number}
                      </Link>
                      <p className="text-sm text-gray-600">{new Date(invoice.invoice_date).toLocaleDateString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium">{formatIndianCurrency(invoice.total_amount)}</p>
                      <p className="text-sm text-gray-600">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${invoice.type_of_invoice === 'outward' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
                          {invoice.type_of_invoice === 'outward' ? 'Outward' : 'Inward'}
                        </span>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

export default BusinessDetail;
