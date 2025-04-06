import React, { useState, useEffect, useRef } from 'react';
import { STATE_CHOICES } from '../utils/constants';

function StateDropdown({
  label,
  id,
  name,
  value,
  onChange,
  error,
  required = false,
  placeholder = 'Select a state',
  className = '',
  ...props
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [filteredOptions, setFilteredOptions] = useState(STATE_CHOICES);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef(null);

  // Set the display value based on the current value
  useEffect(() => {
    if (value) {
      const selectedState = STATE_CHOICES.find(state => state.value === value);
      if (selectedState) {
        setSearchTerm(selectedState.label);
      }
    } else {
      setSearchTerm('');
    }
  }, [value]);

  // Filter options based on search term
  useEffect(() => {
    if (searchTerm) {
      const filtered = STATE_CHOICES.filter(state =>
        state.label.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredOptions(filtered);
    } else {
      setFilteredOptions(STATE_CHOICES);
    }
  }, [searchTerm]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleInputChange = (e) => {
    setSearchTerm(e.target.value);
    setIsOpen(true);
  };

  const handleOptionSelect = (option) => {
    setSearchTerm(option.label);
    onChange({ target: { name, value: option.value } });
    setIsOpen(false);
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {label} {required && <span className="text-red-500 dark:text-red-400">*</span>}
        </label>
      )}
      <div className="relative">
        <input
          type="text"
          id={id}
          name={name}
          value={searchTerm}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className={`block w-full rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 ${
            error ? 'border-red-300 dark:border-red-600' : ''
          }`}
          {...props}
        />
        <button
          type="button"
          className="absolute inset-y-0 right-0 flex items-center pr-2 text-gray-400 dark:text-gray-500"
          onClick={() => setIsOpen(!isOpen)}
        >
          <svg
            className="h-5 w-5 text-gray-400 dark:text-gray-500"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M10 3a1 1 0 01.707.293l3 3a1 1 0 01-1.414 1.414L10 5.414 7.707 7.707a1 1 0 01-1.414-1.414l3-3A1 1 0 0110 3zm-3.707 9.293a1 1 0 011.414 0L10 14.586l2.293-2.293a1 1 0 011.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {isOpen && (
        <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 shadow-lg rounded-md py-1 text-base ring-1 ring-black ring-opacity-5 dark:ring-gray-700 overflow-auto max-h-60">
          {filteredOptions.length === 0 ? (
            <div className="cursor-default select-none relative py-2 pl-3 pr-9 text-gray-500 dark:text-gray-400">
              No states found
            </div>
          ) : (
            filteredOptions.map((option) => (
              <div
                key={option.value}
                className="cursor-pointer select-none relative py-2 pl-3 pr-9 hover:bg-primary-50 dark:hover:bg-primary-900/30 text-gray-900 dark:text-gray-200"
                onClick={() => handleOptionSelect(option)}
              >
                <div className="flex items-center">
                  <span className="font-normal block truncate">{option.label}</span>
                </div>
                {value === option.value && (
                  <span className="absolute inset-y-0 right-0 flex items-center pr-4 text-primary-600 dark:text-primary-400">
                    <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {error && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

export default StateDropdown;
