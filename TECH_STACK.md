# GST Billing Application Tech Stack

## Frontend
- **Framework**: React (migrating from HTMX)
- **State Management**: React Hooks (useState, useEffect, useContext)
- **Routing**: React Router
- **Styling**: Tailwind CSS
- **HTTP Client**: Axios
- **Build Tool**: Webpack
- **Package Manager**: npm

## Backend
- **Framework**: Django
- **API**: Django REST Framework
- **Authentication**: Django's built-in authentication
- **Database ORM**: Django ORM
- **Task Queue**: Celery (for background tasks)
- **Caching**: Django's built-in caching
- **Package Manager**: uv (preferred over pip)

## Database
- **Primary Database**: PostgreSQL
- **Migrations**: Django Migrations
- **Query Explorer**: Django SQL Explorer

## Infrastructure
- **Deployment**: Docker containers
- **Web Server**: Gunicorn + Nginx
- **Package Management**: uv (fast Python package manager written in Rust)
- **Version Control**: Git
- **CI/CD**: CircleCI

## Development Tools
- **Code Editor**: VS Code
- **Virtual Environments**: uv venv (for creating and managing virtual environments)
- **API Testing**: Postman
- **Linting**: ESLint (JavaScript), Flake8 (Python)
- **Formatting**: Prettier (JavaScript), Black (Python)
- **Documentation**: Markdown

## Testing
- **Frontend Testing**: Jest, React Testing Library
- **Backend Testing**: pytest, Django Test Framework
- **Coverage Reporting**: pytest-cov
- **E2E Testing**: Cypress

## Monitoring & Analytics
- **Error Tracking**: Sentry
- **Performance Monitoring**: Django Debug Toolbar
- **Analytics**: Google Analytics

## Third-Party Services
- **Email**: SMTP service
- **Storage**: Local file system (with plans to move to S3-compatible storage)
- **PDF Generation**: WeasyPrint

## Security
- **Authentication**: Session-based authentication
- **Authorization**: Django's permission system
- **CSRF Protection**: Django's built-in CSRF protection
- **Content Security Policy**: Django CSP

## Compliance
- **GST Compliance**: Built-in GST calculation and reporting
- **Data Protection**: GDPR-compliant data handling

## Future Considerations
- **Mobile App**: React Native
- **Payment Processing**: Razorpay/Stripe integration
- **E-invoicing**: Integration with government e-invoicing system
- **Internationalization**: i18n support for multiple languages
