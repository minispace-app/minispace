use axum::{
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
    middleware::Next,
    extract::Request,
    response::Response,
};

/// Validates that a slug only contains lowercase ASCII letters, digits and hyphens,
/// does not start or end with a hyphen, and is between 2 and 63 characters.
/// This prevents SQL injection via the tenant name used in format!() schema queries.
fn is_valid_slug(s: &str) -> bool {
    let len = s.len();
    len >= 2
        && len <= 63
        && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !s.starts_with('-')
        && !s.ends_with('-')
}

/// Extracts the tenant slug from the `X-Tenant` header or first subdomain.
#[derive(Debug, Clone)]
pub struct TenantSlug(pub String);

impl<S> FromRequestParts<S> for TenantSlug
where
    S: Send + Sync,
{
    type Rejection = (StatusCode, &'static str);

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        // 1. X-Tenant header
        if let Some(tenant) = parts
            .headers
            .get("X-Tenant")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_lowercase())
            .filter(|s| !s.is_empty())
        {
            if !is_valid_slug(&tenant) {
                return Err((StatusCode::BAD_REQUEST, "Invalid tenant identifier"));
            }
            return Ok(TenantSlug(tenant));
        }

        // 2. Subdomain from Host header
        if let Some(host) = parts.headers.get("Host").and_then(|v| v.to_str().ok()) {
            let domain = host.split(':').next().unwrap_or(host);
            let parts_vec: Vec<&str> = domain.split('.').collect();
            if parts_vec.len() >= 3 {
                let subdomain = parts_vec[0].to_lowercase();
                if subdomain != "www" && subdomain != "api" {
                    if !is_valid_slug(&subdomain) {
                        return Err((StatusCode::BAD_REQUEST, "Invalid tenant identifier"));
                    }
                    return Ok(TenantSlug(subdomain));
                }
            }
        }

        Err((StatusCode::BAD_REQUEST, "Missing X-Tenant header"))
    }
}

/// Middleware that ensures tenant resolution succeeds for protected routes.
pub async fn require_tenant(request: Request, next: Next) -> Result<Response, StatusCode> {
    let path = request.uri().path();
    if path.starts_with("/super-admin") || path.starts_with("/health") {
        return Ok(next.run(request).await);
    }

    let has_tenant = request.headers().contains_key("X-Tenant");
    if !has_tenant {
        let host = request
            .headers()
            .get("Host")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        let domain = host.split(':').next().unwrap_or(host);
        let parts: Vec<&str> = domain.split('.').collect();
        if parts.len() < 3 {
            return Err(StatusCode::BAD_REQUEST);
        }
    }

    Ok(next.run(request).await)
}
