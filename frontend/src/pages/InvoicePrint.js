import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import LoadingSpinner from '../components/LoadingSpinner';
import apiClient, { createCancelToken } from '../api/client';
import { formatIndianCurrency } from '../utils/formatters';
import businessService from '../api/businessService';
import customerService from '../api/customerService';
import './InvoicePrint.css';

// Helper function to format dates consistently
const formatDate = (dateString) => {
  if (!dateString) return '--';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString; // Return original if invalid date
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

function InvoicePrint() {
  const { invoiceId } = useParams();
  const navigate = useNavigate();
  const [printData, setPrintData] = useState(null);
  const [businessData, setBusinessData] = useState(null);
  const [customerData, setCustomerData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch invoice print data
  useEffect(() => {
    const cancelTokenSource = createCancelToken();

    const fetchPrintData = async () => {
      try {
        setLoading(true);
        const response = await apiClient.get(`/invoices/${invoiceId}/print/`, {
          cancelToken: cancelTokenSource.token
        });

        setPrintData(response.data);

        // Fetch business details
        if (response.data && response.data.invoice && response.data.invoice.business) {
          try {
            const businessResponse = await businessService.getBusiness(response.data.invoice.business);
            setBusinessData(businessResponse);
          } catch (businessErr) {
            // Handle error silently
          }
        }

        // Fetch customer details
        if (response.data && response.data.invoice && response.data.invoice.customer) {
          try {
            const customerResponse = await customerService.getCustomer(response.data.invoice.customer);
            setCustomerData(customerResponse);
          } catch (customerErr) {
            // Handle error silently
          }
        }

        setError(null);

        // Auto-print after data is loaded
        setTimeout(() => {
          window.print();
        }, 1000); // Increased timeout to ensure data is rendered
      } catch (err) {
        if (!(err.constructor && err.constructor.name === 'CanceledError')) {
          console.error('Error fetching invoice print data:', err);
          setError('Failed to load invoice data. Please try again.');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchPrintData();

    // Cleanup function
    return () => cancelTokenSource.cancel('Component unmounted');
  }, [invoiceId]);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 text-red-500">
        <p>{error}</p>
        <button
          className="mt-4 px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
          onClick={() => navigate(`/billing/invoice/${invoiceId}`)}
        >
          Back to Invoice
        </button>
      </div>
    );
  }

  if (!printData) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">Invoice data not found.</p>
        <button
          className="mt-4 px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
          onClick={() => navigate('/billing/invoice/list')}
        >
          Back to Invoices
        </button>
      </div>
    );
  }

  // Destructure with proper field names and fallbacks
  const invoiceData = printData || {};
  const invoice = invoiceData.invoice || {};
  const line_items = invoiceData.line_items || [];
  const total_items = invoiceData.total_items || 0;
  const amount_without_tax = invoiceData.amount_without_tax || 0;
  const total_cgst_tax = invoiceData.total_cgst_tax || 0;
  const total_sgst_tax = invoiceData.total_sgst_tax || 0;
  const total_igst_tax = invoiceData.total_igst_tax || 0;
  const total_tax = invoiceData.total_tax || 0;
  const total_amount = invoiceData.total_amount || 0;
  const round_off = invoiceData.round_off || '0.00';

  // Get business and customer details
  const business = businessData || {};
  const customer = customerData || {};

  // Convert amount to words (since it's not in the API response)
  const amount_in_words = invoiceData.amount_in_words || convertAmountToWords(total_amount);

  // Helper function to convert amount to words (simplified version)
  function convertAmountToWords(amount) {
    // This is a simplified implementation
    // For a production app, you'd want a more robust solution
    const formatter = new Intl.NumberFormat('en-IN', {
      maximumFractionDigits: 0
    });

    const formattedAmount = formatter.format(Math.floor(amount));
    return `${formattedAmount} Rupees Only`;
  }

  // No debug logging in production

  if (!invoice || Object.keys(invoice).length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">Invoice details are incomplete.</p>
        <button
          className="mt-4 px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
          onClick={() => navigate('/billing/invoice/list')}
        >
          Back to Invoices
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Print controls - hidden when printing */}
      <div className="flex items-center gap-3 p-4 print:hidden">
        <button
          className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          onClick={() => navigate(`/billing/invoice/${invoiceId}`)}
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"/>
          </svg>
          Back to Invoice {invoice.invoice_number}
        </button>

        <button
          onClick={() => window.print()}
          className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-orange-500 rounded-md hover:bg-orange-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/>
          </svg>
          Print Invoice
        </button>
      </div>

      {/* Invoice content - visible when printing */}
      <div id="panel" className="max-w-5xl mx-auto bg-white rounded-lg shadow-lg p-6 print:p-4 flex flex-col invoice-container">
        {/* Top border */}
        <div className="w-full h-1 bg-indigo-600 mb-4"></div>

        {/* Header: Business & Invoice Details */}
        <div className="flex justify-between mb-6">
          {/* Business Info */}
          <div className="w-1/2">
            <h1 className="text-xl font-bold text-indigo-600 uppercase">
              {business.name || invoice.business_name || ''}
            </h1>
            <div className="text-xs text-gray-600 mt-1">
              <p>{business.address || invoice.business_address || ''}</p>
              <p>{business.state_name || ''}</p>
              <p>GSTIN: {business.gst_number || invoice.business_gst_number || ''}</p>
              <p>PAN: {business.pan_number || invoice.business_pan_number || ''}</p>
            </div>
          </div>

          {/* Invoice Details */}
          <div className="w-1/3 bg-gray-50 p-3 rounded">
            <h2 className="text-lg font-bold text-center text-gray-800 mb-1">TAX INVOICE</h2>
            <p className="text-center text-sm font-medium">#{invoice.invoice_number}</p>
            <div className="text-xs mt-2">
              <p><span className="font-medium">Date:</span> {formatDate(invoice.invoice_date)}</p>
              <p><span className="font-medium">Type:</span> {invoice.type_of_invoice ? invoice.type_of_invoice.charAt(0).toUpperCase() + invoice.type_of_invoice.slice(1) : 'Outward'}</p>
            </div>
          </div>
        </div>

        {/* Bill To Section */}
        <div className="mb-4">
          <h3 className="text-xs font-bold uppercase border-b pb-1 mb-2">BILL TO</h3>
          <div className="pl-2">
            <p className="font-bold">{invoice.customer_name || customer.name || ''}</p>
            {(invoice.customer_address || customer.address) && (
              <p className="text-xs">{invoice.customer_address || customer.address}</p>
            )}
            {(invoice.customer_state || customer.state_name) && (
              <p className="text-xs">{invoice.customer_state || customer.state_name}</p>
            )}
            <div className="text-xs mt-1">
              {(invoice.customer_gst_number || customer.gst_number) && (
                <p><span className="font-medium">GSTIN:</span> {invoice.customer_gst_number || customer.gst_number}</p>
              )}
              {(invoice.customer_mobile_number || customer.mobile_number) && (
                <p><span className="font-medium">Mobile:</span> {invoice.customer_mobile_number || customer.mobile_number}</p>
              )}
            </div>
          </div>
        </div>

        {/* Line Items */}
        <div className="mb-4 overflow-hidden border border-gray-200 rounded">
          <table className="invoice-table w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="py-1 px-2 text-left border-b">#</th>
                <th className="py-1 px-2 text-left border-b">ITEM</th>
                <th className="py-1 px-2 text-center border-b">HSN</th>
                <th className="py-1 px-2 text-center border-b">GST %</th>
                <th className="py-1 px-2 text-right border-b">QTY (GM)</th>
                <th className="py-1 px-2 text-right border-b">RATE</th>
                <th className="py-1 px-2 text-right border-b">AMOUNT</th>
              </tr>
            </thead>
            <tbody>
              {line_items && line_items.map((item, index) => (
                <tr key={item.id || index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="py-1 px-2 border-b">{index + 1}</td>
                  <td className="py-1 px-2 border-b font-medium">{item.item_name || item.product_name || ''}</td>
                  <td className="py-1 px-2 border-b text-center">{item.hsn_code || ''}</td>
                  <td className="py-1 px-2 border-b text-center">{item.gst_tax_rate ? `${(item.gst_tax_rate * 100).toFixed(0)}%` : ''}</td>
                  <td className="py-1 px-2 border-b text-right">{item.quantity}</td>
                  <td className="py-1 px-2 border-b text-right">₹{item.rate || 0}/g</td>
                  <td className="py-1 px-2 border-b text-right font-medium">{formatIndianCurrency(item.amount || 0)}</td>
                </tr>
              ))}
              {/* Add empty rows if there are fewer than 2 items */}
              {line_items && line_items.length < 2 && Array(2 - line_items.length).fill().map((_, index) => (
                <tr key={`empty-${index}`} className={(line_items.length + index) % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="py-1 px-2 border-b">&nbsp;</td>
                  <td className="py-1 px-2 border-b">&nbsp;</td>
                  <td className="py-1 px-2 border-b">&nbsp;</td>
                  <td className="py-1 px-2 border-b">&nbsp;</td>
                  <td className="py-1 px-2 border-b">&nbsp;</td>
                  <td className="py-1 px-2 border-b">&nbsp;</td>
                  <td className="py-1 px-2 border-b">&nbsp;</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Amount in Words and Invoice Summary */}
        <div className="flex mb-4">
          <div className="w-1/2 pr-2">
            <h3 className="text-xs font-bold uppercase border-b pb-1 mb-2">AMOUNT IN WORDS</h3>
            <p className="text-xs pl-2">
              {amount_in_words || `${formatIndianCurrency(total_amount).replace('₹', '')} Rupees Only`}
            </p>
            <p className="text-xs mt-2 pl-2"><span className="font-medium">Total Items:</span> {total_items || line_items.length || 1}</p>
          </div>

          <div className="w-1/2 pl-2">
            <h3 className="text-xs font-bold uppercase border-b pb-1 mb-2">INVOICE SUMMARY</h3>
            <table className="w-full text-xs">
              <tbody>
                <tr>
                  <td className="py-0.5">Amount Without Tax:</td>
                  <td className="py-0.5 text-right">{formatIndianCurrency(amount_without_tax)}</td>
                </tr>

                {invoice.is_igst_applicable ? (
                  <tr>
                    <td className="py-0.5">IGST:</td>
                    <td className="py-0.5 text-right">{formatIndianCurrency(total_igst_tax || 0)}</td>
                  </tr>
                ) : (
                  <>
                    <tr>
                      <td className="py-0.5">CGST:</td>
                      <td className="py-0.5 text-right">{formatIndianCurrency(total_cgst_tax || 0)}</td>
                    </tr>
                    <tr>
                      <td className="py-0.5">SGST:</td>
                      <td className="py-0.5 text-right">{formatIndianCurrency(total_sgst_tax || 0)}</td>
                    </tr>
                  </>
                )}

                <tr>
                  <td className="py-0.5">Total Tax:</td>
                  <td className="py-0.5 text-right">{formatIndianCurrency(total_tax)}</td>
                </tr>

                <tr>
                  <td className="py-0.5">Round Off:</td>
                  <td className="py-0.5 text-right">{round_off}</td>
                </tr>

                <tr className="border-t">
                  <td className="py-1 font-bold">Total Amount:</td>
                  <td className="py-1 text-right font-bold">{formatIndianCurrency(total_amount)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Bank Details */}
        <div className="mb-4">
          <h3 className="text-xs font-bold uppercase border-b pb-1 mb-2">BANK DETAILS</h3>
          <div className="flex">
            <table className="w-full text-xs">
              <tbody>
                <tr>
                  <td className="py-0.5 font-medium w-1/4">Bank Name:</td>
                  <td className="py-0.5">{business.bank_name || ''}</td>
                </tr>
                <tr>
                  <td className="py-0.5 font-medium">A/c No:</td>
                  <td className="py-0.5">{business.bank_account_number || ''}</td>
                </tr>
                <tr>
                  <td className="py-0.5 font-medium">IFSC Code:</td>
                  <td className="py-0.5">{business.bank_ifsc_code || ''}</td>
                </tr>
                <tr>
                  <td className="py-0.5 font-medium">Branch:</td>
                  <td className="py-0.5">{business.bank_branch_name || ''}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-center text-xs font-bold mt-2">SUBJECT TO UDAIPUR JURISDICTION</p>
        </div>

        {/* Signatures */}
        <div className="flex justify-between mt-auto">
          <div className="w-1/3 text-center">
            <div className="mt-8 pt-2 border-t">
              <p className="text-xs font-medium">Customer Signature</p>
              <p className="text-xs text-gray-500">Received the above goods in good condition</p>
            </div>
          </div>

          <div className="w-1/3 text-center">
            <div className="mt-8 pt-2 border-t">
              <p className="text-xs font-medium">Authorized Signature</p>
              <p className="text-xs text-gray-500">For {business.name || invoice.business_name || ''}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default InvoicePrint;
