import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import Button from '../components/Button';
import FormInput from '../components/FormInput';
import LoadingSpinner from '../components/LoadingSpinner';
import axios from 'axios';

function InvoiceDetail() {
  const { invoiceId } = useParams();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState(null);
  const [lineItems, setLineItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newLineItem, setNewLineItem] = useState({
    item_name: '',
    qty: '',
    rate: ''
  });
  const [addingLineItem, setAddingLineItem] = useState(false);
  const [submittingLineItem, setSubmittingLineItem] = useState(false);

  // Fetch invoice details
  useEffect(() => {
    const fetchInvoiceDetails = async () => {
      try {
        setLoading(true);

        // Fetch invoice data
        const invoiceResponse = await axios.get(`/api/invoices/${invoiceId}/`);
        setInvoice(invoiceResponse.data);

        // Fetch line items (they should be included in the invoice response)
        setLineItems(invoiceResponse.data.line_items || []);

        // Fetch invoice summary
        const summaryResponse = await axios.get(`/api/invoices/${invoiceId}/summary/`);
        setSummary(summaryResponse.data);

        setError(null);
      } catch (err) {
        console.error('Error fetching invoice details:', err);
        setError('Failed to load invoice details. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchInvoiceDetails();
  }, [invoiceId]);

  // Handle invoice deletion
  const handleDelete = async () => {
    if (window.confirm('Are you sure you want to delete this invoice?')) {
      try {
        await axios.delete(`/api/invoices/${invoiceId}/`);
        navigate('/billing/invoice/list');
      } catch (err) {
        console.error('Error deleting invoice:', err);
        alert('Failed to delete invoice. Please try again.');
      }
    }
  };

  // Handle line item input changes
  const handleLineItemChange = (e) => {
    const { name, value } = e.target;
    setNewLineItem(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // Handle line item submission
  const handleAddLineItem = async (e) => {
    e.preventDefault();

    // Basic validation
    if (!newLineItem.item_name || !newLineItem.qty || !newLineItem.rate) {
      alert('Please fill in all fields');
      return;
    }

    try {
      setSubmittingLineItem(true);

      const response = await axios.post('/api/line-items/create_for_invoice/', {
        invoice_id: invoiceId,
        item_name: newLineItem.item_name,
        qty: newLineItem.qty,
        rate: newLineItem.rate
      });

      // Add the new line item to the list
      setLineItems(prev => [...prev, response.data]);

      // Reset the form
      setNewLineItem({
        item_name: '',
        qty: '',
        rate: ''
      });

      // Refresh the invoice summary
      const summaryResponse = await axios.get(`/api/invoices/${invoiceId}/summary/`);
      setSummary(summaryResponse.data);

      // Refresh the invoice to get updated total
      const invoiceResponse = await axios.get(`/api/invoices/${invoiceId}/`);
      setInvoice(invoiceResponse.data);

      // Hide the form
      setAddingLineItem(false);
    } catch (err) {
      console.error('Error adding line item:', err);
      alert('Failed to add line item. Please try again.');
    } finally {
      setSubmittingLineItem(false);
    }
  };

  // Handle print invoice
  const handlePrintInvoice = () => {
    window.open(`/billing/invoice/${invoiceId}/print`, '_blank');
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
          onClick={() => navigate('/billing/invoice/list')}
        >
          Back to List
        </Button>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">Invoice not found.</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => navigate('/billing/invoice/list')}
        >
          Back to List
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Invoice #{invoice.invoice_number}</h1>
        <div className="space-x-2">
          <Button variant="secondary" onClick={handlePrintInvoice}>Print Invoice</Button>
          <Button variant="danger" onClick={handleDelete}>Delete</Button>
          <Link to="/billing/invoice/list">
            <Button variant="outline">Back to List</Button>
          </Link>
        </div>
      </div>

      <Card>
        <div className="p-6">
          <h2 className="text-xl font-semibold mb-4">Invoice Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <p className="text-sm font-medium text-gray-500">Invoice Number</p>
              <p className="mt-1 text-lg">{invoice.invoice_number}</p>
            </div>

            <div>
              <p className="text-sm font-medium text-gray-500">Invoice Date</p>
              <p className="mt-1 text-lg">{new Date(invoice.invoice_date).toLocaleDateString()}</p>
            </div>

            <div>
              <p className="text-sm font-medium text-gray-500">Invoice Type</p>
              <p className="mt-1 text-lg">{invoice.type_of_invoice === 'outward' ? 'Outward' : 'Inward'}</p>
            </div>

            <div>
              <p className="text-sm font-medium text-gray-500">Customer</p>
              <p className="mt-1 text-lg">{invoice.customer_name}</p>
            </div>

            <div>
              <p className="text-sm font-medium text-gray-500">Business</p>
              <p className="mt-1 text-lg">{invoice.business_name}</p>
            </div>

            <div>
              <p className="text-sm font-medium text-gray-500">Total Amount</p>
              <p className="mt-1 text-lg font-semibold">₹{parseFloat(invoice.total_amount).toFixed(2)}</p>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">Line Items</h2>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setAddingLineItem(!addingLineItem)}
            >
              {addingLineItem ? 'Cancel' : 'Add Line Item'}
            </Button>
          </div>

          {addingLineItem && (
            <div className="mb-6 p-4 bg-gray-50 rounded-lg">
              <h3 className="text-lg font-medium mb-3">Add New Line Item</h3>
              <form onSubmit={handleAddLineItem} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormInput
                    label="Item Name"
                    id="item_name"
                    name="item_name"
                    value={newLineItem.item_name}
                    onChange={handleLineItemChange}
                    placeholder="Enter item name"
                    required
                  />

                  <FormInput
                    label="Quantity"
                    id="qty"
                    name="qty"
                    type="number"
                    min="1"
                    step="1"
                    value={newLineItem.qty}
                    onChange={handleLineItemChange}
                    placeholder="Enter quantity"
                    required
                  />

                  <FormInput
                    label="Rate"
                    id="rate"
                    name="rate"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={newLineItem.rate}
                    onChange={handleLineItemChange}
                    placeholder="Enter rate"
                    required
                  />
                </div>

                <div className="flex justify-end">
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={submittingLineItem}
                  >
                    {submittingLineItem ? (
                      <>
                        <LoadingSpinner size="sm" className="mr-2" />
                        Adding...
                      </>
                    ) : 'Add Line Item'}
                  </Button>
                </div>
              </form>
            </div>
          )}

          {lineItems.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">No line items found for this invoice.</p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => setAddingLineItem(true)}
              >
                Add Line Item
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      #
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Item Name
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Quantity
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Rate
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {lineItems.map((item, index) => (
                    <tr key={item.id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{index + 1}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{item.item_name}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-500">{item.quantity}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-500">₹{parseFloat(item.rate).toFixed(2)}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-500">₹{parseFloat(item.amount).toFixed(2)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {summary && (
        <Card title="Invoice Summary">
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <p className="text-sm font-medium text-gray-500">Total Items</p>
                <p className="mt-1 text-lg">{summary.total_items}</p>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-500">Amount (Before Tax)</p>
                <p className="mt-1 text-lg">₹{parseFloat(summary.amount_without_tax).toFixed(2)}</p>
              </div>

              {invoice.is_igst_applicable ? (
                <div>
                  <p className="text-sm font-medium text-gray-500">IGST Amount</p>
                  <p className="mt-1 text-lg">₹{parseFloat(summary.total_igst_tax || 0).toFixed(2)}</p>
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-sm font-medium text-gray-500">CGST Amount</p>
                    <p className="mt-1 text-lg">₹{parseFloat(summary.total_cgst_tax || 0).toFixed(2)}</p>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-gray-500">SGST Amount</p>
                    <p className="mt-1 text-lg">₹{parseFloat(summary.total_sgst_tax || 0).toFixed(2)}</p>
                  </div>
                </>
              )}

              <div className="md:col-span-3">
                <p className="text-sm font-medium text-gray-500">Total Amount</p>
                <p className="mt-1 text-xl font-bold">₹{parseFloat(summary.total_amount).toFixed(2)}</p>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

export default InvoiceDetail;
