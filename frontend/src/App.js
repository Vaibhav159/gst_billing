import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import CustomerList from './pages/CustomerList';
import CustomerDetail from './pages/CustomerDetail';
import CustomerForm from './pages/CustomerForm';
import BusinessList from './pages/BusinessList';
import BusinessDetail from './pages/BusinessDetail';
import BusinessForm from './pages/BusinessForm';
import InvoiceList from './pages/InvoiceList';
import InvoiceDetail from './pages/InvoiceDetail';
import InvoiceForm from './pages/InvoiceForm';
import InvoiceImport from './pages/InvoiceImport';
import InvoicePrint from './pages/InvoicePrint';
import ProductList from './pages/ProductList';
import ProductForm from './pages/ProductForm';
import Reports from './pages/Reports';

function App() {
  return (
    <Routes>
      {/* Main Layout Routes */}
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />

        {/* Customer Routes */}
        <Route path="billing/customer/list" element={<CustomerList />} />
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
        <Route path="billing/invoice/:invoiceId" element={<InvoiceDetail />} />
        <Route path="billing/invoice" element={<InvoiceForm />} />

        {/* Product Routes */}
        <Route path="billing/product/list" element={<ProductList />} />
        <Route path="billing/product" element={<ProductForm />} />
        <Route path="billing/product/edit/:productId" element={<ProductForm />} />

        {/* Reports Route */}
        <Route path="billing/reports" element={<Reports />} />
      </Route>

      {/* Standalone Routes (without Layout) */}
      <Route path="billing/invoice/:invoiceId/print" element={<InvoicePrint />} />
    </Routes>
  );
}

export default App;
