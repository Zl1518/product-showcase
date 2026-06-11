/* ============================================================
   企业产品展示与点单系统 — 用户端交互逻辑
   ============================================================ */

// ---------- 全局状态 ----------
let allProducts = [];
let allCategories = [];
let currentCategory = "";  // "" 表示全部
let currentSearch = "";

// ---------- DOM 引用 ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---------- 初始化 ----------
document.addEventListener("DOMContentLoaded", () => {
  initNavbar();
  loadCategories();
  loadProducts();
  updateCartBadge();
  updateUserDisplay();
});

// ============================================================
// 导航栏
// ============================================================
function initNavbar() {
  // 搜索（防抖）
  const searchInput = $("#search-input");
  if (searchInput) {
    searchInput.addEventListener("input", debounce((e) => {
      currentSearch = e.target.value.trim();
      renderProducts();
    }, 300));
  }

  // 用户身份按钮
  const userBtn = $("#user-btn");
  if (userBtn) {
    userBtn.addEventListener("click", showUserForm);
  }

  // 购物车按钮
  const cartBtn = $("#cart-btn");
  if (cartBtn) {
    cartBtn.addEventListener("click", openCart);
  }
}

// ============================================================
// 分类加载
// ============================================================
async function loadCategories() {
  try {
    allCategories = await API.get("/api/categories");
    renderCategoryBar();
  } catch (err) {
    console.error("加载分类失败:", err);
  }
}

function renderCategoryBar() {
  const bar = $("#category-bar");
  if (!bar) return;

  let html = `<button class="cat-tag${currentCategory === "" ? " active" : ""}" data-cat="">
    全部 <span class="count">${allProducts.length}</span>
  </button>`;

  allCategories.forEach((cat) => {
    const count = allProducts.filter((p) => p.category_id === cat.id).length;
    html += `<button class="cat-tag${currentCategory === cat.id ? " active" : ""}" data-cat="${Esc.html(cat.id)}">
      ${Esc.html(cat.name)} <span class="count">${count}</span>
    </button>`;
  });

  bar.innerHTML = html;

  // 点击事件
  bar.querySelectorAll(".cat-tag").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentCategory = btn.dataset.cat;
      renderCategoryBar();
      renderProducts();
    });
  });
}

// ============================================================
// 产品加载与渲染
// ============================================================
async function loadProducts() {
  const grid = $("#product-grid");
  if (!grid) return;
  grid.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> 加载产品中…</div>';

  try {
    let url = "/api/products";
    const params = [];
    if (currentCategory) params.push(`category_id=${encodeURIComponent(currentCategory)}`);
    if (currentSearch) params.push(`search=${encodeURIComponent(currentSearch)}`);
    if (params.length) url += "?" + params.join("&");

    allProducts = await API.get(url);
    renderProducts();
    renderCategoryBar(); // 更新分类标签中的计数
  } catch (err) {
    console.error("加载产品失败:", err);
    Toast.error("加载产品失败: " + err.message);
    grid.innerHTML = '<div class="empty-state"><div class="icon">⚠</div><div class="title">加载失败</div><div class="desc">请检查网络连接后刷新页面</div></div>';
  }
}

function renderProducts() {
  const grid = $("#product-grid");
  if (!grid) return;

  if (allProducts.length === 0) {
    grid.innerHTML = `<div class="empty-state">
      <div class="icon">📦</div>
      <div class="title">${currentSearch ? "未找到匹配的产品" : "暂无产品"}</div>
      <div class="desc">${currentSearch ? "请尝试其他关键词" : "管理员尚未添加产品"}</div>
    </div>`;
    return;
  }

  let html = "";
  allProducts.forEach((p) => {
    const priceText = formatPrice(p.price);
    const isNegotiable = p.price === 0 || p.price == null;
    const cartItems = Cart.getAll();
    const inCart = cartItems.find((ci) => ci.product_id === p.id);
    const catName = p.category_name || "";

    html += `<div class="product-card" data-id="${p.id}">
      <div class="card-image" data-action="detail">
        ${p.image
          ? `<img src="${productImageUrl(p.image)}" alt="${Esc.html(p.name)}" loading="lazy">`
          : `<div class="no-image">暂无图片</div>`}
      </div>
      <div class="card-body" data-action="detail">
        ${catName ? `<span class="card-cat">${Esc.html(catName)}</span>` : ""}
        <div class="card-name">${Esc.html(p.name)}</div>
        ${p.description ? `<div class="card-desc">${Esc.html(p.description)}</div>` : ""}
      </div>
      <div class="card-footer">
        <span class="card-price${isNegotiable ? " negotiable" : ""}">
          ${priceText}<span class="unit">${isNegotiable ? "" : "/" + Esc.html(p.unit || "个")}</span>
        </span>
        ${inCart
          ? `<div class="quantity-ctrl">
              <button data-action="qty-dec" data-id="${p.id}">−</button>
              <span class="qty">${inCart.quantity}</span>
              <button data-action="qty-inc" data-id="${p.id}">+</button>
            </div>`
          : `<button class="add-cart-btn" data-action="add-cart" data-id="${p.id}" title="加入购物车">+</button>`}
      </div>
    </div>`;
  });

  grid.innerHTML = html;

  // 事件委托
  grid.querySelectorAll(".product-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      const action = e.target.closest("[data-action]");
      if (!action) return;

      const pid = action.dataset.id;
      const act = action.dataset.action;

      if (act === "detail") {
        showProductDetail(pid);
      } else if (act === "add-cart") {
        e.stopPropagation();
        addToCartFromCard(pid, action);
      } else if (act === "qty-dec") {
        e.stopPropagation();
        changeCartQty(pid, -1);
      } else if (act === "qty-inc") {
        e.stopPropagation();
        changeCartQty(pid, 1);
      }
    });
  });
}

// ============================================================
// 购物车操作（卡片内联）
// ============================================================
function addToCartFromCard(productId, btnEl) {
  const prod = allProducts.find((p) => p.id === productId);
  if (!prod) return;

  Cart.add(prod, 1);
  updateCartBadge();

  // 动画反馈
  btnEl.classList.add("added");
  btnEl.textContent = "✓";
  setTimeout(() => {
    renderProducts(); // 刷新卡片以显示数量控件
  }, 400);

  Toast.success(`已添加「${prod.name}」到购物车`);
}

function changeCartQty(productId, delta) {
  const items = Cart.getAll();
  const item = items.find((i) => i.product_id === productId);
  if (!item) return;

  const newQty = item.quantity + delta;
  if (newQty <= 0) {
    Cart.remove(productId);
    Toast.info("已从购物车移除");
  } else if (newQty > 999) {
    Toast.warning("数量不能超过 999");
    return;
  } else {
    Cart.update(productId, newQty);
  }
  updateCartBadge();
  renderProducts();
}

// ============================================================
// 产品详情弹窗
// ============================================================
function showProductDetail(productId) {
  const prod = allProducts.find((p) => p.id === productId);
  if (!prod) return;

  const inCart = Cart.getAll().find((i) => i.product_id === productId);
  const initQty = inCart ? inCart.quantity : 1;

  const html = `
    <div class="modal-header">
      <h2>产品详情</h2>
      <button class="btn btn-icon btn-ghost btn-sm" onclick="Modal.close()" title="关闭">✕</button>
    </div>
    <div class="modal-body">
      <div class="product-detail">
        <div class="detail-image">
          ${prod.image
            ? `<img src="${productImageUrl(prod.image)}" alt="${Esc.html(prod.name)}" onclick="window.open(this.src)">`
            : `<div class="no-image" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-muted);">暂无图片</div>`}
        </div>
        <div class="detail-info">
          <div class="detail-name">${Esc.html(prod.name)}</div>
          <div class="detail-price">
            ${formatPrice(prod.price)}<span class="unit">${prod.price === 0 ? "" : " /" + Esc.html(prod.unit || "个")}</span>
          </div>
          ${prod.description ? `<div class="detail-desc">${Esc.htmlWithBreaks(prod.description)}</div>` : ""}
          <div class="detail-actions">
            <div class="qty-input">
              <button id="detail-qty-dec">−</button>
              <input type="number" id="detail-qty" value="${initQty}" min="1" max="999" readonly>
              <button id="detail-qty-inc">+</button>
            </div>
            <button class="btn btn-primary" id="detail-add-cart">
              ${inCart ? "更新购物车" : "加入购物车"}
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  const modal = Modal.show(html, { wide: true });
  if (!modal) return;

  const qtyInput = modal.querySelector("#detail-qty");
  let qty = initQty;

  modal.querySelector("#detail-qty-dec").addEventListener("click", () => {
    if (qty > 1) { qty--; qtyInput.value = qty; }
  });
  modal.querySelector("#detail-qty-inc").addEventListener("click", () => {
    if (qty < 999) { qty++; qtyInput.value = qty; }
  });
  modal.querySelector("#detail-add-cart").addEventListener("click", () => {
    Cart.add(prod, qty);
    updateCartBadge();
    renderProducts();
    Modal.close();
    Toast.success(`已添加 ${qty} 件「${prod.name}」`);
  });
}

// ============================================================
// 购物车侧边栏
// ============================================================
function openCart() {
  // 创建遮罩
  let overlay = $("#cart-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "cart-overlay";
    overlay.id = "cart-overlay";
    overlay.addEventListener("click", closeCart);
    document.body.appendChild(overlay);
  }

  // 创建侧边栏
  let sidebar = $("#cart-sidebar");
  if (!sidebar) {
    sidebar = document.createElement("div");
    sidebar.className = "cart-sidebar";
    sidebar.id = "cart-sidebar";
    document.body.appendChild(sidebar);
  }

  renderCartContent(sidebar);
  requestAnimationFrame(() => {
    overlay.classList.add("open");
    sidebar.classList.add("open");
  });
}

function closeCart() {
  const overlay = $("#cart-overlay");
  const sidebar = $("#cart-sidebar");
  if (overlay) overlay.classList.remove("open");
  if (sidebar) sidebar.classList.remove("open");
}

function renderCartContent(sidebar) {
  const items = Cart.getAll();
  const user = UserInfo.get();

  let itemsHtml = "";
  if (items.length === 0) {
    itemsHtml = `<div class="empty-state"><div class="icon">🛒</div><div class="title">购物车为空</div><div class="desc">去逛逛产品页面吧</div></div>`;
  } else {
    itemsHtml = items.map((item) => `
      <div class="cart-item">
        <div class="item-image">
          ${item.image
            ? `<img src="${productImageUrl(item.image)}" alt="${Esc.html(item.product_name)}">`
            : `<div class="no-image" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--text-muted);">无图</div>`}
        </div>
        <div class="item-info">
          <div class="item-name">${Esc.html(item.product_name)}</div>
          <div class="item-price">${formatPrice(item.price)}</div>
        </div>
        <div class="item-qty">
          <button data-cart-dec="${item.product_id}">−</button>
          <span>${item.quantity}</span>
          <button data-cart-inc="${item.product_id}">+</button>
        </div>
        <div class="item-subtotal">${formatPrice(item.price * item.quantity)}</div>
        <button class="item-remove" data-cart-remove="${item.product_id}" title="移除">✕</button>
      </div>
    `).join("");
  }

  sidebar.innerHTML = `
    <div class="cart-header">
      <h2>🛒 购物车（<span id="cart-item-count">${items.length}</span>）</h2>
      <div>
        ${items.length ? '<button class="btn btn-ghost btn-sm" id="clear-cart-btn">清空</button>' : ""}
        <button class="btn btn-icon btn-ghost btn-sm" onclick="closeCart()" title="关闭">✕</button>
      </div>
    </div>
    <div class="cart-items">${itemsHtml}</div>
    ${items.length ? `
    <div class="cart-footer">
      <div class="cart-total">
        <span>合计</span>
        <span>${formatPrice(Cart.total())}</span>
      </div>
      <div class="cart-note">
        <textarea placeholder="订单备注（选填）" id="cart-note" maxlength="500"></textarea>
      </div>
      <div class="cart-user">
        <input type="text" id="cart-nickname" placeholder="您的昵称 *" value="${Esc.html(user?.nickname || "")}" maxlength="50">
        <input type="tel" id="cart-phone" placeholder="手机号 *" value="${Esc.html(user?.phone || "")}" maxlength="20">
      </div>
      <button class="btn btn-primary submit-order-btn" id="submit-order-btn">提交订单</button>
    </div>
    ` : ""}
  `;

  // 绑定事件
  if (items.length) {
    sidebar.querySelectorAll("[data-cart-dec]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = Cart.getAll().find((i) => i.product_id === btn.dataset.cartDec);
        if (item && item.quantity <= 1) {
          Cart.remove(item.product_id);
        } else {
          Cart.update(btn.dataset.cartDec, (item?.quantity || 1) - 1);
        }
        updateCartBadge();
        renderProducts();
        renderCartContent(sidebar);
      });
    });

    sidebar.querySelectorAll("[data-cart-inc]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = Cart.getAll().find((i) => i.product_id === btn.dataset.cartInc);
        Cart.update(btn.dataset.cartInc, (item?.quantity || 0) + 1);
        updateCartBadge();
        renderProducts();
        renderCartContent(sidebar);
      });
    });

    sidebar.querySelectorAll("[data-cart-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        Cart.remove(btn.dataset.cartRemove);
        updateCartBadge();
        renderProducts();
        renderCartContent(sidebar);
      });
    });

    const clearBtn = sidebar.querySelector("#clear-cart-btn");
    if (clearBtn) {
      clearBtn.addEventListener("click", async () => {
        const ok = await Modal.confirm("清空购物车", "确定要清空购物车吗？", "确定清空", true);
        if (ok) {
          Cart.clear();
          updateCartBadge();
          renderProducts();
          renderCartContent(sidebar);
          Toast.info("购物车已清空");
        }
      });
    }

    const submitBtn = sidebar.querySelector("#submit-order-btn");
    if (submitBtn) {
      submitBtn.addEventListener("click", submitOrder);
    }
  }
}

function updateCartBadge() {
  const count = Cart.count();
  const badge = $("#cart-count");
  if (badge) {
    badge.textContent = count || "";
    badge.style.display = count > 0 ? "" : "none";
  }
}

// ============================================================
// 订单提交
// ============================================================
async function submitOrder() {
  const items = Cart.getAll();
  if (items.length === 0) {
    Toast.error("购物车为空");
    return;
  }

  const nickname = ($("#cart-nickname")?.value || "").trim();
  const phone = ($("#cart-phone")?.value || "").trim();
  if (!nickname) { Toast.error("请填写昵称"); return; }
  if (!phone) { Toast.error("请填写手机号"); return; }
  if (!/^\d{5,20}$/.test(phone)) { Toast.error("手机号格式不正确"); return; }

  const note = ($("#cart-note")?.value || "").trim();
  const userInfo = UserInfo.save(nickname, phone);
  updateUserDisplay();

  const btn = $("#submit-order-btn");
  btn.disabled = true;
  btn.textContent = "提交中…";

  try {
    const order = await API.post("/api/orders", {
      user: { nickname, phone },
      items: items.map((i) => ({
        product_id: i.product_id,
        quantity: i.quantity,
      })),
      note,
    });

    Cart.clear();
    updateCartBadge();
    renderProducts();
    closeCart();

    showOrderSuccess(order);
    Toast.success("订单提交成功！");
  } catch (err) {
    Toast.error("订单提交失败: " + err.message);
    btn.disabled = false;
    btn.textContent = "提交订单";
  }
}

function showOrderSuccess(order) {
  const itemsHtml = order.items.map((item) => `
    <tr>
      <td style="padding:4px 8px;">${Esc.html(item.product_name)}</td>
      <td style="padding:4px 8px;text-align:center;">×${item.quantity}</td>
      <td style="padding:4px 8px;text-align:right;">${formatPrice(item.subtotal)}</td>
    </tr>
  `).join("");

  const html = `
    <div class="order-success">
      <div class="success-icon">✓</div>
      <h2>订单提交成功</h2>
      <p class="text-secondary">订单已提交，管理员将尽快处理</p>
      <div class="order-info">
        <p><strong>订单编号：</strong>${Esc.html(order.id.substring(0, 8).toUpperCase())}</p>
        <p><strong>提交时间：</strong>${formatDate(order.created_at)}</p>
        <p><strong>客户：</strong>${Esc.html(order.user.nickname)} (${Esc.html(order.user.phone)})</p>
        <p><strong>金额：</strong>${formatPrice(order.total)}</p>
        <hr style="margin:8px 0;border:none;border-top:1px solid var(--border);">
        <table style="width:100%;">${itemsHtml}</table>
      </div>
      <button class="btn btn-primary" onclick="Modal.close()">继续浏览</button>
    </div>
  `;

  Modal.show(html, { closable: false });
}

// ============================================================
// 用户身份
// ============================================================
function showUserForm() {
  const user = UserInfo.get();
  const html = `
    <div class="modal-header">
      <h2>${user ? "修改信息" : "填写信息"}</h2>
      <button class="btn btn-icon btn-ghost btn-sm" onclick="Modal.close()">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group mb">
        <label class="form-label">昵称 *</label>
        <input type="text" class="form-input" id="user-nickname" value="${Esc.html(user?.nickname || "")}" placeholder="请输入您的昵称" maxlength="50">
      </div>
      <div class="form-group mb">
        <label class="form-label">手机号 *</label>
        <input type="tel" class="form-input" id="user-phone" value="${Esc.html(user?.phone || "")}" placeholder="请输入手机号" maxlength="20">
      </div>
    </div>
    <div class="modal-footer">
      ${user ? '<button class="btn btn-outline" id="clear-user-btn">清除信息</button>' : ""}
      <button class="btn btn-outline" onclick="Modal.close()">取消</button>
      <button class="btn btn-primary" id="save-user-btn">保存</button>
    </div>
  `;

  Modal.show(html);

  const saveBtn = document.querySelector("#save-user-btn");
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      const nickname = document.querySelector("#user-nickname")?.value.trim();
      const phone = document.querySelector("#user-phone")?.value.trim();
      if (!nickname) { Toast.error("请填写昵称"); return; }
      if (!phone) { Toast.error("请填写手机号"); return; }
      UserInfo.save(nickname, phone);
      updateUserDisplay();
      Modal.close();
      Toast.success("信息已保存");
    });
  }

  const clearBtn = document.querySelector("#clear-user-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      UserInfo.clear();
      updateUserDisplay();
      Modal.close();
      Toast.info("信息已清除");
    });
  }
}

function updateUserDisplay() {
  const user = UserInfo.get();
  const btn = $("#user-btn");
  if (!btn) return;

  if (user) {
    const initial = user.nickname.charAt(0);
    btn.innerHTML = `<span class="user-avatar">${Esc.html(initial)}</span><span>${Esc.html(user.nickname)}</span>`;
    btn.title = `昵称: ${user.nickname}\n手机: ${user.phone}`;
  } else {
    btn.innerHTML = `👤 <span>登录/身份</span>`;
    btn.title = "点击填写身份信息";
  }
}
