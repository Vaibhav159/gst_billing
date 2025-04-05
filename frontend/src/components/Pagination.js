import React from 'react';

function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  className = ''
}) {
  console.log('Pagination component rendering with:', { currentPage, totalPages });
  // Generate page numbers to display
  const getPageNumbers = () => {
    console.log('getPageNumbers called with:', { currentPage, totalPages });
    const pageNumbers = [];
    const maxPagesToShow = 5;

    // Safety check
    if (!totalPages || typeof totalPages !== 'number' || totalPages < 1) {
      console.warn('Invalid totalPages in getPageNumbers:', totalPages);
      return [1];
    }

    // Safety check for currentPage
    const safeCurrentPage = (!currentPage || typeof currentPage !== 'number' || currentPage < 1)
      ? 1
      : Math.min(currentPage, totalPages);

    if (totalPages <= maxPagesToShow) {
      // Show all pages if total pages is less than or equal to maxPagesToShow
      for (let i = 1; i <= totalPages; i++) {
        pageNumbers.push(i);
      }
    } else {
      // Always show first page
      pageNumbers.push(1);

      // Calculate start and end of middle pages
      let startPage = Math.max(2, safeCurrentPage - 1);
      let endPage = Math.min(totalPages - 1, safeCurrentPage + 1);

      // Adjust if we're at the beginning or end
      if (safeCurrentPage <= 2) {
        endPage = 3;
      } else if (safeCurrentPage >= totalPages - 1) {
        startPage = totalPages - 2;
      }

      // Add ellipsis after first page if needed
      if (startPage > 2) {
        pageNumbers.push('...');
      }

      // Add middle pages
      for (let i = startPage; i <= endPage; i++) {
        pageNumbers.push(i);
      }

      // Add ellipsis before last page if needed
      if (endPage < totalPages - 1) {
        pageNumbers.push('...');
      }

      // Always show last page
      pageNumbers.push(totalPages);
    }

    return pageNumbers;
  };

  // Don't render pagination if there's only one page
  console.log('Checking if pagination should render:', { totalPages, currentPage });
  if (!totalPages || !currentPage || totalPages <= 1 || typeof totalPages !== 'number' || typeof currentPage !== 'number') {
    console.log('Not rendering pagination (invalid props)');
    return null;
  }

  return (
    <nav className={`flex items-center justify-between border-t border-gray-200 px-4 sm:px-0 py-3 ${className}`}>
      <div className="hidden sm:block">
        <p className="text-sm text-gray-700">
          Showing page <span className="font-medium">{currentPage}</span> of{' '}
          <span className="font-medium">{totalPages}</span>
        </p>
      </div>
      <div className="flex-1 flex justify-between sm:justify-end">
        <button
          onClick={() => {
            console.log('Previous button clicked, calling onPageChange with:', currentPage - 1);
            if (typeof onPageChange === 'function') {
              onPageChange(currentPage - 1);
            } else {
              console.error('onPageChange is not a function:', onPageChange);
            }
          }}
          disabled={currentPage === 1}
          className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400"
        >
          Previous
        </button>
        <div className="hidden md:flex mx-2">
          {getPageNumbers().map((page, index) => (
            <React.Fragment key={index}>
              {page === '...' ? (
                <span className="relative inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700">
                  ...
                </span>
              ) : (
                <button
                  onClick={() => {
                    console.log('Page button clicked, calling onPageChange with:', page);
                    if (typeof onPageChange === 'function') {
                      onPageChange(page);
                    } else {
                      console.error('onPageChange is not a function:', onPageChange);
                    }
                  }}
                  className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium rounded-md ${
                    currentPage === page
                      ? 'z-10 bg-blue-50 border-blue-500 text-blue-600'
                      : 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50'
                  }`}
                >
                  {page}
                </button>
              )}
            </React.Fragment>
          ))}
        </div>
        <button
          onClick={() => {
            console.log('Next button clicked, calling onPageChange with:', currentPage + 1);
            if (typeof onPageChange === 'function') {
              onPageChange(currentPage + 1);
            } else {
              console.error('onPageChange is not a function:', onPageChange);
            }
          }}
          disabled={currentPage === totalPages}
          className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400"
        >
          Next
        </button>
      </div>
    </nav>
  );
}

export default Pagination;
