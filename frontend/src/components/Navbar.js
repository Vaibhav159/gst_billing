import React, { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import authService from '../api/authService';
import DarkModeToggle from './DarkModeToggle';
import Button from './Button';

function Navbar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const navigate = useNavigate();

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const handleLogout = () => {
    authService.logout();
    navigate('/login');
  };

  return (
    <nav className="bg-white dark:bg-gray-900 shadow-sm sticky top-0 z-10 transition-colors duration-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <Link to="/" className="text-primary-600 dark:text-primary-300 font-bold text-xl transition-colors duration-200">GST Billing</Link>
            </div>
            <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  isActive
                    ? "border-primary-500 text-gray-900 dark:text-white dark:border-primary-300 inline-flex items-center px-3 pt-1 border-b-4 text-sm font-medium transition-colors duration-200 bg-primary-50/10 dark:bg-primary-700 rounded-t-md shadow-sm font-bold"
                    : "border-transparent text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-700 dark:hover:text-gray-100 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors duration-200"
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span className="absolute -bottom-1 left-0 right-0 h-1 bg-primary-500 dark:bg-primary-300 hidden"></span>
                    )}
                    Dashboard
                  </>
                )}
              </NavLink>
              <NavLink
                to="/billing/customer/list"
                className={({ isActive }) =>
                  isActive
                    ? "border-primary-500 text-gray-900 dark:text-white dark:border-primary-300 inline-flex items-center px-3 pt-1 border-b-4 text-sm font-medium transition-colors duration-200 bg-primary-50/10 dark:bg-primary-700 rounded-t-md shadow-sm font-bold"
                    : "border-transparent text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-700 dark:hover:text-gray-100 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors duration-200"
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span className="absolute -bottom-1 left-0 right-0 h-1 bg-primary-500 dark:bg-primary-300 hidden"></span>
                    )}
                    Customers
                  </>
                )}
              </NavLink>
              <NavLink
                to="/billing/business/list"
                className={({ isActive }) =>
                  isActive
                    ? "border-primary-500 text-gray-900 dark:text-white dark:border-primary-300 inline-flex items-center px-3 pt-1 border-b-4 text-sm font-medium transition-colors duration-200 bg-primary-50/10 dark:bg-primary-700 rounded-t-md shadow-sm font-bold"
                    : "border-transparent text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-700 dark:hover:text-gray-100 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors duration-200"
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span className="absolute -bottom-1 left-0 right-0 h-1 bg-primary-500 dark:bg-primary-300 hidden"></span>
                    )}
                    Businesses
                  </>
                )}
              </NavLink>
              <NavLink
                to="/billing/invoice/list"
                className={({ isActive }) =>
                  isActive
                    ? "border-primary-500 text-gray-900 dark:text-white dark:border-primary-300 inline-flex items-center px-3 pt-1 border-b-4 text-sm font-medium transition-colors duration-200 bg-primary-50/10 dark:bg-primary-700 rounded-t-md shadow-sm font-bold"
                    : "border-transparent text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-700 dark:hover:text-gray-100 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors duration-200"
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span className="absolute -bottom-1 left-0 right-0 h-1 bg-primary-500 dark:bg-primary-300 hidden"></span>
                    )}
                    Invoices
                  </>
                )}
              </NavLink>
              <NavLink
                to="/billing/product/list"
                className={({ isActive }) =>
                  isActive
                    ? "border-primary-500 text-gray-900 dark:text-white dark:border-primary-300 inline-flex items-center px-3 pt-1 border-b-4 text-sm font-medium transition-colors duration-200 bg-primary-50/10 dark:bg-primary-700 rounded-t-md shadow-sm font-bold"
                    : "border-transparent text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-700 dark:hover:text-gray-100 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors duration-200"
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span className="absolute -bottom-1 left-0 right-0 h-1 bg-primary-500 dark:bg-primary-300 hidden"></span>
                    )}
                    Products
                  </>
                )}
              </NavLink>
              <NavLink
                to="/billing/reports"
                className={({ isActive }) =>
                  isActive
                    ? "border-primary-500 text-gray-900 dark:text-white dark:border-primary-300 inline-flex items-center px-3 pt-1 border-b-4 text-sm font-medium transition-colors duration-200 bg-primary-50/10 dark:bg-primary-700 rounded-t-md shadow-sm font-bold"
                    : "border-transparent text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-700 dark:hover:text-gray-100 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors duration-200"
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span className="absolute -bottom-1 left-0 right-0 h-1 bg-primary-500 dark:bg-primary-300 hidden"></span>
                    )}
                    Reports
                  </>
                )}
              </NavLink>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            {/* Dark Mode Toggle */}
            <DarkModeToggle />

            {/* Logout button */}
            <Button
              onClick={handleLogout}
              variant="danger"
              size="sm"
              className="ml-2"
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1V4a1 1 0 00-1-1H3zm11 4a1 1 0 10-2 0v4a1 1 0 102 0V7z" clipRule="evenodd" />
                  <path d="M4 8a1 1 0 011-1h4a1 1 0 110 2H5a1 1 0 01-1-1z" />
                </svg>
              }
            >
              Logout
            </Button>

            {/* Mobile menu button */}
            <div className="-mr-2 flex items-center sm:hidden">
            <button
              onClick={toggleMobileMenu}
              type="button"
              className="inline-flex items-center justify-center p-2 rounded-md text-gray-400 dark:text-gray-300 hover:text-gray-500 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500 transition-colors duration-200"
              aria-expanded="false"
            >
              <span className="sr-only">Open main menu</span>
              {/* Icon when menu is closed */}
              <svg
                className={`${isMobileMenuOpen ? 'hidden' : 'block'} h-6 w-6`}
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
              {/* Icon when menu is open */}
              <svg
                className={`${isMobileMenuOpen ? 'block' : 'hidden'} h-6 w-6`}
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu, show/hide based on menu state */}
      <div className={`${isMobileMenuOpen ? 'block' : 'hidden'} sm:hidden`}>
        <div className="pt-2 pb-3 space-y-1">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              isActive
                ? "bg-primary-50 dark:bg-primary-700 border-primary-500 dark:border-primary-300 text-primary-700 dark:text-white block pl-3 pr-4 py-2 border-l-4 text-base font-medium transition-colors duration-200 shadow-sm font-bold"
                : "border-transparent text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-700 dark:hover:text-gray-100 block pl-3 pr-4 py-2 border-l-4 text-base font-medium transition-colors duration-200"
            }
            onClick={toggleMobileMenu}
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/billing/customer/list"
            className={({ isActive }) =>
              isActive
                ? "bg-blue-50 border-blue-500 text-blue-700 block pl-3 pr-4 py-2 border-l-4 text-base font-medium"
                : "border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700 block pl-3 pr-4 py-2 border-l-4 text-base font-medium"
            }
            onClick={toggleMobileMenu}
          >
            Customers
          </NavLink>
          <NavLink
            to="/billing/business/list"
            className={({ isActive }) =>
              isActive
                ? "bg-blue-50 border-blue-500 text-blue-700 block pl-3 pr-4 py-2 border-l-4 text-base font-medium"
                : "border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700 block pl-3 pr-4 py-2 border-l-4 text-base font-medium"
            }
            onClick={toggleMobileMenu}
          >
            Businesses
          </NavLink>
          <NavLink
            to="/billing/invoice/list"
            className={({ isActive }) =>
              isActive
                ? "bg-blue-50 border-blue-500 text-blue-700 block pl-3 pr-4 py-2 border-l-4 text-base font-medium"
                : "border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700 block pl-3 pr-4 py-2 border-l-4 text-base font-medium"
            }
            onClick={toggleMobileMenu}
          >
            Invoices
          </NavLink>
          <NavLink
            to="/billing/product/list"
            className={({ isActive }) =>
              isActive
                ? "bg-blue-50 border-blue-500 text-blue-700 block pl-3 pr-4 py-2 border-l-4 text-base font-medium"
                : "border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700 block pl-3 pr-4 py-2 border-l-4 text-base font-medium"
            }
            onClick={toggleMobileMenu}
          >
            Products
          </NavLink>
          <NavLink
            to="/billing/reports"
            className={({ isActive }) =>
              isActive
                ? "bg-blue-50 border-blue-500 text-blue-700 block pl-3 pr-4 py-2 border-l-4 text-base font-medium"
                : "border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700 block pl-3 pr-4 py-2 border-l-4 text-base font-medium"
            }
            onClick={toggleMobileMenu}
          >
            Reports
          </NavLink>
        </div>
      </div>
      </div>
    </nav>
  );
}

export default Navbar;
