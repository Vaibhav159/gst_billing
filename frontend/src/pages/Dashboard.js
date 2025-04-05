import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Card from '../components/Card';
import Button from '../components/Button';
import LoadingSpinner from '../components/LoadingSpinner';
import apiClient from '../api/client';
import { formatIndianCurrency, formatDate } from '../utils/formatters';

function Dashboard() {
  const [stats, setStats] = useState({
    totalCustomers: null,
    totalBusinesses: null,
    totalInvoices: null,
    totalProducts: null,
    totalOutward: null,
    totalInward: null,
    netAmount: null
  });
  const [recentInvoices, setRecentInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch dashboard data
  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setLoading(true);

        // Fetch counts
        const [customersRes, businessesRes, invoicesRes, productsRes, invoiceTotalsRes, recentInvoicesRes] = await Promise.all([
          apiClient.get('/customers/?limit=1'),
          apiClient.get('/businesses/?limit=1'),
          apiClient.get('/invoices/?limit=1'),
          apiClient.get('/products/?limit=1'),
          apiClient.get('/invoices/totals/'),
          apiClient.get('/invoices/?limit=5&ordering=-invoice_date')
        ]);

        setStats({
          totalCustomers: customersRes.data.count || 0,
          totalBusinesses: businessesRes.data.count || 0,
          totalInvoices: invoicesRes.data.count || 0,
          totalProducts: productsRes.data.count || 0,
          totalOutward: invoiceTotalsRes.data.outward_total || 0,
          totalInward: invoiceTotalsRes.data.inward_total || 0,
          netAmount: (invoiceTotalsRes.data.outward_total || 0) - (invoiceTotalsRes.data.inward_total || 0)
        });

        setRecentInvoices(recentInvoicesRes.data.results || []);
        setError(null);
      } catch (err) {
        console.error('Error fetching dashboard data:', err);
        setError('Failed to load dashboard data');
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  // Using the formatDate function from utils/formatters.js

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">Welcome to GST Billing</h1>
          <p className="text-gray-500 dark:text-gray-400">Your business management dashboard</p>
        </div>
        <div className="flex space-x-2 mt-4 sm:mt-0">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
            <span className="h-2 w-2 mr-1 rounded-full bg-green-500 animate-pulse"></span>
            System Online
          </span>
        </div>
      </div>

      {/* Summary Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 border border-blue-200 dark:border-blue-800/30 shadow-sm overflow-hidden">
          <div className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-blue-600 dark:text-blue-400">Total Outward</p>
                <h3 className="text-2xl font-bold text-blue-800 dark:text-blue-300 mt-1">
                  {loading ? <LoadingSpinner size="sm" /> : formatIndianCurrency(stats.totalOutward)}
                </h3>
              </div>
              <div className="p-3 rounded-full bg-blue-200/50 dark:bg-blue-700/30">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          </div>
        </Card>

        <Card className="bg-gradient-to-br from-red-50 to-red-100 dark:from-red-900/20 dark:to-red-800/20 border border-red-200 dark:border-red-800/30 shadow-sm overflow-hidden">
          <div className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-red-600 dark:text-red-400">Total Inward</p>
                <h3 className="text-2xl font-bold text-red-800 dark:text-red-300 mt-1">
                  {loading ? <LoadingSpinner size="sm" /> : formatIndianCurrency(stats.totalInward)}
                </h3>
              </div>
              <div className="p-3 rounded-full bg-red-200/50 dark:bg-red-700/30">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          </div>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 border border-green-200 dark:border-green-800/30 shadow-sm overflow-hidden">
          <div className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-green-600 dark:text-green-400">Net Amount</p>
                <h3 className="text-2xl font-bold text-green-800 dark:text-green-300 mt-1">
                  {loading ? <LoadingSpinner size="sm" /> : formatIndianCurrency(stats.netAmount)}
                </h3>
              </div>
              <div className="p-3 rounded-full bg-green-200/50 dark:bg-green-700/30">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
            </div>
          </div>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 border border-purple-200 dark:border-purple-800/30 shadow-sm overflow-hidden">
          <div className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-purple-600 dark:text-purple-400">Total Invoices</p>
                <h3 className="text-2xl font-bold text-purple-800 dark:text-purple-300 mt-1">
                  {loading ? <LoadingSpinner size="sm" /> : stats.totalInvoices}
                </h3>
              </div>
              <div className="p-3 rounded-full bg-purple-200/50 dark:bg-purple-700/30">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card className="h-full">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Recent Invoices</h2>
                <Link to="/billing/invoice/list">
                  <Button variant="outline" size="sm">View All</Button>
                </Link>
              </div>

              {loading ? (
                <div className="flex justify-center py-8">
                  <LoadingSpinner size="md" />
                </div>
              ) : error ? (
                <div className="text-center py-8 text-red-500 dark:text-red-400">
                  <p>{error}</p>
                </div>
              ) : recentInvoices.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500 dark:text-gray-400">No recent invoices found.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-800">
                      <tr>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Invoice #</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Date</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Customer</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Amount</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Type</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {recentInvoices.map((invoice) => (
                        <tr key={invoice.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-150">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <Link to={`/billing/invoice/${invoice.id}`} className="text-primary-600 dark:text-primary-400 hover:underline">
                              {invoice.invoice_number}
                            </Link>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                            {formatDate(invoice.invoice_date)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                            {invoice.customer_name}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                            {formatIndianCurrency(invoice.total_amount)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${invoice.type_of_invoice === 'outward' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'}`}>
                              {invoice.type_of_invoice === 'outward' ? 'Outward' : 'Inward'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Card>
        </div>

        <div>
          <Card className="h-full">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">Quick Stats</h2>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                  <div className="flex items-center">
                    <div className="p-2 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 mr-3">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Customers</span>
                  </div>
                  <span className="text-lg font-semibold text-gray-900 dark:text-white">
                    {loading ? <LoadingSpinner size="sm" /> : stats.totalCustomers}
                  </span>
                </div>

                <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                  <div className="flex items-center">
                    <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 mr-3">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                    </div>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Businesses</span>
                  </div>
                  <span className="text-lg font-semibold text-gray-900 dark:text-white">
                    {loading ? <LoadingSpinner size="sm" /> : stats.totalBusinesses}
                  </span>
                </div>

                <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                  <div className="flex items-center">
                    <div className="p-2 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 mr-3">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                    </div>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Products</span>
                  </div>
                  <span className="text-lg font-semibold text-gray-900 dark:text-white">
                    {loading ? <LoadingSpinner size="sm" /> : stats.totalProducts}
                  </span>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
        <Link to="/billing/customer/list" className="block group">
          <Card className="h-full transition-all duration-300 group-hover:shadow-soft transform group-hover:-translate-y-1">
            <div className="flex flex-col items-center justify-center p-6 text-center">
              <div className="p-3 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 mb-4 transition-colors duration-200 group-hover:bg-primary-200 dark:group-hover:bg-primary-800/40">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">Customers</h3>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Manage your customer information</p>
            </div>
          </Card>
        </Link>

        <Link to="/billing/business/list" className="block group">
          <Card className="h-full transition-all duration-300 group-hover:shadow-soft transform group-hover:-translate-y-1">
            <div className="flex flex-col items-center justify-center p-6 text-center">
              <div className="p-3 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 mb-4 transition-colors duration-200 group-hover:bg-primary-200 dark:group-hover:bg-primary-800/40">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">Businesses</h3>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Manage your business profiles</p>
            </div>
          </Card>
        </Link>

        <Link to="/billing/invoice/list" className="block group">
          <Card className="h-full transition-all duration-300 group-hover:shadow-soft transform group-hover:-translate-y-1">
            <div className="flex flex-col items-center justify-center p-6 text-center">
              <div className="p-3 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 mb-4 transition-colors duration-200 group-hover:bg-primary-200 dark:group-hover:bg-primary-800/40">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">Invoices</h3>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Create and manage invoices</p>
            </div>
          </Card>
        </Link>

        <Link to="/billing/product/list" className="block group">
          <Card className="h-full transition-all duration-300 group-hover:shadow-soft transform group-hover:-translate-y-1">
            <div className="flex flex-col items-center justify-center p-6 text-center">
              <div className="p-3 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 mb-4 transition-colors duration-200 group-hover:bg-primary-200 dark:group-hover:bg-primary-800/40">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">Products</h3>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Manage your product catalog</p>
            </div>
          </Card>
        </Link>

        <Link to="/billing/reports" className="block group">
          <Card className="h-full transition-all duration-300 group-hover:shadow-soft transform group-hover:-translate-y-1">
            <div className="flex flex-col items-center justify-center p-6 text-center">
              <div className="p-3 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 mb-4 transition-colors duration-200 group-hover:bg-primary-200 dark:group-hover:bg-primary-800/40">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">Reports</h3>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Generate and download reports</p>
            </div>
          </Card>
        </Link>
      </div>
    </div>
  );
}

export default Dashboard;
