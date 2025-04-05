import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import LoadingSpinner from '../components/LoadingSpinner';
import apiClient, { createCancelToken } from '../api/client';
import axios from 'axios';
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

        console.log('Print data:', response.data); // Debug log
        setPrintData(response.data);

        // Fetch business details
        if (response.data && response.data.invoice && response.data.invoice.business) {
          try {
            const businessResponse = await businessService.getBusiness(response.data.invoice.business);
            console.log('Business data:', businessResponse);
            setBusinessData(businessResponse);
          } catch (businessErr) {
            console.error('Error fetching business details:', businessErr);
          }
        }

        // Fetch customer details
        if (response.data && response.data.invoice && response.data.invoice.customer) {
          try {
            const customerResponse = await customerService.getCustomer(response.data.invoice.customer);
            console.log('Customer data:', customerResponse);
            setCustomerData(customerResponse);
          } catch (customerErr) {
            console.error('Error fetching customer details:', customerErr);
          }
        }

        setError(null);

        // Auto-print after data is loaded
        setTimeout(() => {
          window.print();
        }, 1000); // Increased timeout to ensure data is rendered
      } catch (err) {
        if (!axios.isCancel(err)) {
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

  // Add additional debug information in development
  if (process.env.NODE_ENV !== 'production') {
    console.log('Invoice data:', printData);
    console.log('Invoice:', invoice);
    console.log('Line items:', line_items);
    console.log('Tax information:', { total_cgst_tax, total_sgst_tax, total_igst_tax });
  }

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
      <div id="panel" className="max-w-5xl mx-auto bg-white rounded-lg shadow-sm p-8 print:p-6 min-h-[29.7cm] flex flex-col">
        {/* Header: Business & Invoice Details */}
        <div className="invoice-header flex justify-between items-start mb-6 border-b pb-4">
          <div>
            <h1 className="text-2xl font-bold text-blue-600">
              {business.name || invoice.business_name || ''}
            </h1>
            <div className="text-sm text-gray-600 mt-2 space-y-1">
              <p>{business.address || invoice.business_address || ''}</p>
              {(business.state_name || business.state_code) && (
                <p>{business.state_name || ''}{business.state_code ? `, ${business.state_code}` : ''}</p>
              )}
              {(business.gst_number || invoice.business_gst_number) && (
                <p>GSTIN: {business.gst_number || invoice.business_gst_number || ''}</p>
              )}
              {(business.pan_number || invoice.business_pan_number) && (
                <p>PAN: {business.pan_number || invoice.business_pan_number || ''}</p>
              )}
            </div>
          </div>

          <div className="text-right">
            <h2 className="text-2xl font-bold text-gray-800">TAX INVOICE</h2>
            <div className="mt-2 text-sm text-gray-600 space-y-1">
              <p>Invoice #: {invoice.invoice_number}</p>
              <p>Date: {formatDate(invoice.invoice_date)}</p>
            </div>
          </div>
        </div>

        {/* Bill To and Ship To Sections */}
        <div className="flex justify-between mb-6">
          <div className="w-1/2 pr-4">
            <h3 className="text-sm font-bold mb-2 border-b pb-1">BILL TO</h3>
            <div className="pl-4">
              <p className="font-bold text-base">{invoice.customer_name || customer.name || ''}</p>
              {(invoice.customer_address || customer.address) && (
                <p>{invoice.customer_address || customer.address}</p>
              )}
              {(invoice.customer_state || customer.state_name) && (
                <p>
                  {invoice.customer_state || customer.state_name}
                </p>
              )}
              <div className="mt-1">
                {(invoice.customer_gst_number || customer.gst_number) && (
                  <p>GSTIN: {invoice.customer_gst_number || customer.gst_number}</p>
                )}
                {(invoice.customer_pan_number || customer.pan_number) && (
                  <p>PAN: {invoice.customer_pan_number || customer.pan_number}</p>
                )}
                {(invoice.customer_mobile_number || customer.mobile_number) && (
                  <p>Mobile: {invoice.customer_mobile_number || customer.mobile_number}</p>
                )}
              </div>
            </div>
          </div>

          <div className="w-1/2 pl-4">
            <h3 className="text-sm font-bold mb-2 border-b pb-1">PAYMENT DETAILS</h3>
            <div className="pl-4">
              <p><span className="font-medium">Payment Terms:</span> Due on Receipt</p>
              <p><span className="font-medium">Invoice Type:</span> {invoice.type_of_invoice ? invoice.type_of_invoice.charAt(0).toUpperCase() + invoice.type_of_invoice.slice(1) : 'Outward'}</p>
            </div>
          </div>
        </div>

      {/* Line Items */}
      <table className="invoice-table min-w-full border border-gray-300 mb-4">
        <thead>
          <tr className="bg-gray-100">
            <th className="py-1 px-2 border-b border-r text-left">#</th>
            <th className="py-1 px-2 border-b border-r text-left">Item</th>
            <th className="py-1 px-2 border-b border-r text-center">HSN</th>
            <th className="py-1 px-2 border-b border-r text-center">GST %</th>
            <th className="py-1 px-2 border-b border-r text-right">Qty</th>
            <th className="py-1 px-2 border-b border-r text-right">Rate</th>
            <th className="py-1 px-2 border-b text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {line_items && line_items.map((item, index) => (
            <tr key={item.id || index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              <td className="py-1 px-2 border-b border-r">{index + 1}</td>
              <td className="py-1 px-2 border-b border-r font-medium">{item.item_name || item.product_name || ''}</td>
              <td className="py-1 px-2 border-b border-r text-center">{item.hsn_code || ''}</td>
              <td className="py-1 px-2 border-b border-r text-center">{item.gst_tax_rate ? `${(item.gst_tax_rate * 100).toFixed(0)}%` : ''}</td>
              <td className="py-1 px-2 border-b border-r text-right">{item.quantity} gm</td>
              <td className="py-1 px-2 border-b border-r text-right">₹{item.rate || 0}/g</td>
              <td className="py-1 px-2 border-b text-right font-medium">{formatIndianCurrency(item.amount || 0)}</td>
            </tr>
          ))}
          {/* Add empty rows if there are fewer than 2 items */}
          {line_items && line_items.length < 2 && Array(2 - line_items.length).fill().map((_, index) => (
            <tr key={`empty-${index}`} className={(line_items.length + index) % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              <td className="py-1 px-2 border-b border-r">&nbsp;</td>
              <td className="py-1 px-2 border-b border-r">&nbsp;</td>
              <td className="py-1 px-2 border-b border-r">&nbsp;</td>
              <td className="py-1 px-2 border-b border-r">&nbsp;</td>
              <td className="py-1 px-2 border-b border-r">&nbsp;</td>
              <td className="py-1 px-2 border-b border-r">&nbsp;</td>
              <td className="py-1 px-2 border-b">&nbsp;</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Summary and Amount in Words */}
      <div className="flex justify-between mb-4">
        <div className="w-1/2 pr-4">
          <div className="border-b pb-2">
            <p className="text-sm font-medium">Amount in Words:</p>
            <p className="text-sm pl-4">
              {amount_in_words || `${formatIndianCurrency(total_amount).replace('₹', '')} Rupees Only`}
            </p>
            <p className="text-sm mt-2"><strong>Total Items:</strong> {total_items || 1}</p>
          </div>
        </div>
        <div className="w-1/2 pl-4">
          <table className="w-full text-sm">
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

      {/* Bank Details and Signatures */}
      <div className="mt-auto">
        <div className="grid grid-cols-3 gap-4 mb-4 mt-4">
          <div className="col-span-1">
            <h3 className="text-sm font-bold mb-2">BANK DETAILS</h3>
            <table className="w-full text-sm">
              <tbody>
                {business.bank_name && (
                  <tr>
                    <td className="py-0.5 font-medium">Bank Name:</td>
                    <td className="py-0.5">{business.bank_name}</td>
                  </tr>
                )}
                {business.bank_account_number && (
                  <tr>
                    <td className="py-0.5 font-medium">A/c No:</td>
                    <td className="py-0.5">{business.bank_account_number}</td>
                  </tr>
                )}
                {business.bank_ifsc_code && (
                  <tr>
                    <td className="py-0.5 font-medium">IFSC Code:</td>
                    <td className="py-0.5">{business.bank_ifsc_code}</td>
                  </tr>
                )}
                {business.bank_branch_name && (
                  <tr>
                    <td className="py-0.5 font-medium">Branch:</td>
                    <td className="py-0.5">{business.bank_branch_name}</td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="text-center font-bold text-sm mt-2">SUBJECT TO UDAIPUR JURISDICTION</p>
          </div>

          <div className="col-span-1 text-center flex flex-col justify-end">
            <div className="mt-8 pt-4 border-t border-gray-300 mx-4">
              <p className="font-medium">Customer Signature</p>
              <p className="text-xs text-gray-500">Received the above goods in good condition</p>
            </div>
          </div>

          <div className="col-span-1 text-center flex flex-col justify-end">
            <div className="mt-8 pt-4 border-t border-gray-300 mx-4">
              <p className="font-medium">Authorized Signature</p>
              <p className="text-xs text-gray-500">For {business.name || invoice.business_name || ''}</p>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

export default InvoicePrint;
