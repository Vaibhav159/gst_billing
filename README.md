# GST Billing Application

A comprehensive billing and invoice management system designed for Indian businesses, with built-in GST compliance and reporting features.

## 🚀 Features

- **Business Management**: Create and manage multiple businesses
- **Customer Management**: Maintain customer database with GST details
- **Invoice Generation**: Create GST-compliant invoices with automatic tax calculation
- **Product Catalog**: Manage products with HSN codes and tax rates
- **Reports**: Generate detailed reports for GST filing and business analytics
- **Responsive UI**: Modern React-based interface that works on desktop and mobile

## 📋 Project Status

The app UI is v3, the Vite/React app in `web/`, served by nginx in production since v3.0.0. Django serves only the API, the admin and the SQL explorer.

## 🛠️ Tech Stack

- **Frontend**: React, Tailwind CSS
- **Backend**: Django, Django REST Framework
- **Database**: PostgreSQL
- **Package Management**: pip (Python package manager)
- **Deployment**: Docker, Nginx
- **CI/CD**: CircleCI

For a detailed breakdown of the technology stack, see [TECH_STACK.md](TECH_STACK.md).

## 🗺️ Roadmap

See [PROJECT_ROADMAP.md](PROJECT_ROADMAP.md) for the detailed development roadmap and future plans.

## 🚀 Getting Started

### Prerequisites

#### Option 1: Using Docker (Recommended)
- Docker and Docker Compose

#### Option 2: Manual Setup
- Python 3.10+
- Node.js 16+
- PostgreSQL 13+

### Installation

1. Clone the repository
   ```bash
   git clone https://github.com/yourusername/gst-billing.git
   cd gst-billing
   ```

#### Option 1: Using Docker (Recommended)

1. Run the development server
   ```bash
   # Make the script executable
   chmod +x run_dev_pip.sh

   # Start the development environment
   ./run_dev_pip.sh
   ```

2. Access the application at http://localhost:8000

3. For production deployment
   ```bash
   # Make the script executable
   chmod +x deploy.sh

   # Start the production environment
   ./deploy.sh
   ```

4. Access the production deployment at http://localhost

#### Option 2: Manual Setup

1. Install dependencies with pip
   ```bash
   # Create a virtual environment
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate

   # Install the project and its dependencies
   pip install -e .
   ```

2. Set up the database
   ```bash
   python manage.py migrate
   ```

3. Start the API server
   ```bash
   python manage.py runserver
   ```

4. Start the frontend dev server (separate terminal)
   ```bash
   cd web
   npm ci
   npm run dev
   ```

5. Access the app at the Vite URL it prints (the dev server proxies `/api/` to `VITE_API_TARGET`; with a local runserver, start it as `VITE_API_TARGET=http://127.0.0.1:8000 npm run dev`)

### Managing Dependencies with pip

The project uses pyproject.toml for dependency management. To add or remove packages:

```bash
# Add a package
pip install <package_name>

# Update the project dependencies
pip install -e .

# Install development dependencies
pip install -e ".[dev]"
```

## 🧪 Running Tests

### Backend Tests
We use pytest for running tests with coverage reporting:

```bash
# Make sure you have the dev dependencies installed
pip install -e ".[dev]"

# Run tests with coverage
python -m pytest billing/tests/ --cov=billing
```

Alternatively, you can use Django's test runner:

```bash
python manage.py test
```

### Frontend Tests
```bash
cd web
npm test -- --run   # vitest unit tests
npm run typecheck
```

End-to-end tests (Playwright) live in `e2e-tests/` (`npx playwright test -c v3.config.js`); see `e2e-tests/AGENTS.md`.

### Continuous Integration
This project uses CircleCI for continuous integration. Every push to the repository triggers a build that runs all the tests with PostgreSQL. You can view the build status in the CircleCI dashboard.

[![CircleCI](https://dl.circleci.com/status-badge/img/gh/Vaibhav159/gst_billing/tree/main.svg?style=svg)](https://dl.circleci.com/status-badge/redirect/gh/Vaibhav159/gst_billing/tree/main)

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgements

- [Django](https://www.djangoproject.com/)
- [React](https://reactjs.org/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Django REST Framework](https://www.django-rest-framework.org/)
