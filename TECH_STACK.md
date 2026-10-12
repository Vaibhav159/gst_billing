# GST Billing Application Tech Stack

## Frontend
- **Framework**: React 18 with TypeScript, built by Vite 5
- **Data**: TanStack Query over one axios instance
- **Routing**: React Router 7; styling Tailwind 3.4
- **Package Manager**: npm

## Backend
- **Framework**: Django
- **API**: Django REST Framework
- **Authentication**: Django's built-in authentication
- **Database ORM**: Django ORM
- **Task Queue**: Celery (for background tasks)
- **Caching**: django-cacheops with Redis for intelligent query caching
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
- **Frontend Testing**: Vitest, React Testing Library, Playwright with axe
- **Backend Testing**: pytest, Django Test Framework
- **Coverage Reporting**: pytest-cov
- **E2E Testing**: Playwright

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
