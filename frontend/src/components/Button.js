import React from 'react';

function Button({
  children,
  type = 'button',
  variant = 'primary',
  size = 'md',
  className = '',
  disabled = false,
  onClick,
  icon,
  iconPosition = 'left',
  ...props
}) {
  // Base classes
  const baseClasses = 'btn-modern inline-flex items-center justify-center font-medium shadow-sm';

  // Size classes
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm rounded-lg',
    md: 'px-4 py-2 text-sm rounded-lg',
    lg: 'px-6 py-3 text-base rounded-xl'
  };

  // Variant classes
  const variantClasses = {
    primary: 'text-white bg-primary-600 hover:bg-primary-700 focus:ring-primary-500 disabled:bg-primary-300 dark:bg-primary-700 dark:hover:bg-primary-600',
    secondary: 'text-primary-700 bg-primary-100 hover:bg-primary-200 focus:ring-primary-500 disabled:bg-primary-50 disabled:text-primary-400 dark:bg-primary-900 dark:text-primary-300 dark:hover:bg-primary-800',
    danger: 'text-white bg-red-600 hover:bg-red-700 focus:ring-red-500 disabled:bg-red-300 dark:bg-red-700 dark:hover:bg-red-600',
    success: 'text-white bg-green-600 hover:bg-green-700 focus:ring-green-500 disabled:bg-green-300 dark:bg-green-700 dark:hover:bg-green-600',
    outline: 'text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 focus:ring-primary-500 disabled:text-gray-400 dark:text-gray-200 dark:bg-gray-800 dark:border-gray-600 dark:hover:bg-gray-700'
  };

  const classes = `${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${className}`;

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled}
      onClick={onClick}
      {...props}
    >
      {icon && iconPosition === 'left' && <span className="mr-2">{icon}</span>}
      {children}
      {icon && iconPosition === 'right' && <span className="ml-2">{icon}</span>}
    </button>
  );
}

export default Button;
