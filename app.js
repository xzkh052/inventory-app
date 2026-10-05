/* ============================================================
   app.js — 库存管理主逻辑
   ============================================================ */

/* ---------- 全局状态 ---------- */
let state = {
  parts: [],
  products: [],
  transactions: [],
  forecast: [],
  plans: []
};

/* ---------- 工具函数 ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function fmtMoney(n) {
  return '¥' + num(n).toFixed(2);
}

function fmtTime(ts) {
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function toast(msg, type) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'toast'; }, 2200);
}

/* ---------- 库存计算 ---------- */
// 库存 = 该零件所有流水之和
function stockOf(partId) {
  let sum = 0;
  for (const t of state.transactions) {
    if (t.targetType === 'part' && t.targetId === partId) sum += num(t.delta);
  }
  return sum;
}

function partById(id) {
  return state.parts.find(p => p.id === id);
}
function productById(id) {
  return state.products.find(p => p.id === id);
}

/* ---------- 数据加载 ---------- */
async function loadAll() {
  state.parts = await DB.all('parts');
  state.products = await DB.all('products');
  state.transactions = await DB.all('transactions');
  state.transactions.sort((a, b) => b.time - a.time);
  state.forecast = await DB.all('forecast');
  state.plans = await DB.all('plans');
  state.plans.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}

/* ---------- 产品最大可组装套数 ---------- */
function maxSetsOf(product) {
  if (!product || !product.bom || !product.bom.length) return 0;
  let maxSets = Infinity;
  product.bom.forEach(b => {
    const p = partById(b.partId);
    const have = p ? stockOf(p.id) : 0;
    const per = num(b.qty) || 1;
    maxSets = Math.min(maxSets, Math.floor(have / per));
  });
  if (!isFinite(maxSets)) return 0;
  return Math.max(0, maxSets);
}

/* ---------- 出库计划：总重量 ---------- */
// 总重量 = Σ(产品单件重量 × 该产品数量)
function planTotalWeight(plan) {
  const items = (plan && plan.items) || [];
  let total = 0;
  items.forEach(it => {
    const p = productById(it.productId);
    const w = p ? num(p.weight) : 0;
    total += w * num(it.qty);
  });
  return total;
}

/* ---------- 预警计算 ---------- */
function forecastOf(productId) {
  return state.forecast.find(f => f.productId === productId) || null;
}

// 返回 { level: 'red'|'orange'|'ok'|'none', stock, safe, daily, daysLeft, ... }
function warnStatusOf(product) {
  const f = forecastOf(product.id);
  const stock = maxSetsOf(product);
  if (!f) return { level: 'none', stock, safe: null, daily: 0, daysLeft: null };

  const daily = num(f.monthQty) / 30;            // 日均消耗
  const leadDays = num(f.restockDays) + num(f.packDays) + num(f.shipDays);
  const safe = daily * leadDays;                  // 安全值 X

  if (daily <= 0) return { level: 'ok', stock, safe: 0, daily: 0, daysLeft: null, leadDays };

  const daysLeft = stock / daily;                 // 还能撑多少天
  let level = 'ok';
  if (stock < safe) level = 'red';
  else if (stock < safe + daily * 10) level = 'orange';

  return { level, stock, safe, daily, daysLeft, leadDays };
}

/* ============================================================
   渲染：零件库
   ============================================================ */
function renderParts() {
  const kw = ($('#parts-search').value || '').trim().toLowerCase();
  const tbody = $('#parts-table tbody');
  let rows = state.parts.slice().sort((a, b) => (a.sku || '').localeCompare(b.sku || ''));

  if (kw) {
    rows = rows.filter(p =>
      [p.sku, p.code, p.name, p.supplier].some(v => String(v || '').toLowerCase().includes(kw))
    );
  }

  let totalValue = 0;
  let totalQty = 0;
  tbody.innerHTML = rows.map(p => {
    const st = stockOf(p.id);
    const val = st * num(p.price);
    totalValue += val;
    totalQty += st;
    return `<tr>
      <td>${esc(p.sku)}</td>
      <td>${esc(p.code)}</td>
      <td>${esc(p.name)}</td>
      <td class="num">${fmtMoney(p.price)}</td>
      <td>${esc(p.supplier)}</td>
      <td class="num ${st < 0 ? 'neg' : ''}">${st}</td>
      <td class="num">${fmtMoney(val)}</td>
      <td class="muted">${esc(p.note)}</td>
      <td class="ops">
        <button class="mini" data-edit-part="${p.id}">编辑</button>
        <button class="mini danger" data-del-part="${p.id}">删除</button>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="9" class="empty">暂无零件，点击右上角「新增零件」</td></tr>`;

  $('#parts-stats').innerHTML = `
    <div class="stat"><span class="stat-label">零件种类</span><span class="stat-val">${state.parts.length}</span></div>
    <div class="stat"><span class="stat-label">在库总数量</span><span class="stat-val">${totalQty}</span></div>
    <div class="stat"><span class="stat-label">在库总货值</span><span class="stat-val">${fmtMoney(totalValue)}</span></div>
  `;
}

/* ============================================================
   渲染：产品库
   ============================================================ */
function bomText(product) {
  if (!product.bom || !product.bom.length) return '<span class="muted">未配置</span>';
  return product.bom.map(b => {
    const p = partById(b.partId);
    const name = p ? (p.name || p.sku || '未知') : '已删除零件';
    return `<span class="bom-tag">${esc(name)} × ${b.qty}</span>`;
  }).join('');
}

function renderProducts() {
  const kw = ($('#products-search').value || '').trim().toLowerCase();
  const tbody = $('#products-table tbody');
  let rows = state.products.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  if (kw) rows = rows.filter(p => String(p.name || '').toLowerCase().includes(kw));

  tbody.innerHTML = rows.map(p => `<tr>
    <td>${esc(p.name)}</td>
    <td>${bomText(p)}</td>
    <td class="num">${p.weight ? esc(p.weight) + ' KG' : '<span class="muted">—</span>'}</td>
    <td>${p.size ? esc(p.size) + ' CM' : '<span class="muted">—</span>'}</td>
    <td class="muted">${esc(p.note)}</td>
    <td class="ops">
      <button class="mini" data-edit-product="${p.id}">编辑</button>
      <button class="mini danger" data-del-product="${p.id}">删除</button>
    </td>
  </tr>`).join('') || `<tr><td colspan="6" class="empty">暂无产品，点击右上角「新增产品」</td></tr>`;
}

/* ============================================================
   渲染：下拉框
   ============================================================ */
function fillSelects() {
  const partOpts = state.parts.slice()
    .sort((a, b) => (a.sku || '').localeCompare(b.sku || ''))
    .map(p => `<option value="${p.id}">${esc(p.sku ? p.sku + ' · ' : '')}${esc(p.name)}</option>`).join('');
  const prodOpts = state.products.slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');

  ['#in-part', '#adj-part'].forEach(sel => {
    const el = $(sel);
    const old = el.value;
    el.innerHTML = partOpts || '<option value="">（无零件）</option>';
    if (old) el.value = old;
  });
  ['#out-product', '#calc-product'].forEach(sel => {
    const el = $(sel);
    const old = el.value;
    el.innerHTML = prodOpts || '<option value="">（无产品）</option>';
    if (old) el.value = old;
  });
}

/* ============================================================
   渲染：流水
   ============================================================ */
function renderLogs() {
  const kw = ($('#logs-search').value || '').trim().toLowerCase();
  const tbody = $('#logs-table tbody');
  let rows = state.transactions;
  if (kw) {
    rows = rows.filter(t =>
      [t.type, t.targetName, t.note].some(v => String(v || '').toLowerCase().includes(kw))
    );
  }
  tbody.innerHTML = rows.slice(0, 500).map(t => {
    const d = num(t.delta);
    const cls = d > 0 ? 'pos' : (d < 0 ? 'neg' : '');
    const sign = d > 0 ? '+' : '';
    return `<tr>
      <td class="muted">${fmtTime(t.time)}</td>
      <td>${esc(t.type)}</td>
      <td>${esc(t.targetName)}</td>
      <td class="num ${cls}">${sign}${d}</td>
      <td class="muted">${esc(t.note)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="5" class="empty">暂无流水记录</td></tr>`;
}

/* ============================================================
   渲染：库存预警
   ============================================================ */
function renderWarnings() {
  const tbody = $('#warn-table tbody');
  const rows = state.products.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  let redCount = 0, orangeCount = 0;

  tbody.innerHTML = rows.map(p => {
    const w = warnStatusOf(p);
    const f = forecastOf(p.id);
    let badge = '<span class="badge ok">正常</span>';
    if (w.level === 'red') { badge = '<span class="badge red">红色预警</span>'; redCount++; }
    else if (w.level === 'orange') { badge = '<span class="badge orange">橙色预警</span>'; orangeCount++; }
    else if (w.level === 'none') { badge = '<span class="badge none">未设置</span>'; }

    const safeTxt = w.safe == null ? '<span class="muted">—</span>' : Math.ceil(w.safe);
    const daysTxt = w.daysLeft == null ? '<span class="muted">—</span>' : w.daysLeft.toFixed(1) + ' 天';
    const leadTxt = f ? (num(f.restockDays) + num(f.packDays) + num(f.shipDays)) + ' 天' : '<span class="muted">—</span>';

    return `<tr class="${w.level === 'red' ? 'row-red' : (w.level === 'orange' ? 'row-orange' : '')}">
      <td>${esc(p.name)}</td>
      <td class="num">${w.stock}</td>
      <td class="num">${safeTxt}</td>
      <td class="num">${w.daily ? w.daily.toFixed(2) : '<span class="muted">—</span>'}</td>
      <td class="num">${leadTxt}</td>
      <td class="num">${daysTxt}</td>
      <td>${badge}</td>
      <td class="ops">
        <button class="mini" data-edit-forecast="${p.id}">设置</button>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" class="empty">暂无产品，请先到「产品库」新增</td></tr>`;

  $('#warn-stats').innerHTML = `
    <div class="stat"><span class="stat-label">红色预警</span><span class="stat-val neg">${redCount}</span></div>
    <div class="stat"><span class="stat-label">橙色预警</span><span class="stat-val" style="color:var(--warn)">${orangeCount}</span></div>
    <div class="stat"><span class="stat-label">产品总数</span><span class="stat-val">${state.products.length}</span></div>
  `;
}

/* ---------- 预警设置弹窗 ---------- */
function openForecastModal(product) {
  const f = forecastOf(product.id) || {
    productId: product.id, monthQty: 0, restockDays: 0, packDays: 0, shipDays: 0
  };
  const html = `
    <div class="hint">产品：<b>${esc(product.name)}</b>　当前可组装：<b>${maxSetsOf(product)}</b> 套</div>
    <div class="form-grid">
      <label>30天消耗量<input type="number" id="f-month" value="${num(f.monthQty)}" min="0" step="1"></label>
      <label>补货天数<input type="number" id="f-restock" value="${num(f.restockDays)}" min="0" step="1"></label>
      <label>打包天数<input type="number" id="f-pack" value="${num(f.packDays)}" min="0" step="1"></label>
      <label>海运天数<input type="number" id="f-ship" value="${num(f.shipDays)}" min="0" step="1"></label>
    </div>
    <div class="hint">安全值 X = (30天消耗量 ÷ 30) × (补货 + 打包 + 海运)</div>
  `;
  openModal('库存预警设置', html, async () => {
    const obj = {
      productId: product.id,
      monthQty: num($('#f-month').value),
      restockDays: num($('#f-restock').value),
      packDays: num($('#f-pack').value),
      shipDays: num($('#f-ship').value)
    };
    await DB.put('forecast', obj);
    await loadAll();
    renderAll();
    toast('预警设置已保存', 'ok');
    return true;
  });
}

/* ============================================================
   渲染：出库计划
   ============================================================ */
function renderPlans() {
  const tbody = $('#plans-table tbody');
  const rows = state.plans.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

  tbody.innerHTML = rows.map(pl => {
    const items = pl.items || [];
    const totalQty = items.reduce((s, it) => s + num(it.qty), 0);
    const totalWeight = planTotalWeight(pl);
    const itemsTxt = items.length
      ? items.map(it => {
          const p = productById(it.productId);
          return `<span class="bom-tag">${esc(p ? p.name : '已删除产品')} × ${num(it.qty)}</span>`;
        }).join('')
      : '<span class="muted">无产品</span>';
    const freight = num(pl.freight);
    const total = freight * totalWeight;
    const done = pl.status === '已发货';
    return `<tr class="${done ? 'row-done' : ''}">
      <td>${esc(pl.date)}</td>
      <td>${itemsTxt}</td>
      <td class="num">${totalQty}</td>
      <td class="num">${totalWeight ? totalWeight.toFixed(2) + ' KG' : '<span class="muted">—</span>'}</td>
      <td>${esc(pl.channel)}</td>
      <td>${esc(pl.logistics) || '<span class="muted">—</span>'}</td>
      <td class="num">${esc(pl.boxes) || '<span class="muted">—</span>'}</td>
      <td class="num">${esc(pl.shipments) || '<span class="muted">—</span>'}</td>
      <td class="num">${fmtMoney(freight)}</td>
      <td class="num">${fmtMoney(total)}</td>
      <td>${esc(pl.shop)}</td>
      <td>${done ? '<span class="badge ok">已发货</span>' : '<span class="badge none">待发货</span>'}</td>
      <td class="ops">
        <button class="mini" data-pdf-plan="${pl.id}">PDF</button>
        <button class="mini" data-toggle-plan="${pl.id}">${done ? '撤销' : '标记发货'}</button>
        <button class="mini" data-edit-plan="${pl.id}">编辑</button>
        <button class="mini danger" data-del-plan="${pl.id}">删除</button>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="13" class="empty">暂无出库计划，点击右上角「新增计划」</td></tr>`;
}

/* ---------- 出库计划弹窗（支持多产品） ---------- */
function openPlanModal(plan) {
  const isNew = !plan;
  plan = plan || { id: uid(), date: '', items: [], channel: '', freight: 0, shop: '', status: '待发货' };
  // 兼容旧数据（单产品）
  let items = (plan.items && plan.items.length)
    ? plan.items.map(it => ({ ...it }))
    : (plan.productId ? [{ productId: plan.productId, qty: num(plan.qty) || 1 }] : []);
  if (!items.length && state.products.length) items = [{ productId: state.products[0].id, qty: 1 }];

  const prodOpts = (selectedId) => state.products.slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .map(p => `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${esc(p.name)}</option>`).join('');

  function itemsRowsHTML() {
    if (!state.products.length) return '<div class="muted">请先到「产品库」新增产品</div>';
    return items.map((it, i) => `
      <div class="plan-item-row" data-i="${i}">
        <select class="plan-item-product">${prodOpts(it.productId)}</select>
        <input type="number" class="plan-item-qty" value="${num(it.qty) || 1}" min="1" step="1">
        <button type="button" class="mini danger plan-item-del">删除</button>
      </div>
    `).join('');
  }

  const html = `
    <div class="form-grid">
      <label>预计出货日期<input type="date" id="pl-date" value="${esc(plan.date)}"></label>
      <label>发货渠道<input type="text" id="pl-channel" value="${esc(plan.channel)}" placeholder="如 海运 / 空运 / 快递"></label>
      <label>物流渠道名称<input type="text" id="pl-logistics" value="${esc(plan.logistics)}" placeholder="如 顺丰国际 / DHL / 海运整柜"></label>
      <label>箱子数量<input type="text" id="pl-boxes" value="${esc(plan.boxes)}" placeholder="如 12"></label>
      <label>分成几票<input type="text" id="pl-shipments" value="${esc(plan.shipments)}" placeholder="如 3"></label>
      <label>运费单价（元/KG）<input type="number" id="pl-freight" value="${num(plan.freight)}" min="0" step="0.01" placeholder="每公斤运费"></label>
      <label>电商店铺<input type="text" id="pl-shop" value="${esc(plan.shop)}" placeholder="如 亚马逊 / 独立站"></label>
      <label>状态<select id="pl-status">
        <option value="待发货" ${plan.status === '待发货' ? 'selected' : ''}>待发货</option>
        <option value="已发货" ${plan.status === '已发货' ? 'selected' : ''}>已发货</option>
      </select></label>
    </div>
    <div class="bom-editor">
      <div class="bom-head">
        <span>出货产品及数量</span>
        <button type="button" class="mini" id="plan-item-add">+ 添加产品</button>
      </div>
      <div id="plan-item-list">${itemsRowsHTML()}</div>
    </div>
  `;
  openModal(isNew ? '新增出库计划' : '编辑出库计划', html, async () => {
    const newItems = [];
    $$('#plan-item-list .plan-item-row').forEach(row => {
      const productId = row.querySelector('.plan-item-product').value;
      const qty = num(row.querySelector('.plan-item-qty').value);
      if (productId && qty > 0) newItems.push({ productId, qty });
    });
    if (!newItems.length) { toast('请至少添加一款产品', 'warn'); return false; }
    const obj = {
      id: plan.id,
      date: $('#pl-date').value,
      items: newItems,
      channel: $('#pl-channel').value.trim(),
      logistics: $('#pl-logistics').value.trim(),
      boxes: $('#pl-boxes').value.trim(),
      shipments: $('#pl-shipments').value.trim(),
      freight: num($('#pl-freight').value),
      shop: $('#pl-shop').value.trim(),
      status: $('#pl-status').value
    };
    await DB.put('plans', obj);
    await loadAll();
    renderAll();
    toast(isNew ? '计划已新增' : '计划已保存', 'ok');
    return true;
  });

  // 动态事件
  // 把当前界面已填的产品/数量同步回 items 数组（避免重渲染时丢失）
  function syncItemsFromDOM() {
    $$('#plan-item-list .plan-item-row').forEach(row => {
      const i = parseInt(row.dataset.i, 10);
      if (isNaN(i) || !items[i]) return;
      items[i].productId = row.querySelector('.plan-item-product').value;
      items[i].qty = num(row.querySelector('.plan-item-qty').value);
    });
  }

  $('#plan-item-add').onclick = () => {
    if (!state.products.length) { toast('请先新增产品', 'warn'); return; }
    syncItemsFromDOM();
    items.push({ productId: state.products[0].id, qty: 1 });
    $('#plan-item-list').innerHTML = itemsRowsHTML();
    bindItemEvents();
  };
  function bindItemEvents() {
    $$('#plan-item-list .plan-item-del').forEach(btn => {
      btn.onclick = () => {
        syncItemsFromDOM();
        const i = parseInt(btn.closest('.plan-item-row').dataset.i, 10);
        items.splice(i, 1);
        $('#plan-item-list').innerHTML = itemsRowsHTML();
        bindItemEvents();
      };
    });
  }
  bindItemEvents();
}

/* ============================================================
   渲染：数据概览
   ============================================================ */
function renderOverview() {
  let totalValue = 0;
  state.parts.forEach(p => { totalValue += stockOf(p.id) * num(p.price); });
  $('#data-overview').innerHTML = `
    <div class="stat"><span class="stat-label">零件种类</span><span class="stat-val">${state.parts.length}</span></div>
    <div class="stat"><span class="stat-label">产品种类</span><span class="stat-val">${state.products.length}</span></div>
    <div class="stat"><span class="stat-label">流水条数</span><span class="stat-val">${state.transactions.length}</span></div>
    <div class="stat"><span class="stat-label">在库总货值</span><span class="stat-val">${fmtMoney(totalValue)}</span></div>
  `;
}

/* ============================================================
   渲染：全部
   ============================================================ */
function renderAll() {
  renderParts();
  renderProducts();
  fillSelects();
  renderLogs();
  renderOverview();
  renderOutPreview();
  renderCalc();
  renderWarnings();
  renderPlans();
}

/* ============================================================
   弹窗
   ============================================================ */
let modalOkHandler = null;

function openModal(title, bodyHTML, onOk) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHTML;
  modalOkHandler = onOk;
  $('#modal-mask').classList.add('show');
}

function closeModal() {
  $('#modal-mask').classList.remove('show');
  modalOkHandler = null;
}

/* ---------- 零件编辑弹窗 ---------- */
function openPartModal(part) {
  const isNew = !part;
  part = part || { id: uid(), sku: '', code: '', name: '', price: 0, supplier: '', note: '' };
  const curStock = isNew ? 0 : stockOf(part.id);
  const html = `
    <div class="form-grid">
      <label>SKU<input type="text" id="m-sku" value="${esc(part.sku)}" placeholder="如 A-001"></label>
      <label>零件编码<input type="text" id="m-code" value="${esc(part.code)}" placeholder="厂家料号，可选"></label>
      <label>零件名称<input type="text" id="m-name" value="${esc(part.name)}"></label>
      <label>采购单价<input type="number" id="m-price" value="${num(part.price)}" min="0" step="0.01"></label>
      <label>供应商<input type="text" id="m-supplier" value="${esc(part.supplier)}"></label>
      <label>当前库存<input type="number" id="m-stock" value="${curStock}" step="1" ${isNew ? '' : ''}></label>
      <label>备注<input type="text" id="m-note" value="${esc(part.note)}"></label>
    </div>
    ${isNew ? '' : '<div class="hint">修改「当前库存」会自动生成一条「盘点修正」流水，把库存调整为你填写的数值。</div>'}
  `;
  openModal(isNew ? '新增零件' : '编辑零件', html, async () => {
    const name = $('#m-name').value.trim();
    if (!name) { toast('请填写零件名称', 'warn'); return false; }
    const obj = {
      id: part.id,
      sku: $('#m-sku').value.trim(),
      code: $('#m-code').value.trim(),
      name,
      price: num($('#m-price').value),
      supplier: $('#m-supplier').value.trim(),
      note: $('#m-note').value.trim()
    };
    await DB.put('parts', obj);

    // 库存调整：生成盘点修正流水
    const newStock = num($('#m-stock').value);
    if (isNew) {
      if (newStock !== 0) {
        await addTransaction({
          type: '盘点修正', targetType: 'part', targetId: part.id,
          targetName: name, delta: newStock, note: '新增零件初始库存'
        });
      }
    } else {
      const delta = newStock - curStock;
      if (delta !== 0) {
        await addTransaction({
          type: '盘点修正', targetType: 'part', targetId: part.id,
          targetName: name, delta, note: `编辑零件时修正库存（${curStock} → ${newStock}）`
        });
      }
    }

    await loadAll();
    renderAll();
    toast(isNew ? '零件已新增' : '零件已保存', 'ok');
    return true;
  });
}

/* ---------- 产品编辑弹窗 ---------- */
function openProductModal(product) {
  const isNew = !product;
  product = product || { id: uid(), name: '', bom: [], weight: '', size: '', note: '' };
  const bom = (product.bom || []).map(b => ({ ...b }));

  function bomRowsHTML() {
    if (!state.parts.length) return '<div class="muted">请先到「零件库」新增零件</div>';
    return bom.map((b, i) => `
      <div class="bom-row" data-i="${i}">
        <select class="bom-part">
          ${state.parts.map(p => `<option value="${p.id}" ${p.id === b.partId ? 'selected' : ''}>${esc(p.sku ? p.sku + ' · ' : '')}${esc(p.name)}</option>`).join('')}
        </select>
        <input type="number" class="bom-qty" value="${num(b.qty) || 1}" min="1" step="1">
        <button type="button" class="mini danger bom-del">删除</button>
      </div>
    `).join('');
  }

  const html = `
    <div class="form-grid">
      <label>产品名称<input type="text" id="m-pname" value="${esc(product.name)}"></label>
      <label>产品总重量（KG）<input type="number" id="m-weight" value="${esc(product.weight)}" min="0" step="0.01" placeholder="单位：KG，可选"></label>
      <label>包装尺寸（CM）<input type="text" id="m-size" value="${esc(product.size)}" placeholder="如 30×20×10，单位：CM，可选"></label>
      <label>备注<input type="text" id="m-pnote" value="${esc(product.note)}"></label>
    </div>
    <div class="bom-editor">
      <div class="bom-head">
        <span>包含零件及数量</span>
        <button type="button" class="mini" id="bom-add">+ 添加零件</button>
      </div>
      <div id="bom-list">${bomRowsHTML()}</div>
    </div>
  `;
  openModal(isNew ? '新增产品' : '编辑产品', html, async () => {
    const name = $('#m-pname').value.trim();
    if (!name) { toast('请填写产品名称', 'warn'); return false; }
    // 收集 BOM
    const newBom = [];
    $$('#bom-list .bom-row').forEach(row => {
      const partId = row.querySelector('.bom-part').value;
      const qty = num(row.querySelector('.bom-qty').value);
      if (partId && qty > 0) newBom.push({ partId, qty });
    });
    if (!newBom.length) { toast('请至少添加一个零件', 'warn'); return false; }
    const obj = {
      id: product.id,
      name,
      bom: newBom,
      weight: $('#m-weight').value.trim(),
      size: $('#m-size').value.trim(),
      note: $('#m-pnote').value.trim()
    };
    await DB.put('products', obj);
    await loadAll();
    renderAll();
    toast(isNew ? '产品已新增' : '产品已保存', 'ok');
    return true;
  });

  // 动态事件
  // 把当前界面已填的零件/数量同步回 bom 数组（避免重渲染时丢失）
  function syncBomFromDOM() {
    $$('#bom-list .bom-row').forEach(row => {
      const i = parseInt(row.dataset.i, 10);
      if (isNaN(i) || !bom[i]) return;
      bom[i].partId = row.querySelector('.bom-part').value;
      bom[i].qty = num(row.querySelector('.bom-qty').value);
    });
  }

  $('#bom-add').onclick = () => {
    if (!state.parts.length) { toast('请先新增零件', 'warn'); return; }
    syncBomFromDOM();
    bom.push({ partId: state.parts[0].id, qty: 1 });
    $('#bom-list').innerHTML = bomRowsHTML();
    bindBomEvents();
  };
  function bindBomEvents() {
    $$('#bom-list .bom-del').forEach(btn => {
      btn.onclick = () => {
        syncBomFromDOM();
        const i = parseInt(btn.closest('.bom-row').dataset.i, 10);
        bom.splice(i, 1);
        $('#bom-list').innerHTML = bomRowsHTML();
        bindBomEvents();
      };
    });
  }
  bindBomEvents();
}

/* ============================================================
   出入库逻辑
   ============================================================ */
async function addTransaction({ type, targetType, targetId, targetName, delta, note }) {
  const t = {
    id: uid(),
    time: Date.now(),
    type,
    targetType,
    targetId,
    targetName,
    delta: num(delta),
    note: note || ''
  };
  await DB.put('transactions', t);
  state.transactions.unshift(t);
}

/* ---------- 入库 ---------- */
async function doStockIn() {
  const partId = $('#in-part').value;
  const qty = num($('#in-qty').value);
  const type = $('#in-type').value;
  const note = $('#in-note').value.trim();
  if (!partId) { toast('请选择零件', 'warn'); return; }
  if (qty <= 0) { toast('数量必须大于 0', 'warn'); return; }
  const p = partById(partId);
  await addTransaction({
    type, targetType: 'part', targetId: partId,
    targetName: p.name, delta: qty, note
  });
  $('#in-qty').value = '';
  $('#in-note').value = '';
  renderAll();
  toast(`入库成功：${p.name} +${qty}`, 'ok');
}

/* ---------- 出库预览 ---------- */
function renderOutPreview() {
  const box = $('#out-preview');
  const productId = $('#out-product').value;
  const qty = num($('#out-qty').value);
  const product = productById(productId);
  if (!product || !product.bom || !product.bom.length) { box.innerHTML = ''; return; }
  if (qty <= 0) { box.innerHTML = '<div class="muted">输入数量后显示零件扣减预览</div>'; return; }

  let html = '<div class="preview-title">本次出库将扣减：</div><div class="preview-list">';
  let ok = true;
  product.bom.forEach(b => {
    const p = partById(b.partId);
    const need = b.qty * qty;
    const have = p ? stockOf(p.id) : 0;
    const after = have - need;
    if (after < 0) ok = false;
    html += `<div class="preview-item ${after < 0 ? 'bad' : ''}">
      <span>${esc(p ? p.name : '已删除零件')}</span>
      <span>需 ${need} · 现有 ${have} · 剩 ${after}</span>
    </div>`;
  });
  html += '</div>';
  if (!ok) html += '<div class="preview-warn">⚠ 部分零件库存不足，无法出库</div>';
  box.innerHTML = html;
}

/* ---------- 出库 ---------- */
async function doStockOut() {
  const productId = $('#out-product').value;
  const qty = num($('#out-qty').value);
  const note = $('#out-note').value.trim();
  const product = productById(productId);
  if (!product) { toast('请选择产品', 'warn'); return; }
  if (qty <= 0) { toast('数量必须大于 0', 'warn'); return; }
  if (!product.bom || !product.bom.length) { toast('该产品未配置零件', 'warn'); return; }

  // 检查库存
  const lack = [];
  product.bom.forEach(b => {
    const p = partById(b.partId);
    const need = b.qty * qty;
    const have = p ? stockOf(p.id) : 0;
    if (have < need) lack.push(`${p ? p.name : '未知'}（需 ${need}，有 ${have}）`);
  });
  if (lack.length) {
    toast('库存不足：' + lack.join('；'), 'warn');
    return;
  }

  // 扣减每个零件
  for (const b of product.bom) {
    const p = partById(b.partId);
    await addTransaction({
      type: '出库', targetType: 'part', targetId: b.partId,
      targetName: p.name, delta: -(b.qty * qty),
      note: `出库产品「${product.name}」× ${qty}${note ? ' · ' + note : ''}`
    });
  }
  $('#out-qty').value = '';
  $('#out-note').value = '';
  renderAll();
  toast(`出库成功：${product.name} × ${qty}`, 'ok');
}

/* ---------- 库存矫正 ---------- */
async function doAdjust() {
  const partId = $('#adj-part').value;
  const type = $('#adj-type').value;
  const qty = num($('#adj-qty').value);
  const note = $('#adj-note').value.trim();
  if (!partId) { toast('请选择零件', 'warn'); return; }
  const p = partById(partId);
  const cur = stockOf(partId);

  let delta;
  if (type === '盘点修正') {
    delta = qty - cur; // 直接改成实际库存
    if (delta === 0) { toast('库存无变化', 'warn'); return; }
  } else {
    if (qty <= 0) { toast('数量必须大于 0', 'warn'); return; }
    delta = -qty; // 不良品 / 正常损耗 都是减
  }

  await addTransaction({
    type, targetType: 'part', targetId: partId,
    targetName: p.name, delta,
    note: type === '盘点修正' ? `盘点修正为 ${qty}${note ? ' · ' + note : ''}` : note
  });
  $('#adj-qty').value = '';
  $('#adj-note').value = '';
  renderAll();
  toast(`矫正成功：${p.name} ${delta > 0 ? '+' : ''}${delta}`, 'ok');
}

/* ============================================================
   最大套数测算
   ============================================================ */
function renderCalc() {
  const box = $('#calc-result');
  const productId = $('#calc-product').value;
  const product = productById(productId);
  if (!product || !product.bom || !product.bom.length) {
    box.innerHTML = '<div class="muted">请选择已配置零件的产品</div>';
    return;
  }

  // 最大套数 = min(库存 / 单套用量)
  let maxSets = Infinity;
  product.bom.forEach(b => {
    const p = partById(b.partId);
    const have = p ? stockOf(p.id) : 0;
    const per = num(b.qty) || 1;
    maxSets = Math.min(maxSets, Math.floor(have / per));
  });
  if (!isFinite(maxSets)) maxSets = 0;
  if (maxSets < 0) maxSets = 0;

  const planQty = num($('#calc-qty').value);

  let html = `<div class="calc-max">最大可组装：<b>${maxSets}</b> 套</div>`;
  html += `<table class="calc-table"><thead><tr>
    <th>零件</th><th class="num">单套用量</th><th class="num">当前库存</th>
    <th class="num">本次消耗</th><th class="num">剩余</th>
  </tr></thead><tbody>`;

  product.bom.forEach(b => {
    const p = partById(b.partId);
    const have = p ? stockOf(p.id) : 0;
    const per = num(b.qty) || 1;
    const use = planQty > 0 ? per * planQty : 0;
    const left = have - use;
    html += `<tr>
      <td>${esc(p ? p.name : '已删除零件')}</td>
      <td class="num">${per}</td>
      <td class="num">${have}</td>
      <td class="num">${planQty > 0 ? use : '—'}</td>
      <td class="num ${left < 0 ? 'neg' : ''}">${planQty > 0 ? left : '—'}</td>
    </tr>`;
  });
  html += '</tbody></table>';

  if (planQty > 0) {
    if (planQty > maxSets) {
      html += `<div class="preview-warn">⚠ 计划 ${planQty} 套超过最大可组装 ${maxSets} 套</div>`;
    } else {
      html += `<div class="preview-ok">✓ 计划 ${planQty} 套可行，剩余可组装 ${maxSets - planQty} 套</div>`;
    }
  }
  box.innerHTML = html;
}

/* ============================================================
   出库计划 PDF 导出（A4 排版）
   ============================================================ */
function exportPlanPDF(plan) {
  const items = plan.items || [];
  const totalQty = items.reduce((s, it) => s + num(it.qty), 0);
  const totalWeight = planTotalWeight(plan);
  const freight = num(plan.freight);
  const totalFreight = freight * totalWeight;
  const now = new Date();
  const p = (x) => String(x).padStart(2, '0');
  const printTime = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`;

  const rowsHTML = items.map((it, i) => {
    const prod = productById(it.productId);
    const name = prod ? prod.name : '已删除产品';
    const unitW = prod ? num(prod.weight) : 0;
    const weight = unitW ? unitW + ' KG' : '—';
    const lineW = unitW * num(it.qty);
    const size = prod && prod.size ? prod.size + ' CM' : '—';
    return `<tr>
      <td class="c">${i + 1}</td>
      <td>${esc(name)}</td>
      <td class="c">${num(it.qty)}</td>
      <td class="c">${esc(weight)}</td>
      <td class="c">${lineW ? lineW.toFixed(2) + ' KG' : '—'}</td>
      <td class="c">${esc(size)}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>出库计划单</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif;
    color: #1f2328;
    font-size: 12px;
    margin: 0;
  }
  .doc-title {
    text-align: center;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 4px;
    margin: 0 0 4px;
  }
  .doc-sub {
    text-align: center;
    color: #8a9199;
    font-size: 11px;
    margin-bottom: 18px;
  }
  .meta {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 14px;
  }
  .meta td {
    border: 1px solid #d0d4d9;
    padding: 7px 10px;
    font-size: 12px;
  }
  .meta .label {
    background: #f5f6f8;
    color: #5a6169;
    width: 90px;
    font-weight: 600;
  }
  table.items {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 14px;
  }
  table.items th, table.items td {
    border: 1px solid #d0d4d9;
    padding: 7px 10px;
    font-size: 12px;
  }
  table.items th {
    background: #f5f6f8;
    font-weight: 600;
    color: #5a6169;
  }
  table.items td.c, table.items th.c { text-align: center; }
  .summary {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 24px;
  }
  .summary td {
    border: 1px solid #d0d4d9;
    padding: 7px 10px;
    font-size: 12px;
  }
  .summary .label {
    background: #f5f6f8;
    color: #5a6169;
    font-weight: 600;
    width: 90px;
  }
  .summary .total {
    font-weight: 700;
    font-size: 13px;
  }
  .sign {
    display: flex;
    justify-content: space-between;
    margin-top: 40px;
    font-size: 12px;
    color: #5a6169;
  }
  .sign div { width: 30%; border-top: 1px solid #999; padding-top: 6px; text-align: center; }
  .footer {
    margin-top: 20px;
    text-align: center;
    color: #a0a6ad;
    font-size: 10px;
  }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
  <div class="doc-title">出 库 计 划 单</div>
  <div class="doc-sub">Inventory Outbound Plan</div>

  <table class="meta">
    <tr>
      <td class="label">预计出货日期</td>
      <td>${esc(plan.date) || '—'}</td>
      <td class="label">发货渠道</td>
      <td>${esc(plan.channel) || '—'}</td>
    </tr>
    <tr>
      <td class="label">物流渠道名称</td>
      <td>${esc(plan.logistics) || '—'}</td>
      <td class="label">电商店铺</td>
      <td>${esc(plan.shop) || '—'}</td>
    </tr>
    <tr>
      <td class="label">箱子数量</td>
      <td>${esc(plan.boxes) || '—'}</td>
      <td class="label">分成几票</td>
      <td>${esc(plan.shipments) || '—'}</td>
    </tr>
    <tr>
      <td class="label">状态</td>
      <td colspan="3">${esc(plan.status) || '—'}</td>
    </tr>
  </table>

  <table class="items">
    <thead>
      <tr>
        <th class="c" style="width:40px">序号</th>
        <th>产品名称</th>
        <th class="c" style="width:60px">数量</th>
        <th class="c" style="width:80px">单件重量</th>
        <th class="c" style="width:90px">小计重量</th>
        <th class="c" style="width:100px">包装尺寸</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHTML || '<tr><td colspan="6" class="c">无产品明细</td></tr>'}
    </tbody>
  </table>

  <table class="summary">
    <tr>
      <td class="label">产品总数量</td>
      <td>${totalQty} 件</td>
      <td class="label">总重量</td>
      <td>${totalWeight ? totalWeight.toFixed(2) + ' KG' : '—'}</td>
    </tr>
    <tr>
      <td class="label">运费单价</td>
      <td>¥${freight.toFixed(2)} / KG</td>
      <td class="label">运费预估</td>
      <td class="total">¥${totalFreight.toFixed(2)}</td>
    </tr>
    <tr>
      <td class="label">产品种类</td>
      <td colspan="3">${items.length} 种</td>
    </tr>
  </table>

  <div class="sign">
    <div>制单人</div>
    <div>审核人</div>
    <div>发货人</div>
  </div>

  <div class="footer">打印时间：${printTime}</div>

  <script>
    window.onload = function () {
      setTimeout(function () { window.print(); }, 300);
    };
  <\/script>
</body>
</html>`;

  const w = window.open('', '_blank');
  if (!w) { toast('请允许弹出窗口以导出 PDF', 'warn'); return; }
  w.document.write(html);
  w.document.close();
}

/* ============================================================
   数据导出 / 导入
   ============================================================ */
async function exportData() {
  const data = {
    app: 'inventory-app',
    version: 2,
    exportedAt: new Date().toISOString(),
    parts: state.parts,
    products: state.products,
    transactions: state.transactions,
    forecast: state.forecast,
    plans: state.plans
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  a.href = url;
  a.download = `inventory-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('已导出备份文件', 'ok');
}

async function importData(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.parts)) throw new Error('文件格式不正确');
    if (!confirm('导入将覆盖当前全部数据，确定继续？')) return;
    await DB.bulkClear(['parts', 'products', 'transactions', 'forecast', 'plans']);
    await DB.bulkPut('parts', data.parts || []);
    await DB.bulkPut('products', data.products || []);
    await DB.bulkPut('transactions', data.transactions || []);
    await DB.bulkPut('forecast', data.forecast || []);
    await DB.bulkPut('plans', data.plans || []);
    await loadAll();
    renderAll();
    toast('导入成功', 'ok');
  } catch (e) {
    toast('导入失败：' + e.message, 'warn');
  }
}

async function resetAll() {
  if (!confirm('将清空全部零件、产品、流水、预警、计划数据，且无法恢复。确定？')) return;
  if (!confirm('再次确认：真的要清空所有数据吗？')) return;
  await DB.bulkClear(['parts', 'products', 'transactions', 'forecast', 'plans']);
  await loadAll();
  renderAll();
  toast('已清空全部数据', 'ok');
}

/* ============================================================
   事件绑定
   ============================================================ */
function bindEvents() {
  // Tab 切换
  $('#tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    $$('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    $$('.view').forEach(v => v.classList.remove('active'));
    $('#view-' + btn.dataset.view).classList.add('active');
  });

  // 搜索
  $('#parts-search').addEventListener('input', renderParts);
  $('#products-search').addEventListener('input', renderProducts);
  $('#logs-search').addEventListener('input', renderLogs);

  // 新增
  $('#btn-add-part').onclick = () => openPartModal(null);
  $('#btn-add-product').onclick = () => openProductModal(null);

  // 表格操作（事件委托）
  $('#parts-table').addEventListener('click', async (e) => {
    const editId = e.target.dataset.editPart;
    const delId = e.target.dataset.delPart;
    if (editId) openPartModal(partById(editId));
    if (delId) {
      const p = partById(delId);
      if (!confirm(`删除零件「${p.name}」？其历史流水会保留。`)) return;
      await DB.del('parts', delId);
      await loadAll(); renderAll();
      toast('零件已删除', 'ok');
    }
  });
  $('#products-table').addEventListener('click', async (e) => {
    const editId = e.target.dataset.editProduct;
    const delId = e.target.dataset.delProduct;
    if (editId) openProductModal(productById(editId));
    if (delId) {
      const p = productById(delId);
      if (!confirm(`删除产品「${p.name}」？`)) return;
      await DB.del('products', delId);
      await loadAll(); renderAll();
      toast('产品已删除', 'ok');
    }
  });

  // 出入库
  $('#btn-in').onclick = doStockIn;
  $('#btn-out').onclick = doStockOut;
  $('#btn-adj').onclick = doAdjust;
  $('#out-qty').addEventListener('input', renderOutPreview);
  $('#out-product').addEventListener('change', renderOutPreview);

  // 测算
  $('#calc-product').addEventListener('change', renderCalc);
  $('#calc-qty').addEventListener('input', renderCalc);

  // 库存预警
  $('#warn-table').addEventListener('click', (e) => {
    const id = e.target.dataset.editForecast;
    if (id) {
      const p = productById(id);
      if (p) openForecastModal(p);
    }
  });

  // 出库计划
  $('#btn-add-plan').onclick = () => openPlanModal(null);
  $('#plans-table').addEventListener('click', async (e) => {
    const pdfId = e.target.dataset.pdfPlan;
    const toggleId = e.target.dataset.togglePlan;
    const editId = e.target.dataset.editPlan;
    const delId = e.target.dataset.delPlan;
    if (pdfId) {
      const pl = state.plans.find(x => x.id === pdfId);
      if (pl) exportPlanPDF(pl);
    }
    if (toggleId) {
      const pl = state.plans.find(x => x.id === toggleId);
      if (pl) {
        pl.status = pl.status === '已发货' ? '待发货' : '已发货';
        await DB.put('plans', pl);
        await loadAll(); renderAll();
        toast('状态已更新', 'ok');
      }
    }
    if (editId) {
      const pl = state.plans.find(x => x.id === editId);
      if (pl) openPlanModal(pl);
    }
    if (delId) {
      if (!confirm('删除该出库计划？')) return;
      await DB.del('plans', delId);
      await loadAll(); renderAll();
      toast('计划已删除', 'ok');
    }
  });

  // 数据
  $('#btn-export').onclick = exportData;
  $('#import-file').addEventListener('change', (e) => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = '';
  });
  $('#btn-reset').onclick = resetAll;
  $('#btn-clear-logs').onclick = async () => {
    if (!confirm('清空全部流水记录？库存将全部归零。')) return;
    await DB.clear('transactions');
    await loadAll(); renderAll();
    toast('流水已清空', 'ok');
  };

  // 弹窗
  $('#modal-close').onclick = closeModal;
  $('#modal-cancel').onclick = closeModal;
  $('#modal-ok').onclick = async () => {
    if (!modalOkHandler) return closeModal();
    const ok = await modalOkHandler();
    if (ok !== false) closeModal();
  };
  // 注意：点击遮罩不再关闭弹窗，避免误点导致已填内容丢失。
  // 只能通过「取消」或「×」按钮关闭。
}

/* ============================================================
   启动
   ============================================================ */
(async function init() {
  bindEvents();
  await loadAll();
  renderAll();
  // 注册 Service Worker（离线缓存）
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
