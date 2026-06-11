/* ============================================================
   企业产品展示与点单系统 — 管理端交互逻辑
   ============================================================ */

// ---------- DOM 快捷方式 ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---------- 全局状态 ----------
let currentPage = "products";
let editingProductId = null;
let editingCategoryId = null;

// ---------- 初始化 ----------
document.addEventListener("DOMContentLoaded", () => {
  checkAuthThenInit();
});

// ============================================================
// 认证
// ============================================================
async function checkAuthThenInit() {
  try {
    const res = await API.get("/api/auth/check");
    if (res.authenticated) {
      showDashboard();
    } else {
      showLoginPage();
    }
  } catch {
    showLoginPage();
  }
}

function showLoginPage() {
  document.body.innerHTML = `
    <div class="login-page">
      <div class="login-card">
        <h1>🔐 管理端登录</h1>
        <p class="subtitle">企业产品展示与点单系统</p>
        <div class="form-group">
          <label class="form-label">管理密码</label>
          <input type="password" class="form-input" id="login-password" placeholder="请输入管理密码" autofocus>
        </div>
        <button class="btn btn-primary login-btn" id="login-btn">登 录</button>
        <div class="error-msg" id="login-error"></div>
      </div>
    </div>
  `;

  const pwdInput = $("#login-password");
  const loginBtn = $("#login-btn");
  const errorEl = $("#login-error");

  const doLogin = async () => {
    const pwd = pwdInput.value.trim();
    if (!pwd) { errorEl.textContent = "请输入密码"; return; }

    loginBtn.disabled = true;
    loginBtn.textContent = "登录中…";
    errorEl.textContent = "";

    try {
      await API.post("/api/auth/login", { password: pwd });
      Toast.success("登录成功");
      location.reload();
    } catch (err) {
      errorEl.textContent = err.message;
      loginBtn.disabled = false;
      loginBtn.textContent = "登 录";
    }
  };

  loginBtn.addEventListener("click", doLogin);
  pwdInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doLogin();
  });
}

async function logout() {
  try {
    await API.post("/api/auth/logout");
  } catch {}
  Toast.info("已退出登录");
  setTimeout(() => location.reload(), 500);
}

// ============================================================
// 管理端界面
// ============================================================
function showDashboard() {
  document.body.innerHTML = `
    <!-- 移动端菜单按钮 -->
    <button class="mobile-menu-btn" id="mobile-menu-btn" title="菜单">☰</button>

    <!-- 侧边栏遮罩（移动端） -->
    <div id="sidebar-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:99;" onclick="toggleMobileMenu()"></div>

    <div class="admin-layout">
      <!-- 侧边栏 -->
      <aside class="admin-sidebar" id="admin-sidebar">
        <div class="sidebar-header">
          <span style="font-size:1.5rem;">🏢</span>
          <h2>管理后台</h2>
        </div>
        <nav class="sidebar-nav">
          <button class="nav-item active" data-page="products">📦 产品管理</button>
          <button class="nav-item" data-page="categories">📁 分类管理</button>
          <button class="nav-item" data-page="orders">📋 订单管理</button>
          <button class="nav-item" data-page="catalog">📖 图册生成</button>
          <button class="nav-item" data-page="images">🗑 图片清理</button>
          <button class="nav-item" data-page="settings">⚙ 系统设置</button>
        </nav>
        <div class="sidebar-footer">
          <button class="btn btn-outline btn-sm" style="width:100%;" onclick="logout()">🚪 退出登录</button>
        </div>
      </aside>

      <!-- 主内容区 -->
      <main class="admin-main" id="admin-content">
        <div class="loading-overlay"><div class="spinner"></div> 加载中…</div>
      </main>
    </div>
  `;

  // 侧边栏导航
  $$("#admin-sidebar .nav-item").forEach((item) => {
    item.addEventListener("click", () => {
      currentPage = item.dataset.page;
      $$("#admin-sidebar .nav-item").forEach((n) => n.classList.remove("active"));
      item.classList.add("active");
      loadPage(currentPage);
      // 移动端关闭菜单
      const sidebar = $("#admin-sidebar");
      if (sidebar) sidebar.classList.remove("mobile-open");
      const overlay = $("#sidebar-overlay");
      if (overlay) overlay.style.display = "none";
    });
  });

  // 移动端菜单
  const menuBtn = $("#mobile-menu-btn");
  if (menuBtn) {
    menuBtn.addEventListener("click", toggleMobileMenu);
  }

  loadPage("products");
}

function toggleMobileMenu() {
  const sidebar = $("#admin-sidebar");
  const overlay = $("#sidebar-overlay");
  if (!sidebar) return;
  sidebar.classList.toggle("mobile-open");
  if (overlay) {
    overlay.style.display = sidebar.classList.contains("mobile-open") ? "" : "none";
  }
}

// ============================================================
// 页面路由
// ============================================================
async function loadPage(page) {
  currentPage = page;
  const content = $("#admin-content");
  if (!content) return;

  switch (page) {
    case "products": await renderProductsPage(content); break;
    case "categories": await renderCategoriesPage(content); break;
    case "orders": await renderOrdersPage(content); break;
    case "catalog": renderCatalogPage(content); break;
    case "images": await renderImagesPage(content); break;
    case "settings": await renderSettingsPage(content); break;
  }
}

// ============================================================
// 产品管理页
// ============================================================
async function renderProductsPage(container) {
  let categories = [];
  try {
    categories = await API.get("/api/categories");
  } catch {}

  // 先渲染页面框架
  container.innerHTML = `
    <div class="page-header">
      <h1>📦 产品管理</h1>
      <div class="actions">
        <button class="btn btn-primary" id="add-product-btn">+ 新增产品</button>
      </div>
    </div>
    <div class="toolbar">
      <input type="text" class="search-input" id="product-search" placeholder="搜索产品名称…" maxlength="200">
      <select class="filter-select" id="product-cat-filter">
        <option value="">全部分类</option>
        ${categories.map((c) => `<option value="${c.id}">${Esc.html(c.name)}</option>`).join("")}
      </select>
    </div>
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:60px;">图片</th>
            <th>名称</th>
            <th>价格</th>
            <th>分类</th>
            <th>排序</th>
            <th style="width:120px;">操作</th>
          </tr>
        </thead>
        <tbody id="product-table-body">
          <tr><td colspan="6"><div class="loading-overlay"><div class="spinner"></div> 加载中…</div></td></tr>
        </tbody>
      </table>
    </div>
  `;

  // 事件
  $("#add-product-btn").addEventListener("click", () => showProductForm());
  const searchInput = $("#product-search");
  const catFilter = $("#product-cat-filter");
  searchInput.addEventListener("input", debounce(() => refreshProductTable(), 300));
  catFilter.addEventListener("change", () => refreshProductTable());

  await refreshProductTable();
}

async function refreshProductTable() {
  const search = $("#product-search")?.value?.trim() || "";
  const catFilter = $("#product-cat-filter")?.value || "";
  const tbody = $("#product-table-body");
  if (!tbody) return;

  try {
    const params = [];
    if (search) params.push(`search=${encodeURIComponent(search)}`);
    if (catFilter) params.push(`category_id=${encodeURIComponent(catFilter)}`);
    let url = "/api/products";
    if (params.length) url += "?" + params.join("&");

    const products = await API.get(url);
    const categories = await API.get("/api/categories");
    const catMap = {};
    categories.forEach((c) => { catMap[c.id] = c.name; });

    if (products.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="icon">📦</div><div class="title">暂无产品</div><div class="desc">点击「新增产品」开始添加</div></div></td></tr>`;
      return;
    }

    tbody.innerHTML = products.map((p) => `
      <tr>
        <td>
          <div class="cell-image">
            ${p.image
              ? `<img src="${productImageUrl(p.image)}" alt="${Esc.html(p.name)}">`
              : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--text-muted);">无图</div>`}
          </div>
        </td>
        <td><strong>${Esc.html(p.name)}</strong></td>
        <td>${formatPrice(p.price)}<span class="text-muted text-sm"> /${Esc.html(p.unit || "个")}</span></td>
        <td>${p.category_id ? Esc.html(catMap[p.category_id] || "") : '<span class="text-muted">未分类</span>'}</td>
        <td>${p.sort_order ?? 0}</td>
        <td>
          <div class="cell-actions">
            <button class="btn btn-outline btn-sm" data-edit="${p.id}">编辑</button>
            <button class="btn btn-danger btn-sm" data-delete="${p.id}">删除</button>
          </div>
        </td>
      </tr>
    `).join("");

    // 绑定事件
    tbody.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => showProductForm(btn.dataset.edit));
    });
    tbody.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", () => deleteProduct(btn.dataset.delete));
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="icon">⚠</div><div class="title">加载失败</div></div></td></tr>`;
    Toast.error("加载产品失败: " + err.message);
  }
}

async function showProductForm(productId = null) {
  editingProductId = productId;

  let product = null;
  let categories = [];
  try {
    categories = await API.get("/api/categories");
    if (productId) {
      product = await API.get(`/api/products/${productId}`);
    }
  } catch (err) {
    Toast.error("加载数据失败: " + err.message);
    return;
  }

  const isEdit = !!product;
  const html = `
    <div class="modal-header">
      <h2>${isEdit ? "编辑产品" : "新增产品"}</h2>
      <button class="btn btn-icon btn-ghost btn-sm" onclick="Modal.close()">✕</button>
    </div>
    <div class="modal-body">
      <form class="product-form" id="product-form" enctype="multipart/form-data">
        <div class="form-group">
          <label class="form-label">产品名称 *</label>
          <input type="text" class="form-input" name="name" value="${Esc.html(product?.name || "")}" placeholder="请输入产品名称" maxlength="200" required>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">价格 *</label>
            <input type="number" class="form-input" name="price" value="${product?.price ?? 0}" placeholder="0 = 面议" min="0" step="0.01">
            <span class="form-hint">输入 0 表示"面议"</span>
          </div>
          <div class="form-group">
            <label class="form-label">单位</label>
            <input type="text" class="form-input" name="unit" value="${Esc.html(product?.unit || "个")}" placeholder="如：个、件、套" maxlength="20">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">描述</label>
          <textarea class="form-input" name="description" placeholder="产品描述（选填）" maxlength="2000" rows="3">${Esc.html(product?.description || "")}</textarea>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">分类</label>
            <select class="form-input" name="category_id">
              <option value="">未分类</option>
              ${categories.map((c) => `<option value="${c.id}" ${product?.category_id === c.id ? "selected" : ""}>${Esc.html(c.name)}</option>`).join("")}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">排序序号</label>
            <input type="number" class="form-input" name="sort_order" value="${product?.sort_order ?? 0}" min="0">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">产品图片</label>
          <div class="image-preview" id="image-preview" onclick="document.getElementById('image-input').click()">
            ${product?.image
              ? `<img src="${productImageUrl(product.image)}" alt="预览">`
              : `<div class="placeholder">📷<br>点击上传图片<br><span class="text-muted">JPG/PNG/WebP/GIF · 最大10MB</span></div>`}
          </div>
          <input type="file" id="image-input" name="image" accept="image/jpeg,image/png,image/webp,image/gif" style="display:none;">
          <span class="form-hint" id="image-name"></span>
        </div>
      </form>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="Modal.close()">取消</button>
      <button class="btn btn-primary" id="save-product-btn">${isEdit ? "保存修改" : "创建产品"}</button>
    </div>
  `;

  Modal.show(html, { wide: true });

  // 图片预览
  const imageInput = document.getElementById("image-input");
  if (imageInput) {
    imageInput.addEventListener("change", () => {
      const file = imageInput.files[0];
      if (file) {
        document.getElementById("image-name").textContent = `已选择: ${file.name} (${(file.size/1024).toFixed(1)} KB)`;
        const reader = new FileReader();
        reader.onload = (e) => {
          const preview = document.getElementById("image-preview");
          preview.innerHTML = `<img src="${e.target.result}" alt="预览">`;
        };
        reader.readAsDataURL(file);
      }
    });
  }

  // 保存
  const saveBtn = document.getElementById("save-product-btn");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      const form = document.getElementById("product-form");
      const formData = new FormData(form);

      // 如果没有选新图片，删除 image 字段以保留原图
      const fileInput = document.getElementById("image-input");
      if (fileInput && !fileInput.files[0]) {
        formData.delete("image");
      }

      saveBtn.disabled = true;
      saveBtn.textContent = "保存中…";

      try {
        if (isEdit) {
          await API.put(`/api/products/${productId}`, formData, { isFormData: true });
          Toast.success("产品已更新");
        } else {
          await API.post("/api/products", formData, { isFormData: true });
          Toast.success("产品已创建");
        }
        Modal.close();
        await refreshProductTable();
      } catch (err) {
        Toast.error("保存失败: " + err.message);
        saveBtn.disabled = false;
        saveBtn.textContent = isEdit ? "保存修改" : "创建产品";
      }
    });
  }
}

async function deleteProduct(productId) {
  const ok = await Modal.confirm("删除产品", "确定要删除该产品吗？产品图片将保留待清理。", "删除", true);
  if (!ok) return;

  try {
    await API.delete(`/api/products/${productId}`);
    Toast.success("产品已删除");
    await refreshProductTable();
  } catch (err) {
    Toast.error("删除失败: " + err.message);
  }
}

// ============================================================
// 分类管理页
// ============================================================
async function renderCategoriesPage(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>📁 分类管理</h1>
      <div class="actions">
        <button class="btn btn-primary" id="add-cat-btn">+ 新增分类</button>
      </div>
    </div>
    <div class="category-list" id="category-list">
      <div class="loading-overlay"><div class="spinner"></div> 加载中…</div>
    </div>
  `;

  $("#add-cat-btn").addEventListener("click", () => showCategoryForm());
  await refreshCategoryList();
}

async function refreshCategoryList() {
  const list = $("#category-list");
  if (!list) return;

  try {
    const categories = await API.get("/api/categories");
    const products = await API.get("/api/products");

    if (categories.length === 0) {
      list.innerHTML = `<div class="empty-state"><div class="icon">📁</div><div class="title">暂无分类</div><div class="desc">点击「新增分类」开始创建</div></div>`;
      return;
    }

    list.innerHTML = categories.map((c) => {
      const count = products.filter((p) => p.category_id === c.id).length;
      return `
        <div class="cat-row">
          <span class="cat-name">${Esc.html(c.name)}</span>
          <span class="cat-count">${count} 件产品</span>
          <div class="cell-actions">
            <button class="btn btn-outline btn-sm" data-edit-cat="${c.id}">编辑</button>
            <button class="btn btn-danger btn-sm" data-delete-cat="${c.id}">删除</button>
          </div>
        </div>
      `;
    }).join("");

    list.querySelectorAll("[data-edit-cat]").forEach((btn) => {
      btn.addEventListener("click", () => showCategoryForm(btn.dataset.editCat));
    });
    list.querySelectorAll("[data-delete-cat]").forEach((btn) => {
      btn.addEventListener("click", () => deleteCategory(btn.dataset.deleteCat));
    });
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><div class="icon">⚠</div><div class="title">加载失败</div></div>`;
    Toast.error("加载分类失败: " + err.message);
  }
}

async function showCategoryForm(catId = null) {
  let cat = null;
  if (catId) {
    try {
      const cats = await API.get("/api/categories");
      cat = cats.find((c) => c.id === catId) || null;
    } catch {}
  }

  const isEdit = !!cat;
  const html = `
    <div class="modal-header">
      <h2>${isEdit ? "编辑分类" : "新增分类"}</h2>
      <button class="btn btn-icon btn-ghost btn-sm" onclick="Modal.close()">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">分类名称 *</label>
        <input type="text" class="form-input" id="cat-name" value="${Esc.html(cat?.name || "")}" placeholder="请输入分类名称" maxlength="100">
      </div>
      <div class="form-group mt">
        <label class="form-label">排序序号</label>
        <input type="number" class="form-input" id="cat-sort" value="${cat?.sort_order ?? 0}" min="0">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="Modal.close()">取消</button>
      <button class="btn btn-primary" id="save-cat-btn">${isEdit ? "保存" : "创建"}</button>
    </div>
  `;

  Modal.show(html);

  const saveBtn = document.getElementById("save-cat-btn");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      const name = document.getElementById("cat-name")?.value.trim();
      if (!name) { Toast.error("请输入分类名称"); return; }
      const sortOrder = parseInt(document.getElementById("cat-sort")?.value || "0");

      saveBtn.disabled = true;
      try {
        if (isEdit) {
          await API.put(`/api/categories/${catId}`, { name, sort_order: sortOrder });
          Toast.success("分类已更新");
        } else {
          await API.post("/api/categories", { name, sort_order: sortOrder });
          Toast.success("分类已创建");
        }
        Modal.close();
        await refreshCategoryList();
      } catch (err) {
        Toast.error("保存失败: " + err.message);
        saveBtn.disabled = false;
      }
    });
  }
}

async function deleteCategory(catId) {
  const ok = await Modal.confirm("删除分类", "确定要删除该分类吗？如果有关联产品将无法删除。", "删除", true);
  if (!ok) return;

  try {
    await API.delete(`/api/categories/${catId}`);
    Toast.success("分类已删除");
    await refreshCategoryList();
  } catch (err) {
    Toast.error("删除失败: " + err.message);
  }
}

// ============================================================
// 订单管理页
// ============================================================
let orderStatusFilter = "";

async function renderOrdersPage(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>📋 订单管理</h1>
    </div>
    <div class="status-tabs">
      <button class="status-tab${orderStatusFilter === "" ? " active" : ""}" data-status="">全部</button>
      <button class="status-tab${orderStatusFilter === "pending" ? " active" : ""}" data-status="pending">⏳ 待处理</button>
      <button class="status-tab${orderStatusFilter === "processing" ? " active" : ""}" data-status="processing">🔄 处理中</button>
      <button class="status-tab${orderStatusFilter === "completed" ? " active" : ""}" data-status="completed">✅ 已完成</button>
    </div>
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>订单编号</th>
            <th>客户</th>
            <th>手机号</th>
            <th>金额</th>
            <th>状态</th>
            <th>时间</th>
            <th style="width:120px;">操作</th>
          </tr>
        </thead>
        <tbody id="order-table-body">
          <tr><td colspan="7"><div class="loading-overlay"><div class="spinner"></div> 加载中…</div></td></tr>
        </tbody>
      </table>
    </div>
  `;

  // 状态筛选标签
  $$(".status-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      orderStatusFilter = tab.dataset.status;
      renderOrdersPage(container);
    });
  });

  await refreshOrderTable();
}

async function refreshOrderTable() {
  const tbody = $("#order-table-body");
  if (!tbody) return;

  try {
    let url = "/api/orders";
    if (orderStatusFilter) url += `?status=${orderStatusFilter}`;
    const orders = await API.get(url);

    if (orders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="icon">📋</div><div class="title">暂无订单</div></div></td></tr>`;
      return;
    }

    const statusLabels = { pending: "⏳ 待处理", processing: "🔄 处理中", completed: "✅ 已完成" };
    const statusBadges = { pending: "badge-warning", processing: "badge-primary", completed: "badge-success" };

    tbody.innerHTML = orders.map((o) => `
      <tr>
        <td><code class="text-sm">${Esc.html(o.id.substring(0, 8).toUpperCase())}</code></td>
        <td>${Esc.html(o.user.nickname)}</td>
        <td>${Esc.html(o.user.phone)}</td>
        <td><strong>${formatPrice(o.total)}</strong></td>
        <td><span class="badge ${statusBadges[o.status] || "badge-neutral"}">${statusLabels[o.status] || o.status}</span></td>
        <td class="text-sm text-secondary">${formatDate(o.created_at)}</td>
        <td>
          <div class="cell-actions">
            <button class="btn btn-outline btn-sm" data-view-order="${o.id}">详情</button>
            ${o.status !== "completed"
              ? `<button class="btn btn-sm ${o.status === "pending" ? "btn-primary" : "btn-success"}" data-status-order="${o.id}">
                  ${o.status === "pending" ? "开始处理" : "完成"}
                </button>`
              : ""}
          </div>
        </td>
      </tr>
    `).join("");

    tbody.querySelectorAll("[data-view-order]").forEach((btn) => {
      btn.addEventListener("click", () => viewOrderDetail(btn.dataset.viewOrder));
    });
    tbody.querySelectorAll("[data-status-order]").forEach((btn) => {
      btn.addEventListener("click", () => advanceOrderStatus(btn.dataset.statusOrder, orders));
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="icon">⚠</div><div class="title">加载失败</div></div></td></tr>`;
    Toast.error("加载订单失败: " + err.message);
  }
}

function viewOrderDetail(orderId) {
  API.get(`/api/orders/${orderId}`).then((o) => {
    const statusLabels = { pending: "待处理", processing: "处理中", completed: "已完成" };
    const itemsHtml = o.items.map((item) => `
      <tr>
        <td>${Esc.html(item.product_name)}</td>
        <td style="text-align:center;">×${item.quantity}</td>
        <td style="text-align:right;">${formatPrice(item.price)}</td>
        <td style="text-align:right;">${formatPrice(item.subtotal)}</td>
      </tr>
    `).join("");

    const html = `
      <div class="modal-header">
        <h2>订单详情</h2>
        <button class="btn btn-icon btn-ghost btn-sm" onclick="Modal.close()">✕</button>
      </div>
      <div class="modal-body">
        <div class="order-detail-section">
          <h3>基本信息</h3>
          <p><strong>订单编号：</strong><code>${Esc.html(o.id.substring(0, 8).toUpperCase())}</code></p>
          <p><strong>状态：</strong><span class="badge badge-${o.status === 'completed' ? 'success' : o.status === 'processing' ? 'primary' : 'warning'}">${statusLabels[o.status]}</span></p>
          <p><strong>客户：</strong>${Esc.html(o.user.nickname)} (${Esc.html(o.user.phone)})</p>
          <p><strong>提交时间：</strong>${formatDate(o.created_at)}</p>
          <p><strong>备注：</strong>${o.note ? Esc.html(o.note) : '<span class="text-muted">无</span>'}</p>
        </div>
        <div class="order-detail-section">
          <h3>产品明细</h3>
          <table class="data-table">
            <thead><tr><th>产品</th><th style="width:60px;">数量</th><th style="width:100px;">单价</th><th style="width:100px;">小计</th></tr></thead>
            <tbody>${itemsHtml}</tbody>
          </table>
        </div>
        <p class="text-right mt" style="font-size:1.125rem;"><strong>总计：${formatPrice(o.total)}</strong></p>
      </div>
    `;
    Modal.show(html, { wide: true });
  }).catch((err) => {
    Toast.error("加载订单详情失败: " + err.message);
  });
}

async function advanceOrderStatus(orderId, currentOrders) {
  const order = (currentOrders || []).find((o) => o.id === orderId);
  if (!order) return;

  const newStatus = order.status === "pending" ? "processing" : "completed";
  const label = newStatus === "processing" ? "开始处理" : "标记完成";

  const ok = await Modal.confirm("更新状态", `确定要${label}该订单吗？`);
  if (!ok) return;

  try {
    await API.patch(`/api/orders/${orderId}/status`, { status: newStatus });
    Toast.success(`订单状态已更新为"${newStatus === "processing" ? "处理中" : "已完成"}"`);
    await refreshOrderTable();
  } catch (err) {
    Toast.error("更新失败: " + err.message);
  }
}

// ============================================================
// 图册生成页
// ============================================================
function renderCatalogPage(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>📖 产品图册</h1>
    </div>
    <div class="card p-md" style="max-width:480px;">
      <p class="mb">生成一份包含所有产品信息的静态 HTML 页面，可按分类浏览，也支持打印输出为 PDF。</p>
      <div class="catalog-actions">
        <button class="btn btn-primary" id="preview-catalog-btn">🖥 在新标签页预览</button>
        <button class="btn btn-outline" id="open-catalog-btn">📄 直接打开图册</button>
      </div>
      <div class="mt text-sm text-secondary">
        <p>💡 提示：预览页面打开后，可使用浏览器的「打印 → 另存为 PDF」功能导出 PDF 文件。</p>
      </div>
    </div>
  `;

  $("#preview-catalog-btn").addEventListener("click", () => {
    window.open("/api/catalog", "_blank");
  });
  $("#open-catalog-btn").addEventListener("click", () => {
    window.location.href = "/api/catalog";
  });
}

// ============================================================
// 图片清理页
// ============================================================
async function renderImagesPage(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>🗑 图片清理</h1>
      <div class="actions">
        <button class="btn btn-danger" id="cleanup-images-btn" disabled>清理全部孤立图片</button>
      </div>
    </div>
    <div id="orphan-info">
      <div class="loading-overlay"><div class="spinner"></div> 检查中…</div>
    </div>
    <div class="orphan-grid" id="orphan-grid"></div>
  `;

  await refreshOrphanImages();

  $("#cleanup-images-btn").addEventListener("click", async () => {
    const ok = await Modal.confirm("清理图片", "确定要删除所有未被任何产品引用的图片吗？此操作不可恢复。", "确认清理", true);
    if (!ok) return;
    try {
      const res = await API.post("/api/images/cleanup");
      Toast.success(`已清理 ${res.deleted} 个孤立图片`);
      await refreshOrphanImages();
    } catch (err) {
      Toast.error("清理失败: " + err.message);
    }
  });
}

async function refreshOrphanImages() {
  try {
    const res = await API.get("/api/images/orphans");
    const info = $("#orphan-info");
    const grid = $("#orphan-grid");
    const btn = $("#cleanup-images-btn");

    if (info) {
      info.innerHTML = `<p class="mb">共有 <strong>${res.count}</strong> 个孤立图片（未被任何产品引用）</p>`;
    }

    if (grid) {
      if (res.images.length === 0) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><div class="icon">✨</div><div class="title">没有孤立图片</div><div class="desc">所有图片都被正常引用</div></div>`;
      } else {
        grid.innerHTML = res.images.map((img) => `
          <div class="orphan-card">
            <div class="thumb">
              <img src="/uploads/${img.filename}" alt="${Esc.html(img.filename)}" loading="lazy" onerror="this.parentElement.innerHTML='<div style=\\'height:120px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:12px;\\'>加载失败</div>'">
            </div>
            <div class="info">
              <div class="truncate" title="${Esc.html(img.filename)}">${Esc.html(img.filename)}</div>
              <div>${(img.size / 1024).toFixed(1)} KB</div>
            </div>
          </div>
        `).join("");
      }
    }

    if (btn) btn.disabled = res.count === 0;
  } catch (err) {
    Toast.error("加载失败: " + err.message);
  }
}

// ============================================================
// 系统设置页
// ============================================================
async function renderSettingsPage(container) {
  let settings = {};
  try {
    settings = await API.get("/api/settings");
  } catch {}

  container.innerHTML = `
    <div class="page-header">
      <h1>⚙ 系统设置</h1>
    </div>

    <div class="settings-section">
      <h3>🔔 Webhook 通知</h3>
      <div class="form-group mb">
        <label class="form-label">Webhook URL</label>
        <input type="url" class="form-input" id="webhook-url" value="${Esc.html(settings.webhook_url || "")}" placeholder="企业微信/钉钉机器人 Webhook 地址">
      </div>
      <div class="form-group mb">
        <label class="form-label">Webhook 类型</label>
        <select class="form-input" id="webhook-type" style="max-width:200px;">
          <option value="wecom" ${settings.webhook_type === "wecom" ? "selected" : ""}>企业微信</option>
          <option value="dingtalk" ${settings.webhook_type === "dingtalk" ? "selected" : ""}>钉钉</option>
        </select>
      </div>
      <div style="display:flex;gap:var(--space-sm);">
        <button class="btn btn-primary" id="save-webhook-btn">保存 Webhook 配置</button>
        <button class="btn btn-outline" id="test-webhook-btn">发送测试消息</button>
      </div>
    </div>

    <div class="settings-section">
      <h3>🔑 修改管理密码</h3>
      <div class="form-group mb">
        <label class="form-label">旧密码</label>
        <input type="password" class="form-input" id="old-pwd" placeholder="输入当前密码" style="max-width:320px;">
      </div>
      <div class="form-group mb">
        <label class="form-label">新密码</label>
        <input type="password" class="form-input" id="new-pwd" placeholder="至少 6 位字符" minlength="6" style="max-width:320px;">
      </div>
      <div class="form-group mb">
        <label class="form-label">确认新密码</label>
        <input type="password" class="form-input" id="confirm-pwd" placeholder="再次输入新密码" style="max-width:320px;">
      </div>
      <button class="btn btn-primary" id="change-pwd-btn">修改密码</button>
    </div>

    <div class="settings-section">
      <h3>🌐 服务端口</h3>
      <p class="text-sm text-secondary mb">当前端口：<strong>${settings.port || 8080}</strong></p>
      <p class="text-xs text-muted">修改端口需编辑 config.json 中的 port 字段，然后重启服务器生效。</p>
    </div>
  `;

  // 保存 Webhook
  $("#save-webhook-btn").addEventListener("click", async () => {
    const webhook_url = document.getElementById("webhook-url")?.value.trim() || "";
    const webhook_type = document.getElementById("webhook-type")?.value || "wecom";
    try {
      await API.put("/api/settings", { webhook_url, webhook_type });
      Toast.success("Webhook 配置已保存");
    } catch (err) {
      Toast.error("保存失败: " + err.message);
    }
  });

  // 测试 Webhook
  $("#test-webhook-btn").addEventListener("click", async () => {
    const btn = $("#test-webhook-btn");
    btn.disabled = true;
    btn.textContent = "发送中…";
    try {
      const res = await API.post("/api/webhook/test");
      Toast.success(res.message || "测试消息已发送");
    } catch (err) {
      Toast.error("测试失败: " + err.message);
    }
    btn.disabled = false;
    btn.textContent = "发送测试消息";
  });

  // 修改密码
  $("#change-pwd-btn").addEventListener("click", async () => {
    const oldPwd = document.getElementById("old-pwd")?.value || "";
    const newPwd = document.getElementById("new-pwd")?.value || "";
    const confirmPwd = document.getElementById("confirm-pwd")?.value || "";

    if (!oldPwd) { Toast.error("请输入旧密码"); return; }
    if (!newPwd) { Toast.error("请输入新密码"); return; }
    if (newPwd.length < 6) { Toast.error("新密码至少 6 位"); return; }
    if (newPwd !== confirmPwd) { Toast.error("两次输入的新密码不一致"); return; }

    try {
      await API.put("/api/settings", { old_password: oldPwd, new_password: newPwd });
      Toast.success("密码修改成功，下次登录请使用新密码");
      document.getElementById("old-pwd").value = "";
      document.getElementById("new-pwd").value = "";
      document.getElementById("confirm-pwd").value = "";
    } catch (err) {
      Toast.error("修改失败: " + err.message);
    }
  });
}
