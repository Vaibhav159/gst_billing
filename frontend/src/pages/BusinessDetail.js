import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import Button from '../components/Button';
import LoadingSpinner from '../components/LoadingSpinner';
import axios from 'axios';
import { formatIndianCurrency } from '../utils/formatters';

function BusinessDetail() {
  const { businessId } = useParams();
  const navigate = useNavigate();
  const [business, setBusiness] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch business details
  useEffect(() => {
    const fetchBusinessDetails = async () => {
      try {
        setLoading(true);
        const businessResponse = await axios.get(`/api/businesses/${businessId}/`);
        setBusiness(businessResponse.data);

        // Fetch invoices for this business
        const invoicesResponse = await axios.get(`/api/invoices/`, {
          params: { business_id: businessId }
        });
        setInvoices(invoicesResponse.data.results || invoicesResponse.data);

        // Fetch customers for this business
        const customersResponse = await axios.get(`/api/customers/`);
        const allCustomers = customersResponse.data.results || customersResponse.data;

        // Filter customers that have this business in their businesses array
        const businessCustomers = allCustomers.filter(customer =>
          customer.businesses && customer.businesses.includes(parseInt(businessId))
        );
        setCustomers(businessCustomers);

        setError(null);
      } catch (err) {
        console.error('Error fetching business details:', err);
        setError('Failed to load business details. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchBusinessDetails();
  }, [businessId]);

  // Handle business deletion
  const handleDelete = async () => {
    if (window.confirm('Are you sure you want to delete this business?')) {
      try {
        await axios.delete(`/api/businesses/${businessId}/`);
        navigate('/billing/business/list');
      } catch (err) {
        console.error('Error deleting business:', err);
        alert('Failed to delete business. Please try again.');
      }
    }
  };

  if (loading) {
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

            {invoices.length === 0 ? (
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
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

export default BusinessDetail;
