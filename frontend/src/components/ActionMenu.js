import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';

/**
 * ActionMenu component for grouping action buttons in a dropdown menu
 * 
 * @param {Object} props - Component props
 * @param {Array} props.actions - Array of action objects
 * @param {string} props.className - Additional CSS classes
 */
function ActionMenu({ actions, className = '' }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Toggle menu
  const toggleMenu = () => {
    setIsOpen(!isOpen);
  };

  // Handle action click
  const handleActionClick = (action) => {
    if (action.onClick) {
      action.onClick();
    }
    setIsOpen(false);
  };

  return (
    <div className={`relative ${className}`} ref={menuRef}>
      <button
        type="button"
        className="p-2 rounded-full text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none"
        onClick={toggleMenu}
        aria-label="Actions"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute z-10 right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg py-1 ring-1 ring-black ring-opacity-5 focus:outline-none">
          {actions.map((action, index) => {
            // Determine icon based on action type
            let icon;
            let textColorClass;
            
            switch (action.type) {
              case 'view':
                icon = (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                    <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                  </svg>
                );
                textColorClass = 'text-primary-600 dark:text-primary-400';
                break;
              case 'edit':
                icon = (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                  </svg>
                );
                textColorClass = 'text-indigo-600 dark:text-indigo-400';
                break;
              case 'print':
                icon = (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a2 2 0 002 2h6a2 2 0 002-2v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a2 2 0 00-2-2H7a2 2 0 00-2 2zm8 0H7v3h6V4zm0 8H7v4h6v-4z" clipRule="evenodd" />
                  </svg>
                );
                textColorClass = 'text-green-600 dark:text-green-400';
                break;
              case 'delete':
                icon = (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                );
                textColorClass = 'text-red-600 dark:text-red-400';
                break;
              default:
                icon = action.icon || null;
                textColorClass = action.textColorClass || 'text-gray-700 dark:text-gray-300';
            }

            const itemClass = `flex items-center px-4 py-2 text-sm ${textColorClass} hover:bg-gray-100 dark:hover:bg-gray-700 ${action.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`;

            // Render link or button based on action type
            if (action.to && !action.disabled) {
              return (
                <Link
                  key={index}
                  to={action.to}
                  className={itemClass}
                  onClick={() => setIsOpen(false)}
                >
                  {icon}
                  {action.label}
                </Link>
              );
            }

            if (action.type === 'delete') {
              return (
                <button
                  key={index}
                  type="button"
                  className={itemClass}
                  onClick={() => {
                    if (window.confirm('Are you sure you want to delete this item?')) {
                      handleActionClick(action);
                    }
                  }}
                  disabled={action.disabled}
                >
                  {icon}
                  {action.label}
                </button>
              );
            }

            return (
              <button
                key={index}
                type="button"
                className={itemClass}
                onClick={() => handleActionClick(action)}
                disabled={action.disabled}
              >
                {icon}
                {action.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ActionMenu;
