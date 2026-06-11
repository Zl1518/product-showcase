/* ============================================================
   企业产品展示与点单系统 — 公共工具函数
   API 封装、Toast 通知、购物车管理、工具函数
   ============================================================ */

// ---------- API 封装 ----------
const API = {
  /**
   * 通用请求
   */
  async request(method, url, options = {}) {
    const { body, isFormData, headers: extraHeaders } = options;

    const headers = { ...extraHeaders };
    if (body && !isFormData) {
      headers["Content-Type"] = "application/json";
    }

    try {
      const resp = await fetch(url, {
        method,
        headers,
        body: isFormData ? body : (body ? JSON.stringify(body) : undefined),
      });

      // 特殊处理：catalog 返回 HTML
      const ct = resp.headers.get("Content-Type") || "";
      if (ct.includes("text/html")) {
        const html = await resp.text();
        if (!resp.ok) throw new ApiError(html, resp.status, "HTML_ERROR");
        return html;
      }

      const data = await resp.json();
      if (!resp.ok) {
        throw new ApiError(data.error || "请求失败", resp.status, data.code || "ERROR");
      }
      return data;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err.name === "TypeError" && err.message.includes("fetch")) {
        throw new ApiError("网络连接失败，请检查网络", 0, "NETWORK_ERROR");
      }
      throw new ApiError(err.message || "未知错误", 0, "UNKNOWN");
    }
  },

  get(url) { return this.request("GET", url); },
  post(url, body, opts) { return this.request("POST", url, { body, ...opts }); },
  put(url, body, opts) { return this.request("PUT", url, { body, ...opts }); },
  patch(url, body, opts) { return this.request("PATCH", url, { body, ...opts }); },
  delete(url) { return this.request("DELETE", url); },
};

class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

// ---------- Toast 通知 ----------
const Toast = {
  _container: null,

  _ensureContainer() {
    if (!this._container) {
      this._container = document.createElement("div");
      this._container.className = "toast-container";
      document.body.appendChild(this._container);
    }
  },

  show(message, type = "info", duration = 3000) {
    this._ensureContainer();
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;

    const icons = { success: "✓", error: "✕", warning: "⚠", info: "ℹ" };
    toast.innerHTML = `<span>${icons[type] || "ℹ"}</span><span>${Esc.html(message)}</span>`;

    this._container.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, duration);
  },

  success(msg, d) { this.show(msg, "success", d); },
  error(msg, d) { this.show(msg, "error", d || 5000); },
  warning(msg, d) { this.show(msg, "warning", d); },
  info(msg, d) { this.show(msg, "info", d); },
};

// ---------- HTML 转义 ----------
const Esc = {
  html(text) {
    if (!text) return "";
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  },

  /** 允许保留换行：转义后 <br> 替代换行 */
  htmlWithBreaks(text) {
    return this.html(text).replace(/\n/g, "<br>");
  },
};

// ---------- 价格格式化 ----------
function formatPrice(price) {
  if (price == null || price === 0) return "面议";
  return "¥" + Number(price).toFixed(2);
}

// ---------- 日期格式化 ----------
function formatDate(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return dateStr;
  }
}

// ---------- 防抖 ----------
function debounce(fn, delay = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// ---------- 模态框 ----------
const Modal = {
  show(html, options = {}) {
    this.close();

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.id = "modal-overlay";

    const modal = document.createElement("div");
    modal.className = `modal ${options.wide ? "modal-wide" : ""}`;
    modal.innerHTML = html;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // 点击遮罩关闭
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay && options.closable !== false) {
        this.close();
      }
    });

    // ESC 关闭
    if (options.closable !== false) {
      const onKey = (e) => {
        if (e.key === "Escape") { this.close(); document.removeEventListener("keydown", onKey); }
      };
      document.addEventListener("keydown", onKey);
    }

    if (options.onShow) options.onShow(modal);
    return modal;
  },

  close() {
    const overlay = document.getElementById("modal-overlay");
    if (overlay) overlay.remove();
    document.body.style.overflow = "";
  },

  /** 弹出确认对话框 */
  confirm(title, message, confirmText = "确定", danger = false) {
    return new Promise((resolve) => {
      const html = `
        <div class="modal-header">
          <h2>${Esc.html(title)}</h2>
          <button class="btn btn-icon btn-ghost btn-sm" onclick="Modal.close()" title="关闭">✕</button>
        </div>
        <div class="modal-body">
          <p>${Esc.html(message)}</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" id="modal-cancel">取消</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="modal-confirm">${Esc.html(confirmText)}</button>
        </div>
      `;
      const modal = this.show(html, { closable: false });
      modal.querySelector("#modal-cancel").addEventListener("click", () => { this.close(); resolve(false); });
      modal.querySelector("#modal-confirm").addEventListener("click", () => { this.close(); resolve(true); });
    });
  },
};

// ---------- 购物车（localStorage） ----------
const Cart = {
  _key: "showcase_cart",

  getAll() {
    try {
      return JSON.parse(localStorage.getItem(this._key)) || [];
    } catch {
      return [];
    }
  },

  _save(items) {
    localStorage.setItem(this._key, JSON.stringify(items));
  },

  add(product, quantity = 1) {
    const items = this.getAll();
    const idx = items.findIndex((i) => i.product_id === product.id);
    if (idx >= 0) {
      items[idx].quantity = Math.min(999, items[idx].quantity + quantity);
    } else {
      items.push({
        product_id: product.id,
        product_name: product.name,
        image: product.image || "",
        price: product.price || 0,
        quantity,
        unit: product.unit || "个",
      });
    }
    this._save(items);
    return items;
  },

  update(productId, quantity) {
    const items = this.getAll();
    const idx = items.findIndex((i) => i.product_id === productId);
    if (idx >= 0) {
      items[idx].quantity = Math.max(1, Math.min(999, quantity));
      this._save(items);
    }
    return items;
  },

  remove(productId) {
    const items = this.getAll().filter((i) => i.product_id !== productId);
    this._save(items);
    return items;
  },

  clear() {
    localStorage.removeItem(this._key);
  },

  count() {
    return this.getAll().reduce((sum, i) => sum + i.quantity, 0);
  },

  total() {
    return this.getAll().reduce((sum, i) => sum + i.price * i.quantity, 0);
  },
};

// ---------- 用户信息（模拟身份） ----------
const UserInfo = {
  _key: "showcase_user",

  get() {
    try {
      return JSON.parse(localStorage.getItem(this._key)) || null;
    } catch {
      return null;
    }
  },

  save(nickname, phone) {
    const info = { nickname, phone };
    localStorage.setItem(this._key, JSON.stringify(info));
    return info;
  },

  clear() {
    localStorage.removeItem(this._key);
  },
};

// ---------- 图片 URL 辅助 ----------
function productImageUrl(image) {
  if (!image) return "static/img/placeholder.svg";
  return "/uploads/" + image;
}

// ---------- URL 查询参数 ----------
function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}
