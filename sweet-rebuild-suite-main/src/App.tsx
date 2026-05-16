import { lazy, Suspense } from "react";
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
import KeyboardShortcuts from "@/components/KeyboardShortcuts";
import CommandPalette from "@/components/CommandPalette";
import { Loader2 } from "lucide-react";

// Route-level code-splitting. Before this change every page (30+) was in
// a single 5.6 MB main bundle, so the user paid the full download cost
// on the first request. With React.lazy each page becomes its own chunk
// that loads only when the route is visited — Dashboard streams in
// fast, and heavy pages (BatchPrint pulling pdf-lib, QRScanner pulling
// qrcode, BulkPDF pulling jszip) only download their vendor deps when
// the user navigates there. Login is NOT lazy — it's the most common
// first page after a token expires and we don't want a loader flash on
// the auth screen.
import LoginPage from "@/pages/Login";

const Dashboard = lazy(() => import("@/pages/Dashboard"));
const CustomerList = lazy(() => import("@/pages/CustomerList"));
const CustomerDetail = lazy(() => import("@/pages/CustomerDetail"));
const CustomerStatement = lazy(() => import("@/pages/CustomerStatement"));
const CustomerForm = lazy(() => import("@/pages/CustomerForm"));
const ImportPage = lazy(() => import("@/pages/ImportPage"));
const BusinessList = lazy(() => import("@/pages/BusinessList"));
const BusinessDetail = lazy(() => import("@/pages/BusinessDetail"));
const BusinessForm = lazy(() => import("@/pages/BusinessForm"));
const InvoiceList = lazy(() => import("@/pages/InvoiceList"));
const InvoiceDetail = lazy(() => import("@/pages/InvoiceDetail"));
const InvoicePrint = lazy(() => import("@/pages/InvoicePrint"));
const InvoicePrintTally = lazy(() => import("@/pages/InvoicePrintTally"));
const InvoiceForm = lazy(() => import("@/pages/InvoiceForm"));
const AIInvoiceImport = lazy(() => import("@/pages/AIInvoiceImport"));
const UserManagement = lazy(() => import("@/pages/UserManagement"));
const ImportPreview = lazy(() => import("@/pages/ImportPreview"));
const ImportReview = lazy(() => import("@/pages/ImportReview"));
const BulkPDF = lazy(() => import("@/pages/BulkPDF"));
const QRScanner = lazy(() => import("@/pages/QRScanner"));
const BatchPrint = lazy(() => import("@/pages/BatchPrint"));
const ProductList = lazy(() => import("@/pages/ProductList"));
const ProductDetail = lazy(() => import("@/pages/ProductDetail"));
const ProductForm = lazy(() => import("@/pages/ProductForm"));
const Reports = lazy(() => import("@/pages/Reports"));
const GSTSummary = lazy(() => import("@/pages/GSTSummary"));
const Backup = lazy(() => import("@/pages/Backup"));
const Settings = lazy(() => import("@/pages/Settings"));
const AuditLog = lazy(() => import("@/pages/AuditLog"));
const Profile = lazy(() => import("@/pages/Profile"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

/** Single fallback for all lazy routes. Centred spinner keeps the layout
 *  height stable so the sidebar/topnav don't reflow during the chunk
 *  fetch. ~100ms on a warm cache, ~300-500ms on first navigation. */
function RouteFallback() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Loader2 className="w-6 h-6 animate-spin text-primary" />
    </div>
  );
}

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
              <Suspense fallback={<RouteFallback />}>
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
              </Suspense>
            </BrowserRouter>
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
