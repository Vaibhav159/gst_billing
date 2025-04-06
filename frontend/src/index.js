import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter as Router } from 'react-router-dom';
import App from './App';
import './index.css';

// Find the root element
const container = document.getElementById('react-app');

// Create a root
if (container) {
  const root = createRoot(container);
  
  // Render the app
  root.render(
    <React.StrictMode>
      <Router>
        <App />
      </Router>
    </React.StrictMode>
  );
}
