import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import Button from '../components/Button';
import LoadingSpinner from '../components/LoadingSpinner';
import axios from 'axios';
import { formatIndianCurrency } from '../utils/formatters';

function CustomerDetail() {
  const { customerId } = useParams();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch customer details
  useEffect(() => {
    const fetchCustomerDetails = async () => {
      try {
        setLoading(true);
        const customerResponse = await axios.get(`/api/customers/${customerId}/`);
        // Validate customer data
        const customerData = customerResponse.data;
        if (!customerData || typeof customerData !== 'object') {
          throw new Error('Invalid customer data received');
        }
        setCustomer(customerData);

        // Fetch invoices for this customer
        const invoicesResponse = await axios.get(`/api/invoices/`, {
          params: { customer_id: customerId }
        });

        // Validate invoices data
        const invoiceData = invoicesResponse.data.results || invoicesResponse.data || [];
        const validInvoices = Array.isArray(invoiceData)
          ? invoiceData.filter(invoice => invoice && typeof invoice === 'object' && invoice.id)
          : [];

        setInvoices(validInvoices);

        setError(null);
      } catch (err) {
        console.error('Error fetching customer details:', err);
        setError('Failed to load customer details. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchCustomerDetails();
  }, [customerId]);

  // Handle customer deletion
  const handleDelete = async () => {
    if (window.confirm('Are you sure you want to delete this customer?')) {
      try {
        await axios.delete(`/api/customers/${customerId}/`);
        navigate('/billing/customer/list');
      } catch (err) {
        console.error('Error deleting customer:', err);
        alert('Failed to delete customer. Please try again.');
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
          onClick={() => navigate('/billing/customer/list')}
        >
          Back to List
        </Button>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">Customer not found.</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => navigate('/billing/customer/list')}
        >
          Back to List
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">{customer.name}</h1>
        <div className="space-x-2">
          <Link to={`/billing/customer/edit/${customerId}`}>
            <Button variant="secondary">Edit</Button>
          </Link>
          <Button variant="danger" onClick={handleDelete}>Delete</Button>
          <Link to="/billing/customer/list">
            <Button variant="outline">Back to List</Button>
          </Link>
        </div>
      </div>

      <Card>
        <div className="p-6">
          <h2 className="text-xl font-semibold mb-4">Customer Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <p className="text-sm font-medium text-gray-500">Name</p>
              <p className="mt-1 text-lg">{customer.name}</p>
            </div>

            <div>
              <p className="text-sm font-medium text-gray-500">GST Number</p>
              <p className="mt-1 text-lg">{customer.gst_number || '-'}</p>
            </div>

            <div>
              <p className="text-sm font-medium text-gray-500">Phone Number</p>
              <p className="mt-1 text-lg">{customer.phone_number || '-'}</p>
            </div>

            <div>
              <p className="text-sm font-medium text-gray-500">Email</p>
              <p className="mt-1 text-lg">{customer.email || '-'}</p>
            </div>

            <div>
              <p className="text-sm font-medium text-gray-500">Address</p>
              <p className="mt-1 text-lg">{customer.address || '-'}</p>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">Invoices</h2>
            <div className="text-sm text-gray-500">
              Total: {invoices.length} invoice{invoices.length !== 1 ? 's' : ''}
            </div>
          </div>

          {invoices.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-gray-500">No invoices found for this customer.</p>
              <Link to="/billing/invoice/new" className="mt-2 inline-block text-blue-600 hover:text-blue-800">
                Create an invoice
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Invoice Number
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Business
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Amount
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Type
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {invoices.map((invoice) => {
                    // Skip rendering if invoice doesn't have required properties
                    if (!invoice || !invoice.id) return null;

                    // Safely format date
                    let formattedDate = '-';
                    try {
                      if (invoice.invoice_date) {
                        formattedDate = new Date(invoice.invoice_date).toLocaleDateString();
                      }
                    } catch (err) {
                      console.error('Error formatting date:', err);
                    }

                    // Safely format amount
                    let formattedAmount = '-';
                    try {
                      if (invoice.total_amount !== undefined) {
                        formattedAmount = formatIndianCurrency(invoice.total_amount);
                      }
                    } catch (err) {
                      console.error('Error formatting amount:', err);
                    }

                    return (
                      <tr key={invoice.id}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{invoice.invoice_number || '-'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-500">{formattedDate}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-500">{invoice.business_name || '-'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-500">{formattedAmount}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${invoice.type_of_invoice === 'outward' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
                            {invoice.type_of_invoice === 'outward' ? 'Outward' : 'Inward'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          {invoice.id && (
                            <Link to={`/billing/invoice/${invoice.id}`} className="text-blue-600 hover:text-blue-900">
                              View
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

export default CustomerDetail;
