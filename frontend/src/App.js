import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import authService from './api/authService';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import CustomerList from './pages/CustomerList';
import CustomerDetail from './pages/CustomerDetail';
import CustomerForm from './pages/CustomerForm';
import CustomerImport from './pages/CustomerImport';
import BusinessList from './pages/BusinessList';
import BusinessDetail from './pages/BusinessDetail';
import BusinessForm from './pages/BusinessForm';
import InvoiceList from './pages/InvoiceList';
import InvoiceDetail from './pages/InvoiceDetail';
import InvoiceForm from './pages/InvoiceForm';
import InvoiceImport from './pages/InvoiceImport';
import AIInvoiceImport from './pages/AIInvoiceImport';
import InvoicePrint from './pages/InvoicePrint';
import BulkInvoicePrint from './pages/BulkInvoicePrint';
import ProductList from './pages/ProductList';
import ProductForm from './pages/ProductForm';
import ProductDetail from './pages/ProductDetail';
import ProductImport from './pages/ProductImport';
import Reports from './pages/Reports';
import Login from './pages/Login';

// Protected Route component
const ProtectedRoute = ({ children }) => {
  console.log('ProtectedRoute: Checking authentication');
  const isAuthenticated = authService.isAuthenticated();
  console.log('ProtectedRoute: isAuthenticated =', isAuthenticated);

  // Check token in localStorage
  const token = localStorage.getItem('access_token');
  console.log('ProtectedRoute: Token in localStorage:', token ? 'Present' : 'Not found');

  if (!isAuthenticated) {
    console.log('ProtectedRoute: Not authenticated, redirecting to login');
    // Redirect to login if not authenticated
    return <Navigate to="/login" replace />;
  }

  console.log('ProtectedRoute: Authenticated, rendering children');
  return children;
};

function App() {
  // Initialize authentication when the app loads
  useEffect(() => {
    const initializeAuth = () => {
      console.log('App component: Initializing authentication');
      try {
        const isAuthenticated = authService.initializeAuth();
        console.log('App component: Authentication initialized:', isAuthenticated ? 'Success' : 'Not authenticated');

        // Check if headers are set correctly
        const token = localStorage.getItem('access_token');
        if (token) {
          console.log('App component: Token in localStorage:', token.substring(0, 10) + '...');
        } else {
          console.warn('App component: No token in localStorage');
        }
      } catch (error) {
        console.error('App component: Error initializing authentication:', error);
      }
    };

    initializeAuth();
  }, []);

  return (
    <Routes>
      {/* Login Route */}
      <Route path="/login" element={<Login />} />

      {/* Main Layout Routes - Protected */}
      <Route path="/" element={
        <ProtectedRoute>
          <Layout />
        </ProtectedRoute>
      }>
        <Route index element={<Dashboard />} />

        {/* Customer Routes */}
        <Route path="billing/customer/list" element={<CustomerList />} />
        <Route path="billing/customer/import" element={<CustomerImport />} />
        <Route path="billing/customer/:customerId" element={<CustomerDetail />} />
        <Route path="billing/customer" element={<CustomerForm />} />
        <Route path="billing/customer/edit/:customerId" element={<CustomerForm />} />

        {/* Business Routes */}
        <Route path="billing/business/list" element={<BusinessList />} />
        <Route path="billing/business/:businessId" element={<BusinessDetail />} />
        <Route path="billing/business" element={<BusinessForm />} />
        <Route path="billing/business/edit/:businessId" element={<BusinessForm />} />

        {/* Invoice Routes */}
        <Route path="billing/invoice/list" element={<InvoiceList />} />
        <Route path="billing/invoice/add" element={<InvoiceForm />} />
        <Route path="billing/invoice/new" element={<InvoiceForm />} />
        <Route path="billing/invoice/import" element={<InvoiceImport />} />
        <Route path="billing/invoice/ai-import" element={<AIInvoiceImport />} />
        <Route path="billing/invoice/:invoiceId" element={<InvoiceDetail />} />
        <Route path="billing/invoice" element={<InvoiceForm />} />

        {/* Product Routes */}
        <Route path="billing/product/list" element={<ProductList />} />
        <Route path="billing/product/import" element={<ProductImport />} />
        <Route path="billing/product/:productId" element={<ProductDetail />} />
        <Route path="billing/product" element={<ProductForm />} />
        <Route path="billing/product/edit/:productId" element={<ProductForm />} />

        {/* Reports Route */}
        <Route path="billing/reports" element={<Reports />} />
      </Route>

      {/* Standalone Routes (without Layout) */}
      <Route path="billing/invoice/:invoiceId/print" element={<InvoicePrint />} />
      <Route path="billing/invoice/bulk-print" element={<BulkInvoicePrint />} />
    </Routes>
  );
}

export default App;
