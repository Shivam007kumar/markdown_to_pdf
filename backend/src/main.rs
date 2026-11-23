use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::Json,
    routing::{get, post},
    Router,
};
use rand::Rng;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, sync::Arc, time::SystemTime};
use tower_http::{
    cors::{Any, CorsLayer},
    limit::RequestBodyLimitLayer,
    trace::TraceLayer,
};
use tracing_subscriber::EnvFilter;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct Config {
    host: String,
    port: u16,
    redis_url: String,
    share_ttl_seconds: u64,
    max_body_bytes: usize,
    rate_limit_per_min: u64,
}

impl Config {
    fn from_env() -> Self {
        Self {
            host: std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
            port: std::env::var("PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(8000),
            redis_url: std::env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string()),
            share_ttl_seconds: std::env::var("SHARE_TTL_SECONDS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(604_800),
            max_body_bytes: std::env::var("MAX_BODY_BYTES")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(524_288),
            rate_limit_per_min: std::env::var("RATE_LIMIT_PER_MIN")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(20),
        }
    }
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct AppState {
    redis: redis::aio::ConnectionManager,
    config: Arc<Config>,
}

// ---------------------------------------------------------------------------
// Sanitization helpers
// ---------------------------------------------------------------------------

/// Strip null bytes and ASCII control characters (except normal whitespace).
fn strip_control_chars(s: &str) -> String {
    s.chars()
        .filter(|&c| {
            // Keep normal whitespace (space, tab, newline, carriage return)
            if c == '\t' || c == '\n' || c == '\r' || c == ' ' {
                return true;
            }
            // Keep all non-control chars (>= 0x20) and non-DEL
            (c as u32) >= 0x20 && (c as u32) != 0x7F
        })
        .collect()
}

/// Sanitize a title: strip control chars, strip HTML angle-bracket tags,
/// strip <script ... and javascript: URI patterns, then trim and clamp.
fn sanitize_title(raw: &str) -> String {
    let s = strip_control_chars(raw);
    // Strip HTML angle brackets (remove anything that looks like an HTML tag)
    let s = regex_replace_html_tags(&s);
    // Strip javascript: URI (case-insensitive) anywhere in the string
    let s = strip_javascript_uri(&s);
    let s = s.trim().to_string();
    // Clamp to 120 chars (char boundary safe)
    clamp_chars(&s, 120)
}

/// Remove HTML-like tags (content between < and >) from title.
/// This handles <script>, <img>, etc. safely.
fn regex_replace_html_tags(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut inside_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => {
                inside_tag = true;
            }
            '>' => {
                inside_tag = false;
            }
            _ => {
                if !inside_tag {
                    result.push(ch);
                }
            }
        }
    }
    result
}

/// Remove javascript: URI patterns (case-insensitive).
fn strip_javascript_uri(s: &str) -> String {
    // Simple case-insensitive replacement
    let lower = s.to_lowercase();
    if !lower.contains("javascript:") {
        return s.to_string();
    }
    // Walk the string removing javascript: occurrences
    let mut result = String::with_capacity(s.len());
    let mut i = 0;
    let bytes = s.as_bytes();
    let len = bytes.len();
    while i < len {
        // Check if we're at a javascript: prefix (case-insensitive)
        if i + 11 <= len {
            let chunk = &s[i..i + 11];
            if chunk.to_lowercase() == "javascript:" {
                i += 11;
                continue;
            }
        }
        result.push(bytes[i] as char);
        i += 1;
    }
    result
}

/// Sanitize CSS: block dangerous patterns while leaving safe CSS intact.
/// Blocks: @import, expression(, javascript:, url(http...), url(//)
fn sanitize_css(raw: &str) -> String {
    let s = strip_control_chars(raw);
    let lower = s.to_lowercase();

    // If none of the dangerous patterns are present, return as-is
    if !lower.contains("@import")
        && !lower.contains("expression(")
        && !lower.contains("javascript:")
        && !lower.contains("url(http")
        && !lower.contains("url(//")
        && !lower.contains("url('http")
        && !lower.contains("url(\"http")
        && !lower.contains("url('//")
        && !lower.contains("url(\"//")
    {
        return s;
    }

    // Process line by line, stripping lines/blocks with dangerous content
    let lines: Vec<&str> = s.lines().collect();
    let mut result = Vec::with_capacity(lines.len());
    for line in lines {
        let ll = line.to_lowercase();
        if ll.contains("@import")
            || ll.contains("expression(")
            || ll.contains("javascript:")
            || is_external_url_in_css(&ll)
        {
            // Drop this line entirely
            continue;
        }
        result.push(line);
    }
    result.join("\n")
}

fn is_external_url_in_css(lower_line: &str) -> bool {
    // Match url(http...) url(//...) with optional quotes
    if lower_line.contains("url(http") || lower_line.contains("url(//") {
        return true;
    }
    // With quotes: url('http  url("http  url('//  url("//
    if lower_line.contains("url('http")
        || lower_line.contains("url(\"http")
        || lower_line.contains("url('//")
        || lower_line.contains("url(\"//")
    {
        return true;
    }
    false
}

fn clamp_chars(s: &str, max_chars: usize) -> String {
    let mut end = s.len();
    let mut count = 0;
    for (idx, _) in s.char_indices() {
        if count >= max_chars {
            end = idx;
            break;
        }
        count += 1;
    }
    if count < max_chars {
        s.to_string()
    } else {
        s[..end].to_string()
    }
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

const ID_CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

pub fn generate_id() -> String {
    let mut rng = rand::thread_rng();
    (0..12)
        .map(|_| {
            let idx = rng.gen_range(0..ID_CHARSET.len());
            ID_CHARSET[idx] as char
        })
        .collect()
}

pub fn validate_id(id: &str) -> bool {
    id.len() == 12 && id.bytes().all(|b| b.is_ascii_alphanumeric())
}

// ---------------------------------------------------------------------------
// Compression
// ---------------------------------------------------------------------------

pub fn compress(data: &[u8]) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    Ok(zstd::encode_all(data, 3)?)
}

pub fn decompress(data: &[u8]) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    Ok(zstd::decode_all(data)?)
}

// ---------------------------------------------------------------------------
// IP extraction
// ---------------------------------------------------------------------------

fn extract_client_ip(headers: &HeaderMap, peer_addr: Option<&str>) -> String {
    // CF-Connecting-IP first
    if let Some(ip) = headers
        .get("CF-Connecting-IP")
        .and_then(|v| v.to_str().ok())
    {
        let ip = ip.trim();
        if !ip.is_empty() {
            return ip.to_string();
        }
    }
    // X-Forwarded-For: take the first value
    if let Some(xff) = headers
        .get("X-Forwarded-For")
        .and_then(|v| v.to_str().ok())
    {
        if let Some(first) = xff.split(',').next() {
            let ip = first.trim();
            if !ip.is_empty() {
                return ip.to_string();
            }
        }
    }
    // Fall back to peer socket address
    peer_addr.unwrap_or("unknown").to_string()
}

// ---------------------------------------------------------------------------
// Stored payload
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
struct StoredPayload {
    title: String,
    markdown: String,
    custom_css: String,
    created_at: u64,
}

// ---------------------------------------------------------------------------
// Request/response types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct ShareRequest {
    #[serde(default = "default_title")]
    title: String,
    markdown: String,
    #[serde(default)]
    custom_css: String,
}

fn default_title() -> String {
    "Untitled".to_string()
}

#[derive(Serialize)]
struct ShareCreatedResponse {
    id: String,
    expires_in: u64,
}

#[derive(Serialize)]
struct ShareGetResponse {
    id: String,
    title: String,
    markdown: String,
    custom_css: String,
    created_at: u64,
    ttl_seconds: i64,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    redis: &'static str,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async fn health_handler(State(state): State<AppState>) -> (StatusCode, Json<HealthResponse>) {
    let mut conn = state.redis.clone();
    let result: redis::RedisResult<String> = redis::cmd("PING").query_async(&mut conn).await;
    match result {
        Ok(_) => (
            StatusCode::OK,
            Json(HealthResponse {
                status: "ok",
                redis: "ok",
            }),
        ),
        Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(HealthResponse {
                status: "degraded",
                redis: "unavailable",
            }),
        ),
    }
}

async fn share_post_handler(
    State(state): State<AppState>,
    axum::extract::ConnectInfo(peer): axum::extract::ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    body: axum::extract::Json<ShareRequest>,
) -> Result<(StatusCode, Json<ShareCreatedResponse>), (StatusCode, Json<ErrorResponse>)> {
    let req = body.0;

    // --- Validation ---
    if req.markdown.is_empty() {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(ErrorResponse {
                error: "markdown must not be empty".to_string(),
            }),
        ));
    }
    if req.markdown.len() > 400 * 1024 {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(ErrorResponse {
                error: "markdown exceeds 400 KB limit".to_string(),
            }),
        ));
    }
    if req.custom_css.len() > 100 * 1024 {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(ErrorResponse {
                error: "custom_css exceeds 100 KB limit".to_string(),
            }),
        ));
    }

    // --- Sanitization ---
    let title = sanitize_title(&req.title);
    if title.is_empty() {
        // If sanitization strips everything, use default
    }
    let title = if title.is_empty() {
        "Untitled".to_string()
    } else {
        title
    };

    // Markdown is left untouched — the client renders it in a sandboxed iframe
    let markdown = req.markdown;

    // Sanitize CSS (block dangerous patterns)
    let custom_css = sanitize_css(&req.custom_css);

    // --- Rate limiting ---
    let peer_ip = peer.ip().to_string();
    let client_ip = extract_client_ip(&headers, Some(&peer_ip));
    let rate_key = format!("rate:{}:{}", client_ip, current_minute());
    let mut conn = state.redis.clone();

    let count: redis::RedisResult<u64> = conn.incr(&rate_key, 1u64).await;
    match count {
        Ok(n) => {
            if n == 1 {
                // Set expiry on first increment
                let _: redis::RedisResult<bool> = conn.expire(&rate_key, 60).await;
            }
            if n > state.config.rate_limit_per_min {
                return Err((
                    StatusCode::TOO_MANY_REQUESTS,
                    Json(ErrorResponse {
                        error: "rate limit exceeded".to_string(),
                    }),
                ));
            }
        }
        Err(_) => {
            // Redis error during rate check — fail open (allow the request)
            tracing::warn!("Redis error during rate limit check for IP {}", client_ip);
        }
    }

    // --- Store ---
    let created_at = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let payload = StoredPayload {
        title,
        markdown,
        custom_css,
        created_at,
    };

    let json_bytes = serde_json::to_vec(&payload).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("serialization error: {}", e),
            }),
        )
    })?;

    let compressed = compress(&json_bytes).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("compression error: {}", e),
            }),
        )
    })?;

    let id = generate_id();
    let redis_key = format!("share:{}", id);
    let ttl = state.config.share_ttl_seconds as usize;

    conn.set_ex::<_, _, ()>(&redis_key, compressed, ttl as u64)
        .await
        .map_err(|e| {
            tracing::error!("Redis write error for share {}: {}", id, e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "storage error".to_string(),
                }),
            )
        })?;

    Ok((
        StatusCode::CREATED,
        Json(ShareCreatedResponse {
            id,
            expires_in: state.config.share_ttl_seconds,
        }),
    ))
}

async fn share_get_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ShareGetResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Validate ID
    if !validate_id(&id) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "invalid share id".to_string(),
            }),
        ));
    }

    let redis_key = format!("share:{}", id);
    let mut conn = state.redis.clone();

    // Fetch value and TTL in parallel
    let data: redis::RedisResult<Option<Vec<u8>>> = conn.get(&redis_key).await;
    let ttl: redis::RedisResult<i64> = conn.ttl(&redis_key).await;

    let data = match data {
        Ok(Some(d)) => d,
        Ok(None) => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "share not found or expired".to_string(),
                }),
            ));
        }
        Err(e) => {
            tracing::error!("Redis error fetching share {}: {}", id, e);
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "storage error".to_string(),
                }),
            ));
        }
    };

    let ttl_seconds = ttl.unwrap_or(-2);

    let decompressed = decompress(&data).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("decompression error: {}", e),
            }),
        )
    })?;

    let payload: StoredPayload = serde_json::from_slice(&decompressed).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("deserialization error: {}", e),
            }),
        )
    })?;

    Ok(Json(ShareGetResponse {
        id,
        title: payload.title,
        markdown: payload.markdown,
        custom_css: payload.custom_css,
        created_at: payload.created_at,
        ttl_seconds,
    }))
}

fn current_minute() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        / 60
}

// ---------------------------------------------------------------------------
// Router builder (pub for tests)
// ---------------------------------------------------------------------------

pub fn build_router(state: AppState, max_body_bytes: usize) -> Router {
    Router::new()
        .route("/health", get(health_handler))
        .route("/share", post(share_post_handler))
        .route("/share/:id", get(share_get_handler))
        .layer(RequestBodyLimitLayer::new(max_body_bytes))
        .layer(CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    let config = Config::from_env();

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let redis_client = redis::Client::open(config.redis_url.clone())
        .expect("Invalid Redis URL");

    let redis_conn = redis::aio::ConnectionManager::new(redis_client)
        .await
        .expect("Failed to connect to Redis");

    let max_body = config.max_body_bytes;
    let state = AppState {
        redis: redis_conn,
        config: Arc::new(config.clone()),
    };

    let app = build_router(state, max_body);

    let addr: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .expect("Invalid bind address");

    tracing::info!("Listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Failed to bind");
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .await
        .expect("Server error");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        extract::connect_info::MockConnectInfo,
        http::{Request, StatusCode},
    };
    use std::net::SocketAddr;
    use tower::ServiceExt;

    /// Wrap the router with a mock peer address so ConnectInfo is available in tests.
    fn test_app(state: AppState) -> axum::Router {
        let max_body = state.config.max_body_bytes;
        build_router(state, max_body)
            .layer(MockConnectInfo(SocketAddr::from(([127, 0, 0, 1], 12345))))
    }

    // --- Unit: ID validation & generation ---

    #[test]
    fn test_id_generation_length_and_charset() {
        for _ in 0..50 {
            let id = generate_id();
            assert_eq!(id.len(), 12, "ID must be exactly 12 chars");
            assert!(
                id.bytes().all(|b| b.is_ascii_alphanumeric()),
                "ID must be alphanumeric: {id}"
            );
        }
    }

    #[test]
    fn test_validate_id_valid() {
        assert!(validate_id("ABCdef123456"));
        assert!(validate_id("aaaaaaaaaaaa"));
        assert!(validate_id("ZZZZZZZZZZZZ"));
        assert!(validate_id("000000000000"));
    }

    #[test]
    fn test_validate_id_invalid() {
        assert!(!validate_id(""));
        assert!(!validate_id("short"));
        assert!(!validate_id("toolongstring1"));
        assert!(!validate_id("ABCdef12345!")); // special char
        assert!(!validate_id("ABCdef 23456")); // space
        assert!(!validate_id("ABCdef-23456")); // hyphen
        assert!(!validate_id("ABCdef_23456")); // underscore
    }

    // --- Unit: zstd round-trip ---

    #[test]
    fn test_zstd_roundtrip() {
        let data = b"Hello, Markdown! This is test data with some repetition. Repetition. Repetition.";
        let compressed = compress(data).expect("compress should succeed");
        let decompressed = decompress(&compressed).expect("decompress should succeed");
        assert_eq!(data, decompressed.as_slice());
    }

    #[test]
    fn test_zstd_roundtrip_empty() {
        let data = b"";
        let compressed = compress(data).expect("compress should succeed");
        let decompressed = decompress(&compressed).expect("decompress should succeed");
        assert_eq!(data, decompressed.as_slice());
    }

    #[test]
    fn test_zstd_roundtrip_unicode() {
        let data = "# 日本語テスト\n\nSome **bold** and $a < b$ math.".as_bytes();
        let compressed = compress(data).expect("compress should succeed");
        let decompressed = decompress(&compressed).expect("decompress should succeed");
        assert_eq!(data, decompressed.as_slice());
    }

    // --- Unit: CSS sanitization ---

    #[test]
    fn test_css_blocks_at_import() {
        let css = "body { color: red; }\n@import url('https://evil.com/style.css');\np { margin: 0; }";
        let result = sanitize_css(css);
        assert!(!result.contains("@import"), "CSS must not contain @import after sanitization");
        assert!(result.contains("body { color: red; }"), "Safe CSS preserved");
        assert!(result.contains("p { margin: 0; }"), "Safe CSS preserved");
    }

    #[test]
    fn test_css_blocks_external_url_https() {
        let css = "div { background: url(https://evil.com/bg.png); }";
        let result = sanitize_css(css);
        assert!(
            !result.contains("url(https://"),
            "External https URL must be blocked"
        );
    }

    #[test]
    fn test_css_blocks_external_url_protocol_relative() {
        let css = "div { background: url(//evil.com/bg.png); }";
        let result = sanitize_css(css);
        assert!(
            !result.contains("url(//"),
            "Protocol-relative URL must be blocked"
        );
    }

    #[test]
    fn test_css_blocks_expression() {
        let css = "div { width: expression(document.body.clientWidth); }";
        let result = sanitize_css(css);
        assert!(!result.contains("expression("), "expression() must be blocked");
    }

    #[test]
    fn test_css_blocks_javascript_uri() {
        let css = "a { content: javascript:alert(1); }";
        let result = sanitize_css(css);
        assert!(!result.contains("javascript:"), "javascript: URI must be blocked");
    }

    #[test]
    fn test_css_allows_safe_local_url() {
        let css = "div { background-image: url('/static/image.png'); }";
        let result = sanitize_css(css);
        assert!(
            result.contains("url('/static/image.png')"),
            "Local URL must be allowed"
        );
    }

    #[test]
    fn test_css_allows_data_uri() {
        let css = "div { background: url(data:image/png;base64,abc123); }";
        let result = sanitize_css(css);
        assert!(
            result.contains("url(data:image/png"),
            "Data URI should be allowed"
        );
    }

    // --- Unit: Markdown safety (do NOT mangle valid Markdown) ---

    #[test]
    fn test_markdown_blockquote_not_mangled() {
        // The markdown field is left completely untouched.
        // The sanitize functions are only applied to title and CSS.
        // Blockquotes use '>' which must not be stripped.
        let raw_md = "> This is a blockquote\n> Second line";
        // Markdown is NOT sanitized at all — just stored as-is
        // Prove that sanitize_title does not affect markdown:
        let title = sanitize_title("My Title <b>bold</b>");
        assert!(!title.contains('<'), "Title HTML stripped");
        assert!(!title.contains('>'), "Title HTML stripped");
        // But the markdown variable itself would be unchanged (no sanitization applied)
        // Strip control chars is not stripping > in markdown
        let md_after_control = strip_control_chars(raw_md);
        assert!(
            md_after_control.contains('>'),
            "Blockquote '>' must NOT be stripped by control-char sanitizer"
        );
        assert_eq!(
            md_after_control, raw_md,
            "Markdown must be completely unchanged after strip_control_chars"
        );
    }

    #[test]
    fn test_markdown_math_not_mangled() {
        let raw_md = "Compare $a < b$ and $x > y$ for math.";
        // Markdown is not sanitized — it's left as-is
        // Even strip_control_chars must not change it:
        let after = strip_control_chars(raw_md);
        assert_eq!(after, raw_md, "Math markdown must be completely unchanged");
        assert!(after.contains("$a < b$"), "$a < b$ must remain intact");
        assert!(after.contains("$x > y$"), "$x > y$ must remain intact");
    }

    #[test]
    fn test_title_strips_html_but_not_math() {
        // Title sanitization strips angle-bracket HTML
        let title_with_script = "Hello <script>alert(1)</script> World";
        let sanitized = sanitize_title(title_with_script);
        assert!(!sanitized.contains("<script>"), "script tag removed");
        assert!(!sanitized.contains("</script>"), "closing script tag removed");
        assert!(sanitized.contains("Hello"), "text before tag preserved");
        assert!(sanitized.contains("World"), "text after tag preserved");
    }

    #[test]
    fn test_title_max_length() {
        let long_title = "a".repeat(200);
        let sanitized = sanitize_title(&long_title);
        assert!(
            sanitized.chars().count() <= 120,
            "Title must be clamped to 120 chars"
        );
    }

    #[test]
    fn test_title_strips_javascript_uri() {
        let title = "Click javascript:alert(1) here";
        let sanitized = sanitize_title(title);
        assert!(
            !sanitized.contains("javascript:"),
            "javascript: stripped from title"
        );
    }

    // --- Integration tests (require local Redis) ---

    async fn make_test_state() -> Option<AppState> {
        let config = Arc::new(Config {
            host: "127.0.0.1".to_string(),
            port: 8000,
            redis_url: "redis://127.0.0.1:6379".to_string(),
            share_ttl_seconds: 300,
            max_body_bytes: 524_288,
            rate_limit_per_min: 5,
        });

        let client = match redis::Client::open("redis://127.0.0.1:6379") {
            Ok(c) => c,
            Err(_) => return None,
        };

        match tokio::time::timeout(
            std::time::Duration::from_secs(1),
            redis::aio::ConnectionManager::new(client),
        )
        .await
        {
            Ok(Ok(conn)) => Some(AppState { redis: conn, config }),
            _ => None,
        }
    }

    #[tokio::test]
    async fn test_integration_health() {
        let state = match make_test_state().await {
            Some(s) => s,
            None => {
                eprintln!("Skipping integration test: Redis not available");
                return;
            }
        };
        let app = test_app(state);

        let req = Request::builder()
            .method("GET")
            .uri("/health")
            .body(Body::empty())
            .unwrap();

        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(json["status"], "ok");
        assert_eq!(json["redis"], "ok");
    }

    #[tokio::test]
    async fn test_integration_share_post_and_get() {
        let state = match make_test_state().await {
            Some(s) => s,
            None => {
                eprintln!("Skipping integration test: Redis not available");
                return;
            }
        };
        let app = test_app(state);

        // POST /share
        let body = serde_json::json!({
            "title": "Test Share",
            "markdown": "# Hello\n\nThis is a **test**.",
            "custom_css": "body { color: blue; }"
        });

        let req = Request::builder()
            .method("POST")
            .uri("/share")
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap();

        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);

        let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let created: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
        let id = created["id"].as_str().unwrap().to_string();
        assert_eq!(id.len(), 12);
        assert!(id.bytes().all(|b| b.is_ascii_alphanumeric()));

        // GET /share/{id}
        let req = Request::builder()
            .method("GET")
            .uri(format!("/share/{}", id))
            .body(Body::empty())
            .unwrap();

        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let got: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(got["id"], id);
        assert_eq!(got["title"], "Test Share");
        assert_eq!(got["markdown"], "# Hello\n\nThis is a **test**.");
    }

    #[tokio::test]
    async fn test_integration_share_not_found() {
        let state = match make_test_state().await {
            Some(s) => s,
            None => {
                eprintln!("Skipping integration test: Redis not available");
                return;
            }
        };
        let app = test_app(state);

        let req = Request::builder()
            .method("GET")
            .uri("/share/ZZZZZZZZZZZZ")
            .body(Body::empty())
            .unwrap();

        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_integration_rate_limit() {
        let state = match make_test_state().await {
            Some(s) => s,
            None => {
                eprintln!("Skipping integration test: Redis not available");
                return;
            }
        };

        // Use a unique test IP to avoid interference with other tests
        let test_ip = format!("test-ratelimit-{}", generate_id());
        let rate_limit = state.config.rate_limit_per_min;

        // Clear any pre-existing rate key
        {
            let mut conn = state.redis.clone();
            let rate_key = format!("rate:{}:{}", test_ip, current_minute());
            let _: redis::RedisResult<()> = conn.del(&rate_key).await;
        }

        let app = test_app(state);

        let body = serde_json::json!({
            "markdown": "test"
        });
        let body_bytes = serde_json::to_vec(&body).unwrap();

        // Send up to rate_limit requests — all should succeed
        for i in 0..rate_limit {
            let req = Request::builder()
                .method("POST")
                .uri("/share")
                .header("content-type", "application/json")
                .header("CF-Connecting-IP", &test_ip)
                .body(Body::from(body_bytes.clone()))
                .unwrap();

            let resp = app.clone().oneshot(req).await.unwrap();
            assert_ne!(
                resp.status(),
                StatusCode::TOO_MANY_REQUESTS,
                "Request {} of {} should not be rate-limited",
                i + 1,
                rate_limit
            );
        }

        // The (rate_limit + 1)th request must be rate-limited
        let req = Request::builder()
            .method("POST")
            .uri("/share")
            .header("content-type", "application/json")
            .header("CF-Connecting-IP", &test_ip)
            .body(Body::from(body_bytes.clone()))
            .unwrap();

        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::TOO_MANY_REQUESTS,
            "Request beyond rate limit must return 429"
        );
    }

    #[tokio::test]
    async fn test_integration_invalid_id() {
        let state = match make_test_state().await {
            Some(s) => s,
            None => {
                eprintln!("Skipping integration test: Redis not available");
                return;
            }
        };
        let app = test_app(state);

        for bad_id in &["short", "toolong1234567", "bad!char12345"] {
            let req = Request::builder()
                .method("GET")
                .uri(format!("/share/{}", bad_id))
                .body(Body::empty())
                .unwrap();

            let resp = app.clone().oneshot(req).await.unwrap();
            assert_eq!(
                resp.status(),
                StatusCode::BAD_REQUEST,
                "ID '{}' must return 400",
                bad_id
            );
        }
    }
}
