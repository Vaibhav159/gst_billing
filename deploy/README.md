# GST Billing - Split Deployment Guide

Deploys backend (Django API) on Oracle Cloud and frontend (React) on Cloudflare Pages / GitHub Pages.

## Folder Structure

```
deploy/
  backend/
    Dockerfile              # Backend-only Docker image (no frontend)
    docker-compose.yml      # Full stack: Django + Postgres + Redis
    .env.template           # Environment variables template
    production_settings_overlay.py  # Changes needed in production_settings.py
  frontend/
    AuthContext.tsx          # Improved auth (replaces src/contexts/AuthContext.tsx)
    api.ts                  # Configurable API URL (replaces src/utils/api.ts)
    vite-env.d.ts           # TypeScript env types (replaces src/vite-env.d.ts)
    build.sh                # Build script for static deployment
    _redirects              # Cloudflare Pages SPA routing
  patches/
    custom_jwt_serializer.py  # Add to billing/api/serializers.py
    custom_jwt_view.py        # Add to billing/api/views.py
    urls_patch.py             # URL routing changes needed
```

---

## Step 1: Apply Auth Improvements

These changes add username to JWT tokens and fix token expiration handling.

### Backend (in billing/api/)

1. **Add custom JWT serializer** - copy contents of `patches/custom_jwt_serializer.py` into `billing/api/serializers.py`

2. **Add custom JWT view** - copy contents of `patches/custom_jwt_view.py` into `billing/api/views.py`

3. **Update URL routing** - in `billing/api/urls.py` line 47, change:
   ```python
   # FROM:
   path("token/", TokenObtainPairView.as_view(), name="token_obtain_pair"),
   # TO:
   path("token/", CustomTokenObtainPairView.as_view(), name="token_obtain_pair"),
   ```
   Update imports accordingly.

### Frontend (in sweet-rebuild-suite-main/src/)

4. **Replace** `src/contexts/AuthContext.tsx` with `deploy/frontend/AuthContext.tsx`
5. **Replace** `src/utils/api.ts` with `deploy/frontend/api.ts`
6. **Replace** `src/vite-env.d.ts` with `deploy/frontend/vite-env.d.ts`

---

## Step 2: Apply Production Settings

Apply changes from `deploy/backend/production_settings_overlay.py` to `gst_billing/production_settings.py`:

1. Make `ALLOWED_HOSTS` env-driven
2. Remove `"frontend"` from `INSTALLED_APPS`
3. Add WhiteNoise middleware (after SecurityMiddleware)
4. Make CORS origins env-driven
5. Add `STATICFILES_STORAGE` for WhiteNoise

Also in `gst_billing/urls.py`, make the frontend catch-all conditional:
```python
# Change:
urlpatterns += [path("", include("frontend.urls"))]
# To:
if "frontend" in settings.INSTALLED_APPS:
    urlpatterns += [path("", include("frontend.urls"))]
```

---

## Step 3: Deploy Backend on Oracle Cloud

```bash
# 1. SSH into Oracle Cloud instance
# 2. Clone the repo
# 3. Set up environment
cd deploy/backend
cp .env.template .env
# Edit .env with your values (secret key, passwords, CORS origins)

# 4. Build and run
docker compose up -d --build

# 5. Verify
curl http://localhost:8000/api/token/verify/
```

The API will be available at `http://your-oracle-ip:8000/api/`.

For HTTPS, put a reverse proxy (Caddy, Nginx, or Oracle Load Balancer) in front.

---

## Step 4: Deploy Frontend

### Option A: Cloudflare Pages

1. Connect your GitHub repo to Cloudflare Pages
2. Set build settings:
   - **Build command:** `cd sweet-rebuild-suite-main && npm ci && npm run build`
   - **Build output directory:** `sweet-rebuild-suite-main/dist`
   - **Environment variable:** `VITE_API_BASE_URL=https://your-backend-domain/api/`
3. Copy `_redirects` to `sweet-rebuild-suite-main/public/` before building

### Option B: GitHub Pages

```bash
# Build locally or in GitHub Actions
cd deploy/frontend
./build.sh https://your-backend-domain/api/

# Deploy dist/ to gh-pages branch
cd ../../sweet-rebuild-suite-main
npx gh-pages -d dist
```

### Option C: Manual build

```bash
cd sweet-rebuild-suite-main
VITE_API_BASE_URL=https://your-backend-domain/api/ npm run build
# Upload dist/ folder to any static host
```

---

## Environment Variables Reference

### Backend (.env)
| Variable | Required | Description |
|----------|----------|-------------|
| `DJANGO_SECRET_KEY` | Yes | Django secret key |
| `DB_PASSWORD` | Yes | PostgreSQL password |
| `CORS_ALLOWED_ORIGINS` | Yes | Frontend URL(s), comma-separated |
| `ALLOWED_HOSTS` | Yes | Backend domain(s), comma-separated |
| `DEBUG` | No | `False` for production |
| `DJANGO_SUPERUSER_PASSWORD` | Yes | Initial admin password |

### Frontend (build-time)
| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_BASE_URL` | Yes | Full backend API URL (e.g., `https://api.example.com/api/`) |

---

## Verification Checklist

- [ ] Backend responds to `GET /api/` 
- [ ] Login works: `POST /api/token/` returns access + refresh tokens
- [ ] JWT contains `username` claim (decode at jwt.io)
- [ ] Frontend loads and can login cross-origin
- [ ] CORS headers present on API responses
- [ ] Page refresh on deep routes (e.g., `/billing/invoice/list`) loads the app
- [ ] Django admin accessible at `/admin/`
