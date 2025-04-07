import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Card from '../Card';
import { formatIndianCurrency, formatDate } from '../../utils/formatters';

/**
 * Recent Invoices Widget for the dashboard
 * Shows the most recent invoices
 * @param {Object} props - Component props
 * @param {Array} props.invoices - List of recent invoices
 * @param {boolean} props.loading - Loading state
 * @param {string} props.error - Error message
 */
function RecentInvoicesWidget({ invoices = [], loading = false, error = null }) {
  const navigate = useNavigate();

  // Handle click on invoice row
  const handleInvoiceClick = (invoiceId) => {
    navigate(`/billing/invoice/${invoiceId}`);
  };

  // Handle click on customer or business
  const handleEntityClick = (e, type, id) => {
    e.stopPropagation();
    if (type === 'customer') {
      navigate(`/billing/customer/${id}`);
    } else if (type === 'business') {
      navigate(`/billing/business/${id}`);
    }
  };

  // Get badge color based on invoice type
  const getInvoiceTypeBadge = (type) => {
    if (type === 'outward') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
          Outward
        </span>
      );
    } else if (type === 'inward') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
          Inward
        </span>
      );
    } else {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
          Other
        </span>
      );
    }
  };

  return (
    <Card className="w-full">
      <div className="p-4 md:p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Recent Invoices
          </h2>

          <Link
            to="/billing/invoice/list"
            className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 flex items-center"
          >
            View all
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-64 animate-pulse">
            <div className="text-gray-500 dark:text-gray-400">Loading recent invoices...</div>
          </div>
        ) : error ? (
          <div className="flex justify-center items-center h-64">
            <div className="text-red-500 dark:text-red-400">{error}</div>
          </div>
        ) : invoices.length > 0 ? (
          <div className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Invoice
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Date
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Customer/Business
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Amount
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Type
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                  {invoices.map(invoice => (
                    <tr
                      key={invoice.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors duration-150"
                      onClick={() => handleInvoiceClick(invoice.id)}
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          {invoice.invoice_number}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          {formatDate(invoice.invoice_date)}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div
                          className="text-sm text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 hover:underline"
                          onClick={(e) => handleEntityClick(e, invoice.type_of_invoice === 'outward' ? 'customer' : 'business', invoice.type_of_invoice === 'outward' ? invoice.customer : invoice.business)}
                        >
                          {invoice.type_of_invoice === 'outward' ? invoice.customer_name : invoice.business_name}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          {formatIndianCurrency(invoice.total_amount)}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getInvoiceTypeBadge(invoice.type_of_invoice)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="flex justify-center items-center h-64">
            <div className="text-gray-500 dark:text-gray-400">No recent invoices available</div>
          </div>
        )}
      </div>
    </Card>
  );
}

export default RecentInvoicesWidget;
