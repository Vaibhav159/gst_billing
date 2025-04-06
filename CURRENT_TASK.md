# Current Task

## Frontend Migration from HTMX to React

### Status: In Progress

### Description
We are migrating the frontend of the GST Billing application from HTMX to React to improve the user experience, performance, and maintainability of the application.

### Current Focus
- Implementing all remaining React pages to achieve feature parity with the current HTMX version
- Optimizing API requests with proper cancellation and error handling
- Ensuring consistent UI/UX across all pages
- Implementing proper data formatting (e.g., Indian currency format)

### Completed Items
- Set up React application structure
- Created core components (Card, Button, FormInput, etc.)
- Implemented main pages (Dashboard, Business, Customer, Invoice)
- Added API client with request cancellation
- Implemented proper error handling
- Added Indian currency formatting
- Fixed invoice detail and print views
- Added reports generation functionality
- Added comprehensive test cases for all API endpoints
- Set up CircleCI for continuous integration with uv package manager and PostgreSQL
- Added pytest and coverage reporting to CI pipeline
- Configured proper uv usage according to official documentation

### Pending Items / Bugs
- None at the moment


### Recently Completed Items
- ✅ Fixed pagination numbers in dark mode (previously white text on white background)
- ✅ Made Reports section readable in dark mode by adding proper text colors
- ✅ Added proper loading state to the dashboard to prevent it from showing 0 values before data loads
- ✅ Standardized date format across the application to be consistent (e.g., Feb 28, 2025) by creating a reusable formatDate utility function
- ✅ Dashboard already uses ₹ symbol correctly via the formatIndianCurrency utility and updated SVG icons to show the ₹ symbol instead of $
- ✅ Fixed report generation issue where authentication credentials were not being passed to the new tab
- ✅ Increased timeout for report generation to 5 minutes and added better loading indicators
- ✅ Fixed report download to include proper file extension (.xlsx) and descriptive filename with robust handling of Content-Disposition headers
- ✅ Added GST tax rate field to Product list and form pages
- ✅ Fixed StateDropdown component to support dark mode with proper styling in Business and Customer forms
- ✅ Fixed CSRF verification issue with Add Line Item API by removing CSRF middleware since we're using JWT authentication
- ✅ Fixed line items API endpoint to properly handle nested routes for invoice line items
- ✅ Fixed line item creation by using the backend's create_line_item_for_invoice method to handle all calculations and validations
- ✅ Standardized field naming by using consistent field names (product_name, quantity) throughout the frontend to match backend models
- ✅ Added robust error handling for line item creation to handle potential undefined values
- ✅ Fixed issue with blank line items appearing after adding by refreshing the entire line items list
- ✅ Added test cases for line item addition/deletion and invoice total amount verification
- ✅ Added custom debounce hook for search filters in Customer and Business lists with immediate visual feedback, delayed API calls, and maintained input focus
- ✅ Fixed list refresh issues by removing API caching to ensure fresh data is always displayed
- ✅ Added Delete action in Invoice List page with confirmation dialog and proper list refresh
- ✅ Fixed total_amount not updating after adding a new line item
- ✅ Implemented delete functionality for line items with confirmation dialog
- ✅ Fixed Add Line Item component to support dark mode with proper styling, including the SearchableDropdown component
- ✅ Improved the Add/Cancel button in Line Items section to use appropriate colors and icons
- ✅ Realigned View Bill and New Invoice buttons on invoice details page for better UX
- ✅ Added dark mode support to all components including tables, cards, and text elements
- ✅ Fixed PAN Card display in CustomerList view page and removed email field since it's not in the database
- ✅ Fixed Current Month button in reports to correctly set date range
- ✅ Cleaned up unnecessary console logs from frontend code
- ✅ Update Phone number is not working in customer add or edit section.
- ✅ In Add Invoice, after selecting business, customer is not getting filtered as per that business, also customer list should be a searchable dropdown.
- ✅ Add Searchable Dropdown on StateName on Business Add, Edit and Customer Add, Edit and user can only submit if state is selected from dropdown.
- ✅ Add Serial Number in each List View.
- ✅ Remove Hard coded fallbacks from most of the pages, like invoiceDetails still have that
- ✅ Invoice Number should be auto generated based on business and type of invoice, for outward, it should be N+1 of the last invoice number of that business if its in same financial year. If its a new financial year, it start from 1.
- ✅ Update test cases since the APIs have changed.
- ✅ Figure out how to handle ci_settings.py since it is taking all objects from settings.py but on circleci local file wont be there.
- ✅ Migrated from requirements.txt to pyproject.toml with uv for better dependency management.
- Implemented JWT Authentication for API security
- Added Login page and protected routes
- Improved Customer and Business Detail pages to render data as it becomes available instead of waiting for all API calls to complete
- Fixed issue with total tax showing as 0 on invoice detail page by properly using the total_tax field from the summary API
- Improved Invoice Detail page to render data as it becomes available instead of waiting for all API calls to complete
- Added Invoice Import feature that allows users to import invoices from CSV files
- Fixed filters on CustomerList view page
- Fixed total inward and outward calculations on InvoiceList view
- Fixed item name display on InvoiceDetail and Print view pages
- Updated Print view page to match the HTMX version with improved layout and styling, fixed date formatting, and added proper handling of API response data including round-off amount, dynamic business details, and customer details from API without hard-coded fallback values
- Enhanced the Print view with optimized layout for A4 paper, including improved spacing for Bill To section, Amount in Words section, and Signature section
- Fixed issue with jurisdiction text appearing on a separate page by moving it into the Bank Details section while maintaining the original design
- Updated InvoiceDetail view page to match the HTMX version
- Fixed Business filter on CustomerList view page
- Enhanced InvoiceDetail view to match the HTMX version with improved layout and styling
- Fixed issue with blank GSTIN, mobile, and address fields in InvoiceDetail page
- Improved API service usage in InvoiceDetail page for better code organization
- Made Item Name in invoice page a searchable dropdown of products list that shows all products when clicked
- Updated invoice detail page to show quantity as "Quantity (gm)" and rate as "Rate (₹/g)"
- Updated CustomerList page to show PAN number and fixed mobile number display

### Notes
- Using uv for package installation instead of pip
- Ensuring all price fields display in Indian number format (e.g., ₹1,00,000.00)
- Maintaining backward compatibility during the transition
