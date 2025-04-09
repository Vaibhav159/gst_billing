# Caching Strategy

This document outlines the caching strategy implemented in the GST Billing application to improve API performance.

## Overview

We use `django-cacheops` for intelligent caching of database queries. This provides:

1. Automatic cache invalidation when models are updated
2. Query-based caching rather than view-based caching
3. Proper handling of complex queries and related objects
4. Minimal code changes required

## Configuration

### Development Environment

In the development environment, cacheops is configured to use a local Redis instance:

```python
# Cacheops configuration
CACHEOPS_REDIS = {
    'host': 'localhost',
    'port': 6379,
    'db': 1,
    'socket_timeout': 3,
}

CACHEOPS_DEFAULTS = {
    'timeout': 60 * 15,  # 15 minutes default cache timeout
    'cache_on_save': True,
    'invalidate_on_save': True,
}
```

### Production Environment

In production, cacheops uses the Redis instance specified by environment variables:

```python
CACHEOPS_REDIS = {
    'host': os.environ.get('REDIS_HOST', 'redis'),
    'port': int(os.environ.get('REDIS_PORT', 6379)),
    'db': 2,
    'socket_timeout': 3,
}
```

### Model Cache Timeouts

Different models have different cache timeouts based on their update frequency:

| Model | Development Timeout | Production Timeout |
|-------|---------------------|-------------------|
| Business | 1 hour | 2 hours |
| Customer | 30 minutes | 1 hour |
| Product | 1 hour | 2 hours |
| Invoice | 15 minutes | 30 minutes |
| LineItem | 15 minutes | 30 minutes |

## How It Works

1. **Query Caching**: When a database query is executed, cacheops checks if the same query has been cached. If so, it returns the cached result.

2. **Automatic Invalidation**: When a model instance is saved or deleted, cacheops automatically invalidates all cached queries that involve that model.

3. **Related Model Invalidation**: When a model is updated, cacheops also invalidates caches for related models.

## Benefits

- **Improved API Performance**: Frequently accessed data is served from cache, reducing database load.
- **Automatic Cache Invalidation**: No need to manually invalidate caches when data changes.
- **Transparent Operation**: Works with existing code without major modifications.

## Debugging

To debug caching issues, you can:

1. **Check Redis**: Use `redis-cli` to inspect cached data:
   ```
   redis-cli -n 1  # Connect to DB 1 (development)
   KEYS *          # List all keys
   ```

2. **Disable Caching Temporarily**: Set `CACHEOPS_ENABLED = False` in settings to disable caching.

3. **Monitor Cache Hit Rate**: Use Redis monitoring tools to track cache hit/miss rates.

## Maintenance

- **Clear All Caches**: To clear all caches, run:
  ```python
  from cacheops import invalidate_all
  invalidate_all()
  ```

- **Clear Specific Model Cache**: To clear cache for a specific model:
  ```python
  from cacheops import invalidate_model
  from billing.models import Invoice
  invalidate_model(Invoice)
  ```
