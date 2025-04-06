import React, { useState, useEffect, useRef } from 'react';

const SearchableDropdown = ({
  label,
  id,
  name,
  value,
  onChange,
  onSelect,
  placeholder,
  required,
  searchFunction,
  displayProperty = 'name',
  valueProperty = 'id',
  className = '',
  error = ''
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [options, setOptions] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Function to fetch all options
  const fetchAllOptions = async () => {
    try {
      setLoading(true);
      // Pass empty string to get all options
      const results = await searchFunction('');
      setOptions(results);
      // Show dropdown with all options
      setIsOpen(true);
    } catch (error) {
      console.error('Error fetching all options:', error);
    } finally {
      setLoading(false);
    }
  };

  // Search for options when searchTerm changes
  useEffect(() => {
    const fetchOptions = async () => {
      try {
        setLoading(true);
        const results = await searchFunction(searchTerm);
        setOptions(results);
      } catch (error) {
        console.error('Error searching options:', error);
      } finally {
        setLoading(false);
      }
    };

    // Always fetch options when dropdown is open
    if (isOpen) {
      const timeoutId = setTimeout(() => {
        fetchOptions();
      }, 300);

      return () => clearTimeout(timeoutId);
    }
  }, [searchTerm, searchFunction, isOpen]);

  const handleInputChange = (e) => {
    const value = e.target.value;
    setSearchTerm(value);
    onChange({ target: { name, value } });
  };

  const handleOptionSelect = (option) => {
    setSearchTerm(option[displayProperty]);
    // Use valueProperty for the value
    onChange({ target: { name, value: option[valueProperty] } });
    if (onSelect) {
      onSelect(option);
    }
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
          value={searchTerm || value}
          onChange={handleInputChange}
          onFocus={() => {
            setIsOpen(true);
            fetchAllOptions();
          }}
          placeholder={placeholder}
          required={required}
          className={`block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 ${
            error ? 'border-red-500 dark:border-red-600' : ''
          }`}
        />
        {loading && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-3">
            <svg className="animate-spin h-5 w-5 text-gray-400 dark:text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        )}
      </div>

      {isOpen && options.length > 0 && (
        <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 shadow-lg rounded-md py-1 text-base ring-1 ring-black ring-opacity-5 dark:ring-gray-700 overflow-auto max-h-60">
          {options.map((option) => (
            <div
              key={option[valueProperty]}
              className="cursor-pointer select-none relative py-2 pl-3 pr-9 hover:bg-primary-50 dark:hover:bg-primary-900/30 text-gray-900 dark:text-gray-200"
              onClick={() => handleOptionSelect(option)}
            >
              <div className="flex items-center">
                <span className="font-normal block truncate">{option[displayProperty]}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
};

export default SearchableDropdown;
