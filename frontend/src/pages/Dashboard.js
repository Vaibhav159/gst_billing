import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Card from '../components/Card';
import Button from '../components/Button';
import LoadingSpinner from '../components/LoadingSpinner';
import apiClient from '../api/client';
import { formatIndianCurrency, formatDate } from '../utils/formatters';

// Import dashboard chart components
import RevenueChart from '../components/dashboard/RevenueChart';
import InvoiceDistributionChart from '../components/dashboard/InvoiceDistributionChart';
import TopCustomersWidget from '../components/dashboard/TopCustomersWidget';
import TopProductsWidget from '../components/dashboard/TopProductsWidget';
import BusinessPerformanceCard from '../components/dashboard/BusinessPerformanceCard';
import RecentInvoicesWidget from '../components/dashboard/RecentInvoicesWidget';
import DashboardFilters from '../components/dashboard/DashboardFilters';

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

  // Dashboard filters state
  const [filters, setFilters] = useState({
    business: null,
    startDate: null,
    endDate: null
  });

  // Handle filter changes - memoized to prevent infinite re-renders
  const handleFilterChange = useCallback((newFilters) => {
    setFilters(newFilters);
  }, []);

  // Fetch dashboard data
  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setLoading(true);

        // Build params object with filters
        const params = {};
        if (filters.business) params.business = filters.business;
        if (filters.startDate) params.start_date = filters.startDate;
        if (filters.endDate) params.end_date = filters.endDate;

        // Fetch counts with filters
        const [customersRes, businessesRes, invoicesRes, productsRes, invoiceTotalsRes, recentInvoicesRes] = await Promise.all([
          apiClient.get('/customers/?limit=1', { params }),
          apiClient.get('/businesses/?limit=1', { params }),
          apiClient.get('/invoices/?limit=1', { params }),
          apiClient.get('/products/?limit=1', { params }),
          apiClient.get('/invoices/totals/', { params }),
          apiClient.get('/invoices/?limit=5&ordering=-invoice_date', { params })
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
  }, [filters]); // Re-fetch when filters change

  // Using the formatDate function from utils/formatters.js

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-1 relative">
            Welcome to GST Billing
            <span className="absolute -top-2 -right-2 sm:hidden inline-flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
            </span>
          </h1>
          <p className="text-gray-500 dark:text-gray-400">Your business management dashboard</p>
        </div>
        <div className="hidden sm:flex space-x-2 mt-4 sm:mt-0">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 shadow-sm">
            <span className="h-2 w-2 mr-1 rounded-full bg-green-500 animate-pulse"></span>
            System Online
          </span>
        </div>
      </div>

      {/* Dashboard Filters */}
      <div className="mb-4">
        <DashboardFilters onFilterChange={handleFilterChange} />
      </div>

      {/* Summary Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 border border-blue-200 dark:border-blue-800/30 shadow-sm overflow-hidden transform transition-all duration-300 hover:scale-105">
          <div className="p-4 md:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs md:text-sm font-medium text-blue-600 dark:text-blue-400">Total Outward</p>
                <h3 className="text-xl md:text-2xl font-bold text-blue-800 dark:text-blue-300 mt-1">
                  {loading ? <LoadingSpinner size="sm" /> : formatIndianCurrency(stats.totalOutward)}
                </h3>
              </div>
              <div className="p-2 md:p-3 rounded-full bg-blue-200/50 dark:bg-blue-700/30">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 md:h-6 md:w-6 text-blue-600 dark:text-blue-400" viewBox="-96 0 512 512" fill="currentColor">
                  <path d="M308 96c6.627 0 12-5.373 12-12V44c0-6.627-5.373-12-12-12H12C5.373 32 0 37.373 0 44v44.748c0 6.627 5.373 12 12 12h85.28c27.308 0 48.261 9.958 60.97 27.252H12c-6.627 0-12 5.373-12 12v40c0 6.627 5.373 12 12 12h158.757c-6.217 36.086-32.961 58.632-74.757 58.632H12c-6.627 0-12 5.373-12 12v53.012c0 3.349 1.4 6.546 3.861 8.818l165.052 152.356a12.001 12.001 0 0 0 8.139 3.182h82.562c10.924 0 16.166-13.408 8.139-20.818L116.871 319.906c76.499-2.34 131.144-53.395 138.318-127.906H308c6.627 0 12-5.373 12-12v-40c0-6.627-5.373-12-12-12h-58.69c-3.486-11.541-8.28-22.246-14.252-32H308z"/>
                </svg>
              </div>
            </div>
          </div>
        </Card>

        <Card className="bg-gradient-to-br from-red-50 to-red-100 dark:from-red-900/20 dark:to-red-800/20 border border-red-200 dark:border-red-800/30 shadow-sm overflow-hidden transform transition-all duration-300 hover:scale-105">
          <div className="p-4 md:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs md:text-sm font-medium text-red-600 dark:text-red-400">Total Inward</p>
                <h3 className="text-xl md:text-2xl font-bold text-red-800 dark:text-red-300 mt-1">
                  {loading ? <LoadingSpinner size="sm" /> : formatIndianCurrency(stats.totalInward)}
                </h3>
              </div>
              <div className="p-2 md:p-3 rounded-full bg-red-200/50 dark:bg-red-700/30">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 md:h-6 md:w-6 text-red-600 dark:text-red-400" viewBox="-96 0 512 512" fill="currentColor">
                  <path d="M308 96c6.627 0 12-5.373 12-12V44c0-6.627-5.373-12-12-12H12C5.373 32 0 37.373 0 44v44.748c0 6.627 5.373 12 12 12h85.28c27.308 0 48.261 9.958 60.97 27.252H12c-6.627 0-12 5.373-12 12v40c0 6.627 5.373 12 12 12h158.757c-6.217 36.086-32.961 58.632-74.757 58.632H12c-6.627 0-12 5.373-12 12v53.012c0 3.349 1.4 6.546 3.861 8.818l165.052 152.356a12.001 12.001 0 0 0 8.139 3.182h82.562c10.924 0 16.166-13.408 8.139-20.818L116.871 319.906c76.499-2.34 131.144-53.395 138.318-127.906H308c6.627 0 12-5.373 12-12v-40c0-6.627-5.373-12-12-12h-58.69c-3.486-11.541-8.28-22.246-14.252-32H308z"/>
                </svg>
              </div>
            </div>
          </div>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 border border-green-200 dark:border-green-800/30 shadow-sm overflow-hidden transform transition-all duration-300 hover:scale-105">
          <div className="p-4 md:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs md:text-sm font-medium text-green-600 dark:text-green-400">Net Amount</p>
                <h3 className="text-xl md:text-2xl font-bold text-green-800 dark:text-green-300 mt-1">
                  {loading ? <LoadingSpinner size="sm" /> : formatIndianCurrency(stats.netAmount)}
                </h3>
              </div>
              <div className="p-2 md:p-3 rounded-full bg-green-200/50 dark:bg-green-700/30">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 md:h-6 md:w-6 text-green-600 dark:text-green-400" viewBox="-96 0 512 512" fill="currentColor">
                  <path d="M308 96c6.627 0 12-5.373 12-12V44c0-6.627-5.373-12-12-12H12C5.373 32 0 37.373 0 44v44.748c0 6.627 5.373 12 12 12h85.28c27.308 0 48.261 9.958 60.97 27.252H12c-6.627 0-12 5.373-12 12v40c0 6.627 5.373 12 12 12h158.757c-6.217 36.086-32.961 58.632-74.757 58.632H12c-6.627 0-12 5.373-12 12v53.012c0 3.349 1.4 6.546 3.861 8.818l165.052 152.356a12.001 12.001 0 0 0 8.139 3.182h82.562c10.924 0 16.166-13.408 8.139-20.818L116.871 319.906c76.499-2.34 131.144-53.395 138.318-127.906H308c6.627 0 12-5.373 12-12v-40c0-6.627-5.373-12-12-12h-58.69c-3.486-11.541-8.28-22.246-14.252-32H308z"/>
                </svg>
              </div>
            </div>
          </div>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 border border-purple-200 dark:border-purple-800/30 shadow-sm overflow-hidden transform transition-all duration-300 hover:scale-105">
          <div className="p-4 md:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs md:text-sm font-medium text-purple-600 dark:text-purple-400">Total Invoices</p>
                <h3 className="text-xl md:text-2xl font-bold text-purple-800 dark:text-purple-300 mt-1">
                  {loading ? <LoadingSpinner size="sm" /> : stats.totalInvoices}
                </h3>
              </div>
              <div className="p-2 md:p-3 rounded-full bg-purple-200/50 dark:bg-purple-700/30">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 md:h-6 md:w-6 text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
            <div className="p-4 md:p-6">
              <div className="flex justify-between items-center mb-4 md:mb-6">
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
                <>
                  {/* Desktop View */}
                  <div className="hidden md:block overflow-x-auto">
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

                  {/* Mobile View - Card-based layout */}
                  <div className="md:hidden space-y-4">
                    {recentInvoices.map((invoice) => (
                      <div key={invoice.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 transition-all duration-200 hover:shadow-md">
                        <div className="flex justify-between items-start mb-2">
                          <Link to={`/billing/invoice/${invoice.id}`} className="text-primary-600 dark:text-primary-400 hover:underline font-medium">
                            {invoice.invoice_number}
                          </Link>
                          <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${invoice.type_of_invoice === 'outward' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'}`}>
                            {invoice.type_of_invoice === 'outward' ? 'Outward' : 'Inward'}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-sm mb-2">
                          <div>
                            <p className="text-gray-500 dark:text-gray-400 text-xs">Date</p>
                            <p className="font-medium text-gray-900 dark:text-white">{formatDate(invoice.invoice_date)}</p>
                          </div>
                          <div>
                            <p className="text-gray-500 dark:text-gray-400 text-xs">Amount</p>
                            <p className="font-medium text-gray-900 dark:text-white">{formatIndianCurrency(invoice.total_amount)}</p>
                          </div>
                        </div>

                        <div>
                          <p className="text-gray-500 dark:text-gray-400 text-xs">Customer</p>
                          <p className="font-medium text-gray-900 dark:text-white truncate">{invoice.customer_name}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </Card>
        </div>

        <div>
          <Card className="h-full">
            <div className="p-4 md:p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 md:mb-6">Quick Stats</h2>

              <div className="space-y-3 md:space-y-4">
                <div className="flex items-center justify-between p-3 md:p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg transform transition-all duration-300 hover:scale-102 hover:shadow-sm">
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

                <div className="flex items-center justify-between p-3 md:p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg transform transition-all duration-300 hover:scale-102 hover:shadow-sm">
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

                <div className="flex items-center justify-between p-3 md:p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg transform transition-all duration-300 hover:scale-102 hover:shadow-sm">
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

      {/* Revenue Chart */}
      <div className="mb-8">
        <RevenueChart filters={filters} />
      </div>

      {/* Invoice Distribution and Top Customers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <InvoiceDistributionChart filters={filters} />
        <TopCustomersWidget filters={filters} />
      </div>

      {/* Top Products */}
      <div className="mb-8">
        <TopProductsWidget filters={filters} />
      </div>

      {/* Business Performance */}
      <div className="mb-8">
        <BusinessPerformanceCard filters={filters} />
      </div>

      {/* Recent Invoices */}
      <div className="mb-8">
        <RecentInvoicesWidget
          invoices={recentInvoices}
          loading={loading}
          error={error}
        />
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 md:gap-6">
        <Link to="/billing/customer/list" className="block group">
          <Card className="h-full transition-all duration-300 group-hover:shadow-md transform group-hover:-translate-y-1 hover:bg-primary-50 dark:hover:bg-primary-900/10">
            <div className="flex flex-col items-center justify-center p-4 md:p-6 text-center">
              <div className="p-2 md:p-3 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 mb-3 md:mb-4 transition-colors duration-200 group-hover:bg-primary-200 dark:group-hover:bg-primary-800/40">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 md:h-10 md:w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h3 className="text-base md:text-lg font-medium text-gray-900 dark:text-white">Customers</h3>
              <p className="mt-1 md:mt-2 text-xs md:text-sm text-gray-500 dark:text-gray-400">Manage your customer information</p>
            </div>
          </Card>
        </Link>

        <Link to="/billing/business/list" className="block group">
          <Card className="h-full transition-all duration-300 group-hover:shadow-md transform group-hover:-translate-y-1 hover:bg-primary-50 dark:hover:bg-primary-900/10">
            <div className="flex flex-col items-center justify-center p-4 md:p-6 text-center">
              <div className="p-2 md:p-3 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 mb-3 md:mb-4 transition-colors duration-200 group-hover:bg-primary-200 dark:group-hover:bg-primary-800/40">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 md:h-10 md:w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <h3 className="text-base md:text-lg font-medium text-gray-900 dark:text-white">Businesses</h3>
              <p className="mt-1 md:mt-2 text-xs md:text-sm text-gray-500 dark:text-gray-400">Manage your business profiles</p>
            </div>
          </Card>
        </Link>

        <Link to="/billing/invoice/list" className="block group">
          <Card className="h-full transition-all duration-300 group-hover:shadow-md transform group-hover:-translate-y-1 hover:bg-primary-50 dark:hover:bg-primary-900/10">
            <div className="flex flex-col items-center justify-center p-4 md:p-6 text-center">
              <div className="p-2 md:p-3 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 mb-3 md:mb-4 transition-colors duration-200 group-hover:bg-primary-200 dark:group-hover:bg-primary-800/40">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 md:h-10 md:w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-base md:text-lg font-medium text-gray-900 dark:text-white">Invoices</h3>
              <p className="mt-1 md:mt-2 text-xs md:text-sm text-gray-500 dark:text-gray-400">Create and manage invoices</p>
            </div>
          </Card>
        </Link>

        <Link to="/billing/product/list" className="block group">
          <Card className="h-full transition-all duration-300 group-hover:shadow-md transform group-hover:-translate-y-1 hover:bg-primary-50 dark:hover:bg-primary-900/10">
            <div className="flex flex-col items-center justify-center p-4 md:p-6 text-center">
              <div className="p-2 md:p-3 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 mb-3 md:mb-4 transition-colors duration-200 group-hover:bg-primary-200 dark:group-hover:bg-primary-800/40">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 md:h-10 md:w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <h3 className="text-base md:text-lg font-medium text-gray-900 dark:text-white">Products</h3>
              <p className="mt-1 md:mt-2 text-xs md:text-sm text-gray-500 dark:text-gray-400">Manage your product catalog</p>
            </div>
          </Card>
        </Link>

        <Link to="/billing/reports" className="block group">
          <Card className="h-full transition-all duration-300 group-hover:shadow-md transform group-hover:-translate-y-1 hover:bg-primary-50 dark:hover:bg-primary-900/10">
            <div className="flex flex-col items-center justify-center p-4 md:p-6 text-center">
              <div className="p-2 md:p-3 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 mb-3 md:mb-4 transition-colors duration-200 group-hover:bg-primary-200 dark:group-hover:bg-primary-800/40">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 md:h-10 md:w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-base md:text-lg font-medium text-gray-900 dark:text-white">Reports</h3>
              <p className="mt-1 md:mt-2 text-xs md:text-sm text-gray-500 dark:text-gray-400">Generate and download reports</p>
            </div>
          </Card>
        </Link>
      </div>
    </div>
  );
}

export default Dashboard;
