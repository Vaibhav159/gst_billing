import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import Button from '../components/Button';
import FormInput from '../components/FormInput';
import SearchableDropdown from '../components/SearchableDropdown';
import LoadingSpinner from '../components/LoadingSpinner';

import lineItemService from '../api/lineItemService';
import { formatIndianCurrency, formatDate } from '../utils/formatters';
import businessService from '../api/businessService';
import customerService from '../api/customerService';
import invoiceService from '../api/invoiceService';
import productService from '../api/productService';

// Using the formatDate function imported from utils/formatters.js

function InvoiceDetail() {
  const { invoiceId } = useParams();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState(null);
  const [lineItems, setLineItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loadingStates, setLoadingStates] = useState({
    invoice: true,
    lineItems: true,
    summary: true,
    customer: true,
    business: true
  });
  const [error, setError] = useState(null);
  const [customerDetails, setCustomerDetails] = useState({});
  const [businessDetails, setBusinessDetails] = useState({});
  const [newLineItem, setNewLineItem] = useState({
    product_name: '',
    qty: '',
    rate: '',
    hsn_code: '',
    gst_tax_rate: ''
  });
  const [defaultValues, setDefaultValues] = useState({
    hsn_code: '',
    gst_tax_rate: 0
  });
  const [addingLineItem, setAddingLineItem] = useState(false);
  const [submittingLineItem, setSubmittingLineItem] = useState(false);
  const [deletingLineItem, setDeletingLineItem] = useState(false);

  // Helper function to update a specific loading state
  const updateLoadingState = (key, value) => {
    setLoadingStates(prev => ({
      ...prev,
      [key]: value
    }));
  };

  // Fetch default values when component mounts
  useEffect(() => {
    const fetchDefaultValues = async () => {
      try {
        const defaults = await productService.getDefaults();
        setDefaultValues(defaults);
      } catch (err) {
        console.error('Error fetching default values:', err);
      }
    };

    fetchDefaultValues();
  }, []);

  // Fetch invoice details
  useEffect(() => {
    // Fetch invoice data
    const fetchInvoice = async () => {
      try {
        updateLoadingState('invoice', true);
        const invoiceData = await invoiceService.getInvoice(invoiceId);
        setInvoice(invoiceData);

        // Line items are included in the invoice response
        setLineItems(invoiceData.line_items || []);
        updateLoadingState('lineItems', false);

        // Trigger customer and business data fetching once we have the invoice
        if (invoiceData.customer) {
          fetchCustomerDetails(invoiceData.customer);
        } else {
          updateLoadingState('customer', false);
        }

        if (invoiceData.business) {
          fetchBusinessDetails(invoiceData.business);
        } else {
          updateLoadingState('business', false);
        }

        setError(null);
      } catch (err) {
        console.error('Error fetching invoice:', err);
        setError('Failed to load invoice. Please try again.');
      } finally {
        updateLoadingState('invoice', false);
      }
    };

    // Fetch invoice summary
    const fetchSummary = async () => {
      try {
        updateLoadingState('summary', true);
        const summaryData = await invoiceService.getInvoiceSummary(invoiceId);
        setSummary(summaryData);
      } catch (err) {
        console.error('Error fetching invoice summary:', err);
        // Don't set global error for summary - just log it
      } finally {
        updateLoadingState('summary', false);
      }
    };

    // Fetch customer details
    const fetchCustomerDetails = async (customerId) => {
      try {
        updateLoadingState('customer', true);
        const customerData = await customerService.getCustomer(customerId);
        setCustomerDetails(customerData);
      } catch (err) {
        console.error('Error fetching customer details:', err);
        // Don't set global error for customer details - just log it
      } finally {
        updateLoadingState('customer', false);
      }
    };

    // Fetch business details
    const fetchBusinessDetails = async (businessId) => {
      try {
        updateLoadingState('business', true);
        const businessData = await businessService.getBusiness(businessId);
        setBusinessDetails(businessData);
      } catch (err) {
        console.error('Error fetching business details:', err);
        // Don't set global error for business details - just log it
      } finally {
        updateLoadingState('business', false);
      }
    };

    // Start fetching data in parallel
    fetchInvoice();
    fetchSummary();
  }, [invoiceId]);



  // Handle line item input changes
  const handleLineItemChange = (e) => {
    const { name, value } = e.target;
    setNewLineItem(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // Handle product selection
  const handleProductSelect = (product) => {
    setNewLineItem(prev => ({
      ...prev,
      product_name: product.name,
      hsn_code: product.hsn_code,
      gst_tax_rate: product.gst_tax_rate
    }));
  };

  // Handle line item deletion
  const handleDeleteLineItem = async (lineItemId) => {
    if (!window.confirm('Are you sure you want to delete this line item?')) {
      return;
    }

    try {
      setDeletingLineItem(true);
      await lineItemService.deleteLineItem(lineItemId);

      // Remove the line item from the list
      setLineItems(prev => prev.filter(item => item.id !== lineItemId));

      // Refresh the invoice summary
      updateLoadingState('summary', true);
      try {
        const summaryData = await invoiceService.getInvoiceSummary(invoiceId);
        setSummary(summaryData);
      } catch (err) {
        console.error('Error refreshing summary:', err);
      } finally {
        updateLoadingState('summary', false);
      }

      // Refresh the invoice to get the updated total_amount
      updateLoadingState('invoice', true);
      try {
        const invoiceData = await invoiceService.getInvoice(invoiceId);
        setInvoice(invoiceData);
      } catch (err) {
        console.error('Error refreshing invoice:', err);
      } finally {
        updateLoadingState('invoice', false);
      }

    } catch (err) {
      console.error('Error deleting line item:', err);
      alert('Failed to delete line item. Please try again.');
    } finally {
      setDeletingLineItem(false);
    }
  };

  // Handle line item submission
  const handleAddLineItem = async (e) => {
    e.preventDefault();

    // Basic validation
    if (!newLineItem.product_name || !newLineItem.qty || !newLineItem.rate) {
      alert('Please fill in all fields');
      return;
    }

    try {
      setSubmittingLineItem(true);

      const lineItemData = {
        invoice: invoiceId,
        product_name: newLineItem.product_name,
        quantity: newLineItem.qty,
        rate: newLineItem.rate,
        hsn_code: newLineItem.hsn_code || defaultValues.hsn_code, // Use default HSN code if not provided
        gst_tax_rate: newLineItem.gst_tax_rate || defaultValues.gst_tax_rate // Use default GST rate if not provided
      };

      const response = await lineItemService.createLineItem(invoiceId, lineItemData);

      // Add the new line item to the list
      // Make sure the response data has all required fields
      const newItem = response.data || {};
      // Ensure product_name exists
      if (!newItem.product_name) {
        newItem.product_name = newLineItem.product_name;
      }
      setLineItems(prev => [...prev, newItem]);

      // Reset the form
      setNewLineItem({
        product_name: '',
        qty: '',
        rate: '',
        hsn_code: '',
        gst_tax_rate: ''
      });

      // Refresh the invoice summary
      updateLoadingState('summary', true);
      try {
        const summaryData = await invoiceService.getInvoiceSummary(invoiceId);
        setSummary(summaryData);
      } catch (summaryErr) {
        console.error('Error refreshing summary:', summaryErr);
      } finally {
        updateLoadingState('summary', false);
      }

      // Refresh the invoice to get updated total
      updateLoadingState('invoice', true);
      try {
        const invoiceData = await invoiceService.getInvoice(invoiceId);
        setInvoice(invoiceData);
      } catch (invoiceErr) {
        console.error('Error refreshing invoice:', invoiceErr);
      } finally {
        updateLoadingState('invoice', false);
      }

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

  // Check if the main invoice data is still loading
  const isMainDataLoading = loadingStates.invoice;

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
          <h1 className="text-3xl font-bold text-primary-600 dark:text-primary-400">
            {invoice.type_of_invoice === 'outward' ? 'Outward' : 'Inward'} Invoice #{invoice.invoice_number}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">Created on {formatDate(invoice.invoice_date)}</p>
        </div>
        <div className="flex space-x-3">
          <Button variant="outline" onClick={handlePrintInvoice}>
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
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Invoice
              </span>
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Business Information */}
        <Card>
          {renderWithLoading(loadingStates.business, (
            <div className="p-6">
              <h2 className="text-xl font-bold mb-4 uppercase text-gray-900 dark:text-white">{invoice.business_name}</h2>
              <div className="space-y-2">
                <div className="flex">
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400 w-24">GSTIN:</p>
                  <p className="text-sm dark:text-gray-300">{businessDetails?.gst_number || '--'}</p>
                </div>
                <div className="flex">
                  <p className="text-sm font-medium text-gray-500 w-24">PAN:</p>
                  <p className="text-sm">{businessDetails?.pan_number || '--'}</p>
                </div>
                <div className="flex">
                  <p className="text-sm font-medium text-gray-500 w-24">Mobile:</p>
                  <p className="text-sm">{businessDetails?.mobile_number || '--'}</p>
                </div>
                <div className="flex">
                  <p className="text-sm font-medium text-gray-500 w-24">Address:</p>
                  <p className="text-sm">{businessDetails?.address || '--'}</p>
                </div>
                <div className="flex">
                  <p className="text-sm font-medium text-gray-500 w-24">State:</p>
                  <p className="text-sm">{businessDetails?.state_name || '--'}</p>
                </div>
                <div className="flex">
                  <p className="text-sm font-medium text-gray-500 w-24">State Code:</p>
                  <p className="text-sm">{businessDetails?.state_code || '--'}</p>
                </div>
              </div>
            </div>
          ))}
        </Card>

        {/* Customer Information */}
        <Card>
          {renderWithLoading(loadingStates.customer, (
            <div className="p-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Customer Name</p>
                  <p className="text-lg font-medium dark:text-white">{invoice.customer_name}</p>
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
                  <p className="text-sm">{customerDetails?.state_name || '--'} {customerDetails?.state_code ? `(Code: ${customerDetails.state_code})` : ''}</p>
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
          ))}
        </Card>
      </div>

      <Card>
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Line Items</h2>
            <Button
              variant={addingLineItem ? "danger" : "primary"}
              size="sm"
              onClick={() => setAddingLineItem(!addingLineItem)}
            >
              <span className="flex items-center">
                {addingLineItem ? (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Cancel
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Item
                  </>
                )}
              </span>
            </Button>
          </div>

          {addingLineItem && (
            <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-medium mb-3 text-gray-900 dark:text-white">Add New Line Item</h3>
              <form onSubmit={handleAddLineItem} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <SearchableDropdown
                    label="Product Name"
                    id="product_name"
                    name="product_name"
                    value={newLineItem.product_name}
                    onChange={handleLineItemChange}
                    onSelect={handleProductSelect}
                    placeholder="Search for a product"
                    searchFunction={productService.searchProducts}
                    required
                  />

                  <FormInput
                    label="Quantity (gm)"
                    id="qty"
                    name="qty"
                    type="number"
                    min="1"
                    step="1"
                    value={newLineItem.qty}
                    onChange={handleLineItemChange}
                    placeholder="Enter quantity in grams"
                    required
                  />

                  <FormInput
                    label="Rate (₹/g)"
                    id="rate"
                    name="rate"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={newLineItem.rate}
                    onChange={handleLineItemChange}
                    placeholder="Enter rate per gram"
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

          {renderWithLoading(loadingStates.lineItems, (
            lineItems.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500 dark:text-gray-400">No line items found for this invoice.</p>
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
                  <thead className="bg-gray-50 dark:bg-gray-800">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        #
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Product
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        HSN
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        GST %
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Quantity
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Rate
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Amount
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {lineItems.map((item, index) => (
                      <tr key={item.id}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900 dark:text-gray-100">{index + 1}.</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">{item.product_name || '--'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-500 dark:text-gray-400">{item.hsn_code || defaultValues.hsn_code || '--'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          <div className="text-sm text-gray-500 dark:text-gray-400">{item.gst_tax_rate ? (item.gst_tax_rate * 100).toFixed(0) : defaultValues.gst_tax_rate ? (defaultValues.gst_tax_rate * 100).toFixed(0) : '--'}%</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          <div className="text-sm text-gray-500 dark:text-gray-400">{item.quantity} gm</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          <div className="text-sm text-gray-500 dark:text-gray-400">{formatIndianCurrency(item.rate)}/g</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          <div className="text-sm text-gray-500 dark:text-gray-400">{formatIndianCurrency(item.amount)}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          <button
                            className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                            onClick={() => handleDeleteLineItem(item.id)}
                            disabled={deletingLineItem}
                          >
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
            )
          ))}
        </div>
      </Card>

      <Card>
        {renderWithLoading(loadingStates.summary, (
          <div className="p-6">
            <h2 className="text-xl font-semibold mb-4">Invoice Summary</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Items</p>
                  <p className="mt-1 text-lg font-bold dark:text-white">{summary?.total_items || 1}</p>
                </div>
              </div>

              <div>
                <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Amount (Before Tax)</p>
                  <p className="mt-1 text-lg font-bold dark:text-white">{formatIndianCurrency(summary?.amount_without_tax || 0)}</p>
                </div>
              </div>

              <div>
                <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Tax Details</p>
                  {invoice.is_igst_applicable ? (
                    <div>
                      <p className="mt-1 text-lg font-bold dark:text-white">IGST: {formatIndianCurrency(summary?.total_igst_tax || 0)}</p>
                      <p className="font-bold dark:text-white">Total Tax: {formatIndianCurrency(summary?.total_tax || summary?.total_igst_tax || 0)}</p>
                    </div>
                  ) : (
                    <div>
                      <p className="mt-1 dark:text-gray-300">CGST: {formatIndianCurrency(summary?.total_cgst_tax || 0)}</p>
                      <p className="dark:text-gray-300">SGST: {formatIndianCurrency(summary?.total_sgst_tax || 0)}</p>
                      <p className="font-bold dark:text-white">Total Tax: {formatIndianCurrency(summary?.total_tax || (summary?.total_cgst_tax || 0) + (summary?.total_sgst_tax || 0))}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <div className="w-64 border border-gray-300 dark:border-gray-700 rounded-lg overflow-hidden">
                <div className="flex justify-between py-3 px-4 bg-gray-50 dark:bg-gray-800 border-b dark:border-gray-700">
                  <span className="font-medium dark:text-gray-300">Total Amount:</span>
                  <span className="font-bold text-lg dark:text-white">{formatIndianCurrency(summary?.total_amount || invoice.total_amount || 0)}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

export default InvoiceDetail;
