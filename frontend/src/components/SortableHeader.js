import React from 'react';

/**
 * SortableHeader component for table headers that can be sorted
 * @param {Object} props - Component props
 * @param {string} props.label - Header label
 * @param {string} props.field - Field name for sorting
 * @param {string} props.currentSortField - Current sort field
 * @param {string} props.currentSortDirection - Current sort direction ('asc' or 'desc')
 * @param {Function} props.onSort - Function to call when header is clicked
 * @param {string} props.className - Additional CSS classes
 * @returns {JSX.Element} - Sortable header component
 */
function SortableHeader({ 
  label, 
  field, 
  currentSortField, 
  currentSortDirection, 
  onSort,
  className = ''
}) {
  // Determine if this header is currently being sorted
  const isSorted = currentSortField === field;
  
  // Handle click on header
  const handleClick = () => {
    // If not sorted, sort ascending
    // If sorted ascending, sort descending
    // If sorted descending, remove sorting
    if (!isSorted) {
      onSort(field, 'asc');
    } else if (currentSortDirection === 'asc') {
      onSort(field, 'desc');
    } else {
      onSort(null, null);
    }
  };
  
  // Render sort indicator
  const renderSortIndicator = () => {
    if (!isSorted) {
      return (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      );
    } else if (currentSortDirection === 'asc') {
      return (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-primary-500 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      );
    } else {
      return (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-primary-500 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      );
    }
  };
  
  return (
    <th 
      scope="col" 
      className={`px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer group ${className} ${isSorted ? 'bg-gray-100 dark:bg-gray-700' : ''}`}
      onClick={handleClick}
    >
      <div className="flex items-center space-x-1">
        <span>{label}</span>
        {renderSortIndicator()}
      </div>
    </th>
  );
}

export default SortableHeader;
