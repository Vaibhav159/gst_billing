import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
import ErrorBoundary from "@/components/ErrorBoundary";
import LoginPage from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import CustomerList from "@/pages/CustomerList";
import CustomerDetail from "@/pages/CustomerDetail";
import CustomerStatement from "@/pages/CustomerStatement";
import CustomerForm from "@/pages/CustomerForm";
import ImportPage from "@/pages/ImportPage";
import BusinessList from "@/pages/BusinessList";
import BusinessDetail from "@/pages/BusinessDetail";
import BusinessForm from "@/pages/BusinessForm";
import InvoiceList from "@/pages/InvoiceList";
import InvoiceDetail from "@/pages/InvoiceDetail";
import InvoicePrint from "@/pages/InvoicePrint";
import InvoicePrintTally from "@/pages/InvoicePrintTally";
import InvoiceForm from "@/pages/InvoiceForm";
import AIInvoiceImport from "@/pages/AIInvoiceImport";
import UserManagement from "@/pages/UserManagement";
import ImportPreview from "@/pages/ImportPreview";
import ImportReview from "@/pages/ImportReview";
import BulkPDF from "@/pages/BulkPDF";
import QRScanner from "@/pages/QRScanner";
import BatchPrint from "@/pages/BatchPrint";
import ProductList from "@/pages/ProductList";
import ProductDetail from "@/pages/ProductDetail";
import ProductForm from "@/pages/ProductForm";
import Reports from "@/pages/Reports";
import GSTSummary from "@/pages/GSTSummary";
import Backup from "@/pages/Backup";
import Settings from "@/pages/Settings";
import AuditLog from "@/pages/AuditLog";
import Profile from "@/pages/Profile";
import KeyboardShortcuts from "@/components/KeyboardShortcuts";
import CommandPalette from "@/components/CommandPalette";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <KeyboardShortcuts />
              <CommandPalette />
              <Routes>
                <Route path="/login" element={<LoginPage />} />

                {/* Invoice print — Tally format is default */}
                <Route path="/billing/invoice/:id/print" element={
                  <ProtectedRoute><InvoicePrintTally /></ProtectedRoute>
                } />
                <Route path="/billing/invoice/:id/print-classic" element={
                  <ProtectedRoute><InvoicePrint /></ProtectedRoute>
                } />
                <Route path="/billing/batch-print" element={
                  <ProtectedRoute><BatchPrint /></ProtectedRoute>
                } />

                {/* Main app layout */}
                <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                  <Route path="/" element={<Dashboard />} />

                  {/* Customers */}
                  <Route path="/billing/customer/list" element={<CustomerList />} />
                  <Route path="/billing/customer/new" element={<CustomerForm />} />
                  <Route path="/billing/customer/edit/:id" element={<CustomerForm />} />
                  <Route path="/billing/customer/import" element={<ImportPage type="customer" />} />
                  <Route path="/billing/customer/:id" element={<CustomerDetail />} />
                  <Route path="/billing/customer/:id/statement" element={<CustomerStatement />} />

                  {/* Businesses */}
                  <Route path="/billing/business/list" element={<BusinessList />} />
                  <Route path="/billing/business/new" element={<BusinessForm />} />
                  <Route path="/billing/business/edit/:id" element={<BusinessForm />} />
                  <Route path="/billing/business/import" element={<ImportPage type="business" />} />
                  <Route path="/billing/business/:id" element={<BusinessDetail />} />

                  {/* Invoices */}
                  <Route path="/billing/invoice/list" element={<InvoiceList />} />
                  <Route path="/billing/invoice/add" element={<InvoiceForm mode="create" />} />
                  <Route path="/billing/invoice/edit/:id" element={<InvoiceForm mode="edit" />} />
                  <Route path="/billing/invoice/import" element={<ImportPage type="invoice" />} />
                  <Route path="/billing/invoice/ai-import" element={<AIInvoiceImport />} />
                  <Route path="/billing/import/review" element={<ImportReview />} />
                  <Route path="/billing/import/preview" element={<ImportPreview />} />
                  {/* Multi-segment pretty URL:
                        /billing/invoice/{bizSlug}/{fy}/{number}
                      e.g. /billing/invoice/pyarchand-ratanlal/2025-26/040
                      Falls through to the single-segment route below for
                      legacy id-based or number-only links. */}
                  <Route path="/billing/invoice/:bizSlug/:fy/:slug" element={<InvoiceDetail />} />
                  <Route path="/billing/invoice/:id" element={<InvoiceDetail />} />
                  <Route path="/billing/bulk-pdf" element={<BulkPDF />} />
                  <Route path="/billing/qr-scanner" element={<QRScanner />} />

                  {/* Products */}
                  <Route path="/billing/product/list" element={<ProductList />} />
                  <Route path="/billing/product/new" element={<ProductForm />} />
                  <Route path="/billing/product/edit/:id" element={<ProductForm />} />
                  <Route path="/billing/product/import" element={<ImportPage type="product" />} />
                  <Route path="/billing/product/:id" element={<ProductDetail />} />

                  {/* Reports, GST, Backup */}
                  <Route path="/billing/reports" element={<Reports />} />
                  <Route path="/billing/gst-summary" element={<GSTSummary />} />
                  <Route path="/billing/backup" element={<Backup />} />
                  <Route path="/billing/settings" element={<Settings />} />
                  <Route path="/billing/audit-log" element={<AuditLog />} />
                  <Route path="/billing/users" element={<UserManagement />} />
                  {/* Old gstr-export route — merged into /gst-summary as a tab */}
                  <Route path="/billing/gstr-export" element={<Navigate to="/billing/gst-summary?tab=gstr1" replace />} />
                  <Route path="/billing/profile" element={<Profile />} />
                </Route>

                <Route path="/billing" element={<Navigate to="/" replace />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
