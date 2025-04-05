import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import authService from '../api/authService';
import Card from '../components/Card';
import Button from '../components/Button';
import FormInput from '../components/FormInput';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();

  // Get the redirect path from location state or default to dashboard
  const from = location.state?.from?.pathname || '/';

  const handleSubmit = async (e) => {
    e.preventDefault();
    console.log('Login form submitted');

    if (!username || !password) {
      setError('Please enter both username and password');
      console.warn('Login form validation failed: missing username or password');
      return;
    }

    try {
      setLoading(true);
      setError('');
      console.log('Attempting login for user:', username);

      const result = await authService.login(username, password);
      console.log('Login successful, received tokens:', result ? 'Yes' : 'No');

      // Check if token is in localStorage after login
      const token = localStorage.getItem('access_token');
      console.log('Token in localStorage after login:', token ? 'Present' : 'Not found');

      // Redirect to the page the user was trying to access
      console.log('Redirecting to:', from);
      navigate(from, { replace: true });
    } catch (err) {
      console.error('Login component error:', err);

      if (err.response && err.response.status === 401) {
        setError('Invalid username or password');
        console.warn('Login failed: Invalid credentials');
      } else {
        setError('An error occurred during login. Please try again.');
        console.error('Login failed with error:', err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h2 className="mt-6 text-3xl font-extrabold text-gray-900">Sign in to your account</h2>
        </div>

        <Card>
          <div className="p-6">
            {error && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                {error}
              </div>
            )}

            <form className="space-y-6" onSubmit={handleSubmit}>
              <FormInput
                label="Username"
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />

              <FormInput
                label="Password"
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />

              <div>
                <Button
                  type="submit"
                  variant="primary"
                  className="w-full"
                  disabled={loading}
                >
                  {loading ? 'Signing in...' : 'Sign in'}
                </Button>
              </div>
            </form>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default Login;
