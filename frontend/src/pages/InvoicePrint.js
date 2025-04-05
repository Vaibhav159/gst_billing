import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import LoadingSpinner from '../components/LoadingSpinner';
import apiClient, { createCancelToken } from '../api/client';
import axios from 'axios';
import { formatIndianCurrency } from '../utils/formatters';

function InvoicePrint() {
  const { invoiceId } = useParams();
  const navigate = useNavigate();
  const [printData, setPrintData] = useState(null);
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
  const total_amount = invoiceData.total_amount || 0;

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
    <div className="max-w-4xl mx-auto p-8 bg-white">
      {/* Print-only button */}
      <div className="print:hidden mb-6 flex justify-between">
        <button
          className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
          onClick={() => navigate(`/billing/invoice/${invoiceId}`)}
        >
          Back to Invoice
        </button>
        <button
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          onClick={() => window.print()}
        >
          Print
        </button>
      </div>

      {/* Invoice Header */}
      <div className="border-b-2 border-gray-300 pb-6 mb-6">
        <div className="flex justify-between">
          <div>
            <h1 className="text-2xl font-bold">{invoice.type_of_invoice === 'outward' ? 'Tax Invoice' : 'Purchase Invoice'}</h1>
            <p className="text-gray-600">Invoice #: {invoice.invoice_number}</p>
            <p className="text-gray-600">Date: {new Date(invoice.invoice_date).toLocaleDateString()}</p>
          </div>
          <div className="text-right">
            <h2 className="text-xl font-semibold">{invoice.business_name}</h2>
            <p className="text-gray-600">GSTIN: {invoice.business_gst_number}</p>
          </div>
        </div>
      </div>

      {/* Customer and Business Details */}
      <div className="grid grid-cols-2 gap-6 mb-8">
        <div>
          <h3 className="text-lg font-semibold mb-2">Bill To:</h3>
          <p className="font-medium">{invoice.customer_name}</p>
          <p className="text-gray-600">GSTIN: {invoice.customer_gst_number || 'N/A'}</p>
          <p className="text-gray-600">{invoice.customer_address || 'N/A'}</p>
          <p className="text-gray-600">{invoice.customer_phone_number || 'N/A'}</p>
        </div>
        <div>
          <h3 className="text-lg font-semibold mb-2">From:</h3>
          <p className="font-medium">{invoice.business_name}</p>
          <p className="text-gray-600">{invoice.business_address || 'N/A'}</p>
          <p className="text-gray-600">{invoice.business_phone_number || 'N/A'}</p>
        </div>
      </div>

      {/* Line Items */}
      <table className="min-w-full border border-gray-300 mb-8">
        <thead>
          <tr className="bg-gray-100">
            <th className="py-2 px-4 border-b border-r text-left">S.No</th>
            <th className="py-2 px-4 border-b border-r text-left">Item</th>
            <th className="py-2 px-4 border-b border-r text-right">Qty</th>
            <th className="py-2 px-4 border-b border-r text-right">Rate</th>
            <th className="py-2 px-4 border-b text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {line_items && line_items.map((item, index) => (
            <tr key={item.id || index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              <td className="py-2 px-4 border-b border-r">{index + 1}</td>
              <td className="py-2 px-4 border-b border-r">{item.item_name}</td>
              <td className="py-2 px-4 border-b border-r text-right">{item.quantity}</td>
              <td className="py-2 px-4 border-b border-r text-right">{formatIndianCurrency(item.rate || 0)}</td>
              <td className="py-2 px-4 border-b text-right">{formatIndianCurrency(item.amount || 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Summary */}
      <div className="flex justify-end mb-8">
        <div className="w-64 border border-gray-300">
          <div className="flex justify-between py-2 px-4 border-b">
            <span className="font-medium">Subtotal:</span>
            <span>{formatIndianCurrency(amount_without_tax)}</span>
          </div>

          {invoice.is_igst_applicable ? (
            <div className="flex justify-between py-2 px-4 border-b">
              <span className="font-medium">IGST (18%):</span>
              <span>{formatIndianCurrency(total_igst_tax || 0)}</span>
            </div>
          ) : (
            <>
              <div className="flex justify-between py-2 px-4 border-b">
                <span className="font-medium">CGST (9%):</span>
                <span>{formatIndianCurrency(total_cgst_tax || 0)}</span>
              </div>
              <div className="flex justify-between py-2 px-4 border-b">
                <span className="font-medium">SGST (9%):</span>
                <span>{formatIndianCurrency(total_sgst_tax || 0)}</span>
              </div>
            </>
          )}

          <div className="flex justify-between py-2 px-4 bg-gray-100 font-bold">
            <span>Total:</span>
            <span>{formatIndianCurrency(total_amount)}</span>
          </div>
        </div>
      </div>

      {/* Terms and Notes */}
      <div className="border-t border-gray-300 pt-6 mb-8">
        <h3 className="text-lg font-semibold mb-2">Terms & Notes</h3>
        <p className="text-gray-600">
          1. Payment is due within 30 days.<br />
          2. Please make payments to the bank account specified in the invoice.<br />
          3. For any queries regarding this invoice, please contact us.
        </p>
      </div>

      {/* Footer */}
      <div className="text-center text-gray-500 text-sm mt-12">
        <p>This is a computer-generated invoice and does not require a signature.</p>
      </div>
    </div>
  );
}

export default InvoicePrint;
