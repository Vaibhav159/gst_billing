import React from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

// Register ChartJS components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

/**
 * Reusable Bar Chart component
 * @param {Object} props - Component props
 * @param {Object} props.data - Chart data
 * @param {Object} props.options - Chart options
 * @param {string} props.className - Additional CSS classes
 * @param {number} props.height - Chart height
 * @returns {JSX.Element} - Bar Chart component
 */
function BarChart({ data, options = {}, className = '', height = 300 }) {
  // Default options with dark mode support
  const defaultOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          color: document.documentElement.classList.contains('dark') ? '#e5e7eb' : '#374151',
          font: {
            family: "'Inter', sans-serif",
            size: 12
          }
        }
      },
      title: {
        display: false,
      },
      tooltip: {
        backgroundColor: document.documentElement.classList.contains('dark') ? '#1f2937' : '#ffffff',
        titleColor: document.documentElement.classList.contains('dark') ? '#e5e7eb' : '#111827',
        bodyColor: document.documentElement.classList.contains('dark') ? '#d1d5db' : '#374151',
        borderColor: document.documentElement.classList.contains('dark') ? '#374151' : '#e5e7eb',
        borderWidth: 1,
        padding: 12,
        cornerRadius: 8,
        titleFont: {
          family: "'Inter', sans-serif",
          size: 14,
          weight: 'bold'
        },
        bodyFont: {
          family: "'Inter', sans-serif",
          size: 13
        },
        displayColors: true,
        boxPadding: 4
      }
    },
    scales: {
      x: {
        grid: {
          color: document.documentElement.classList.contains('dark') ? 'rgba(75, 85, 99, 0.2)' : 'rgba(209, 213, 219, 0.2)',
        },
        ticks: {
          color: document.documentElement.classList.contains('dark') ? '#9ca3af' : '#6b7280',
          font: {
            family: "'Inter', sans-serif",
            size: 11
          }
        }
      },
      y: {
        grid: {
          color: document.documentElement.classList.contains('dark') ? 'rgba(75, 85, 99, 0.2)' : 'rgba(209, 213, 219, 0.2)',
        },
        ticks: {
          color: document.documentElement.classList.contains('dark') ? '#9ca3af' : '#6b7280',
          font: {
            family: "'Inter', sans-serif",
            size: 11
          }
        }
      }
    }
  };

  // Merge default options with provided options
  const mergedOptions = { ...defaultOptions, ...options };

  return (
    <div className={`w-full ${className}`} style={{ height }}>
      <Bar data={data} options={mergedOptions} />
    </div>
  );
}

export default BarChart;
