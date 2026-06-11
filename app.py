#!/usr/bin/env python3
"""
企业产品展示与点单系统 — 后端服务
Python 3 标准库，零第三方依赖
启动: python app.py
"""

import json
import os
import re
import sys
import time
import uuid
import hashlib
import secrets
import threading
import traceback
import mimetypes
import urllib.request
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote


# ============================================================
# 编码辅助：Windows 终端可能发送 GBK 编码的请求体
# ============================================================
def safe_decode(data):
    """尝试 UTF-8 解码，失败则回退到 GBK"""
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        try:
            return data.decode("gbk")
        except UnicodeDecodeError:
            return data.decode("utf-8", errors="replace")

# ============================================================
# 常量配置
# ============================================================
HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", 8080))
DATA_DIR = "data"
UPLOAD_DIR = "uploads"
STATIC_DIR = "static"
SESSION_TTL = 86400         # 管理端 session 有效期 24 小时
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10MB
MAX_LOGIN_ATTEMPTS = 5
LOGIN_LOCKOUT_SECONDS = 900  # 15 分钟

# 图片格式白名单
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
MAGIC_BYTES = {
    b"\xff\xd8\xff": "image/jpeg",
    b"\x89PNG\r\n\x1a\n": "image/png",
    b"GIF89a": "image/gif",
    b"GIF87a": "image/gif",
}

# MIME 类型补充
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("image/svg+xml", ".svg")

# ============================================================
# 日志
# ============================================================
def log(msg):
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{timestamp}] {msg}", file=sys.stderr, flush=True)


# ============================================================
# 线程安全的 JSON 文件读写
# ============================================================
class DataStore:
    """每个 JSON 文件一个实例，维护独立的线程锁"""

    def __init__(self, filepath, default):
        self.filepath = filepath
        self.lock = threading.Lock()
        self.default = default
        self._ensure_file()

    def _ensure_file(self):
        if not os.path.exists(self.filepath):
            self._write_raw(self.default)

    def read(self):
        with self.lock:
            try:
                with open(self.filepath, "r", encoding="utf-8") as f:
                    return json.load(f)
            except (json.JSONDecodeError, FileNotFoundError):
                log(f"⚠ {self.filepath} 解析失败，使用默认值")
                self._write_raw(self.default)
                return self.default

    def write(self, data):
        with self.lock:
            self._write_raw(data)

    def _write_raw(self, data):
        """原子写入：先写临时文件，成功后替换"""
        tmp = self.filepath + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, self.filepath)

    def update(self, fn):
        """读取→修改→原子写回（常用模式）"""
        with self.lock:
            try:
                with open(self.filepath, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except (json.JSONDecodeError, FileNotFoundError):
                log(f"⚠ {self.filepath} 解析失败，使用默认值")
                self._write_raw(self.default)
                data = self.default
            data = fn(data)
            self._write_raw(data)
            return data


# ============================================================
# Session 管理器
# ============================================================
class SessionManager:
    def __init__(self):
        self._sessions = {}
        self._lock = threading.Lock()

    def create(self):
        token = hashlib.sha256(os.urandom(32)).hexdigest()
        now = time.time()
        with self._lock:
            self._sessions[token] = {
                "created_at": now,
                "expires_at": now + SESSION_TTL,
            }
            self._cleanup_locked()
        return token

    def validate(self, token):
        if not token:
            return False
        with self._lock:
            if token not in self._sessions:
                return False
            if time.time() > self._sessions[token]["expires_at"]:
                del self._sessions[token]
                return False
            # 续期
            self._sessions[token]["expires_at"] = time.time() + SESSION_TTL
            return True

    def revoke(self, token):
        with self._lock:
            self._sessions.pop(token, None)

    def _cleanup_locked(self):
        now = time.time()
        expired = [t for t, s in self._sessions.items() if now > s["expires_at"]]
        for t in expired:
            del self._sessions[t]


# ============================================================
# 登录限流
# ============================================================
class LoginRateLimiter:
    def __init__(self):
        self._attempts = {}
        self._lock = threading.Lock()

    def is_locked_out(self):
        """检查当前是否被锁定（基于 IP 的简单实现基于客户端地址）"""
        return False  # 简化实现，仅在 RequestHandler 中处理

    def record_failure(self, ip):
        with self._lock:
            now = time.time()
            if ip not in self._attempts:
                self._attempts[ip] = {"count": 0, "first": now}
            entry = self._attempts[ip]
            # 超过锁定时长则重置
            if now - entry["first"] > LOGIN_LOCKOUT_SECONDS:
                entry["count"] = 0
                entry["first"] = now
            entry["count"] += 1

    def is_blocked(self, ip):
        with self._lock:
            if ip not in self._attempts:
                return False
            entry = self._attempts[ip]
            if time.time() - entry["first"] > LOGIN_LOCKOUT_SECONDS:
                return False
            return entry["count"] >= MAX_LOGIN_ATTEMPTS

    def reset(self, ip):
        with self._lock:
            self._attempts.pop(ip, None)

    def remaining_seconds(self, ip):
        with self._lock:
            if ip not in self._attempts:
                return 0
            entry = self._attempts[ip]
            elapsed = time.time() - entry["first"]
            return max(0, int(LOGIN_LOCKOUT_SECONDS - elapsed))


# ============================================================
# 全局实例
# ============================================================
db_products = DataStore(os.path.join(DATA_DIR, "products.json"), [])
db_categories = DataStore(os.path.join(DATA_DIR, "categories.json"), [])
db_orders = DataStore(os.path.join(DATA_DIR, "orders.json"), [])
session_mgr = SessionManager()
rate_limiter = LoginRateLimiter()


# ============================================================
# Multipart 解析器（零依赖）
# ============================================================
def parse_multipart(body, content_type):
    """解析 multipart/form-data，返回 (fields_dict, files_list)"""
    # 提取 boundary
    boundary_match = re.search(r"boundary=([^;]+)", content_type)
    if not boundary_match:
        raise ValueError("无法解析 boundary")

    boundary = boundary_match.group(1).strip().strip('"').encode()
    parts = body.split(b"--" + boundary)

    fields = {}
    files = []

    for part in parts[1:-1]:  # 跳过首个空和末尾 "--"
        if not part or part.strip() == b"--":
            continue
        part = part.lstrip(b"\r\n").rstrip(b"--").rstrip(b"\r\n")

        header_end = part.find(b"\r\n\r\n")
        if header_end == -1:
            continue

        headers_raw = part[:header_end].decode("utf-8", errors="replace")
        content = part[header_end + 4:]

        # 解析 Content-Disposition
        disp_match = re.search(r'Content-Disposition:.*name="([^"]+)"', headers_raw)
        if not disp_match:
            continue
        name = disp_match.group(1)

        filename_match = re.search(r'filename="([^"]*)"', headers_raw)

        if filename_match:
            ct_match = re.search(r"Content-Type:\s*(\S+)", headers_raw)
            files.append({
                "name": name,
                "filename": filename_match.group(1) or "unknown",
                "content": content,
                "content_type": ct_match.group(1) if ct_match else "application/octet-stream",
            })
        else:
            fields[name] = safe_decode(content)

    return fields, files


# ============================================================
# 图片工具
# ============================================================
def detect_image_type(content):
    """通过文件头魔数检测图片类型"""
    for magic, mime in MAGIC_BYTES.items():
        if content.startswith(magic):
            return mime
    # WebP: RIFF....WEBP (offset 8)
    if content.startswith(b"RIFF") and len(content) > 12 and content[8:12] == b"WEBP":
        return "image/webp"
    return None


def validate_image(content):
    """验证文件大小和类型，返回 (ok, mime_type_or_error)"""
    if len(content) > MAX_UPLOAD_SIZE:
        return False, "文件大小超过 10MB 限制"
    if len(content) == 0:
        return False, "文件为空"
    mime = detect_image_type(content)
    if not mime:
        return False, "不支持的文件格式，仅允许 JPG/PNG/WebP/GIF"
    return True, mime


EXT_TO_MIME = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def save_image(content):
    """验证并保存图片到 uploads/，返回 (new_filename, error)"""
    ok, result = validate_image(content)
    if not ok:
        return None, result
    ext = EXT_TO_MIME[result]
    new_name = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(UPLOAD_DIR, new_name)
    with open(filepath, "wb") as f:
        f.write(content)
    log(f"📷 图片已保存: {new_name} ({len(content)} bytes)")
    return new_name, None


def get_orphan_images():
    """找出 uploads/ 中未被任何产品引用的图片"""
    if not os.path.exists(UPLOAD_DIR):
        return []
    all_images = set(f for f in os.listdir(UPLOAD_DIR)
                     if os.path.splitext(f)[1].lower() in ALLOWED_EXTENSIONS)

    products = db_products.read()
    referenced = set(p.get("image", "") for p in products if p.get("image"))

    orphans = []
    for img in all_images - referenced:
        filepath = os.path.join(UPLOAD_DIR, img)
        try:
            size = os.path.getsize(filepath)
            mtime = os.path.getmtime(filepath)
            orphans.append({"filename": img, "size": size, "mtime": mtime})
        except OSError:
            pass
    return orphans


# ============================================================
# Webhook 发送
# ============================================================
def send_webhook(order):
    """发送订单通知到企业微信/钉钉"""
    config = db_config.read()
    url = config.get("webhook_url", "")
    if not url:
        log("⚠ Webhook URL 未配置，跳过通知")
        return False, "未配置 Webhook URL"

    webhook_type = config.get("webhook_type", "wecom")

    items_lines = "\n".join(
        f"| {item['product_name']} | ×{item['quantity']} | ¥{item['subtotal']:.2f} |"
        for item in order["items"]
    )

    md_content = (
        f"## 🛒 新订单通知\n\n"
        f"**订单号：** {order['id'][:8]}\n"
        f"**客户：** {order['user']['nickname']} ({order['user']['phone']})\n"
        f"**金额：** ¥{order['total']:.2f}\n"
        f"**备注：** {order.get('note', '无')}\n"
        f"**时间：** {order['created_at']}\n\n"
        f"| 产品 | 数量 | 小计 |\n"
        f"|------|------|------|\n"
        f"{items_lines}"
    )

    if webhook_type == "wecom":
        payload = {"msgtype": "markdown", "markdown": {"content": md_content}}
    else:  # 钉钉
        payload = {"msgtype": "markdown", "markdown": {"title": "新订单通知", "text": md_content}}

    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json; charset=utf-8"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = resp.read().decode()
            log(f"📤 Webhook 发送成功: {url[:50]}...")
            return True, result
    except Exception as e:
        log(f"⚠ Webhook 发送失败: {e}")
        return False, str(e)


# ============================================================
# 图册 HTML 生成
# ============================================================
CATALOG_HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>产品图册</title>
<style>
  :root {{
    --primary: #2563EB;
    --bg: #F8FAFC;
    --surface: #FFFFFF;
    --border: #E2E8F0;
    --text: #1E293B;
    --text-secondary: #64748B;
    --radius: 8px;
    --shadow: 0 4px 6px rgba(0,0,0,0.07);
  }}
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
    background: var(--bg);
    color: var(--text);
    padding: 24px;
  }}
  .catalog-header {{
    text-align: center;
    padding: 40px 0 32px;
    border-bottom: 2px solid var(--primary);
    margin-bottom: 32px;
  }}
  .catalog-header h1 {{ font-size: 28px; color: var(--primary); }}
  .catalog-header p {{ color: var(--text-secondary); margin-top: 8px; }}
  .category-section {{ margin-bottom: 40px; }}
  .category-title {{
    font-size: 20px;
    font-weight: 700;
    padding: 8px 16px;
    border-left: 4px solid var(--primary);
    margin-bottom: 16px;
    background: var(--surface);
    border-radius: 0 var(--radius) var(--radius) 0;
  }}
  .product-grid {{
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 20px;
  }}
  .product-card {{
    background: var(--surface);
    border-radius: var(--radius);
    overflow: hidden;
    box-shadow: var(--shadow);
    border: 1px solid var(--border);
  }}
  .product-card img {{
    width: 100%;
    height: 220px;
    object-fit: cover;
    background: #f1f5f9;
  }}
  .product-card .info {{ padding: 16px; }}
  .product-card .name {{ font-size: 16px; font-weight: 600; margin-bottom: 4px; }}
  .product-card .desc {{ font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; line-height: 1.5; }}
  .product-card .price {{
    font-size: 20px;
    font-weight: 700;
    color: var(--primary);
  }}
  .product-card .unit {{ font-size: 13px; color: var(--text-secondary); }}
  .no-image {{
    width: 100%;
    height: 220px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f1f5f9;
    color: #94a3b8;
    font-size: 14px;
  }}
  @media print {{
    body {{ background: #fff; padding: 0; }}
    .catalog-header {{ padding: 20px 0 16px; }}
    @page {{ size: A4 portrait; margin: 12mm; }}
    .product-grid {{ grid-template-columns: repeat(2, 1fr); gap: 10mm; }}
    .product-card {{ break-inside: avoid; box-shadow: none; border: 1px solid #ddd; }}
    .product-card img {{ height: 160px; }}
  }}
</style>
</head>
<body>
<div class="catalog-header">
  <h1>产品图册</h1>
  <p>生成时间：{generated_at} | 共 {total_count} 件产品</p>
</div>
{categories_html}
</body>
</html>"""

CATEGORY_SECTION = """<div class="category-section">
  <h2 class="category-title">{category_name}</h2>
  <div class="product-grid">
    {product_cards}
  </div>
</div>"""

PRODUCT_CARD = """<div class="product-card">
  {image_html}
  <div class="info">
    <div class="name">{name}</div>
    {desc_html}
    <span class="price">{price}</span>
    <span class="unit"> /{unit}</span>
  </div>
</div>"""


def generate_catalog_html():
    """生成完整的产品图册 HTML"""
    products = db_products.read()
    categories = db_categories.read()

    cat_map = {c["id"]: c["name"] for c in categories}

    # 按分类分组
    grouped = {}
    uncategorized = []
    for p in sorted(products, key=lambda x: x.get("sort_order", 0)):
        cid = p.get("category_id")
        if cid and cid in cat_map:
            grouped.setdefault(cid, []).append(p)
        else:
            uncategorized.append(p)

    sections = []

    # 有分类的先渲染
    for cat in sorted(categories, key=lambda x: x.get("sort_order", 0)):
        if cat["id"] not in grouped:
            continue
        cards = "".join(_render_product_card(p) for p in grouped[cat["id"]])
        sections.append(CATEGORY_SECTION.format(category_name=cat["name"], product_cards=cards))

    # 未分类的
    if uncategorized:
        cards = "".join(_render_product_card(p) for p in uncategorized)
        sections.append(CATEGORY_SECTION.format(category_name="未分类", product_cards=cards))

    total = len(products)
    generated_at = time.strftime("%Y-%m-%d %H:%M:%S")
    return CATALOG_HTML_TEMPLATE.format(
        generated_at=generated_at,
        total_count=total,
        categories_html="".join(sections),
    )


def _render_product_card(p):
    if p.get("image"):
        img_html = f'<img src="/uploads/{p["image"]}" alt="{_esc(p["name"])}" loading="lazy">'
    else:
        img_html = '<div class="no-image">暂无图片</div>'

    desc_html = ""
    if p.get("description"):
        desc_html = f'<div class="desc">{_esc(p["description"])}</div>'

    price = "面议" if p.get("price", 0) == 0 else f"¥{p['price']:.2f}"
    unit = p.get("unit", "个")

    return PRODUCT_CARD.format(
        image_html=img_html,
        name=_esc(p["name"]),
        desc_html=desc_html,
        price=price,
        unit=unit,
    )


def _esc(text):
    """HTML 转义"""
    return (text.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace('"', "&quot;"))


# ============================================================
# 配置文件 DataStore
# ============================================================
db_config = DataStore("config.json", {
    "admin_password_hash": "",
    "webhook_url": "",
    "webhook_type": "wecom",
    "port": 8080,
})


# ============================================================
# 初始化
# ============================================================
def init_data_files():
    """确保所有数据文件和目录存在"""
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    os.makedirs(os.path.join(STATIC_DIR, "css"), exist_ok=True)
    os.makedirs(os.path.join(STATIC_DIR, "js"), exist_ok=True)
    os.makedirs(os.path.join(STATIC_DIR, "img"), exist_ok=True)

    # 验证 JSON 文件
    for store in [db_products, db_categories, db_orders]:
        try:
            store.read()
        except Exception as e:
            log(f"⚠ {store.filepath} 异常: {e}")

    # 首次启动生成随机密码
    config = db_config.read()
    if not config.get("admin_password_hash"):
        pwd = ''.join(secrets.choice(secrets.token_urlsafe(16)) for _ in range(1))[:12]
        # 简化生成
        import string as _s
        pwd = ''.join(secrets.choice(_s.ascii_letters + _s.digits) for _ in range(12))
        config["admin_password_hash"] = hashlib.sha256(pwd.encode()).hexdigest()
        db_config.write(config)
        log(f"🔑 初始管理密码: {pwd}")
        log(f"   请妥善保管，可在管理端「系统设置」中修改")
    else:
        log("🔑 管理密码已配置")


# ============================================================
# HTTP 请求处理器
# ============================================================
class RequestHandler(BaseHTTPRequestHandler):

    # ========== HTTP 方法入口 ==========
    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PUT(self):
        self._dispatch("PUT")

    def do_DELETE(self):
        self._dispatch("DELETE")

    def do_PATCH(self):
        self._dispatch("PATCH")

    # ========== 路由分发 ==========
    def _dispatch(self, method):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)

        # API 路由
        for http_method, pattern, handler_name in ROUTES:
            if method != http_method:
                continue
            m = re.match(pattern, path)
            if m:
                handler = getattr(self, f"_api_{handler_name}", None)
                if handler:
                    try:
                        handler(*m.groups())
                    except Exception as e:
                        log(f"❌ 处理器异常 [{handler_name}]: {traceback.format_exc()}")
                        self._send_error(500, f"服务器内部错误: {e}")
                    return

        # 非 API 路径 → 静态文件
        if method == "GET":
            self._serve_static(path)
        else:
            self._send_error(404, "未找到")

    # ========== 静态文件服务 ==========
    def _serve_static(self, path):
        # 安全：防止路径遍历
        safe_path = os.path.normpath(path.lstrip("/"))
        if safe_path.startswith(".."):
            self._send_error(403, "禁止访问")
            return

        # 路由映射
        if safe_path == "" or safe_path == "index.html":
            filepath = os.path.join(STATIC_DIR, "index.html")
        elif safe_path in ("admin", "admin/dashboard"):
            filepath = os.path.join(STATIC_DIR, "admin.html")
        elif safe_path.startswith("uploads/") or safe_path.startswith("uploads\\"):
            filepath = safe_path
        elif safe_path.startswith("static/") or safe_path.startswith("static\\"):
            # 直接使用项目根目录下的 static/ 路径
            filepath = safe_path
        else:
            filepath = os.path.join(STATIC_DIR, safe_path) if not os.path.isabs(safe_path) else safe_path

        # 安全检查（允许静态目录和上传目录）
        abs_path = os.path.abspath(filepath)
        allowed_dirs = [os.path.abspath(STATIC_DIR), os.path.abspath(UPLOAD_DIR)]
        if not any(abs_path.startswith(d) for d in allowed_dirs):
            self._send_error(403, "禁止访问")
            return

        if not os.path.isfile(abs_path):
            # SPA fallback: 返回 index.html
            if not path.startswith("/api/") and not path.startswith("/uploads/"):
                abs_path = os.path.abspath(os.path.join(STATIC_DIR, "index.html"))

        if not os.path.isfile(abs_path):
            self._send_error(404, "文件未找到")
            return

        # 读取并返回
        mime_type, _ = mimetypes.guess_type(abs_path)
        if mime_type is None:
            mime_type = "application/octet-stream"

        try:
            with open(abs_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", mime_type)
            self.send_header("Content-Length", str(len(content)))
            # 图片缓存
            if mime_type.startswith("image/"):
                self.send_header("Cache-Control", "public, max-age=86400")
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self._send_error(500, f"读取文件失败: {e}")

    # ========== 认证辅助 ==========
    def _require_auth(self):
        """验证管理端 session，失败则返回 401"""
        token = self._get_session_token()
        if not session_mgr.validate(token):
            self._send_error(401, "未登录或 session 已过期", "UNAUTHORIZED")
            return False
        return True

    def _get_session_token(self):
        cookie_header = self.headers.get("Cookie", "")
        m = re.search(r"session=([^;]+)", cookie_header)
        return m.group(1) if m else None

    def _set_session_cookie(self, token, max_age=SESSION_TTL):
        self.send_header("Set-Cookie",
                         f"session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={max_age}")

    def _clear_session_cookie(self):
        self.send_header("Set-Cookie", "session=; Path=/; Max-Age=0")

    def _get_client_ip(self):
        forwarded = self.headers.get("X-Forwarded-For", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return self.client_address[0]

    # ========== 请求体解析 ==========
    def _read_body(self):
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            return b""
        return self.rfile.read(content_length)

    def _parse_json_body(self):
        body = self._read_body()
        if not body:
            raise ValueError("请求体为空")
        return json.loads(safe_decode(body))

    def _parse_form_body(self):
        """解析 multipart/form-data 或 application/x-www-form-urlencoded"""
        content_type = self.headers.get("Content-Type", "")
        body = self._read_body()

        if "multipart/form-data" in content_type:
            return parse_multipart(body, content_type)
        elif "application/json" in content_type:
            data = json.loads(safe_decode(body))
            return data, []
        else:
            # 普通表单
            data = {}
            for k, v in parse_qs(safe_decode(body)).items():
                data[k] = v[0] if len(v) == 1 else v
            return data, []

    # ========== 响应辅助 ==========
    def _send_json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, code, message, error_code="ERROR"):
        self._send_json({"error": message, "code": error_code}, code)

    def _send_html(self, html, code=200):
        body = html.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ================================================================
    # API 处理器 —— 分类
    # ================================================================
    def _api_list_categories(self):
        data = db_categories.read()
        data.sort(key=lambda x: x.get("sort_order", 0))
        self._send_json(data)

    def _api_create_category(self):
        if not self._require_auth():
            return
        body = self._read_body()
        req = json.loads(safe_decode(body))
        name = req.get("name", "").strip()
        if not name:
            self._send_error(400, "分类名称不能为空")
            return

        def add_cat(cats):
            # 检查重名
            if any(c["name"] == name for c in cats):
                raise ValueError("分类名称已存在")
            cat = {
                "id": uuid.uuid4().hex,
                "name": name,
                "sort_order": req.get("sort_order", len(cats)),
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            }
            cats.append(cat)
            return cats

        try:
            cats = db_categories.update(add_cat)
            new_cat = next(c for c in cats if c["name"] == name)
            log(f"📁 分类已创建: {name}")
            self._send_json(new_cat, 201)
        except ValueError as e:
            self._send_error(409, str(e))

    def _api_update_category(self, cat_id):
        if not self._require_auth():
            return
        body = self._read_body()
        req = json.loads(safe_decode(body))

        def upd(cats):
            for c in cats:
                if c["id"] == cat_id:
                    if "name" in req:
                        new_name = req["name"].strip()
                        if not new_name:
                            raise ValueError("分类名称不能为空")
                        if any(cc["name"] == new_name and cc["id"] != cat_id for cc in cats):
                            raise ValueError("分类名称已存在")
                        c["name"] = new_name
                    if "sort_order" in req:
                        c["sort_order"] = req["sort_order"]
                    return cats
            raise LookupError("分类不存在")

        try:
            db_categories.update(upd)
            log(f"📁 分类已更新: {cat_id}")
            self._send_json({"ok": True})
        except ValueError as e:
            self._send_error(409, str(e))
        except LookupError:
            self._send_error(404, "分类不存在")

    def _api_delete_category(self, cat_id):
        if not self._require_auth():
            return
        # 检查是否有关联产品
        products = db_products.read()
        linked = [p["name"] for p in products if p.get("category_id") == cat_id]
        if linked:
            self._send_error(409, f"无法删除：该分类下有 {len(linked)} 个产品（如：{linked[0]}）")
            return

        def rm(cats):
            return [c for c in cats if c["id"] != cat_id]

        cats_before = len(db_categories.read())
        db_categories.update(rm)
        cats_after = len(db_categories.read())
        if cats_before == cats_after:
            self._send_error(404, "分类不存在")
            return
        log(f"📁 分类已删除: {cat_id}")
        self._send_json({"ok": True})

    # ================================================================
    # API 处理器 —— 产品
    # ================================================================
    def _api_list_products(self):
        qs = parse_qs(urlparse(self.path).query)
        category_filter = qs.get("category_id", [None])[0]
        search = qs.get("search", [None])[0]

        products = db_products.read()
        categories = db_categories.read()
        cat_map = {c["id"]: c for c in categories}

        # 附加分类名称
        for p in products:
            cid = p.get("category_id")
            p["category_name"] = cat_map[cid]["name"] if cid and cid in cat_map else ""

        # 筛选
        if category_filter:
            products = [p for p in products if p.get("category_id") == category_filter]

        # 搜索
        if search:
            kw = search.lower()
            products = [p for p in products
                        if kw in p.get("name", "").lower() or kw in p.get("description", "").lower()]

        # 排序
        products.sort(key=lambda x: x.get("sort_order", 9999))
        self._send_json(products)

    def _api_get_product(self, product_id):
        products = db_products.read()
        for p in products:
            if p["id"] == product_id:
                self._send_json(p)
                return
        self._send_error(404, "产品不存在")

    def _api_create_product(self):
        if not self._require_auth():
            return
        fields, files = self._parse_form_body()

        name = fields.get("name", "").strip()
        if not name:
            self._send_error(400, "产品名称不能为空")
            return

        price_str = fields.get("price", "0")
        try:
            price = float(price_str)
            if price < 0:
                raise ValueError
        except ValueError:
            self._send_error(400, "价格格式不正确")
            return

        # 处理图片上传
        image_filename = ""
        if files:
            file = files[0]  # 取第一个文件
            new_name, err = save_image(file["content"])
            if err:
                self._send_error(400, f"图片错误: {err}")
                return
            image_filename = new_name

        def add_product(products):
            p = {
                "id": uuid.uuid4().hex,
                "name": name,
                "description": fields.get("description", "").strip(),
                "price": price,
                "unit": fields.get("unit", "个").strip() or "个",
                "category_id": fields.get("category_id", "").strip() or "",
                "image": image_filename,
                "sort_order": int(fields.get("sort_order", len(products))),
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            }
            products.append(p)
            return products

        products = db_products.update(add_product)
        new_p = next(p for p in products if p["name"] == name and p.get("image") == image_filename)
        log(f"📦 产品已创建: {name}")
        self._send_json(new_p, 201)

    def _api_update_product(self, product_id):
        if not self._require_auth():
            return
        fields, files = self._parse_form_body()

        name = fields.get("name", "").strip()

        price = None
        if "price" in fields:
            try:
                price = float(fields["price"])
                if price < 0:
                    raise ValueError
            except ValueError:
                self._send_error(400, "价格格式不正确")
                return

        # 处理图片上传
        new_image = None
        if files:
            file = files[0]
            if file["filename"]:  # 有实际文件
                new_name, err = save_image(file["content"])
                if err:
                    self._send_error(400, f"图片错误: {err}")
                    return
                new_image = new_name

        def upd(products):
            for p in products:
                if p["id"] == product_id:
                    if name:
                        p["name"] = name
                    if "description" in fields:
                        p["description"] = fields["description"].strip()
                    if price is not None:
                        p["price"] = price
                    if "unit" in fields:
                        p["unit"] = fields["unit"].strip() or "个"
                    if "category_id" in fields:
                        p["category_id"] = fields["category_id"].strip()
                    if "sort_order" in fields:
                        p["sort_order"] = int(fields["sort_order"])
                    if new_image:
                        # 标记旧图片为待清理
                        p["image"] = new_image
                    p["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
                    return products
            raise LookupError("产品不存在")

        try:
            db_products.update(upd)
            log(f"📦 产品已更新: {product_id}")
            self._send_json({"ok": True})
        except LookupError:
            self._send_error(404, "产品不存在")

    def _api_delete_product(self, product_id):
        if not self._require_auth():
            return

        def rm(products):
            return [p for p in products if p["id"] != product_id]

        before = len(db_products.read())
        db_products.update(rm)
        after = len(db_products.read())
        if before == after:
            self._send_error(404, "产品不存在")
            return
        log(f"📦 产品已删除: {product_id}（图片保留待清理）")
        self._send_json({"ok": True})

    def _api_reorder_products(self):
        if not self._require_auth():
            return
        body = self._read_body()
        req = json.loads(safe_decode(body))
        order_ids = req.get("order", [])

        def reorder(products):
            order_map = {pid: idx for idx, pid in enumerate(order_ids)}
            for p in products:
                if p["id"] in order_map:
                    p["sort_order"] = order_map[p["id"]]
            products.sort(key=lambda x: x.get("sort_order", 9999))
            return products

        db_products.update(reorder)
        self._send_json({"ok": True})

    # ================================================================
    # API 处理器 —— 订单
    # ================================================================
    def _api_list_orders(self):
        if not self._require_auth():
            return
        qs = parse_qs(urlparse(self.path).query)
        status_filter = qs.get("status", [None])[0]

        orders = db_orders.read()
        if status_filter:
            orders = [o for o in orders if o.get("status") == status_filter]
        orders.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        self._send_json(orders)

    def _api_get_order(self, order_id):
        if not self._require_auth():
            return
        orders = db_orders.read()
        for o in orders:
            if o["id"] == order_id:
                self._send_json(o)
                return
        self._send_error(404, "订单不存在")

    def _api_create_order(self):
        body = self._read_body()
        try:
            req = json.loads(safe_decode(body))
        except json.JSONDecodeError:
            self._send_error(400, "请求格式错误")
            return

        # 验证必填字段
        user = req.get("user", {})
        if not user.get("nickname", "").strip():
            self._send_error(400, "请填写昵称")
            return
        if not user.get("phone", "").strip():
            self._send_error(400, "请填写手机号")
            return

        items = req.get("items", [])
        if not items:
            self._send_error(400, "购物车为空")
            return

        # 查找产品信息（快照）
        products = db_products.read()
        prod_map = {p["id"]: p for p in products}

        order_items = []
        total = 0.0
        for item in items:
            pid = item.get("product_id", "")
            quantity = item.get("quantity", 1)
            if quantity < 1:
                quantity = 1

            prod = prod_map.get(pid)
            if not prod:
                self._send_error(400, f"产品不存在: {pid}")
                return

            price = prod.get("price", 0)
            subtotal = price * quantity
            order_items.append({
                "product_id": pid,
                "product_name": prod["name"],
                "image": prod.get("image", ""),
                "price": price,
                "quantity": quantity,
                "subtotal": round(subtotal, 2),
            })
            total += subtotal

        note = req.get("note", "").strip()

        new_order = None

        def add_order(orders):
            nonlocal new_order
            order = {
                "id": uuid.uuid4().hex,
                "status": "pending",
                "user": {
                    "nickname": user["nickname"].strip(),
                    "phone": user["phone"].strip(),
                },
                "items": order_items,
                "total": round(total, 2),
                "note": note,
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            }
            orders.append(order)
            new_order = order
            return orders

        db_orders.update(add_order)
        log(f"🛒 新订单: {new_order['id'][:8]} | {user['nickname']} | ¥{total:.2f}")

        # 异步发送 Webhook（不阻塞响应）
        def _notify():
            try:
                send_webhook(new_order)
            except Exception as e:
                log(f"⚠ Webhook 发送异常: {e}")

        t = threading.Thread(target=_notify, daemon=True)
        t.start()

        self._send_json(new_order, 201)

    def _api_update_order_status(self, order_id):
        if not self._require_auth():
            return
        body = self._read_body()
        req = json.loads(safe_decode(body))
        new_status = req.get("status", "")

        valid_statuses = {"pending", "processing", "completed"}
        if new_status not in valid_statuses:
            self._send_error(400, f"无效状态，允许: {', '.join(valid_statuses)}")
            return

        def upd(orders):
            for o in orders:
                if o["id"] == order_id:
                    o["status"] = new_status
                    o["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
                    return orders
            raise LookupError("订单不存在")

        try:
            db_orders.update(upd)
            log(f"📋 订单状态更新: {order_id[:8]} → {new_status}")
            self._send_json({"ok": True})
        except LookupError:
            self._send_error(404, "订单不存在")

    # ================================================================
    # API 处理器 —— 认证
    # ================================================================
    def _api_login(self):
        body = self._read_body()
        try:
            req = json.loads(safe_decode(body))
        except json.JSONDecodeError:
            self._send_error(400, "请求格式错误")
            return

        password = req.get("password", "")
        ip = self._get_client_ip()

        # 检查锁定
        if rate_limiter.is_blocked(ip):
            remaining = rate_limiter.remaining_seconds(ip)
            self._send_error(429, f"登录失败次数过多，请 {remaining} 秒后重试", "RATE_LIMITED")
            return

        config = db_config.read()
        pwd_hash = hashlib.sha256(password.encode()).hexdigest()

        if pwd_hash != config.get("admin_password_hash", ""):
            rate_limiter.record_failure(ip)
            attempts_left = MAX_LOGIN_ATTEMPTS - 1  # 简化
            self._send_error(401, f"密码错误", "WRONG_PASSWORD")
            return

        # 登录成功
        rate_limiter.reset(ip)
        token = session_mgr.create()
        log(f"🔓 管理端登录成功 (IP: {ip})")

        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._set_session_cookie(token)
        self.end_headers()
        self.wfile.write(json.dumps({"ok": True, "token": token}).encode())

    def _api_logout(self):
        token = self._get_session_token()
        if token:
            session_mgr.revoke(token)
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._clear_session_cookie()
        self.end_headers()
        self.wfile.write(json.dumps({"ok": True}).encode())
        log("🔒 管理端登出")

    def _api_check_auth(self):
        token = self._get_session_token()
        if session_mgr.validate(token):
            self._send_json({"authenticated": True})
        else:
            self._send_json({"authenticated": False})

    # ================================================================
    # API 处理器 —— 图册
    # ================================================================
    def _api_generate_catalog(self):
        if not self._require_auth():
            return
        html = generate_catalog_html()
        self._send_html(html)

    # ================================================================
    # API 处理器 —— 图片清理
    # ================================================================
    def _api_list_orphan_images(self):
        if not self._require_auth():
            return
        orphans = get_orphan_images()
        self._send_json({"count": len(orphans), "images": orphans})

    def _api_cleanup_images(self):
        if not self._require_auth():
            return
        orphans = get_orphan_images()
        deleted = 0
        for img in orphans:
            filepath = os.path.join(UPLOAD_DIR, img["filename"])
            try:
                os.remove(filepath)
                deleted += 1
            except OSError as e:
                log(f"⚠ 删除失败: {img['filename']}: {e}")
        log(f"🗑 已清理 {deleted} 个孤立图片")
        self._send_json({"deleted": deleted})

    # ================================================================
    # API 处理器 —— 设置
    # ================================================================
    def _api_get_settings(self):
        if not self._require_auth():
            return
        config = db_config.read()
        # 不返回密码哈希
        self._send_json({
            "webhook_url": config.get("webhook_url", ""),
            "webhook_type": config.get("webhook_type", "wecom"),
            "port": config.get("port", 8080),
        })

    def _api_update_settings(self):
        if not self._require_auth():
            return
        body = self._read_body()
        req = json.loads(safe_decode(body))

        def upd(config):
            # 修改密码
            if "old_password" in req and "new_password" in req:
                old_hash = hashlib.sha256(req["old_password"].encode()).hexdigest()
                if old_hash != config.get("admin_password_hash", ""):
                    raise ValueError("旧密码不正确")
                if len(req["new_password"]) < 6:
                    raise ValueError("新密码至少 6 位")
                config["admin_password_hash"] = hashlib.sha256(req["new_password"].encode()).hexdigest()
                log("🔑 管理密码已修改")
            # Webhook 配置
            if "webhook_url" in req:
                config["webhook_url"] = req["webhook_url"].strip()
            if "webhook_type" in req:
                config["webhook_type"] = req["webhook_type"]
            return config

        try:
            db_config.update(upd)
            self._send_json({"ok": True})
        except ValueError as e:
            self._send_error(400, str(e))

    def _api_test_webhook(self):
        if not self._require_auth():
            return
        # 发送测试订单
        test_order = {
            "id": "TEST-" + uuid.uuid4().hex[:4],
            "user": {"nickname": "测试用户", "phone": "13800000000"},
            "items": [{"product_name": "测试产品", "quantity": 1, "subtotal": 0}],
            "total": 0,
            "note": "这是一条测试消息",
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }
        ok, msg = send_webhook(test_order)
        if ok:
            self._send_json({"ok": True, "message": "测试消息已发送"})
        else:
            self._send_error(500, f"发送失败: {msg}")

    # ========== 日志（覆盖默认） ==========
    def log_message(self, format, *args):
        log(f"HTTP {args[0] if args else format}")


# ============================================================
# 路由表
# ============================================================
ROUTES = [
    # 分类
    ("GET",    r"^/api/categories$",                  "list_categories"),
    ("POST",   r"^/api/categories$",                  "create_category"),
    ("PUT",    r"^/api/categories/([a-f0-9-]+)$",     "update_category"),
    ("DELETE", r"^/api/categories/([a-f0-9-]+)$",     "delete_category"),
    # 产品
    ("GET",    r"^/api/products$",                    "list_products"),
    ("GET",    r"^/api/products/([a-f0-9-]+)$",       "get_product"),
    ("POST",   r"^/api/products$",                    "create_product"),
    ("PUT",    r"^/api/products/([a-f0-9-]+)$",       "update_product"),
    ("DELETE", r"^/api/products/([a-f0-9-]+)$",       "delete_product"),
    ("PATCH",  r"^/api/products/reorder$",            "reorder_products"),
    # 订单
    ("GET",    r"^/api/orders$",                      "list_orders"),
    ("GET",    r"^/api/orders/([a-f0-9-]+)$",         "get_order"),
    ("POST",   r"^/api/orders$",                      "create_order"),
    ("PATCH",  r"^/api/orders/([a-f0-9-]+)/status$",  "update_order_status"),
    # 认证
    ("POST",   r"^/api/auth/login$",                  "login"),
    ("POST",   r"^/api/auth/logout$",                 "logout"),
    ("GET",    r"^/api/auth/check$",                  "check_auth"),
    # 图册
    ("GET",    r"^/api/catalog$",                     "generate_catalog"),
    # 图片清理
    ("GET",    r"^/api/images/orphans$",              "list_orphan_images"),
    ("POST",   r"^/api/images/cleanup$",              "cleanup_images"),
    # 设置
    ("GET",    r"^/api/settings$",                    "get_settings"),
    ("PUT",    r"^/api/settings$",                    "update_settings"),
    # Webhook 测试
    ("POST",   r"^/api/webhook/test$",                "test_webhook"),
]


# ============================================================
# 主入口
# ============================================================
def main():
    init_data_files()

    config = db_config.read()
    port = config.get("port", PORT)

    server = HTTPServer((HOST, port), RequestHandler)

    print("=" * 50)
    print("  企业产品展示与点单系统")
    print(f"  用户端: http://localhost:{port}")
    print(f"  管理端: http://localhost:{port}/admin")
    print("=" * 50)
    log(f"🚀 服务器启动于端口 {port}")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()
        log("🛑 服务器已停止")
        server.server_close()


if __name__ == "__main__":
    main()
