// =====================================================
//  Storage（サーバーAPI経由）
// =====================================================
const API = 'api.php';

let crmData    = [];   // メモリキャッシュ
let crmVersion = 0;    // サーバー側のバージョン番号
let currentUser = null; // ログイン中ユーザー情報

// 既存コードとの互換性を保つためload()/save()はキャッシュを操作
function load() { return crmData; }
function save(data) {
  crmData = data;
  scheduleSave();
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

// =====================================================
//  API通信
// =====================================================
let saveInFlight = false;
let savePending  = false;

function showSaving(visible) {
  document.getElementById('saving-dot').classList.toggle('show', visible);
}

async function scheduleSave() {
  if (saveInFlight) { savePending = true; return; }
  saveInFlight = true;
  savePending  = false;
  showSaving(true);
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save', data: crmData, version: crmVersion }),
    });
    const r = await res.json();
    if (r.ok) {
      crmVersion = r.version;
    } else if (r.conflict) {
      // 競合：最新データでローカルを上書きして通知
      crmData    = r.data;
      crmVersion = r.version;
      toast('他のスタッフが更新しました。データを再読み込みしました。', 'error');
      renderStats(); renderList();
    } else {
      toast('保存エラー: ' + (r.error || '不明'), 'error');
    }
  } catch (e) {
    toast('通信エラーが発生しました', 'error');
  } finally {
    showSaving(false);
    saveInFlight = false;
    if (savePending) scheduleSave();
  }
}

async function apiCall(payload) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return await res.json();
}

// =====================================================
//  認証
// =====================================================
async function doLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  const btn      = document.getElementById('login-btn');
  errEl.classList.remove('show');
  if (!username || !password) { errEl.textContent = 'ユーザー名とパスワードを入力してください'; errEl.classList.add('show'); return; }
  btn.textContent = 'ログイン中...';
  btn.disabled    = true;
  try {
    const r = await apiCall({ action: 'login', username, password });
    if (r.ok) {
      currentUser = r.user;
      await afterLogin();
    } else {
      errEl.textContent = r.error || 'ログインに失敗しました';
      errEl.classList.add('show');
    }
  } catch (e) {
    errEl.textContent = '通信エラーが発生しました';
    errEl.classList.add('show');
  } finally {
    btn.textContent = 'ログイン';
    btn.disabled    = false;
  }
}

async function doLogout() {
  await apiCall({ action: 'logout' });
  currentUser = null;
  crmData = []; crmVersion = 0;
  document.getElementById('login-overlay').classList.remove('hidden');
  document.getElementById('user-menu').style.display = 'none';
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
}

async function afterLogin() {
  // ユーザー情報をヘッダーに反映
  const nameEl = document.getElementById('user-display-name');
  nameEl.textContent = currentUser.display_name || currentUser.username;
  document.getElementById('user-menu').style.display = 'flex';
  document.getElementById('btn-settings').style.display = currentUser.role === 'admin' ? '' : 'inline-flex';
  // データ読み込み
  const r = await fetch(API + '?action=load');
  const d = await r.json();
  if (d.ok) { crmData = d.data; crmVersion = d.version; }
  // ログイン画面を隠してアプリ表示
  document.getElementById('login-overlay').classList.add('hidden');
  migrateContracts();
  renderStats();
  renderList();
}

// =====================================================
//  設定モーダル
// =====================================================
function openSettings() {
  // タブを動的に構築（adminのみユーザー管理・データ管理を表示）
  const isAdmin = currentUser?.role === 'admin';
  const tabsEl  = document.getElementById('settings-tabs');
  const tabs    = [];
  if (isAdmin) tabs.push(['users', 'ユーザー管理'], ['data', 'データ管理']);
  tabs.push(['password', 'パスワード変更']);
  tabsEl.innerHTML = tabs.map(([id, label], i) =>
    `<button class="settings-tab${i===0?' active':''}" onclick="switchSettingsTab('${id}',this)">${label}</button>`
  ).join('');
  document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('spanel-' + tabs[0][0]).classList.add('active');
  if (isAdmin) loadUsersList();
  // パスワードフィールドをクリア
  ['cp-old','cp-new','cp-new2'].forEach(id => { document.getElementById(id).value = ''; });
  openModal('modal-settings');
}

function switchSettingsTab(id, btn) {
  document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('spanel-' + id).classList.add('active');
  if (id === 'users') loadUsersList();
}

async function loadUsersList() {
  const r = await apiCall({ action: 'list_users' });
  if (!r.ok) return;
  const el = document.getElementById('users-list');
  const ROLE_LABEL = { admin: '管理者', staff: 'スタッフ' };
  if (!r.users.length) { el.innerHTML = '<p style="font-size:13px;color:var(--gray-400);">ユーザーがいません</p>'; return; }
  el.innerHTML = r.users.map(u => `
    <div class="user-list-row">
      <div class="user-list-info">
        <div class="user-list-name">${esc(u.display_name || u.username)}</div>
        <div class="user-list-sub">${esc(u.username)} ・ ${ROLE_LABEL[u.role] || u.role}</div>
      </div>
      ${u.id !== currentUser?.id
        ? `<button class="btn-icon danger" title="削除" onclick="deleteUser(${u.id},'${esc(u.display_name||u.username)}')">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
           </button>`
        : '<span style="font-size:11px;color:var(--gray-400);">（自分）</span>'}
    </div>`).join('');
}

async function createUser() {
  const username = document.getElementById('nu-username').value.trim();
  const display  = document.getElementById('nu-display').value.trim();
  const password = document.getElementById('nu-password').value;
  const role     = document.getElementById('nu-role').value;
  const r = await apiCall({ action: 'create_user', username, display_name: display || username, password, role });
  if (r.ok) {
    toast('ユーザーを追加しました', 'success');
    ['nu-username','nu-display','nu-password'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('nu-role').value = 'staff';
    loadUsersList();
  } else {
    toast(r.error || '作成に失敗しました', 'error');
  }
}

async function deleteUser(id, name) {
  if (!confirm(`「${name}」を削除しますか？`)) return;
  const r = await apiCall({ action: 'delete_user', user_id: id });
  if (r.ok) { toast('削除しました', 'success'); loadUsersList(); }
  else toast(r.error || '削除に失敗しました', 'error');
}

async function changePassword() {
  const old  = document.getElementById('cp-old').value;
  const nw   = document.getElementById('cp-new').value;
  const nw2  = document.getElementById('cp-new2').value;
  if (nw !== nw2) { toast('新しいパスワードが一致しません', 'error'); return; }
  const r = await apiCall({ action: 'change_password', old_password: old, new_password: nw });
  if (r.ok) {
    toast('パスワードを変更しました', 'success');
    ['cp-old','cp-new','cp-new2'].forEach(id => { document.getElementById(id).value = ''; });
  } else {
    toast(r.error || '変更に失敗しました', 'error');
  }
}

async function doExport() {
  window.location.href = API + '?action=export';
}

async function doImport(input) {
  const file = input.files[0];
  if (!file) return;
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); } catch { toast('JSONの形式が正しくありません', 'error'); return; }
  if (!Array.isArray(data)) { toast('データが配列ではありません', 'error'); return; }
  if (!confirm(`${data.length}件のクライアントデータをインポートします。\n現在のデータはすべて上書きされます。よろしいですか？`)) { input.value = ''; return; }
  const r = await apiCall({ action: 'import', data });
  if (r.ok) {
    crmData    = data;
    crmVersion = r.version;
    toast('インポートが完了しました', 'success');
    closeModal('modal-settings');
    renderStats(); renderList();
  } else {
    toast(r.error || 'インポートに失敗しました', 'error');
  }
  input.value = '';
}

// =====================================================
//  Helpers
// =====================================================
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                  .replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
}
function fmtDate(d) {
  if (!d) return '—';
  const x = new Date(d);
  return `${x.getFullYear()}/${pad(x.getMonth()+1)}/${pad(x.getDate())}`;
}
function fmtDT(d) {
  if (!d) return '';
  const x = new Date(d);
  return `${x.getFullYear()}/${pad(x.getMonth()+1)}/${pad(x.getDate())} ${pad(x.getHours())}:${pad(x.getMinutes())}`;
}
function pad(n) { return String(n).padStart(2,'0'); }
function fmtMoney(n) { return n ? '¥' + Number(n).toLocaleString() : '—'; }
function initials(name) {
  if (!name) return '?';
  const p = name.trim().split(/\s+/);
  return p.length >= 2 ? p[0][0] + p[1][0] : name[0];
}

// =====================================================
//  Badges
// =====================================================
const CLIENT_STATUS = { active:['badge-success','取引中'], prospect:['badge-warning','見込み'], inactive:['badge-gray','非アクティブ'] };
const CONTRACT_STATUS = { active:['badge-primary','進行中'], completed:['badge-success','完了'], pending:['badge-warning','保留'], cancelled:['badge-gray','キャンセル'] };
const PROJECT_STATUS  = { planning:['badge-gray','計画中'], active:['badge-primary','進行中'], review:['badge-warning','レビュー中'], completed:['badge-success','完了'], 'on-hold':['badge-danger','保留'] };
const PRIORITY = { high:['badge-danger','高'], normal:['badge-gray','通常'], low:['badge-success','低'] };

function badge(map, key) {
  const [cls,lbl] = map[key] || ['badge-gray', key || '—'];
  return `<span class="badge ${cls}">${lbl}</span>`;
}

// =====================================================
//  State
// =====================================================
let currentId = null;      // 詳細表示中のクライアントID
let editClientId = null;   // 編集中クライアントID
let editContractId = null;
let editProjectId = null;

// =====================================================
//  View
// =====================================================
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  // ナビボタンのアクティブ状態を更新
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const navTarget = name === 'detail' ? 'list' : name;
  const nb = document.getElementById('nav-btn-' + navTarget);
  if (nb) nb.classList.add('active');
  // ビューごとの描画
  if (name === 'list') { currentId = null; renderStats(); renderList(); }
  else if (name === 'projects') { renderAllProjects(); }
  else renderDetail();
}

// =====================================================
//  Stats
// =====================================================
function renderStats() {
  const all = load();
  let totalAmt = 0;
  let mrr = 0;
  let activePrj = 0;
  all.forEach(c => {
    (c.projects||[]).forEach(p => {
      const amt = Number(p.amount) || 0;
      if (p.contractType === 'subscription' && p.status === 'active') {
        mrr += p.cycle === 'yearly' ? Math.round(amt / 12) : amt;
      } else if (p.contractType === 'onetime') {
        totalAmt += amt;
      }
    });
    activePrj += (c.projects||[]).filter(p => p.status === 'active').length;
  });
  document.getElementById('stats-grid').innerHTML = `
    <div class="stat-card"><div class="stat-label">クライアント総数</div><div class="stat-value primary">${all.length}</div></div>
    <div class="stat-card"><div class="stat-label">取引中</div><div class="stat-value">${all.filter(c=>c.status==='active').length}</div></div>
    <div class="stat-card"><div class="stat-label">月額収益（MRR）</div><div class="stat-value success">${fmtMoney(mrr)}</div></div>
    <div class="stat-card"><div class="stat-label">単発契約合計</div><div class="stat-value success" style="font-size:18px;">${fmtMoney(totalAmt)}</div></div>
  `;
}

// =====================================================
//  Client List
// =====================================================
function renderList() {
  const all = load();
  const q   = (document.getElementById('search-input').value || '').toLowerCase();
  const fa  = document.getElementById('filter-assignee').value;

  // update assignee filter
  const assignees = [...new Set(all.map(c => c.assignee).filter(Boolean))];
  const sel = document.getElementById('filter-assignee');
  const prev = sel.value;
  sel.innerHTML = '<option value="">担当者（全員）</option>' +
    assignees.map(a => `<option value="${esc(a)}"${a===prev?' selected':''}>${esc(a)}</option>`).join('');

  let list = all;
  if (q) list = list.filter(c =>
    (c.name||'').toLowerCase().includes(q) ||
    (c.company||'').toLowerCase().includes(q) ||
    (c.email||'').toLowerCase().includes(q)
  );
  if (fa) list = list.filter(c => c.assignee === fa);

  const grid = document.getElementById('clients-grid');
  if (!list.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
      <h3>${all.length===0 ? 'クライアントがいません' : '該当者がいません'}</h3>
      <p style="font-size:13px;">${all.length===0 ? '「クライアント追加」から登録してください' : '検索条件を変えてお試しください'}</p>
      ${all.length===0 ? '<br><button class="btn btn-primary" onclick="openAddModal()">最初のクライアントを追加</button>' : ''}
    </div>`;
    return;
  }

  grid.innerHTML = list.map(c => {
    const cc = (c.contracts||[]).length;
    const pc = (c.projects||[]).length;
    return `
    <div class="client-card" data-id="${c.id}" draggable="true" onclick="openDetail('${c.id}')"
         ondragstart="onDragStart(event)" ondragover="onDragOver(event)" ondragleave="onDragLeave(event)" ondrop="onDrop(event)" ondragend="onDragEnd(event)">
      <div class="drag-handle" title="ドラッグして並び替え" onclick="event.stopPropagation()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
      </div>
      <div class="client-card-top">
        ${avatarHtml(c, 42, 17)}
        <div class="card-actions">
          <button class="btn-icon" title="編集" onclick="event.stopPropagation();openEditModal('${c.id}')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon danger" title="削除" onclick="event.stopPropagation();confirmDeleteClient('${c.id}')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
      </div>
      <div class="client-company">${esc(c.company) || '&nbsp;'}</div>
      <div class="client-name">${esc(c.name)}</div>
      <div class="client-meta">
        ${c.email ? `<div class="meta-item"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>${esc(c.email)}</div>` : ''}
        ${c.phone ? `<div class="meta-item"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.61 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>${esc(c.phone)}</div>` : ''}
        ${c.assignee ? `<div class="meta-item"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>担当: ${esc(c.assignee)}</div>` : ''}
      </div>
      <div class="card-footer">
        ${badge(CLIENT_STATUS, c.status)}
        <span class="card-counts">契約${cc}件 / 案件${pc}件</span>
      </div>
    </div>`;
  }).join('');
}

// =====================================================
//  Client Add / Edit
// =====================================================
// =====================================================
//  Avatar helpers
// =====================================================
let pendingAvatar = null; // base64 or null

function setAvatarPreview(src, label) {
  const preview = document.getElementById('f-avatar-preview');
  const removeBtn = document.getElementById('f-avatar-remove');
  if (src) {
    preview.innerHTML = `<img src="${src}">`;
    removeBtn.style.display = 'inline-block';
  } else {
    preview.innerHTML = label || '?';
    removeBtn.style.display = 'none';
  }
}

function onAvatarFileChange(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    // canvasで200×200にリサイズしてJPEGで保存
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const size = 200;
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      // 正方形にクロップして描画
      const min = Math.min(img.width, img.height);
      const sx = (img.width - min) / 2;
      const sy = (img.height - min) / 2;
      ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
      pendingAvatar = canvas.toDataURL('image/jpeg', 0.8);
      setAvatarPreview(pendingAvatar);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  input.value = ''; // 同じファイルを再選択できるようリセット
}

function removeAvatar() {
  pendingAvatar = '';
  const company = document.getElementById('f-company').value || document.getElementById('f-name').value || '?';
  setAvatarPreview(null, company[0]);
}

function avatarHtml(c, size = 42, fontSize = 17) {
  const label = esc(initials(c.company || c.name));
  if (c.avatar) {
    return `<div style="width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;flex-shrink:0;border:1.5px solid rgba(0,0,0,0.15);"><img src="${c.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"></div>`;
  }
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:linear-gradient(135deg,var(--primary),var(--primary-light));display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:${fontSize}px;flex-shrink:0;">${label}</div>`;
}

function openAddModal() {
  editClientId = null;
  pendingAvatar = null;
  document.getElementById('modal-client-title').textContent = 'クライアント追加';
  ['f-name','f-company','f-email','f-phone','f-assignee','f-address','f-note'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('f-status').value = 'active';
  setAvatarPreview(null, '?');
  openModal('modal-client');
}

function openEditModal(id) {
  const c = load().find(x => x.id === id);
  if (!c) return;
  editClientId = id;
  pendingAvatar = null; // nullのままなら既存画像を維持
  document.getElementById('modal-client-title').textContent = 'クライアント編集';
  document.getElementById('f-name').value     = c.name     || '';
  document.getElementById('f-company').value  = c.company  || '';
  document.getElementById('f-email').value    = c.email    || '';
  document.getElementById('f-phone').value    = c.phone    || '';
  document.getElementById('f-assignee').value = c.assignee || '';
  document.getElementById('f-status').value   = c.status   || 'active';
  document.getElementById('f-address').value  = c.address  || '';
  document.getElementById('f-note').value     = c.note     || '';
  if (c.avatar) {
    setAvatarPreview(c.avatar);
  } else {
    setAvatarPreview(null, initials(c.company || c.name));
  }
  openModal('modal-client');
}

function saveClient() {
  const company = document.getElementById('f-company').value.trim();
  if (!company) { toast('会社名を入力してください', 'error'); return; }
  const name = document.getElementById('f-name').value.trim();
  const all = load();
  const fields = {
    name,
    company,
    email:    document.getElementById('f-email').value.trim(),
    phone:    document.getElementById('f-phone').value.trim(),
    assignee: document.getElementById('f-assignee').value.trim(),
    status:   document.getElementById('f-status').value,
    address:  document.getElementById('f-address').value.trim(),
    note:     document.getElementById('f-note').value.trim(),
    updatedAt: new Date().toISOString(),
  };
  // pendingAvatar: base64文字列→新画像, ''→削除, null→変更なし
  if (pendingAvatar !== null) fields.avatar = pendingAvatar;

  if (editClientId) {
    const i = all.findIndex(c => c.id === editClientId);
    if (i !== -1) all[i] = { ...all[i], ...fields };
    toast('更新しました', 'success');
  } else {
    all.push({ id: uid(), contracts:[], projects:[], memos:[], createdAt: new Date().toISOString(), ...fields });
    toast('追加しました', 'success');
  }
  save(all);
  closeModal('modal-client');
  renderStats(); renderList();
  if (editClientId && currentId === editClientId) renderDetail();
}

// =====================================================
//  Delete Client
// =====================================================
function confirmDeleteClient(id) {
  const c = load().find(x => x.id === id);
  if (!c) return;
  document.getElementById('confirm-title').textContent = 'クライアントの削除';
  document.getElementById('confirm-text').textContent  = `「${c.name}」を削除しますか？この操作は取り消せません。`;
  document.getElementById('confirm-ok').onclick = () => {
    save(load().filter(x => x.id !== id));
    closeModal('modal-confirm');
    toast('削除しました');
    if (currentId === id) showView('list');
    else { renderStats(); renderList(); }
  };
  openModal('modal-confirm');
}

// =====================================================
//  Detail
// =====================================================
function openDetail(id) {
  currentId = id;
  // reset tabs
  document.querySelectorAll('.tab').forEach((t,i) => t.classList.toggle('active', i===0));
  document.querySelectorAll('.tab-panel').forEach((p,i) => p.classList.toggle('active', i===0));
  showView('detail');
}

function renderDetail() {
  const c = load().find(x => x.id === currentId);
  if (!c) { showView('list'); return; }

  document.getElementById('detail-header').innerHTML = `
    ${avatarHtml(c, 68, 26)}
    <div class="detail-info">
      <div class="detail-name">${esc(c.company || c.name)}</div>
      ${c.company ? `<div class="detail-company">${esc(c.name)}</div>` : ''}
      <div class="detail-contacts">
        ${c.email    ? `<div class="contact-item"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>${esc(c.email)}</div>` : ''}
        ${c.phone    ? `<div class="contact-item"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.61 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>${esc(c.phone)}</div>` : ''}
        ${c.assignee ? `<div class="contact-item"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>担当: ${esc(c.assignee)}</div>` : ''}
        ${c.address  ? `<div class="contact-item"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>${esc(c.address)}</div>` : ''}
      </div>
      ${c.note ? `<div class="detail-note">${esc(c.note)}</div>` : ''}
    </div>
    <div class="detail-actions">
      ${badge(CLIENT_STATUS, c.status)}
      <button class="btn btn-sm btn-secondary" onclick="openEditModal('${c.id}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>編集
      </button>
      <button class="btn btn-sm btn-danger" onclick="confirmDeleteClient('${c.id}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>削除
      </button>
    </div>`;

  renderProjects(); renderAccounts(); renderHistory(); renderMemos();
}

function switchTab(id, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-' + id).classList.add('active');
}

// =====================================================
//  Contracts
// =====================================================
// =====================================================
//  Projects（契約・金額を統合）
// =====================================================
const CONTRACT_TYPE = {
  subscription: ['badge-primary', 'サブスク'],
  onetime:      ['badge-gray',    '単発'],
  none:         ['badge-gray',    '契約なし'],
};

function onPfContractTypeChange() {
  const t = document.getElementById('pf-contract-type').value;
  document.getElementById('pf-amount-label').textContent = t === 'subscription' ? '月額（円）' : '金額（円）';
  document.getElementById('pf-cycle-group').style.display = t === 'subscription' ? '' : 'none';
}

function editProjectFromAllProjects(clientId, projectId) {
  currentId = clientId;
  openProjectModal(projectId);
}

function openProjectModal(pid) {
  editProjectId = pid || null;
  if (pid) {
    const p = (load().find(x=>x.id===currentId)?.projects||[]).find(x=>x.id===pid);
    if (!p) return;
    document.getElementById('modal-project-title').textContent = 'プロジェクトを編集';
    document.getElementById('pf-name').value          = p.name          || '';
    document.getElementById('pf-status').value        = p.status        || 'active';
    document.getElementById('pf-assignee').value      = p.assignee      || '';
    document.getElementById('pf-desc').value          = p.description   || '';
    document.getElementById('pf-contract-type').value = p.contractType  || 'none';
    document.getElementById('pf-amount').value        = p.amount        || '';
    document.getElementById('pf-cycle').value         = p.cycle         || 'monthly';
    document.getElementById('pf-start').value         = p.startDate     || '';
    document.getElementById('pf-end').value           = p.endDate       || '';
  } else {
    document.getElementById('modal-project-title').textContent = 'プロジェクトを追加';
    ['pf-name','pf-assignee','pf-desc','pf-amount','pf-start','pf-end'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('pf-status').value        = 'planning';
    document.getElementById('pf-contract-type').value = 'none';
    document.getElementById('pf-cycle').value         = 'monthly';
  }
  onPfContractTypeChange();
  openModal('modal-project');
}

function saveProject() {
  const name = document.getElementById('pf-name').value.trim();
  if (!name) { toast('案件名を入力してください', 'error'); return; }
  const all = load();
  const i   = all.findIndex(x => x.id === currentId);
  if (i === -1) return;
  const contractType = document.getElementById('pf-contract-type').value;
  const obj = {
    id:           editProjectId || uid(),
    name,
    status:       document.getElementById('pf-status').value,
    assignee:     document.getElementById('pf-assignee').value.trim(),
    description:  document.getElementById('pf-desc').value.trim(),
    contractType,
    amount:       document.getElementById('pf-amount').value,
    cycle:        contractType === 'subscription' ? document.getElementById('pf-cycle').value : null,
    startDate:    document.getElementById('pf-start').value,
    endDate:      document.getElementById('pf-end').value,
  };
  if (!all[i].projects) all[i].projects = [];
  if (editProjectId) {
    const pi = all[i].projects.findIndex(x => x.id === editProjectId);
    if (pi !== -1) all[i].projects[pi] = { ...all[i].projects[pi], ...obj };
    toast('プロジェクトを更新しました', 'success');
  } else {
    obj.createdAt = new Date().toISOString();
    all[i].projects.push(obj);
    toast('プロジェクトを追加しました', 'success');
  }
  save(all); closeModal('modal-project'); renderProjects(); renderStats();
  if (document.getElementById('view-projects')?.classList.contains('active')) renderAllProjects();
}

function deleteProject(pid) {
  if (!confirm('このプロジェクトを削除しますか？')) return;
  const all = load();
  const i   = all.findIndex(x => x.id === currentId);
  if (i === -1) return;
  all[i].projects = (all[i].projects||[]).filter(x => x.id !== pid);
  save(all); renderProjects(); renderStats(); toast('削除しました');
}

function fmtProjectAmount(p) {
  if (!p.amount || p.contractType === 'none') return '';
  const suffix = p.contractType === 'subscription' ? (p.cycle === 'yearly' ? '/年' : '/月') : '';
  return `<span class="amount-text">${fmtMoney(p.amount)}${suffix}</span>`;
}

function renderProjects() {
  const c  = load().find(x => x.id === currentId);
  const el = document.getElementById('projects-list');
  const list = c?.projects || [];
  if (!list.length) { el.innerHTML = '<p style="color:var(--gray-400);font-size:13px;text-align:center;padding:16px 0;">プロジェクトがありません</p>'; return; }
  el.innerHTML = list.map(p => {
    const amtHtml  = fmtProjectAmount(p);
    const dateHtml = p.startDate ? `${fmtDate(p.startDate)} 〜 ${fmtDate(p.endDate)}` : '';
    const assigneeHtml = p.assignee
      ? `<span style="display:inline-flex;align-items:center;gap:3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>${esc(p.assignee)}</span>`
      : '';
    const sub = [amtHtml, dateHtml, assigneeHtml, p.description ? esc(p.description) : ''].filter(Boolean).join(' ・ ');
    return `
    <div class="list-row">
      <div class="list-row-info">
        <div class="list-row-title">${esc(p.name)}</div>
        ${sub ? `<div class="list-row-sub">${sub}</div>` : ''}
      </div>
      ${p.contractType && p.contractType !== 'none' ? badge(CONTRACT_TYPE, p.contractType) : ''}
      ${badge(PROJECT_STATUS, p.status)}
      <div class="list-row-actions">
        <button class="btn-icon" onclick="openProjectModal('${p.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon danger" onclick="deleteProject('${p.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');
}

// =====================================================
//  Memos
// =====================================================
// =====================================================
//  Accounts
// =====================================================
let editAccountId = null;

function togglePw(inputId, btn) {
  const input = document.getElementById(inputId);
  input.type = input.type === 'password' ? 'text' : 'password';
  btn.style.color = input.type === 'text' ? 'var(--primary)' : 'var(--gray-400)';
}

const ACCOUNT_KIND_DEFAULT_PORT = { ftp: '21', ssh: '22', db: '3306', other: '' };
const ACCOUNT_KIND_LABEL = { web:'Webサービス', ftp:'FTP/SFTP', ssh:'SSH', db:'データベース', other:'サーバー' };
const ACCOUNT_KIND_BADGE = { web:'badge-primary', ftp:'badge-warning', ssh:'badge-gray', db:'badge-success', other:'badge-gray' };

function onAccountKindChange() {
  const kind = document.getElementById('af-kind').value;
  const isServer = kind !== 'web';
  document.getElementById('af-url-group').style.display    = isServer ? 'none' : '';
  document.getElementById('af-host-group').style.display   = isServer ? '' : 'none';
  document.getElementById('af-port-group').style.display   = isServer ? '' : 'none';
  document.getElementById('af-path-group').style.display   = (kind === 'ftp' || kind === 'ssh' || kind === 'other') ? '' : 'none';
  document.getElementById('af-dbname-group').style.display = kind === 'db' ? '' : 'none';
  if (!document.getElementById('af-port').value && ACCOUNT_KIND_DEFAULT_PORT[kind]) {
    document.getElementById('af-port').value = ACCOUNT_KIND_DEFAULT_PORT[kind];
  }
}

function openAccountModal(aid) {
  editAccountId = aid || null;
  if (aid) {
    const ac = (load().find(x=>x.id===currentId)?.accounts||[]).find(x=>x.id===aid);
    if (!ac) return;
    document.getElementById('modal-account-title').textContent = 'アカウントを編集';
    document.getElementById('af-service').value  = ac.service  || '';
    document.getElementById('af-kind').value     = ac.kind     || 'web';
    document.getElementById('af-url').value      = ac.url      || '';
    document.getElementById('af-host').value     = ac.host     || '';
    document.getElementById('af-port').value     = ac.port     || '';
    document.getElementById('af-path').value     = ac.path     || '';
    document.getElementById('af-dbname').value   = ac.dbname   || '';
    document.getElementById('af-username').value = ac.username || '';
    document.getElementById('af-password').value = ac.password || '';
    document.getElementById('af-note').value     = ac.note     || '';
  } else {
    document.getElementById('modal-account-title').textContent = 'アカウントを追加';
    ['af-service','af-url','af-host','af-port','af-path','af-dbname','af-username','af-password','af-note']
      .forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('af-kind').value = 'web';
  }
  document.getElementById('af-password').type = 'password';
  onAccountKindChange();
  openModal('modal-account');
}

function saveAccount() {
  const service = document.getElementById('af-service').value.trim();
  if (!service) { toast('サービス名を入力してください', 'error'); return; }
  const all = load();
  const i   = all.findIndex(x => x.id === currentId);
  if (i === -1) return;
  const obj = {
    id:       editAccountId || uid(),
    service,
    kind:     document.getElementById('af-kind').value,
    url:      document.getElementById('af-url').value.trim(),
    host:     document.getElementById('af-host').value.trim(),
    port:     document.getElementById('af-port').value.trim(),
    path:     document.getElementById('af-path').value.trim(),
    dbname:   document.getElementById('af-dbname').value.trim(),
    username: document.getElementById('af-username').value.trim(),
    password: document.getElementById('af-password').value,
    note:     document.getElementById('af-note').value.trim(),
  };
  if (!all[i].accounts) all[i].accounts = [];
  if (editAccountId) {
    const ai = all[i].accounts.findIndex(x => x.id === editAccountId);
    if (ai !== -1) all[i].accounts[ai] = { ...all[i].accounts[ai], ...obj };
    toast('アカウントを更新しました', 'success');
  } else {
    obj.createdAt = new Date().toISOString();
    all[i].accounts.push(obj);
    toast('アカウントを追加しました', 'success');
  }
  save(all); closeModal('modal-account'); renderAccounts();
}

function deleteAccount(aid) {
  if (!confirm('このアカウント情報を削除しますか？')) return;
  const all = load();
  const i   = all.findIndex(x => x.id === currentId);
  if (i === -1) return;
  all[i].accounts = (all[i].accounts||[]).filter(x => x.id !== aid);
  save(all); renderAccounts(); toast('削除しました');
}

function copyToClipboard(text, label) {
  navigator.clipboard.writeText(text).then(() => toast(`${label}をコピーしました`, 'success'));
}

function acInfoRow(iconPath, value, copyLabel) {
  if (!value) return '';
  const copyBtn = copyLabel ? `<button class="btn-icon" style="padding:2px;" title="コピー" onclick="copyToClipboard('${esc(value)}','${copyLabel}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>` : '';
  return `<div style="font-size:12px;color:var(--gray-600);display:flex;align-items:center;gap:6px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconPath}</svg>${esc(value)}${copyBtn}</div>`;
}

function renderAccounts() {
  const c  = load().find(x => x.id === currentId);
  const el = document.getElementById('accounts-list');
  const list = c?.accounts || [];
  if (!list.length) { el.innerHTML = '<p style="color:var(--gray-400);font-size:13px;text-align:center;padding:16px 0;">アカウント情報がありません</p>'; return; }
  el.innerHTML = list.map(ac => {
    const kind = ac.kind || 'web';
    const badgeCls = ACCOUNT_KIND_BADGE[kind] || 'badge-gray';
    const badgeLbl = ACCOUNT_KIND_LABEL[kind] || kind;
    const hostPort = ac.host ? (ac.port ? `${ac.host}:${ac.port}` : ac.host) : '';
    return `
    <div class="list-row" style="align-items:flex-start;gap:12px;">
      <div class="list-row-info">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span class="badge ${badgeCls}">${badgeLbl}</span>
          <span class="list-row-title">${esc(ac.service)}</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;">
          ${ac.url ? `<div style="font-size:12px;color:var(--gray-500);display:flex;align-items:center;gap:6px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg><a href="${esc(ac.url)}" target="_blank" style="color:var(--primary);text-decoration:none;">${esc(ac.url)}</a></div>` : ''}
          ${hostPort ? acInfoRow('<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>', hostPort, 'ホスト名') : ''}
          ${ac.path   ? acInfoRow('<polyline points="9 18 3 12 9 6"/><polyline points="15 6 21 12 15 18"/>', ac.path, 'パス') : ''}
          ${ac.dbname ? acInfoRow('<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>', ac.dbname, 'DB名') : ''}
          ${ac.username ? `<div style="font-size:12px;color:var(--gray-600);display:flex;align-items:center;gap:6px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>${esc(ac.username)}<button class="btn-icon" style="padding:2px;" title="コピー" onclick="copyToClipboard('${esc(ac.username)}','ユーザー名')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button></div>` : ''}
          ${ac.password ? `<div style="font-size:12px;color:var(--gray-600);display:flex;align-items:center;gap:6px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg><span id="pw-${ac.id}">••••••••</span><button class="btn-icon" style="padding:2px;" title="表示/非表示" onclick="togglePwView('${ac.id}','${esc(ac.password)}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button><button class="btn-icon" style="padding:2px;" title="コピー" onclick="copyToClipboard('${esc(ac.password)}','パスワード')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button></div>` : ''}
          ${ac.note ? `<div style="font-size:12px;color:var(--gray-500);margin-top:2px;">${esc(ac.note)}</div>` : ''}
        </div>
      </div>
      <div class="list-row-actions" style="flex-shrink:0;margin-top:2px;">
        <button class="btn-icon" onclick="openAccountModal('${ac.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon danger" onclick="deleteAccount('${ac.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');
}

function togglePwView(aid, pw) {
  const el = document.getElementById('pw-' + aid);
  el.textContent = el.textContent === '••••••••' ? pw : '••••••••';
}

function addMemo() {
  const text = document.getElementById('new-memo').value.trim();
  if (!text) { toast('メモを入力してください', 'error'); return; }
  const all = load();
  const i   = all.findIndex(x => x.id === currentId);
  if (i === -1) return;
  if (!all[i].memos) all[i].memos = [];
  all[i].memos.unshift({ id: uid(), content: text, createdAt: new Date().toISOString() });
  save(all);
  document.getElementById('new-memo').value = '';
  renderMemos(); toast('メモを追加しました', 'success');
}

function deleteMemo(mid) {
  if (!confirm('このメモを削除しますか？')) return;
  const all = load();
  const i   = all.findIndex(x => x.id === currentId);
  if (i === -1) return;
  all[i].memos = (all[i].memos||[]).filter(x => x.id !== mid);
  save(all); renderMemos(); toast('削除しました');
}

function renderMemos() {
  const c  = load().find(x => x.id === currentId);
  const el = document.getElementById('memos-list');
  const list = c?.memos || [];
  if (!list.length) { el.innerHTML = '<p style="color:var(--gray-400);font-size:13px;text-align:center;padding:16px 0;">メモがありません</p>'; return; }
  el.innerHTML = list.map(m => `
    <div class="memo-item">
      <div class="memo-top">
        <span class="memo-date">${fmtDT(m.createdAt)}</span>
        <button class="btn-icon danger" onclick="deleteMemo('${m.id}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>
      <div class="memo-content">${esc(m.content)}</div>
    </div>`).join('');
}

// =====================================================
//  History
// =====================================================
const HISTORY_TYPE = {
  meeting:  ['badge-primary', '打ち合わせ'],
  call:     ['badge-success', '電話'],
  email:    ['badge-gray',    'メール'],
  proposal: ['badge-warning', '提案'],
  delivery: ['badge-success', '納品'],
  other:    ['badge-gray',    'その他'],
};

let editHistoryId = null;

function openHistoryModal(hid) {
  editHistoryId = hid || null;
  if (hid) {
    const h = (load().find(x=>x.id===currentId)?.history||[]).find(x=>x.id===hid);
    if (!h) return;
    document.getElementById('modal-history-title').textContent = '履歴を編集';
    document.getElementById('hf-date').value    = h.date    || '';
    document.getElementById('hf-type').value    = h.type    || 'meeting';
    document.getElementById('hf-title').value   = h.title   || '';
    document.getElementById('hf-content').value = h.content || '';
  } else {
    document.getElementById('modal-history-title').textContent = '履歴を追加';
    document.getElementById('hf-date').value    = new Date().toISOString().slice(0,10);
    document.getElementById('hf-type').value    = 'meeting';
    document.getElementById('hf-title').value   = '';
    document.getElementById('hf-content').value = '';
  }
  openModal('modal-history');
}

function saveHistory() {
  const date  = document.getElementById('hf-date').value;
  const title = document.getElementById('hf-title').value.trim();
  if (!date)  { toast('日付を入力してください', 'error'); return; }
  if (!title) { toast('タイトルを入力してください', 'error'); return; }
  const all = load();
  const i   = all.findIndex(x => x.id === currentId);
  if (i === -1) return;
  const obj = {
    id:      editHistoryId || uid(),
    date,
    type:    document.getElementById('hf-type').value,
    title,
    content: document.getElementById('hf-content').value.trim(),
  };
  if (!all[i].history) all[i].history = [];
  if (editHistoryId) {
    const hi = all[i].history.findIndex(x => x.id === editHistoryId);
    if (hi !== -1) all[i].history[hi] = { ...all[i].history[hi], ...obj };
    toast('履歴を更新しました', 'success');
  } else {
    obj.createdAt = new Date().toISOString();
    all[i].history.push(obj);
    toast('履歴を追加しました', 'success');
  }
  save(all); closeModal('modal-history'); renderHistory();
}

function deleteHistory(hid) {
  if (!confirm('この履歴を削除しますか？')) return;
  const all = load();
  const i   = all.findIndex(x => x.id === currentId);
  if (i === -1) return;
  all[i].history = (all[i].history||[]).filter(x => x.id !== hid);
  save(all); renderHistory(); toast('削除しました');
}

function renderHistory() {
  const c  = load().find(x => x.id === currentId);
  const el = document.getElementById('history-list');
  const list = [...(c?.history || [])].sort((a,b) => b.date.localeCompare(a.date));
  if (!list.length) { el.innerHTML = '<p style="color:var(--gray-400);font-size:13px;text-align:center;padding:16px 0;">履歴がありません</p>'; return; }
  el.innerHTML = list.map(h => `
    <div class="list-row" style="align-items:flex-start;">
      <div style="flex-shrink:0;text-align:right;min-width:80px;">
        <div style="font-size:13px;font-weight:600;color:var(--gray-700);">${esc(h.date)}</div>
      </div>
      <div class="list-row-info" style="padding-left:4px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          ${badge(HISTORY_TYPE, h.type || 'other')}
          <span class="list-row-title">${esc(h.title)}</span>
        </div>
        ${h.content ? `<div style="font-size:13px;color:var(--gray-500);line-height:1.6;white-space:pre-wrap;">${esc(h.content)}</div>` : ''}
      </div>
      <div class="list-row-actions" style="flex-shrink:0;">
        <button class="btn-icon" onclick="openHistoryModal('${h.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon danger" onclick="deleteHistory('${h.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>
    </div>`).join('');
}

// =====================================================
//  Modal helpers
// =====================================================
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) closeModal(el.id); });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(m => closeModal(m.id));
});

// =====================================================
//  Toast
// =====================================================
function toast(msg, type = '') {
  const wrap = document.getElementById('toast-wrap');
  const el   = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  el.innerHTML = `<span>${icon}</span> ${esc(msg)}`;
  wrap.appendChild(el);
  setTimeout(() => { el.style.animation = 'fadeOut .3s ease forwards'; setTimeout(() => el.remove(), 300); }, 2500);
}

// =====================================================
//  Init
// =====================================================

// 旧contracts[]データをprojects[]へ自動マイグレーション
// =====================================================
//  Drag & Drop（クライアント一覧の並び替え）
// =====================================================
let dragSrcId = null;

function onDragStart(e) {
  dragSrcId = e.currentTarget.dataset.id;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const card = e.currentTarget;
  if (card.dataset.id !== dragSrcId) card.classList.add('drag-over');
}

function onDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

function onDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  const targetId = e.currentTarget.dataset.id;
  e.currentTarget.classList.remove('drag-over');
  if (!dragSrcId || dragSrcId === targetId) return;

  const all = load();
  const srcIdx  = all.findIndex(c => c.id === dragSrcId);
  const tgtIdx  = all.findIndex(c => c.id === targetId);
  if (srcIdx === -1 || tgtIdx === -1) return;

  // 配列内で入れ替え
  const [moved] = all.splice(srcIdx, 1);
  all.splice(tgtIdx, 0, moved);
  save(all);
  renderList();
}

function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.client-card').forEach(c => c.classList.remove('drag-over'));
  dragSrcId = null;
}

// =====================================================
//  All Projects View
// =====================================================
function renderAllProjects() {
  const all = load();
  const q               = (document.getElementById('ap-search').value || '').toLowerCase();
  const filterStatus    = document.getElementById('ap-filter-status').value;
  const filterType      = document.getElementById('ap-filter-type').value;
  const filterClient    = document.getElementById('ap-filter-client').value;
  const filterAssignee  = document.getElementById('ap-filter-assignee').value;

  // クライアントフィルタの選択肢を更新
  const clientSel  = document.getElementById('ap-filter-client');
  const prevClient = clientSel.value;
  clientSel.innerHTML = '<option value="">クライアント（全員）</option>' +
    all.map(c => `<option value="${c.id}"${c.id===prevClient?' selected':''}>${esc(c.company||c.name)}</option>`).join('');

  // 全プロジェクトを収集
  let rows = [];
  all.forEach(c => {
    (c.projects || []).forEach(p => rows.push({ client: c, project: p }));
  });

  // 担当者フィルタの選択肢を更新（プロジェクト担当者 ＋ クライアント担当者）
  const assigneeSel  = document.getElementById('ap-filter-assignee');
  const prevAssignee = assigneeSel.value;
  const assigneeSet  = new Set();
  rows.forEach(r => {
    if (r.project.assignee) assigneeSet.add(r.project.assignee);
    if (r.client.assignee)  assigneeSet.add(r.client.assignee);
  });
  assigneeSel.innerHTML = '<option value="">担当者（全員）</option>' +
    [...assigneeSet].sort().map(a => `<option value="${esc(a)}"${a===prevAssignee?' selected':''}>${esc(a)}</option>`).join('');

  // フィルタ適用
  if (q) rows = rows.filter(r =>
    (r.project.name||'').toLowerCase().includes(q) ||
    (r.client.company||'').toLowerCase().includes(q) ||
    (r.client.name||'').toLowerCase().includes(q) ||
    (r.project.assignee||'').toLowerCase().includes(q)
  );
  if (filterStatus)   rows = rows.filter(r => r.project.status === filterStatus);
  if (filterType)     rows = rows.filter(r => r.project.contractType === filterType);
  if (filterClient)   rows = rows.filter(r => r.client.id === filterClient);
  if (filterAssignee) rows = rows.filter(r =>
    r.project.assignee === filterAssignee || r.client.assignee === filterAssignee
  );

  // 開始日の新しい順でソート（未設定は末尾）
  rows.sort((a, b) => {
    const da = a.project.startDate || '0000';
    const db = b.project.startDate || '0000';
    return db.localeCompare(da);
  });

  // サマリー統計
  const totalRows  = rows.length;
  const activeRows = rows.filter(r => r.project.status === 'active').length;
  let sumMrr = 0, sumOnetime = 0;
  rows.forEach(({ project: p }) => {
    const amt = Number(p.amount) || 0;
    if (p.contractType === 'subscription') {
      sumMrr += p.cycle === 'yearly' ? Math.round(amt / 12) : amt;
    } else if (p.contractType === 'onetime') {
      sumOnetime += amt;
    }
  });
  document.getElementById('ap-stats-grid').innerHTML = `
    <div class="stat-card"><div class="stat-label">表示中のプロジェクト</div><div class="stat-value primary">${totalRows}</div></div>
    <div class="stat-card"><div class="stat-label">進行中</div><div class="stat-value">${activeRows}</div></div>
    <div class="stat-card"><div class="stat-label">月額収益（MRR）</div><div class="stat-value success">${fmtMoney(sumMrr)}</div></div>
    <div class="stat-card"><div class="stat-label">単発合計</div><div class="stat-value success" style="font-size:18px;">${fmtMoney(sumOnetime)}</div></div>
  `;

  // 一覧描画
  const el = document.getElementById('ap-list');
  if (!rows.length) {
    el.innerHTML = `<div class="empty-state">
      <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
      </svg>
      <h3>プロジェクトが見つかりません</h3>
      <p style="font-size:13px;">フィルターや検索条件を変えてみてください</p>
    </div>`;
    return;
  }

  el.innerHTML = rows.map(({ client: c, project: p }) => {
    const amtHtml    = fmtProjectAmount(p);
    const dateStr    = p.startDate ? `${fmtDate(p.startDate)}${p.endDate ? ' 〜 ' + fmtDate(p.endDate) : ''}` : '';
    // 担当者：プロジェクト担当者を優先、なければクライアント担当者を（淡色で）表示
    const assigneeDisplay = p.assignee
      ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:12px;color:var(--gray-600);white-space:nowrap;flex-shrink:0;">
           <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
           ${esc(p.assignee)}</span>`
      : (c.assignee
          ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:12px;color:var(--gray-400);white-space:nowrap;flex-shrink:0;">
               <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
               ${esc(c.assignee)}</span>`
          : '');
    return `
    <div class="list-row ap-row" onclick="openDetail('${c.id}')">
      <div class="ap-client-col">
        ${avatarHtml(c, 34, 13)}
        <div style="overflow:hidden;">
          <div class="ap-client-name">${esc(c.company || c.name)}</div>
          ${c.company && c.name ? `<div class="ap-client-sub">${esc(c.name)}</div>` : ''}
        </div>
      </div>
      <div class="list-row-info">
        <div class="list-row-title">${esc(p.name)}</div>
        ${p.description ? `<div class="list-row-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:280px;">${esc(p.description)}</div>` : ''}
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;flex-wrap:wrap;">
        ${badge(PROJECT_STATUS, p.status)}
        ${p.contractType && p.contractType !== 'none' ? badge(CONTRACT_TYPE, p.contractType) : ''}
      </div>
      ${assigneeDisplay || '<span style="flex-shrink:0;min-width:80px;"></span>'}
      ${amtHtml ? `<div style="flex-shrink:0;min-width:80px;text-align:right;">${amtHtml}</div>` : '<div style="flex-shrink:0;min-width:80px;"></div>'}
      ${dateStr ? `<div style="font-size:11px;color:var(--gray-400);white-space:nowrap;flex-shrink:0;min-width:120px;">${dateStr}</div>` : '<div style="flex-shrink:0;min-width:120px;"></div>'}
      <div style="display:flex;gap:4px;flex-shrink:0;">
        <button class="btn-icon" title="プロジェクトを編集" onclick="event.stopPropagation();editProjectFromAllProjects('${c.id}','${p.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon" title="クライアント詳細を開く" onclick="event.stopPropagation();openDetail('${c.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');
}

function migrateContracts() {
  const all = load();
  let migrated = false;
  const contractStatusToProject = {
    active: 'active', completed: 'completed', pending: 'planning', cancelled: 'on-hold'
  };
  all.forEach(c => {
    if (!c.contracts || c.contracts.length === 0) return;
    if (!c.projects) c.projects = [];
    c.contracts.forEach(ct => {
      // 同名の案件が既に存在する場合はスキップ（二重移行防止）
      const alreadyMigrated = c.projects.some(p => p._migratedFromContract === ct.id);
      if (alreadyMigrated) return;
      c.projects.push({
        id:                   uid(),
        _migratedFromContract: ct.id,
        name:                 ct.title || '（旧契約）',
        status:               contractStatusToProject[ct.status] || 'active',
        priority:             'normal',
        description:          ct.note || '',
        contractType:         ct.type || 'onetime',
        amount:               ct.amount || '',
        cycle:                ct.cycle || null,
        startDate:            ct.startDate || '',
        endDate:              ct.endDate   || '',
        createdAt:            ct.createdAt || new Date().toISOString(),
      });
    });
    c.contracts = [];
    migrated = true;
  });
  if (migrated) {
    save(all);
    toast('旧契約データを案件に移行しました', 'success');
  }
}

// =====================================================
//  起動：セッション確認 → ログイン済みなら直接アプリへ
// =====================================================
(async () => {
  try {
    const r = await fetch(API + '?action=me');
    const d = await r.json();
    if (d.ok && d.user) {
      currentUser = d.user;
      await afterLogin();
    }
    // 未ログインの場合はログイン画面をそのまま表示（.hidden を付けない）
  } catch (e) {
    // 通信エラー時もログイン画面を表示
    console.warn('セッション確認失敗:', e);
  }
})();
