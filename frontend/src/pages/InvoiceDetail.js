import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import Button from '../components/Button';
import FormInput from '../components/FormInput';
import LoadingSpinner from '../components/LoadingSpinner';
import axios from 'axios';
import { formatIndianCurrency } from '../utils/formatters';
import businessService from '../api/businessService';
import customerService from '../api/customerService';
import invoiceService from '../api/invoiceService';

// Helper function to format dates consistently
const formatDate = (dateString) => {
  if (!dateString) return '--';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString; // Return original if invalid date
  return date.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
};

function InvoiceDetail() {
  const { invoiceId } = useParams();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState(null);
  const [lineItems, setLineItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [customerDetails, setCustomerDetails] = useState({});
  const [businessDetails, setBusinessDetails] = useState({});
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
        const invoiceData = await invoiceService.getInvoice(invoiceId);
        setInvoice(invoiceData);

        // Fetch line items (they should be included in the invoice response)
        setLineItems(invoiceData.line_items || []);

        // Fetch invoice summary
        const summaryData = await invoiceService.getInvoiceSummary(invoiceId);
        setSummary(summaryData);

        // Fetch customer details
        if (invoiceData.customer) {
          try {
            const customerData = await customerService.getCustomer(invoiceData.customer);
            setCustomerDetails(customerData);
            console.log('Customer details:', customerData);
          } catch (customerErr) {
            console.error('Error fetching customer details:', customerErr);
          }
        }

        // Fetch business details
        if (invoiceData.business) {
          try {
            const businessData = await businessService.getBusiness(invoiceData.business);
            setBusinessDetails(businessData);
            console.log('Business details:', businessData);
          } catch (businessErr) {
            console.error('Error fetching business details:', businessErr);
          }
        }

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
        <div>
          <h1 className="text-3xl font-bold text-blue-600">
            {invoice.type_of_invoice === 'outward' ? 'Outward' : 'Inward'} Invoice #{invoice.invoice_number}
          </h1>
          <p className="text-gray-600 mt-1">Created on {formatDate(invoice.invoice_date)}</p>
        </div>
        <div className="space-x-2">
          <Button variant="primary" onClick={handlePrintInvoice}>
            <span className="flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              View Bill
            </span>
          </Button>
          <Link to="/billing/invoice/new">
            <Button variant="primary">
              <span className="flex items-center">
                Add Invoice
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Business Information */}
        <Card>
          <div className="p-6">
            <h2 className="text-xl font-bold mb-4 uppercase">{invoice.business_name}</h2>
            <div className="space-y-2">
              <div className="flex">
                <p className="text-sm font-medium text-gray-500 w-24">GSTIN:</p>
                <p className="text-sm">{businessDetails?.gst_number || '08AAGPL3375F1ZO'}</p>
              </div>
              <div className="flex">
                <p className="text-sm font-medium text-gray-500 w-24">PAN:</p>
                <p className="text-sm">{businessDetails?.pan_number || 'AAGPL3375F'}</p>
              </div>
              <div className="flex">
                <p className="text-sm font-medium text-gray-500 w-24">Mobile:</p>
                <p className="text-sm">{businessDetails?.mobile_number || '9414808909'}</p>
              </div>
              <div className="flex">
                <p className="text-sm font-medium text-gray-500 w-24">Address:</p>
                <p className="text-sm">{businessDetails?.address || 'MOTI CHOHATTA, CLOCK TOWER, UDAIPUR'}</p>
              </div>
              <div className="flex">
                <p className="text-sm font-medium text-gray-500 w-24">State:</p>
                <p className="text-sm">{businessDetails?.state_name || 'RAJASTHAN'}</p>
              </div>
              <div className="flex">
                <p className="text-sm font-medium text-gray-500 w-24">State Code:</p>
                <p className="text-sm">{businessDetails?.state_code || '8'}</p>
              </div>
            </div>
          </div>
        </Card>

        {/* Customer Information */}
        <Card>
          <div className="p-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-gray-500">Customer Name</p>
                <p className="text-lg font-medium">{invoice.customer_name}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">Invoice Number</p>
                <p className="text-lg">{invoice.invoice_number}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">Address</p>
                <p className="text-sm">{customerDetails?.address || '--'}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">Invoice Date</p>
                <p className="text-sm">{formatDate(invoice?.invoice_date)}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">State</p>
                <p className="text-sm">{customerDetails?.state_name || 'RAJASTHAN'} {customerDetails?.state_code ? `(Code: ${customerDetails.state_code})` : '(Code: 8)'}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">Mobile Number</p>
                <p className="text-sm">{customerDetails?.mobile_number || '--'}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">GSTIN</p>
                <p className="text-sm">{customerDetails?.gst_number || '--'}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">PAN Number</p>
                <p className="text-sm">{customerDetails?.pan_number || '--'}</p>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">Line Items</h2>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setAddingLineItem(!addingLineItem)}
            >
              <span className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                {addingLineItem ? 'Cancel' : 'Add Item'}
              </span>
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
                      Product
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      HSN
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      GST %
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
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {lineItems.map((item, index) => (
                    <tr key={item.id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{index + 1}.</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{item.item_name || item.product_name}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-500">{item.hsn_code || '711319'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <div className="text-sm text-gray-500">{item.gst_tax_rate ? (item.gst_tax_rate * 100).toFixed(0) : '3'}%</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="text-sm text-gray-500">{item.quantity} gm</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="text-sm text-gray-500">{formatIndianCurrency(item.rate)}/g</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="text-sm text-gray-500">{formatIndianCurrency(item.amount)}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <button className="text-red-600 hover:text-red-900">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="p-6">
          <h2 className="text-xl font-semibold mb-4">Invoice Summary</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-sm font-medium text-gray-500">Total Items</p>
                <p className="mt-1 text-lg font-bold">{summary?.total_items || 1}</p>
              </div>
            </div>

            <div>
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-sm font-medium text-gray-500">Amount (Before Tax)</p>
                <p className="mt-1 text-lg font-bold">{formatIndianCurrency(summary?.amount_without_tax || 0)}</p>
              </div>
            </div>

            <div>
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-sm font-medium text-gray-500">Tax Details</p>
                {invoice.is_igst_applicable ? (
                  <p className="mt-1 text-lg font-bold">IGST: {formatIndianCurrency(summary?.total_igst_tax || 0)}</p>
                ) : (
                  <div>
                    <p className="mt-1">CGST: {formatIndianCurrency(summary?.total_cgst_tax || 0)}</p>
                    <p>SGST: {formatIndianCurrency(summary?.total_sgst_tax || 0)}</p>
                    <p className="font-bold">Total Tax: {formatIndianCurrency((summary?.total_cgst_tax || 0) + (summary?.total_sgst_tax || 0))}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <div className="w-64 border border-gray-300 rounded-lg overflow-hidden">
              <div className="flex justify-between py-3 px-4 bg-gray-50 border-b">
                <span className="font-medium">Total Amount:</span>
                <span className="font-bold text-lg">{formatIndianCurrency(summary?.total_amount || invoice.total_amount || 0)}</span>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default InvoiceDetail;
