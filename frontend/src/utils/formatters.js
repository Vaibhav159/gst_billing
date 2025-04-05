/**
 * Formats a number to Indian currency format (with commas)
 * Example: 100000 -> 1,00,000
 * 
 * @param {number|string} amount - The amount to format
 * @param {boolean} withSymbol - Whether to include the ₹ symbol
 * @param {number} decimals - Number of decimal places
 * @returns {string} Formatted amount
 */
export const formatIndianCurrency = (amount, withSymbol = true, decimals = 2) => {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return withSymbol ? '₹0.00' : '0.00';
  }
  
  // Convert to number and fix decimal places
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  
  // Format with Indian number system (commas)
  const formatter = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
  
  const formattedAmount = formatter.format(numAmount);
  
  return withSymbol ? `₹${formattedAmount}` : formattedAmount;
};

/**
 * Formats a number with commas in Indian number system
 * Example: 100000 -> 1,00,000
 * 
 * @param {number|string} num - The number to format
 * @param {number} decimals - Number of decimal places
 * @returns {string} Formatted number
 */
export const formatIndianNumber = (num, decimals = 0) => {
  if (num === null || num === undefined || isNaN(num)) {
    return '0';
  }
  
  // Convert to number and fix decimal places
  const numValue = typeof num === 'string' ? parseFloat(num) : num;
  
  // Format with Indian number system (commas)
  const formatter = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
  
  return formatter.format(numValue);
};
