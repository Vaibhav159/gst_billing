import React from 'react';
import { Link } from 'react-router-dom';
import Card from '../components/Card';

function Dashboard() {
  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4 sm:mb-0">Dashboard</h1>
        <div className="flex space-x-2">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
            <span className="h-2 w-2 mr-1 rounded-full bg-green-500"></span>
            System Online
          </span>
        </div>
      </div>

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
