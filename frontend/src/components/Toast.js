import React, { useEffect, useState } from 'react';

function Toast({ message, type = 'success', onClose }) {
  const [isVisible, setIsVisible] = useState(false);
  
  useEffect(() => {
    // Animate in
    setTimeout(() => setIsVisible(true), 10);
    
    // Auto-close after 5 seconds
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onClose, 300); // Wait for animation to complete
    }, 5000);
    
    return () => clearTimeout(timer);
  }, [onClose]);
  
  const bgColor = {
    'success': 'bg-green-500',
    'error': 'bg-red-500',
    'info': 'bg-blue-500'
  }[type];
  
  return (
    <div 
      className={`px-4 py-2 rounded-md shadow-lg text-white transition-all duration-300 transform ${isVisible ? '' : 'translate-x-full'} ${bgColor}`}
    >
      {message}
      <button 
        onClick={() => {
          setIsVisible(false);
          setTimeout(onClose, 300);
        }}
        className="ml-2 text-white hover:text-gray-200"
      >
        &times;
      </button>
    </div>
  );
}

export default Toast;
