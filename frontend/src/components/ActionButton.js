import React, { useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * ActionButton component for list view actions
 * 
 * @param {Object} props - Component props
 * @param {string} props.type - Button type: 'view', 'edit', 'print', 'delete', or 'custom'
 * @param {string} props.to - URL for Link buttons (view, edit, print)
 * @param {function} props.onClick - Click handler for button actions (delete, custom)
 * @param {string} props.label - Button label (used for tooltip and aria-label)
 * @param {string} props.customIcon - Custom SVG path for 'custom' type buttons
 * @param {string} props.customColor - Custom color class for 'custom' type buttons
 * @param {boolean} props.disabled - Whether the button is disabled
 * @param {string} props.className - Additional CSS classes
 */
function ActionButton({ 
  type, 
  to, 
  onClick, 
  label, 
  customIcon, 
  customColor,
  disabled = false,
  className = ''
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Define button styles based on type
  const getButtonStyles = () => {
    switch (type) {
      case 'view':
        return {
          baseClass: 'text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-300',
          icon: (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
              <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
            </svg>
          )
        };
      case 'edit':
        return {
          baseClass: 'text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300',
          icon: (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
            </svg>
          )
        };
      case 'print':
        return {
          baseClass: 'text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300',
          icon: (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a2 2 0 002 2h6a2 2 0 002-2v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a2 2 0 00-2-2H7a2 2 0 00-2 2zm8 0H7v3h6V4zm0 8H7v4h6v-4z" clipRule="evenodd" />
            </svg>
          )
        };
      case 'delete':
        return {
          baseClass: 'text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300',
          icon: (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          )
        };
      case 'custom':
        return {
          baseClass: customColor || 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300',
          icon: customIcon ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d={customIcon} clipRule="evenodd" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z" />
            </svg>
          )
        };
      default:
        return {
          baseClass: 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300',
          icon: (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z" />
            </svg>
          )
        };
    }
  };

  const { baseClass, icon } = getButtonStyles();
  const buttonClass = `${baseClass} p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-200 relative ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${className}`;

  // Handle delete confirmation
  const handleClick = (e) => {
    if (type === 'delete' && !showConfirm) {
      e.preventDefault();
      setShowConfirm(true);
      return;
    }
    
    if (onClick) {
      onClick(e);
    }
    
    setShowConfirm(false);
  };

  // Render confirmation dialog for delete action
  const renderConfirmation = () => {
    if (!showConfirm) return null;
    
    return (
      <div className="absolute z-10 right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg py-1 ring-1 ring-black ring-opacity-5 focus:outline-none">
        <p className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300">Are you sure?</p>
        <div className="flex justify-end px-4 py-2">
          <button
            className="mr-2 px-2 py-1 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
            onClick={(e) => {
              e.stopPropagation();
              setShowConfirm(false);
            }}
          >
            Cancel
          </button>
          <button
            className="px-2 py-1 text-xs text-white bg-red-600 hover:bg-red-700 rounded"
            onClick={(e) => {
              e.stopPropagation();
              if (onClick) onClick(e);
              setShowConfirm(false);
            }}
          >
            Delete
          </button>
        </div>
      </div>
    );
  };

  // Render tooltip
  const renderTooltip = () => {
    if (!showTooltip || showConfirm) return null;
    
    return (
      <div className="absolute z-10 -top-10 left-1/2 transform -translate-x-1/2 px-2 py-1 text-xs font-medium text-white bg-gray-900 rounded-md shadow-sm">
        {label}
        <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45"></div>
      </div>
    );
  };

  // Render button based on type
  const renderButton = () => {
    const buttonContent = (
      <>
        <span className="sr-only">{label}</span>
        {icon}
        {renderTooltip()}
        {type === 'delete' && renderConfirmation()}
      </>
    );

    if (['view', 'edit', 'print'].includes(type) && to) {
      return (
        <Link
          to={to}
          className={buttonClass}
          aria-label={label}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          {buttonContent}
        </Link>
      );
    }

    return (
      <button
        type="button"
        className={buttonClass}
        onClick={handleClick}
        disabled={disabled}
        aria-label={label}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {buttonContent}
      </button>
    );
  };

  return renderButton();
}

export default ActionButton;
