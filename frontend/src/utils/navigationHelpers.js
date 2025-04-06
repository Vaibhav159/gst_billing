/**
 * Utility functions for navigation and row click handling
 */
import { useNavigate } from 'react-router-dom';

/**
 * Handle row click in list views
 * @param {Event} event - The click event
 * @param {string} baseUrl - The base URL to navigate to (e.g., '/billing/invoice/')
 * @param {string|number} id - The ID to append to the base URL
 * @param {Object} options - Additional options
 * @param {Array<string>} options.ignoreClasses - Classes to ignore clicks on (e.g., ['action-button'])
 * @param {Array<string>} options.ignoreElements - Elements to ignore clicks on (e.g., ['button', 'a'])
 * @param {Object} options.specialHandling - Special handling for specific data types
 * @param {Function} options.onBeforeNavigate - Function to call before navigation
 */
export const handleRowClick = (event, baseUrl, id, options = {}) => {
  const {
    ignoreClasses = ['action-button'],
    ignoreElements = ['button', 'a', 'input', 'select'],
    specialHandling = {},
    onBeforeNavigate = null
  } = options;

  // Check if click was on an element that should be ignored
  let target = event.target;

  // Traverse up the DOM tree to check if any parent element should be ignored
  while (target && target !== event.currentTarget) {
    // Check for ignored elements
    if (ignoreElements.includes(target.tagName.toLowerCase())) {
      return;
    }

    // Check for ignored classes
    for (const className of ignoreClasses) {
      if (target.classList.contains(className)) {
        return;
      }
    }

    // Check for special handling
    for (const [dataType, handler] of Object.entries(specialHandling)) {
      if (target.dataset && target.dataset.type === dataType) {
        handler(target.dataset.id);
        return;
      }
    }

    target = target.parentElement;
  }

  // If we get here, the click was not on an ignored element
  if (onBeforeNavigate) {
    onBeforeNavigate();
  }

  // Navigate to the detail view
  window.location.href = `${baseUrl}${id}`;
};

/**
 * React hook for row click handling
 * @param {string} baseUrl - The base URL to navigate to (e.g., '/billing/invoice/')
 * @param {Object} options - Additional options (see handleRowClick)
 * @returns {Function} - Function to handle row clicks
 */
export const useRowClick = (baseUrl, options = {}) => {
  const navigate = useNavigate();

  return (id, event) => {
    const enhancedOptions = {
      ...options,
      onBeforeNavigate: () => {
        if (options.onBeforeNavigate) {
          options.onBeforeNavigate();
        }
      }
    };

    // Create a new function for React Router navigation instead of modifying handleRowClick
    const handleRowClickWithNavigate = (event, baseUrl, id, options) => {
      // Check if click should be ignored (same logic as in handleRowClick)
      let target = event.target;
      const { ignoreClasses = [], ignoreElements = [], specialHandling = {} } = options;

      while (target && target !== event.currentTarget) {
        if (ignoreElements.includes(target.tagName.toLowerCase())) {
          return;
        }

        for (const className of ignoreClasses) {
          if (target.classList.contains(className)) {
            return;
          }
        }

        for (const [dataType, handler] of Object.entries(specialHandling)) {
          if (target.dataset && target.dataset.type === dataType) {
            handler(target.dataset.id);
            return;
          }
        }

        target = target.parentElement;
      }

      // If we get here, navigate
      if (options.onBeforeNavigate) {
        options.onBeforeNavigate();
      }

      navigate(`${baseUrl}${id}`);
    };

    // Use our new function instead
    handleRowClickWithNavigate(event, baseUrl, id, enhancedOptions);
  };
};
