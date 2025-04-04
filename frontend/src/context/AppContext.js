import React, { createContext, useContext, useState } from 'react';

// Create context
const AppContext = createContext();

// Custom hook to use the app context
export const useAppContext = () => useContext(AppContext);

// Provider component
export const AppProvider = ({ children }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Function to show loading indicator
  const showLoading = () => setLoading(true);
  
  // Function to hide loading indicator
  const hideLoading = () => setLoading(false);
  
  // Function to set error
  const setErrorMessage = (message) => setError(message);
  
  // Function to clear error
  const clearError = () => setError(null);
  
  // Value object to be provided to consumers
  const value = {
    loading,
    error,
    showLoading,
    hideLoading,
    setErrorMessage,
    clearError
  };
  
  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
};

export default AppContext;
