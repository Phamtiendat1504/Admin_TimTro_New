// =======================================
// FIREBASE CONFIG
// firebase deploy --only hosting
// =======================================
const firebaseConfig = {
  apiKey: "AIzaSyAZO-ogX1IXCOsH8nuIFb-QOok2S7jeT5s",
  authDomain: "doantotnghiep-b39ae.firebaseapp.com",
  projectId: "doantotnghiep-b39ae",
  storageBucket: "doantotnghiep-b39ae.firebasestorage.app",
  messagingSenderId: "320322209979",
  appId: "1:320322209979:web:b07aeab412e6ff46b5419e"
};

firebase.initializeApp(firebaseConfig);
const auth    = firebase.auth();
const db      = firebase.firestore();
const storage = firebase.storage();

// ?? CHARTS INSTANCES ??
let postsChartInstance = null;
let usersChartInstance = null;

// ════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════
const fmt = n => new Intl.NumberFormat('vi-VN').format(n);
const toEpochMs = value => {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const fmtDate = ts => {
  const ms = toEpochMs(ts);
  return ms ? new Date(ms).toLocaleDateString('vi-VN') : 'N/A';
};
const fmtDateTime = ts => {
  const ms = toEpochMs(ts);
  return ms ? new Date(ms).toLocaleString('vi-VN') : 'N/A';
};
const statusText = status => ({
  waiting_for_payment: 'Chờ thanh toán',
  paid: 'Đã thanh toán',
  paid_waiting_admin: 'Chờ admin duyệt',
  approved: 'Đã duyệt',
  rejected: 'Từ chối',
  expired: 'Hết hạn',
  cancelled: 'Đã hủy',
  failed: 'Lỗi'
}[status] || status || 'N/A');
const paymentStatusText = (status, type = '') => (
  type === 'featured' && status === 'paid'
    ? 'Đã thanh toán, chờ admin duyệt'
    : statusText(status)
);
const paymentStatusBadge = (status, type = '') => {
  if (status === 'approved') return 'badge-approved';
  if (status === 'paid') return type === 'featured' ? 'badge-pending' : 'badge-approved';
  if (status === 'paid_waiting_admin') return 'badge-pending';
  if (['rejected', 'expired', 'cancelled', 'failed'].includes(status)) return 'badge-rejected';
  return 'badge-pending';
};
const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

let activeListeners = [];
let postsSearchTimeout;
let usersSearchTimeout;
let playEntrySplashOnNextAuth = false;
let entrySplashTimer = null;
const ENTRY_SPLASH_MS = 1650;

function stopAllListeners() {
  activeListeners.forEach(u => u());
  activeListeners = [];
}

function hideEntrySplash() {
  const splash = document.getElementById('entrySplash');
  if (!splash) return;
  if (entrySplashTimer) {
    clearTimeout(entrySplashTimer);
    entrySplashTimer = null;
  }
  splash.classList.remove('show');
  splash.style.display = 'none';
  splash.setAttribute('aria-hidden', 'true');
}

function showEntrySplash(name = 'Administrator') {
  return new Promise(resolve => {
    const splash = document.getElementById('entrySplash');
    if (!splash) { resolve(); return; }

    if (entrySplashTimer) {
      clearTimeout(entrySplashTimer);
      entrySplashTimer = null;
    }

    const nameEl = document.getElementById('entrySplashName');
    if (nameEl) nameEl.textContent = name || 'Administrator';
    const progressBar = splash.querySelector('.splash-progress-bar');
    if (progressBar) {
      progressBar.style.animation = 'none';
      void progressBar.offsetWidth;
      progressBar.style.animation = '';
    }

    splash.classList.remove('show');
    splash.style.display = 'flex';
    splash.setAttribute('aria-hidden', 'false');

    requestAnimationFrame(() => splash.classList.add('show'));

    entrySplashTimer = setTimeout(() => {
      splash.classList.remove('show');
      splash.setAttribute('aria-hidden', 'true');
      setTimeout(() => {
        splash.style.display = 'none';
        entrySplashTimer = null;
        resolve();
      }, 420);
    }, ENTRY_SPLASH_MS);
  });
}

// ════════════════════════════════════════
// TOAST
// ════════════════════════════════════════
function showToast(type, title, message, duration = 3000) {
  const icons = { success: 'fa-check-circle', error: 'fa-times-circle', warning: 'fa-exclamation-circle', info: 'fa-info-circle' };
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.style.setProperty('--dur', duration + 'ms');
  t.innerHTML = `
    <div class="toast-icon"><i class="fas ${icons[type]||icons.info}"></i></div>
    <div class="toast-body"><div class="toast-title">${safeTitle}</div><div class="toast-msg">${safeMessage}</div></div>
    <button class="toast-close" onclick="this.closest('.toast').classList.add('toast-out');setTimeout(()=>this.closest('.toast').remove(),300)"><i class="fas fa-times"></i></button>
    <div class="toast-bar"></div>
  `;
  document.getElementById('toastContainer').appendChild(t);
  setTimeout(() => { if (t.parentNode) { t.classList.add('toast-out'); setTimeout(() => t.remove(), 300); } }, duration);
}

// ════════════════════════════════════════
// CONFIRM
// ════════════════════════════════════════
function showConfirm(title, message, type = 'warn') {
  return new Promise(resolve => {
    const iconMap   = { danger: 'fa-trash-alt', success: 'fa-check-circle', info: 'fa-info-circle', warn: 'fa-exclamation-triangle' };
    const btnClass  = { danger: 'btn-confirm-danger', success: 'btn-confirm-success', warn: 'btn-confirm-ok', info: 'btn-confirm-ok' };
    const safeTitle = escapeHtml(title);
    const safeMessage = escapeHtml(message);
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-icon-wrap ${type}"><i class="fas ${iconMap[type]||iconMap.warn}"></i></div>
        <div class="confirm-title">${safeTitle}</div>
        <div class="confirm-message">${safeMessage}</div>
        <div class="confirm-actions">
          <button class="btn btn-confirm-cancel" id="cfCancel">Hủy</button>
          <button class="btn ${btnClass[type]||'btn-confirm-ok'}" id="cfOk">Xác nhận</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#cfOk').onclick    = () => { overlay.remove(); resolve(true); };
    overlay.querySelector('#cfCancel').onclick = () => { overlay.remove(); resolve(false); };
  });
}

// ════════════════════════════════════════
// PROMPT
// ════════════════════════════════════════
function showPrompt(title, message, placeholder = '') {
  return new Promise(resolve => {
    const safeTitle = escapeHtml(title);
    const safeMessage = escapeHtml(message);
    const safePlaceholder = escapeHtml(placeholder);
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-icon-wrap warn"><i class="fas fa-pen"></i></div>
        <div class="confirm-title">${safeTitle}</div>
        <div class="confirm-message">${safeMessage}</div>
        <input class="confirm-input" id="promptInput" placeholder="${safePlaceholder}">
        <div class="confirm-actions">
          <button class="btn btn-confirm-cancel" id="pfCancel">Hủy</button>
          <button class="btn btn-confirm-ok" id="pfOk">Gửi</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const inp = overlay.querySelector('#promptInput');
    inp.focus();
    overlay.querySelector('#pfOk').onclick    = () => { overlay.remove(); resolve(inp.value.trim()||null); };
    overlay.querySelector('#pfCancel').onclick = () => { overlay.remove(); resolve(null); };
    inp.addEventListener('keypress', e => { if (e.key === 'Enter') overlay.querySelector('#pfOk').click(); });
  });
}

// ════════════════════════════════════════
// MODAL
// ════════════════════════════════════════
function showModal(html) {
  const m = document.createElement('div');
  m.className = 'modal-overlay';
  m.innerHTML = `<div class="modal-box">${html}</div>`;
  if (html.includes('data-modal-size="post"')) {
    m.querySelector('.modal-box')?.classList.add('post-modal-box');
  }
  m.addEventListener('click', e => { if (e.target === m) m.remove(); });
  document.body.appendChild(m);
}
function closeModal() { document.querySelector('.modal-overlay')?.remove(); }

function safeUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw, window.location.origin);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch (_) {}
  return '';
}

function safeForJsGlobal(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

window.showFullscreenImage = function(url) {
  const safe = safeUrl(url);
  if (!safe) return;
  const overlay = document.createElement('div');
  overlay.className = 'fullscreen-img-overlay';
  const img = document.createElement('img');
  img.src = safe;
  img.alt = 'Fullscreen';
  overlay.appendChild(img);
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
};

// ════════════════════════════════════════
// NOTIFICATION – SEND & ADMIN BELL
// ════════════════════════════════════════
function sendNotification(userId, title, message, type, extra = {}) {
  return db.collection('notifications').add({ ...extra, userId, title, message, type, seen: false, isRead: false, createdAt: Date.now() })
    .catch(e => console.warn('Notification failed:', e));
}

// ?? ADMIN BELL DROPDOWN ??
let adminNotifUnsubscribe = null;

// --- NOTIFICATIONS SYSTEM REMOVED ---
// Web Admin does not need to receive notifications anymore.


// Đóng / Mở dropdown thông báo quản trị
window.toggleAdminNotif = function(e) {
  if(e) e.stopPropagation();
  const dropdown = document.getElementById('adminNotifDropdown');
  if(dropdown) dropdown.classList.toggle('open');
};

// Đóng dropdown khi click ra ngoài
document.addEventListener('click', e => {
  const dropdownNotif = document.getElementById('adminNotifDropdown');
  const btnBell = document.getElementById('btnNotifBell');
  if (dropdownNotif && btnBell && !dropdownNotif.contains(e.target) && !btnBell.contains(e.target)) {
    dropdownNotif.classList.remove('open');
  }
});


// ════════════════════════════════════════
// TOPBAR DATE
// ════════════════════════════════════════
function updateDate() {
  const d = new Date();
  const el = document.getElementById('topbarDate');
  if (el) el.textContent = d.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}
updateDate();

// ════════════════════════════════════════
// AUTH
// ════════════════════════════════════════
auth.onAuthStateChanged(async user => {
  document.getElementById('loadingScreen').style.display = 'none';
  const btnLogin = document.getElementById('btnLogin');
  if (!user) {
    hideEntrySplash();
    playEntrySplashOnNextAuth = false;
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('appScreen').style.display = 'none';
    if (btnLogin) {
      btnLogin.disabled = false;
      btnLogin.textContent = 'Đăng nhập';
    }
    return;
  }
  try {
    const userDoc = await db.collection('users').doc(user.uid).get();
    if (!userDoc.exists || userDoc.data().role !== 'admin') {
      await auth.signOut(); return;
    }
    const name = userDoc.data().fullName || 'Admin';
    document.getElementById('sidebarName').textContent = name;
    document.getElementById('sidebarAvatar').textContent = name.charAt(0).toUpperCase();
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appScreen').style.display = 'flex';
    if (btnLogin) {
      btnLogin.disabled = false;
      btnLogin.textContent = 'Đăng nhập';
    }
    if (playEntrySplashOnNextAuth) {
      await showEntrySplash(name);
    } else {
      hideEntrySplash();
    }
    playEntrySplashOnNextAuth = false;
    startRealtimeListeners();
    loadDashboard();
  } catch (e) {
    console.error(e);
    playEntrySplashOnNextAuth = false;
    hideEntrySplash();
    await auth.signOut();
  }
});

// LOGIN
document.getElementById('btnLogin').addEventListener('click', async () => {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl    = document.getElementById('loginError');
  const btnLogin = document.getElementById('btnLogin');

  errEl.style.display = 'none';
  if (!email || !password) {
    errEl.textContent = 'Vui lòng nhập đầy đủ email và mật khẩu.';
    errEl.style.display = 'block';
    return;
  }

  try {
    btnLogin.disabled = true;
    btnLogin.textContent = 'Đang đăng nhập...';
    playEntrySplashOnNextAuth = true;
    await auth.signInWithEmailAndPassword(email, password);
  } catch (e) {
    playEntrySplashOnNextAuth = false;
    errEl.textContent = 'Email hoặc mật khẩu không chính xác.';
    errEl.style.display = 'block';
    btnLogin.disabled = false;
    btnLogin.textContent = 'Đăng nhập';
  }
});
document.getElementById('loginPassword').addEventListener('keypress', e => { if (e.key === 'Enter') document.getElementById('btnLogin').click(); });

// LOGOUT
document.getElementById('btnLogout').addEventListener('click', async () => {
  const ok = await showConfirm('Đăng xuất', 'Bạn có chắc chắn muốn đăng xuất khỏi hệ thống?', 'warn');
  if (ok) { stopAllListeners(); closeModal(); await auth.signOut(); }
});

// MOBILE MENU
document.getElementById('btnMenuMobile').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});
document.addEventListener('click', e => {
  const sidebar = document.getElementById('sidebar');
  const btnMenu = document.getElementById('btnMenuMobile');
  if (!sidebar || !btnMenu || window.innerWidth > 900) return;
  if (!sidebar.classList.contains('open')) return;
  if (!sidebar.contains(e.target) && !btnMenu.contains(e.target)) {
    sidebar.classList.remove('open');
  }
});

// ════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════
const pageConfig = {
  dashboard:      { title: 'Bảng điều khiển',   bread: 'Tổng quan',        load: loadDashboard },
  verifications: { title: 'Xác minh tài khoản',   bread: 'Xác minh',          load: loadVerifications },
  posts:          { title: 'Quản lý bài đăng',  bread: 'Bài đăng',          load: () => loadPosts('pending') },
  users:          { title: 'Quản lý người dùng', bread: 'Người dùng',       load: () => loadUsers('all') },
  appointments:  { title: 'Lịch hẹn xem phòng', bread: 'Lịch hẹn',        load: () => loadAppointments('all') },
  support:       { title: 'Hỗ trợ người dùng',  bread: 'Hỗ trợ',          load: () => loadSupportTickets('new') },
  featured:      { title: 'Duyệt bài nổi bật',  bread: 'Nổi bật',         load: () => loadFeaturedRequests('paid_waiting_admin') },
  payments:      { title: 'Lịch sử thanh toán', bread: 'Thanh toán',       load: () => loadPayments('all') },
  reviews:       { title: 'Quản lý đánh giá',   bread: 'Đánh giá',         load: () => loadReviews('approved') },
  broadcast:      { title: 'Thông báo hệ thống', bread: 'Gửi thông báo',    load: () => {} },
  cleanup:        { title: 'Dọn dẹp tài khoản',  bread: 'Dọn dẹp',          load: () => { document.getElementById('cleanupResultArea').style.display = 'none'; } },
};

function navigateTo(page) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page' + page.charAt(0).toUpperCase() + page.slice(1))?.classList.add('active');
  const cfg = pageConfig[page] || {};
  document.getElementById('pageTitle').textContent = cfg.title || page;
  document.getElementById('breadcrumbCurrent').textContent = cfg.bread || page;
  cfg.load?.();
  document.getElementById('sidebar').classList.remove('open');
}

document.querySelectorAll('.nav-item[data-page]').forEach(item => {
  item.addEventListener('click', () => navigateTo(item.dataset.page));
});

document.querySelectorAll('.card-link[data-goto]').forEach(link => {
  link.addEventListener('click', e => { e.preventDefault(); navigateTo(link.dataset.goto); });
});

// ════════════════════════════════════════
// TAB HELPERS
// ════════════════════════════════════════
function bindTabs(groupId, loadFn) {
  document.getElementById(groupId)?.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById(groupId).querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadFn(btn.dataset.filter);
    });
  });
}

bindTabs('postsTabGroup',  filter => {
  state.posts.page = 1;
  postsSearchKeyword = '';
  postsLocationFilter = '';
  selectedPostIds.clear();
  const searchInput = document.getElementById('searchPost');
  if (searchInput) searchInput.value = '';
  const locationSelect = document.getElementById('filterPostLocation');
  if (locationSelect) locationSelect.value = '';
  loadPosts(filter);
});
bindTabs('usersTabGroup',  filter => {
  state.users.page = 1;
  selectedUserIds.clear();
  // Reset search khi chuyển tab
  usersSearchKeyword = '';
  const searchInput = document.getElementById('searchUser');
  if (searchInput) searchInput.value = '';
  loadUsers(filter);
});
bindTabs('apptTabGroup',   filter => {
  state.appt.page = 1;
  selectedAppointmentIds.clear();
  loadAppointments(filter);
});
bindTabs('supportTabGroup', filter => {
  state.support.page = 1;
  loadSupportTickets(filter);
});
bindTabs('featuredTabGroup', filter => {
  state.featured.page = 1;
  loadFeaturedRequests(filter);
});
bindTabs('paymentsTabGroup', filter => {
  state.payments.page = 1;
  loadPayments(filter);
});
bindTabs('reviewsTabGroup', filter => {
  state.reviews.page = 1;
  loadReviews(filter);
});

// ════════════════════════════════════════
// REAL-TIME DASHBOARD LISTENERS & AUTO-UNLOCK SWEEP
// ════════════════════════════════════════
function startRealtimeListeners() {
  stopAllListeners();
  let usersRealtimeRefreshTimer = null;

  // 1. Luồng logic: Quét mở khóa trên Firestore (10 giây/lần để tiết kiệm Read)
  const unlockInterval = setInterval(() => {
    checkAndUnlockExpiredUsers();
  }, 10000);
  activeListeners.push(() => clearInterval(unlockInterval));

  // 2. Luồng hiển thị: Cập nhật bộ đếm trên UI (1 giây/lần cho mượt)
  const uiRefreshInterval = setInterval(() => {
    if (document.getElementById('pageUsers').classList.contains('active')) {
      renderUsers();
    }
  }, 1000);
  activeListeners.push(() => clearInterval(uiRefreshInterval));

  // Chạy quét lần đầu ngay khi khởi động
  checkAndUnlockExpiredUsers();

  activeListeners.push(
    db.collection('users').onSnapshot(snap => {
      document.getElementById('statUsers').textContent = snap.size;
      if (document.getElementById('pageUsers').classList.contains('active')) {
        if (usersRealtimeRefreshTimer) clearTimeout(usersRealtimeRefreshTimer);
        usersRealtimeRefreshTimer = setTimeout(() => {
          loadUsers(getActiveTab('usersTabGroup'));
        }, 180);
      }
    })
  );
  activeListeners.push(() => {
    if (usersRealtimeRefreshTimer) {
      clearTimeout(usersRealtimeRefreshTimer);
      usersRealtimeRefreshTimer = null;
    }
  });
  activeListeners.push(
    db.collection('rooms').onSnapshot(snap => {
      document.getElementById('statPosts').textContent = snap.size;
      const p = snap.docs.filter(d => d.data().status === 'pending').length;
      document.getElementById('statPending').textContent = p;
      setBadge('badgePosts', p);
    })
  );
  activeListeners.push(
    db.collection('verifications').onSnapshot(snap => {
      const pendingLike = snap.docs.filter(doc => shouldShowInAdminVerificationQueue(doc.data()));
      document.getElementById('statVerify').textContent = pendingLike.length;
      setBadge('badgeVerify', pendingLike.length);
    })
  );
  activeListeners.push(
    db.collection('support_tickets').onSnapshot(snap => {
      const unread = snap.docs.filter(d => d.data().unreadForAdmin === true).length;
      setBadge('badgeSupport', unread);
      if (document.getElementById('pageSupport')?.classList.contains('active')) {
        loadSupportTickets(getActiveTab('supportTabGroup'));
      }
    })
  );
  activeListeners.push(
    db.collection('featured_upgrade_requests').onSnapshot(snap => {
      const pending = snap.docs.filter(d => ['paid', 'paid_waiting_admin'].includes(d.data().status)).length;
      setBadge('badgeFeatured', pending);
      if (document.getElementById('pageFeatured')?.classList.contains('active')) {
        loadFeaturedRequests(getActiveTab('featuredTabGroup'));
      }
    })
  );
  activeListeners.push(
    db.collection('reviews').onSnapshot(() => {
      if (document.getElementById('pageReviews')?.classList.contains('active')) {
        loadReviews(getActiveTab('reviewsTabGroup'));
      }
    })
  );
}

function setBadge(id, count) {
  const el = document.getElementById(id);
  if (!el) return;
  if (count > 0) { el.textContent = count; el.classList.add('show'); }
  else { el.classList.remove('show'); }
}

// ════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════
async function loadDashboard() {
  try {
    const [postsSnap, usersSnap, allPostsSnap, allUsersSnap] = await Promise.all([
      db.collection('rooms').where('status', '==', 'pending').orderBy('createdAt', 'desc').limit(5).get(),
      db.collection('users').orderBy('createdAt', 'desc').limit(5).get(),
      db.collection('rooms').get(),
      db.collection('users').get()
    ]);

    renderDashboardCharts(allPostsSnap.docs, allUsersSnap.docs);

    const postsEl = document.getElementById('dashRecentPosts');
    if (postsSnap.empty) {
      postsEl.innerHTML = '<div class="empty-state"><i class="fas fa-file-alt"></i>Không có bài chờ duyệt</div>';
    } else {
      postsEl.innerHTML = postsSnap.docs.map(doc => {
        const d = doc.data();
        const s = (d.status || 'pending').toLowerCase();
        let bc = 'badge-pending';
        let bt = 'Chờ duyệt';
        if (s === 'approved') { bc = 'badge-approved'; bt = 'Đã duyệt'; }
        else if (s === 'rented') { bc = 'badge-landlord'; bt = 'Đã cho thuê'; }
        else if (s === 'rejected') { bc = 'badge-rejected'; bt = 'Từ chối'; }

        return `<div class="list-item" data-created-at="${toEpochMs(d.createdAt)}">
          <div class="list-avatar"><i class="fas fa-file-alt"></i></div>
          <div class="list-info">
            <div class="list-name">${d.title||'Chưa có tiêu đề'}</div>
            <div class="list-meta">${d.ward||''}, ${d.district||''} &bull; ${fmt(d.price||0)} đ/tháng</div>
          </div>
          <span class="badge ${bc}">${bt}</span>
        </div>`;
      }).join('');
    }

    const usersEl = document.getElementById('dashRecentUsers');
    if (usersSnap.empty) {
      usersEl.innerHTML = '<div class="empty-state"><i class="fas fa-users"></i>Chưa có người dùng</div>';
    } else {
      usersEl.innerHTML = usersSnap.docs.map(doc => {
        const d = doc.data();
        const roleLabel = d.role === 'admin' ? 'Admin' : 'User';
        const roleClass = d.role === 'admin' ? 'badge-admin' : 'badge-tenant';
        return `<div class="list-item">
          <div class="list-avatar-user">${(d.fullName||'U').charAt(0).toUpperCase()}</div>
          <div class="list-info">
            <div class="list-name">${d.fullName||'N/A'}</div>
            <div class="list-meta">${d.email||''}</div>
          </div>
          <span class="badge ${roleClass}">${roleLabel}</span>
        </div>`;
      }).join('');
    }
  } catch (e) {
    console.error(e);
    showToast('error', 'Lỗi', 'Không thể tải dữ liệu tổng quan');
  }
}

// ?? RENDER CHARTS ??
function renderDashboardCharts(postDocs, userDocs) {
  // 1. Posts Chart (6 tháng gần nhất)
  const monthNames = ["Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6", "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12"];
  const last6Months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    last6Months.push({ month: d.getMonth(), year: d.getFullYear(), label: monthNames[d.getMonth()], count: 0 });
  }

  postDocs.forEach(doc => {
    const data = doc.data();
    if (!data.createdAt) return;
    const d = new Date(toEpochMs(data.createdAt));
    const m = d.getMonth();
    const y = d.getFullYear();
    const target = last6Months.find(item => item.month === m && item.year === y);
    if (target) target.count++;
  });

  const postsCtx = document.getElementById('postsChart').getContext('2d');
  if (postsChartInstance) postsChartInstance.destroy();
  // Create gradient fill for area chart
  const lineGrad = postsCtx.createLinearGradient(0, 0, 0, 300);
  lineGrad.addColorStop(0, 'rgba(0, 255, 255, 0.5)');
  lineGrad.addColorStop(0.6, 'rgba(99, 102, 241, 0.08)');
  lineGrad.addColorStop(1, 'rgba(99, 102, 241, 0)');
  postsChartInstance = new Chart(postsCtx, {
    type: 'line',
    data: {
      labels: last6Months.map(i => i.label),
      datasets: [{
        label: 'Bài đăng mới',
        data: last6Months.map(i => i.count),
        borderColor: '#00ffff',
        borderWidth: 2.5,
        backgroundColor: lineGrad,
        fill: true,
        tension: 0.45,
        pointBackgroundColor: '#6366f1',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        pointRadius: 5,
        pointHoverRadius: 8,
        pointHoverBackgroundColor: '#6366f1',
        pointHoverBorderColor: '#ffffff',
        pointHoverBorderWidth: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,0.92)',
          titleColor: '#f8fafc',
          bodyColor: '#cbd5e1',
          borderColor: 'rgba(99,102,241,0.4)',
          borderWidth: 1,
          padding: 12,
          cornerRadius: 10,
          displayColors: false,
          callbacks: { label: ctx => `  ${ctx.parsed.y} bài đăng` }
        }
      },
      scales: {
        x: {
          grid: { display: false, drawBorder: false },
          ticks: { color: '#94a3b8', font: { size: 12 } }
        },
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, color: '#94a3b8', font: { size: 12 }, padding: 8 },
          grid: { color: 'rgba(148,163,184,0.12)', borderDash: [4,4], drawBorder: false }
        }
      }
    }
  });

  // 2. Users Pie Chart - phân loại theo isVerified (không cần theo role tenant/landlord)
  const userGroups = { standard: 0, verified: 0, admin: 0 };
  userDocs.forEach(doc => {
    const d = doc.data();
    if (d.role === 'admin') {
      userGroups.admin++;
    } else if (d.isVerified === true) {
      userGroups.verified++;
    } else {
      userGroups.standard++;
    }
  });

  const usersCtx = document.getElementById('usersChart').getContext('2d');
  if (usersChartInstance) usersChartInstance.destroy();
  usersChartInstance = new Chart(usersCtx, {
    type: 'doughnut',
    data: {
      labels: ['Thành viên tiêu chuẩn', 'Đã xác minh', 'Admin'],
      datasets: [{
        data: [userGroups.standard, userGroups.verified, userGroups.admin],
        backgroundColor: ['#00ffff', '#ff00ff', '#7000ff'],
        borderWidth: 0,
        hoverOffset: 10
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { padding: 18, color: '#64748b', usePointStyle: true, pointStyle: 'circle', font: { size: 12 } }
        },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,0.92)',
          titleColor: '#f8fafc',
          bodyColor: '#cbd5e1',
          borderColor: 'rgba(99,102,241,0.4)',
          borderWidth: 1,
          padding: 12,
          cornerRadius: 10
        }
      }
    }
  });
}

// ════════════════════════════════════════
// VERIFICATIONS
// ════════════════════════════════════════
async function loadVerificationsLegacy() {
  const tbody = document.getElementById('verifyTableBody');
  tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state">Đang tải...</div></td></tr>';
  try {
    const snap = await db.collection('verifications').where('status', '==', 'pending').orderBy('createdAt', 'desc').get();
    if (snap.empty) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><i class="fas fa-check-circle"></i>Không có yêu cầu xác minh nào</div></td></tr>';
      return;
    }
    tbody.innerHTML = snap.docs.map(doc => {
      const d = doc.data();
      return `<tr data-created-at="${toEpochMs(d.createdAt)}">
        <td>
          <div class="td-user">
            <div class="td-avatar">${(d.fullName||'U').charAt(0).toUpperCase()}</div>
            <div><div class="td-name">${d.fullName||'N/A'}</div></div>
          </div>
        </td>
        <td><span style="font-size:13px;font-weight:600">${d.cccdNumber||'N/A'}</span></td>
        <td><span style="font-size:13px;font-weight:600;color:#64748b">${d.phone || d.phoneNumber || 'N/A'}</span></td>
        <td><span style="font-size:12px;color:#94a3b8;font-weight:600">${fmtDate(d.createdAt)}</span></td>
        <td><span class="badge badge-pending">Chờ duyệt</span></td>
        <td style="text-align:right">
          <div class="list-actions">
            <button class="btn btn-view" onclick="viewVerification('${doc.id}')">Xem</button>
            <button class="btn btn-approve" onclick="approveVerification('${doc.id}','${d.userId}')">Duyệt</button>
            <button class="btn btn-reject" onclick="rejectVerification('${doc.id}','${d.userId}')">Từ chối</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state">Lỗi tải dữ liệu</div></td></tr>';
    console.error(e);
  }
}

async function viewVerificationLegacy(docId) {
  try {
    const doc = await db.collection('verifications').doc(docId).get();
    if (!doc.exists) { showToast('error', 'Lỗi', 'Yêu cầu không tồn tại'); return; }
    const d = doc.data();
    showModal(`
      <div class="modal-title">Chi tiết yêu cầu xác minh tài khoản</div>
      <div class="detail-row"><div class="detail-label">Họ tên</div><div class="detail-value">${escapeHtml(d.fullName||'N/A')}</div></div>
      <div class="detail-row"><div class="detail-label">Số CCCD</div><div class="detail-value">${escapeHtml(d.cccdNumber||'N/A')}</div></div>
      <div class="detail-row"><div class="detail-label">SĐT</div><div class="detail-value">${escapeHtml(d.phone || d.phoneNumber || 'N/A')}</div></div>
      <div class="detail-row"><div class="detail-label">Địa chỉ</div><div class="detail-value">${escapeHtml(d.address||'N/A')}</div></div>
      <div class="detail-row"><div class="detail-label">CCCD mặt trước</div><div class="detail-value">${d.cccdFrontUrl?`<img src="${safeUrl(d.cccdFrontUrl)}" class="cccd-img" onclick="showFullscreenImage('${safeForJsGlobal(safeUrl(d.cccdFrontUrl))}')">`:'Chưa có'}</div></div>
      <div class="detail-row"><div class="detail-label">CCCD mặt sau</div><div class="detail-value">${d.cccdBackUrl?`<img src="${safeUrl(d.cccdBackUrl)}" class="cccd-img" onclick="showFullscreenImage('${safeForJsGlobal(safeUrl(d.cccdBackUrl))}')">`:'Chưa có'}</div></div>
      <div class="modal-actions">
        <button class="btn btn-view" onclick="closeModal()">Đóng</button>
        <button class="btn btn-approve" onclick="approveVerification('${docId}','${d.userId}');closeModal()">Cấp quyền đăng bài</button>
        <button class="btn btn-reject" onclick="rejectVerification('${docId}','${d.userId}');closeModal()">Từ chối</button>
      </div>`);
  } catch (e) { showToast('error', 'Lỗi', e.message); }
}

// ════════════════════════════════════════
// PAGINATION STATE
// ════════════════════════════════════════
const PAGE_SIZE = 20;
const state = {
  posts: { docs: [], page: 1, sort: 'newest' },
  users: { docs: [], page: 1, sort: 'newest' },
  appt:  { docs: [], page: 1, sort: 'newest' },
  support: { docs: [], page: 1, sort: 'newest' },
  featured: { docs: [], page: 1, sort: 'newest' },
  payments: { docs: [], page: 1, sort: 'newest' },
  reviews: { docs: [], page: 1, sort: 'newest' },
};

function sortDocs(docs, sort) {
  const c = [...docs];
  if (sort === 'newest')      return c.sort((a,b) => (b.data().createdAt||0)-(a.data().createdAt||0));
  if (sort === 'oldest')      return c.sort((a,b) => (a.data().createdAt||0)-(b.data().createdAt||0));
  if (sort === 'price_asc')  return c.sort((a,b) => (a.data().price||0)-(b.data().price||0));
  if (sort === 'price_desc') return c.sort((a,b) => (b.data().price||0)-(a.data().price||0));
  if (sort === 'name_asc')   return c.sort((a,b) => (a.data().fullName||'').localeCompare(b.data().fullName||''));
  if (sort === 'name_desc')  return c.sort((a,b) => (b.data().fullName||'').localeCompare(a.data().fullName||''));
  return c;
}

function renderPagination(containerId, key, total) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  if (totalPages <= 1) { el.innerHTML = ''; return; }
  const cur = state[key].page;
  let html = '';
  if (cur > 1) html += `<button class="page-btn" onclick="goPage('${key}',${cur-1})">← Trước</button>`;
  for (let i = Math.max(1,cur-2); i <= Math.min(totalPages,cur+2); i++) {
    html += `<button class="page-btn ${i===cur?'active':''}" onclick="goPage('${key}',${i})">${i}</button>`;
  }
  if (cur < totalPages) html += `<button class="page-btn" onclick="goPage('${key}',${cur+1})">Sau →</button>`;
  el.innerHTML = html;
}

function renderResultInfo(containerId, page, total) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (total === 0) { el.textContent = ''; return; }
  const from = Math.min((page-1)*PAGE_SIZE+1, total);
  const to   = Math.min(page*PAGE_SIZE, total);
  el.textContent = `Hiển thị ${from}–${to} trong tổng ${total} kết quả`;
}

function goPage(key, page) {
  state[key].page = page;
  if (key === 'posts') renderPosts();
  if (key === 'users') renderUsers();
  if (key === 'appt')  renderAppt();
  if (key === 'support') renderSupportTickets();
  if (key === 'featured') renderFeaturedRequests();
  if (key === 'payments') renderPayments();
  if (key === 'reviews') renderReviews();
}

// ════════════════════════════════════════
// POSTS
// ════════════════════════════════════════
async function loadPosts(filter) {
  const tbody = document.getElementById('postsTableBody');
  tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state">Đang tải...</div></td></tr>';
  try {
    let q = db.collection('rooms');
    if (filter !== 'all') q = q.where('status', '==', filter);
    q = q.orderBy('createdAt', 'desc');
    const snap = await q.get();
    state.posts.docs = sortDocs(snap.docs, state.posts.sort);
    state.posts.page = 1;
    populatePostLocationFilterOptions();
    renderPosts();
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state">Lỗi tải dữ liệu</div></td></tr>';
    console.error(e);
  }
}

function getFilteredPostsDocs() {
  let all = state.posts.docs;
  if (postsSearchKeyword) {
    const kw = postsSearchKeyword;
    all = all.filter(doc => {
      const d = doc.data();
      const haystack = normalizeVietnameseText([
        d.title || '',
        d.ownerName || '',
        d.address || '',
        d.ward || '',
        d.district || '',
      ].join(' '));
      return haystack.includes(kw);
    });
  }
  if (postsLocationFilter) {
    const locationNeedle = normalizeVietnameseText(postsLocationFilter);
    all = all.filter(doc => {
      const d = doc.data();
      const locationHaystack = normalizeVietnameseText([
        d.district || '',
        d.ward || '',
        d.address || ''
      ].join(' '));
      return locationHaystack.includes(locationNeedle);
    });
  }
  return all.filter(doc => isInDateRange(doc.data().createdAt, dateFilterState.posts));
}

function updatePostsSelectAllState(pageDocs) {
  const selectAll = document.getElementById('postsSelectAll');
  if (!selectAll) return;
  if (!pageDocs || pageDocs.length === 0) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    return;
  }
  const selectedCount = pageDocs.filter(doc => selectedPostIds.has(doc.id)).length;
  selectAll.checked = selectedCount === pageDocs.length;
  selectAll.indeterminate = selectedCount > 0 && selectedCount < pageDocs.length;
}

function renderPosts() {
  const tbody = document.getElementById('postsTableBody');
  const all = getFilteredPostsDocs();
  const total = all.length;
  updateSupportSelectAllState(page);
  updateReviewsSelectAllState(page);
  updatePaymentsSelectAllState(page);
  if (total === 0) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><i class="fas fa-file-alt"></i>Không có bài đăng nào</div></td></tr>';
    renderResultInfo('postsResultInfo', 1, 0);
    document.getElementById('postsPagination').innerHTML = '';
    updatePostsSelectAllState([]);
    return;
  }
  renderResultInfo('postsResultInfo', state.posts.page, total);
  renderPagination('postsPagination', 'posts', total);
  const page = all.slice((state.posts.page-1)*PAGE_SIZE, state.posts.page*PAGE_SIZE);
  tbody.innerHTML = page.map(doc => {
    const d  = doc.data();
    const s  = (d.status || 'pending').toLowerCase();

    let bc = 'badge-pending';
    let bt = 'Chờ duyệt';

    if (s === 'approved') {
        bc = 'badge-approved';
        bt = 'Đã duyệt';
    } else if (s === 'rented') {
        bc = 'badge-landlord';
        bt = 'Đã cho thuê';
    } else if (s === 'rejected') {
        bc = 'badge-rejected';
        bt = 'Từ chối';
    } else if (s === 'expired') {
        bc = 'badge-rejected';
        bt = 'Hết hạn';
    }

    const safeTitle = (d.title||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    return `<tr data-created-at="${toEpochMs(d.createdAt)}">
      <td style="text-align:center">
        <input type="checkbox" ${selectedPostIds.has(doc.id) ? 'checked' : ''} onchange="togglePostSelection('${doc.id}', this.checked)">
      </td>
      <td>
        <div class="td-user">
          <div class="td-avatar" style="border-radius:10px;background:#f1f5f9"><i class="fas fa-home" style="color:#94a3b8"></i></div>
          <div><div class="td-name" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.title||'Chưa có tiêu đề'}</div>
          <div class="td-email">${d.ownerName||''}</div></div>
        </div>
      </td>
      <td><div style="font-size:12px;color:#64748b;font-weight:600;max-width:160px">${d.ward||''}, ${d.district||''}</div></td>
      <td>
        <div style="font-size:13px;font-weight:800;color:#0f172a">${fmt(d.price||0)} đ</div>
        <div style="font-size:11px;color:#94a3b8;font-weight:600">${d.area||0} m²</div>
      </td>
      <td>
        <span style="font-size:12px;color:#94a3b8;font-weight:600">${fmtDate(d.createdAt)}</span>
        ${s === 'rented' ? `<div style="font-size:10px;color:#6366f1;font-weight:700;margin-top:2px">Thuê lúc: ${fmtDate(d.rentedAt)}</div>` : ''}
      </td>
      <td><span class="badge ${bc}">${bt}</span></td>
      <td style="text-align:right">
        <div class="list-actions">
          <button class="btn btn-view" onclick="viewPost('${doc.id}')">Xem</button>
          ${s === 'pending' ? `
            <button class="btn btn-approve" onclick="approvePost('${doc.id}','${d.userId}','${safeTitle}')">Duyệt</button>
            <button class="btn btn-reject"  onclick="rejectPost('${doc.id}','${d.userId}','${safeTitle}')">Từ chối</button>
          ` : ''}
          ${(s === 'rented' || s === 'rejected' || s === 'expired') ? `
            <button class="btn btn-delete" onclick="deletePost('${doc.id}')"><i class="fas fa-trash"></i></button>
          ` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
  updatePostsSelectAllState(page);
}

async function loadFeaturedRequests(filter) {
  const tbody = document.getElementById('featuredTableBody');
  tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state">Đang tải...</div></td></tr>';
  try {
    let q = db.collection('featured_upgrade_requests');
    const snap = await q.get();
    let docs = snap.docs;
    if (filter === 'paid_waiting_admin') {
      docs = docs.filter(doc => ['paid', 'paid_waiting_admin'].includes(doc.data().status));
    } else if (filter !== 'all') {
      docs = docs.filter(doc => doc.data().status === filter);
    }
    state.featured.docs = docs.sort((a, b) => toEpochMs(b.data().createdAt) - toEpochMs(a.data().createdAt));
    state.featured.page = 1;
    renderFeaturedRequests();
  } catch (e) {
    console.error(e);
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state">Lỗi tải yêu cầu nổi bật</div></td></tr>';
  }
}

let featuredSearchKw = '';
function filterFeaturedSearch() {
  featuredSearchKw = document.getElementById('searchFeatured')?.value || '';
  state.featured.page = 1;
  renderFeaturedRequests();
}
function getFilteredFeaturedDocs() {
  const kw = normalizeVietnameseText(featuredSearchKw);
  if (!kw) return state.featured.docs;
  return state.featured.docs.filter(doc => {
    const d = doc.data();
    return normalizeVietnameseText(d.roomTitle).includes(kw)
        || normalizeVietnameseText(d.roomId).includes(kw)
        || normalizeVietnameseText(d.uid).includes(kw);
  });
}

function renderFeaturedRequests() {
  const tbody = document.getElementById('featuredTableBody');
  const all = getFilteredFeaturedDocs();
  if (!all.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state">Không có yêu cầu nổi bật</div></td></tr>';
    renderResultInfo('featuredResultInfo', 1, 0);
    document.getElementById('featuredPagination').innerHTML = '';
    return;
  }
  renderResultInfo('featuredResultInfo', state.featured.page, all.length);
  renderPagination('featuredPagination', 'featured', all.length);
  const page = all.slice((state.featured.page-1)*PAGE_SIZE, state.featured.page*PAGE_SIZE);
  tbody.innerHTML = page.map(doc => {
    const d = doc.data();
    const safeTitle = String(d.roomTitle || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    const status = d.status || 'waiting_for_payment';
    return `<tr>
      <td><div class="td-name">${escapeHtml(d.roomTitle || d.roomId || 'Bài đăng')}</div><div class="td-email">${escapeHtml(d.roomId || '')}</div></td>
      <td><b>${escapeHtml(d.label || d.code || '')}</b><div class="td-email">${d.days || 0} ngày</div></td>
      <td><b>${fmt(d.amount || 0)} đ</b><div class="td-email">${escapeHtml(d.transferNote || '')}</div></td>
      <td><span class="badge ${paymentStatusBadge(status, 'featured')}">${paymentStatusText(status, 'featured')}</span></td>
      <td style="text-align:right"><div class="list-actions">
        ${['paid', 'paid_waiting_admin'].includes(status) ? `
          <button class="btn btn-approve" onclick="approveFeaturedRequest('${doc.id}','${d.uid}','${d.roomId}','${safeTitle}')">Duyệt</button>
          <button class="btn btn-reject" onclick="rejectFeaturedRequest('${doc.id}','${d.uid}','${d.roomId}','${safeTitle}')">Từ chối</button>
        ` : ''}
        <button class="btn btn-view" onclick="viewPost('${d.roomId}')">Xem bài</button>
        <button class="btn btn-delete" onclick="deleteFeaturedRequest('${doc.id}','${d.roomId}','${status}')"><i class="fas fa-trash"></i></button>
      </div></td>
    </tr>`;
  }).join('');
}

async function deleteFeaturedRequest(reqId, roomId, status) {
  const ok = await showConfirm('Xóa yêu cầu', 'Xóa yêu cầu nổi bật này?', 'danger');
  if (!ok) return;
  try {
    await db.collection('featured_upgrade_requests').doc(reqId).delete();
    if (status === 'approved' && roomId) {
      await db.collection('rooms').doc(roomId).set({ isFeatured: false, featuredUntil: null }, { merge: true });
    }
    showToast('success', 'Đã xóa', 'Yêu cầu nổi bật đã bị xóa');
    loadFeaturedRequests(getActiveTab('featuredTabGroup'));
  } catch (e) { showToast('error', 'Lỗi', e.message); }
}

async function deleteSelectedFeatured() {
  const ids = Array.from(selectedFeaturedIds);
  const docs = state.featured.docs.filter(d => ids.includes(d.id));
  if (!docs.length) { showToast('warning', 'Không có dữ liệu', 'Không có yêu cầu nào để xóa.'); return; }
  const ok = await showConfirm('Xóa tất cả', `Bạn sắp xóa ${docs.length} yêu cầu nổi bật. Hành động này không thể hoàn tác.`, 'danger');
  if (!ok) return;
  showToast('info', 'Đang xử lý', `Đang xóa ${docs.length} yêu cầu...`, 3000);
  let failed = 0;
  for (const doc of docs) {
    try {
      const d = doc.data();
      await db.collection('featured_upgrade_requests').doc(doc.id).delete();
      if (d.status === 'approved' && d.roomId) {
        await db.collection('rooms').doc(d.roomId).set({ isFeatured: false, featuredUntil: null }, { merge: true });
      }
    } catch (e) { failed++; }
  }
  if (failed === 0) showToast('success', 'Thành công', `Đã xóa ${docs.length} yêu cầu.`);
  else showToast('warning', 'Một phần', `Xóa ${docs.length - failed}/${docs.length}. ${failed} lỗi.`);
  loadFeaturedRequests(getActiveTab('featuredTabGroup'));
}

async function approveFeaturedRequest(requestId, uid, roomId, title) {
  const ok = await showConfirm('Duyệt nổi bật', 'Xác nhận đưa bài này lên mục Phòng nổi bật?', 'success');
  if (!ok) return;
  try {
    const reqRef = db.collection('featured_upgrade_requests').doc(requestId);
    let freshRequest = null;
    await db.runTransaction(async tx => {
      const freshSnap = await tx.get(reqRef);
      if (!freshSnap.exists) throw new Error('Yêu cầu nổi bật không tồn tại.');
      const req = freshSnap.data() || {};
      if (req.status !== 'paid_waiting_admin') {
        throw new Error('Yêu cầu này không còn ở trạng thái chờ duyệt.');
      }
      const now = Date.now();
      const days = Number(req.days || 0);
      const targetRoomId = String(req.roomId || roomId || '');
      const featuredUntil = now + Math.max(days, 1) * 24 * 60 * 60 * 1000;
      freshRequest = { ...req, featuredUntil, featuredStartAt: now, roomId: targetRoomId };
      tx.set(reqRef, {
        status: 'approved',
        approvalStatus: 'approved',
        approvedAt: now,
        updatedAt: now,
        featuredStartAt: now,
        featuredUntil
      }, { merge: true });
      tx.set(db.collection('rooms').doc(targetRoomId), {
        isFeatured: true,
        featuredStartAt: now,
        featuredUntil,
        featuredPackageCode: req.code || '',
        featuredPaymentId: requestId,
        featuredRequestId: requestId,
        featuredRequestStatus: 'approved',
        featuredRequestUpdatedAt: now
      }, { merge: true });
    });
    await sendNotification(freshRequest?.uid || uid, 'Bài đăng đã lên nổi bật', `Bài đăng "${title || freshRequest?.roomTitle || 'của bạn'}" đã được admin duyệt nổi bật.`, 'featured_approved');
    showToast('success', 'Thành công', 'Đã duyệt bài nổi bật');
    loadFeaturedRequests(getActiveTab('featuredTabGroup'));
  } catch (e) { showToast('error', 'Lỗi', e.message); }
}

async function rejectFeaturedRequest(requestId, uid, roomId, title) {
  const reason = await showPrompt('Từ chối nổi bật', 'Nhập lý do từ chối:', 'Lý do...');
  if (reason === null) return;
  if (!reason || reason.length < 5) { showToast('warning', 'Cảnh báo', 'Lý do phải ít nhất 5 ký tự'); return; }
  try {
    const reqRef = db.collection('featured_upgrade_requests').doc(requestId);
    let freshRequest = null;
    await db.runTransaction(async tx => {
      const freshSnap = await tx.get(reqRef);
      if (!freshSnap.exists) throw new Error('Yêu cầu nổi bật không tồn tại.');
      const req = freshSnap.data() || {};
      if (req.status !== 'paid_waiting_admin') {
        throw new Error('Yêu cầu này không còn ở trạng thái chờ duyệt.');
      }
      const now = Date.now();
      const targetRoomId = String(req.roomId || roomId || '');
      freshRequest = { ...req, roomId: targetRoomId };
      tx.set(reqRef, {
        status: 'rejected',
        approvalStatus: 'rejected',
        rejectReason: reason,
        rejectedAt: now,
        updatedAt: now
      }, { merge: true });
      tx.set(db.collection('rooms').doc(targetRoomId), {
        featuredRequestStatus: 'rejected',
        featuredRequestId: requestId,
        featuredRequestUpdatedAt: now
      }, { merge: true });
    });
    await sendNotification(freshRequest?.uid || uid, 'Yêu cầu nổi bật bị từ chối', `Bài "${title || freshRequest?.roomTitle || 'của bạn'}" bị từ chối nổi bật. Lý do: ${reason}`, 'featured_rejected');
    showToast('warning', 'Đã từ chối', 'Yêu cầu nổi bật đã bị từ chối');
    loadFeaturedRequests(getActiveTab('featuredTabGroup'));
  } catch (e) { showToast('error', 'Lỗi', e.message); }
}

async function loadPayments(filter) {
  const tbody = document.getElementById('paymentsTableBody');
  tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state">Đang tải...</div></td></tr>';
  try {
    const tasks = [];
    if (filter === 'all' || filter === 'slot') tasks.push(db.collection('slot_upgrade_requests').orderBy('createdAt', 'desc').limit(200).get());
    if (filter === 'all' || filter === 'featured') tasks.push(db.collection('featured_upgrade_requests').orderBy('createdAt', 'desc').limit(200).get());
    const snaps = await Promise.all(tasks);
    const docs = [];
    snaps.forEach(snap => snap.docs.forEach(doc => docs.push({ id: doc.id, type: doc.ref.parent.id === 'featured_upgrade_requests' ? 'featured' : 'slot', data: doc.data() })));
    state.payments.docs = docs.sort((a,b) => (b.data.createdAt || 0) - (a.data.createdAt || 0));
    state.payments.page = 1;
    renderPayments();
  } catch (e) {
    console.error(e);
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state">Lỗi tải thanh toán</div></td></tr>';
  }
}

let paymentsSearchKw = '';
function filterPaymentsSearch() {
  paymentsSearchKw = document.getElementById('searchPayments')?.value || '';
  state.payments.page = 1;
  renderPayments();
}
function getFilteredPaymentsDocs() {
  const kw = normalizeVietnameseText(paymentsSearchKw);
  if (!kw) return state.payments.docs;
  return state.payments.docs.filter(item => {
    const d = item.data;
    return normalizeVietnameseText(d.uid).includes(kw)
        || normalizeVietnameseText(d.transferNote).includes(kw)
        || normalizeVietnameseText(d.label).includes(kw)
        || normalizeVietnameseText(d.roomTitle).includes(kw);
  });
}

function renderPayments() {
  const tbody = document.getElementById('paymentsTableBody');
  const all = getFilteredPaymentsDocs();
  if (!all.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state">Không có giao dịch</div></td></tr>';
    renderResultInfo('paymentsResultInfo', 1, 0);
    document.getElementById('paymentsPagination').innerHTML = '';
    return;
  }
  renderResultInfo('paymentsResultInfo', state.payments.page, all.length);
  renderPagination('paymentsPagination', 'payments', all.length);
  const page = all.slice((state.payments.page-1)*PAGE_SIZE, state.payments.page*PAGE_SIZE);
  tbody.innerHTML = page.map(item => {
    const docId = item.docId;
    const d = item.data;
    const status = d.status || 'waiting_for_payment';
    const canDelete = ['cancelled','expired','failed','waiting_for_payment'].includes(status);
    return `<tr>
      <td><div class="td-name">${item.type === 'featured' ? 'Đẩy nổi bật' : 'Mua lượt đăng'}</div><div class="td-email">${escapeHtml(d.label || d.code || '')}</div></td>
      <td><div class="td-email">${escapeHtml(d.uid || '')}</div>${d.roomTitle ? `<div class="td-email">${escapeHtml(d.roomTitle)}</div>` : ''}</td>
      <td><b>${fmt(d.amount || 0)} đ</b><div class="td-email">${escapeHtml(d.transferNote || '')}</div></td>
      <td>${fmtDateTime(d.paidAt || d.createdAt)}</td>
      <td><span class="badge ${paymentStatusBadge(status, item.type)}">${paymentStatusText(status, item.type)}</span></td>
      <td style="text-align:right">${canDelete ? `<button class="btn btn-delete" onclick="deletePaymentRecord('${item.id}','${item.type}')"><i class="fas fa-trash"></i></button>` : ''}</td>
    </tr>`;
  }).join('');
}

async function deletePaymentRecord(id, type) {
  const col = type === 'featured' ? 'featured_upgrade_requests' : 'slot_upgrade_requests';
  const ok = await showConfirm('Xóa giao dịch', 'Xóa bản ghi giao dịch này?', 'danger');
  if (!ok) return;
  try {
    await db.collection(col).doc(id).delete();
    showToast('success', 'Đã xóa', 'Giao dịch đã bị xóa');
    loadPayments(getActiveTab('paymentsTabGroup'));
  } catch (e) { showToast('error', 'Lỗi', e.message); }
}

let reviewsSearchKw = '';
let reviewsStarFilter = '';
function filterReviewsSearch() {
  reviewsSearchKw = document.getElementById('searchReviews')?.value || '';
  state.reviews.page = 1;
  renderReviews();
}
function filterReviewsByStars() {
  reviewsStarFilter = document.getElementById('filterReviewStars')?.value || '';
  state.reviews.page = 1;
  renderReviews();
}
function getFilteredReviewsDocs() {
  let docs = state.reviews.docs;
  if (reviewsStarFilter) docs = docs.filter(doc => String(doc.data().rating || '') === reviewsStarFilter);
  const kw = normalizeVietnameseText(reviewsSearchKw);
  if (!kw) return docs;
  return docs.filter(doc => {
    const d = doc.data();
    return normalizeVietnameseText(d.comment).includes(kw)
        || normalizeVietnameseText(d.userName).includes(kw)
        || normalizeVietnameseText(d.roomTitle).includes(kw);
  });
}

function renderReviews() {
  const tbody = document.getElementById('reviewsTableBody');
  const all = getFilteredReviewsDocs();
  if (!all.length) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state">Không có đánh giá</div></td></tr>';
    renderResultInfo('reviewsResultInfo', 1, 0);
    document.getElementById('reviewsPagination').innerHTML = '';
    return;
  }
  renderResultInfo('reviewsResultInfo', state.reviews.page, all.length);
  renderPagination('reviewsPagination', 'reviews', all.length);
  const page = all.slice((state.reviews.page-1)*PAGE_SIZE, state.reviews.page*PAGE_SIZE);
  tbody.innerHTML = page.map(doc => {
    const d = doc.data();
    const status = d.status || 'approved';
    return `<tr>
      <td><div class="td-name">${'★'.repeat(Number(d.rating || 0))}</div><div class="td-email" style="max-width:360px">${escapeHtml(d.comment || '')}</div><span class="badge ${status === 'approved' ? 'badge-approved' : 'badge-rejected'}">${status === 'approved' ? 'Đang hiển thị' : 'Đã ẩn'}</span></td>
      <td><div class="td-name">${escapeHtml(d.roomTitle || d.roomId || '')}</div><div class="td-email">Chủ trọ: ${escapeHtml(d.landlordId || '')}</div></td>
      <td><div class="td-name">${escapeHtml(d.userName || 'Người dùng')}</div><div class="td-email">${escapeHtml(d.userId || '')}</div></td>
      <td>${fmtDateTime(d.createdAt)}</td>
      <td style="text-align:right"><div class="list-actions">
        <button class="btn btn-view" onclick="viewReview('${doc.id}')">Xem</button>
        ${status === 'approved' ? `<button class="btn btn-reject" onclick="hideReview('${doc.id}')">Ẩn</button>` : `<button class="btn btn-approve" onclick="showReview('${doc.id}')">Để lại</button>`}
        <button class="btn btn-delete" onclick="deleteReview('${doc.id}')"><i class="fas fa-trash"></i></button>
      </div></td>
    </tr>`;
  }).join('');
}

async function deleteSelectedReviews() {
  const ids = Array.from(selectedReviewsIds);
  const docs = state.reviews.docs.filter(d => ids.includes(d.id));
  if (!docs.length) { showToast('warning', 'Không có dữ liệu', 'Không có đánh giá nào để xóa.'); return; }
  const ok = await showConfirm('Xóa tất cả', `Xóa ${docs.length} đánh giá?`, 'danger');
  if (!ok) return;
  let failed = 0;
  for (const doc of docs) {
    try { await db.collection('reviews').doc(doc.id).delete(); } catch (e) { failed++; }
  }
  if (failed === 0) showToast('success', 'Thành công', `Đã xóa ${docs.length} đánh giá.`);
  else showToast('warning', 'Một phần', `Xóa ${docs.length - failed}/${docs.length}. ${failed} lỗi.`);
  loadReviews(getActiveTab('reviewsTabGroup'));
}

async function deleteSelectedPayments() {
  const ids = Array.from(selectedPaymentsIds);
  const items = state.payments.docs.filter(item => ids.includes(item.docId)).filter(item => ['cancelled','expired','failed','waiting_for_payment'].includes(item.data.status || ''));
  if (!items.length) { showToast('warning', 'Không thể xóa', 'Chỉ có thể xóa các giao dịch hết hạn, đã hủy hoặc chờ thanh toán.'); return; }
  const ok = await showConfirm('Xóa tất cả', `Xóa ${items.length} giao dịch?`, 'danger');
  if (!ok) return;
  let failed = 0;
  for (const item of items) {
    try {
      const col = item.type === 'featured' ? 'featured_upgrade_requests' : 'slot_upgrade_requests';
      await db.collection(col).doc(item.id).delete();
    } catch (e) { failed++; }
  }
  if (failed === 0) showToast('success', 'Thành công', `Đã xóa ${items.length} giao dịch.`);
  else showToast('warning', 'Một phần', `Xóa ${items.length - failed}/${items.length}. ${failed} lỗi.`);
  loadPayments(getActiveTab('paymentsTabGroup'));
}

async function loadReviews(filter) {
  const tbody = document.getElementById('reviewsTableBody');
  tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state">Đang tải...</div></td></tr>';
  try {
    let q = db.collection('reviews');
    if (filter !== 'all') q = q.where('status', '==', filter);
    q = q.orderBy('createdAt', 'desc');
    const snap = await q.get();
    state.reviews.docs = snap.docs;
    state.reviews.page = 1;
    renderReviews();
  } catch (e) {
    console.error(e);
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state">Lỗi tải đánh giá</div></td></tr>';
  }
}

function renderReviews() {
  const tbody = document.getElementById('reviewsTableBody');
  const all = state.reviews.docs;
  if (!all.length) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state">Không có đánh giá</div></td></tr>';
    renderResultInfo('reviewsResultInfo', 1, 0);
    document.getElementById('reviewsPagination').innerHTML = '';
    return;
  }
  renderResultInfo('reviewsResultInfo', state.reviews.page, all.length);
  renderPagination('reviewsPagination', 'reviews', all.length);
  const page = all.slice((state.reviews.page-1)*PAGE_SIZE, state.reviews.page*PAGE_SIZE);
  tbody.innerHTML = page.map(doc => {
    const d = doc.data();
    const status = d.status || 'approved';
    return `<tr>
      <td><div class="td-name">${'★'.repeat(Number(d.rating || 0))}</div><div class="td-email" style="max-width:360px">${escapeHtml(d.comment || '')}</div><span class="badge ${status === 'approved' ? 'badge-approved' : 'badge-rejected'}">${status === 'approved' ? 'Đang hiển thị' : 'Đã ẩn'}</span></td>
      <td><div class="td-name">${escapeHtml(d.roomTitle || d.roomId || '')}</div><div class="td-email">Chủ trọ: ${escapeHtml(d.landlordId || '')}</div></td>
      <td><div class="td-name">${escapeHtml(d.userName || 'Người dùng')}</div><div class="td-email">${escapeHtml(d.userId || '')}</div></td>
      <td>${fmtDateTime(d.createdAt)}</td>
      <td style="text-align:right"><div class="list-actions">
        <button class="btn btn-view" onclick="viewReview('${doc.id}')">Xem</button>
        ${status === 'approved' ? `<button class="btn btn-reject" onclick="hideReview('${doc.id}')">Ẩn</button>` : `<button class="btn btn-approve" onclick="showReview('${doc.id}')">Hiện lại</button>`}
        <button class="btn btn-delete" onclick="deleteReview('${doc.id}')"><i class="fas fa-trash"></i></button>
      </div></td>
    </tr>`;
  }).join('');
}

async function viewReview(id) {
  try {
    const snap = await db.collection('reviews').doc(id).get();
    if (!snap.exists) { showToast('error', 'Lỗi', 'Đánh giá không tồn tại'); return; }
    const d = snap.data() || {};
    const status = d.status || 'approved';
    showModal(`
      <div class="modal-title">Chi tiết đánh giá</div>
      <div class="detail-row"><div class="detail-label">Điểm</div><div class="detail-value">${'★'.repeat(Number(d.rating || 0))}</div></div>
      <div class="detail-row"><div class="detail-label">Nội dung</div><div class="detail-value">${escapeHtml(d.comment || '')}</div></div>
      <div class="detail-row"><div class="detail-label">Phòng</div><div class="detail-value">${escapeHtml(d.roomTitle || d.roomId || 'N/A')}</div></div>
      <div class="detail-row"><div class="detail-label">Người đánh giá</div><div class="detail-value">${escapeHtml(d.userName || 'Người dùng')}<br><span class="td-email">${escapeHtml(d.userId || '')}</span></div></div>
      <div class="detail-row"><div class="detail-label">Chủ trọ</div><div class="detail-value">${escapeHtml(d.landlordId || '')}</div></div>
      <div class="detail-row"><div class="detail-label">Trạng thái</div><div class="detail-value"><span class="badge ${status === 'approved' ? 'badge-approved' : 'badge-rejected'}">${status === 'approved' ? 'Đang hiển thị' : 'Đã ẩn'}</span></div></div>
      <div class="detail-row"><div class="detail-label">Ngày tạo</div><div class="detail-value">${fmtDateTime(d.createdAt)}</div></div>
      <div class="modal-actions">
        <button class="btn btn-view" onclick="closeModal()">Đóng</button>
        ${status === 'approved' ? `<button class="btn btn-reject" onclick="hideReview('${id}');closeModal()">Ẩn đánh giá</button>` : `<button class="btn btn-approve" onclick="showReview('${id}');closeModal()">Hiện lại</button>`}
        <button class="btn btn-delete" onclick="deleteReview('${id}');closeModal()">Xóa</button>
      </div>
    `);
  } catch (e) {
    showToast('error', 'Lỗi', e.message);
  }
}

async function hideReview(id) {
  try {
    await db.collection('reviews').doc(id).set({ status: 'hidden', updatedAt: Date.now() }, { merge: true });
    showToast('success', 'Đã ẩn', 'Đánh giá đã được ẩn');
    loadReviews(getActiveTab('reviewsTabGroup'));
  } catch (e) { showToast('error', 'Lỗi', e.message); }
}

async function showReview(id) {
  try {
    await db.collection('reviews').doc(id).set({ status: 'approved', updatedAt: Date.now() }, { merge: true });
    showToast('success', 'Đã hiện lại', 'Đánh giá đã được hiển thị');
    loadReviews(getActiveTab('reviewsTabGroup'));
  } catch (e) { showToast('error', 'Lỗi', e.message); }
}

async function deleteReview(id) {
  const ok = await showConfirm('Xóa đánh giá', 'Bạn có chắc chắn muốn xóa đánh giá này?', 'danger');
  if (!ok) return;
  try {
    await db.collection('reviews').doc(id).delete();
    showToast('success', 'Đã xóa', 'Đánh giá đã bị xóa');
    loadReviews(getActiveTab('reviewsTabGroup'));
  } catch (e) { showToast('error', 'Lỗi', e.message); }
}

let postsSearchKeyword = '';
let postsLocationFilter = '';
const selectedPostIds = new Set();
function normalizeVietnameseText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd')
    .replace(/\u0110/g, 'D')
    .toLowerCase()
    .trim();
}

function getPostLocationLabel(data) {
  const district = (data?.district || '').trim();
  if (district) return district;
  const ward = (data?.ward || '').trim();
  if (ward) return ward;
  const address = (data?.address || '').trim();
  return address || '';
}

function populatePostLocationFilterOptions() {
  const select = document.getElementById('filterPostLocation');
  if (!select) return;

  const current = postsLocationFilter || '';
  const locations = Array.from(new Set(
    state.posts.docs
      .map(doc => getPostLocationLabel(doc.data()))
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b, 'vi'));

  select.innerHTML = [
    '<option value="">Tất cả khu vực</option>',
    ...locations.map(loc => `<option value="${escapeHtml(loc)}">${escapeHtml(loc)}</option>`)
  ].join('');

  if (current && locations.includes(current)) {
    select.value = current;
  } else {
    postsLocationFilter = '';
    select.value = '';
  }
}

function filterPostsByLocation() {
  const select = document.getElementById('filterPostLocation');
  postsLocationFilter = select?.value || '';
  state.posts.page = 1;
  renderPosts();
}

function togglePostSelection(postId, checked) {
  if (checked) selectedPostIds.add(postId);
  else selectedPostIds.delete(postId);
  updatePostsSelectAllState(
    getFilteredPostsDocs().slice((state.posts.page-1)*PAGE_SIZE, state.posts.page*PAGE_SIZE)
  );
}

function toggleSelectAllPosts(checked) {
  const pageDocs = getFilteredPostsDocs().slice((state.posts.page-1)*PAGE_SIZE, state.posts.page*PAGE_SIZE);
  pageDocs.forEach(doc => {
    if (checked) selectedPostIds.add(doc.id);
    else selectedPostIds.delete(doc.id);
  });
  renderPosts();
}

async function deletePostRecordCompletely(docId) {
  const doc = await db.collection('rooms').doc(docId).get();
  if (doc.exists) {
    const d = doc.data();
    if (Array.isArray(d.imageUrls) && d.imageUrls.length > 0) {
      const delImgs = d.imageUrls.map(async url => {
        try { return storage.refFromURL(url).delete(); } catch (_) { return Promise.resolve(); }
      });
      await Promise.all(delImgs);
    }
  }
  await db.collection('rooms').doc(docId).delete();
  selectedPostIds.delete(docId);
}

async function deleteSelectedPosts() {
  const ids = Array.from(selectedPostIds);
  if (ids.length === 0) {
    showToast('warning', 'Chưa chọn bài đăng', 'Hãy tick chọn ít nhất 1 bài để xóa.');
    return;
  }
  const ok = await showConfirm('Xóa bài đã chọn', `Bạn sắp xóa ${ids.length} bài đăng. Hành động này không thể hoàn tác.`, 'danger');
  if (!ok) return;

  showToast('info', 'Đang xử lý', `Đang tiến hành xóa ${ids.length} bài đăng...`, 3500);
  let failed = 0;
  for (const id of ids) {
    try {
      await deletePostRecordCompletely(id);
    } catch (e) {
      failed++;
      console.warn(`Không thể xóa bài ${id}:`, e);
    }
  }

  const deleted = ids.length - failed;
  if (failed === 0) {
    showToast('success', 'Thành công', `Đã xóa ${deleted} bài đăng.`);
  } else {
    showToast('warning', 'Hoàn tất một phần', `Đã xóa ${deleted}/${ids.length} bài. ${failed} bài lỗi, kiểm tra console log.`);
  }
  loadPosts(getActiveTab('postsTabGroup'));
}

async function viewPost(docId) {
  try {
    const doc = await db.collection('rooms').doc(docId).get();
    if (!doc.exists) { showToast('error', 'Lỗi', 'Bài đăng không tồn tại'); return; }
    const d = doc.data();
    const statusMap = {
      pending:  { label: 'Chờ duyệt', cls: 'badge-pending' },
      approved: { label: 'Đã duyệt', cls: 'badge-approved' },
      rented:   { label: 'Đã cho thuê', cls: 'badge-landlord' },
      rejected: { label: 'Từ chối', cls: 'badge-rejected' },
      expired:  { label: 'Hết hạn', cls: 'badge-rejected' },
    };
    const statusKey = String(d.status || 'pending').toLowerCase();
    const statusInfo = statusMap[statusKey] || { label: d.status || 'N/A', cls: 'badge-pending' };

    const safeForJs = value => String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const images = Array.isArray(d.imageUrls) ? d.imageUrls.filter(Boolean) : [];
    const mainImage = images[0] || '';
    const moreImages = images.slice(1, 13);
    const locationText = [d.address, d.ward, d.district].filter(Boolean).join(', ') || 'N/A';

    const amenities = [
      d.hasWifi ? 'Wifi' : '', d.hasAirCon ? 'Điều hòa' : '',
      d.hasWaterHeater ? 'Nóng lạnh' : '', d.hasWasher ? 'Máy giặt' : '',
      d.hasBed ? 'Giường' : '', d.hasMotorbike ? 'Để xe máy' : '',
    ].filter(Boolean).join(', ') || 'Không có';
    const safeTitle = (d.title||'').replace(/'/g,"\\'");
    showModal(`
      <div data-modal-size="post">
        <div class="post-modal-head">
          <div class="post-modal-title">${d.title || 'Chi tiết bài đăng'}</div>
          <span class="badge ${statusInfo.cls}" style="font-size:12px;padding:6px 12px;">${statusInfo.label}</span>
        </div>

        <div class="post-modal-grid">
          <div class="post-modal-card">
            <div class="post-meta-list">
              <div class="post-meta-item">
                <div class="post-meta-label">Chủ trọ</div>
                <div class="post-meta-value">${d.ownerName || 'N/A'} - ${d.ownerPhone || 'N/A'}</div>
              </div>
              <div class="post-meta-item">
                <div class="post-meta-label">Giá thuê</div>
                <div class="post-meta-value">${fmt(d.price || 0)} đ/tháng</div>
              </div>
              <div class="post-meta-item">
                <div class="post-meta-label">Diện tích</div>
                <div class="post-meta-value">${d.area || 0} m²</div>
              </div>
              <div class="post-meta-item">
                <div class="post-meta-label">Số người</div>
                <div class="post-meta-value">${d.peopleCount || 0}</div>
              </div>
              <div class="post-meta-item">
                <div class="post-meta-label">Loại phòng</div>
                <div class="post-meta-value">${d.roomType || 'N/A'}</div>
              </div>
              <div class="post-meta-item">
                <div class="post-meta-label">Ngày đăng</div>
                <div class="post-meta-value">${fmtDate(d.createdAt)}</div>
              </div>
            </div>

            <div class="post-desc-block" style="margin-bottom:10px;">
              <div class="post-meta-label">Địa chỉ</div>
              <div class="post-meta-value">${locationText}</div>
            </div>
            <div class="post-desc-block" style="margin-bottom:10px;">
              <div class="post-meta-label">Tiện ích</div>
              <div class="post-meta-value">${amenities}</div>
            </div>
            <div class="post-desc-block">
              <div class="post-meta-label">Mô tả</div>
              <div class="post-meta-value" style="font-weight:700;">${d.description || 'Không có'}</div>
            </div>
          </div>

          <div class="post-modal-card">
            ${mainImage
              ? `<img src="${mainImage}" alt="Ảnh chính" class="post-gallery-main" onclick="showFullscreenImage('${safeForJs(mainImage)}')">`
              : `<div class="empty-state" style="padding:28px 14px;"><i class="fas fa-image"></i>Chưa có ảnh cho bài đăng này</div>`
            }
            ${moreImages.length
              ? `<div class="post-gallery-thumbs">
                  ${moreImages.map(img => `<img src="${img}" alt="Ảnh phòng trọ" class="post-gallery-thumb" onclick="showFullscreenImage('${safeForJs(img)}')">`).join('')}
                 </div>`
              : ''
            }
          </div>
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn btn-view" onclick="closeModal()">Đóng</button>
        ${d.status === 'pending' ? `
          <button class="btn btn-approve" onclick="approvePost('${docId}','${d.userId}','${safeTitle}');closeModal()">Duyệt</button>
          <button class="btn btn-reject"  onclick="rejectPost('${docId}','${d.userId}','${safeTitle}');closeModal()">Từ chối</button>
        ` : ''}
        ${(d.status === 'rented' || d.status === 'rejected' || d.status === 'expired') ? `
          <button class="btn btn-delete" onclick="deletePost('${docId}');closeModal()"><i class="fas fa-trash"></i> Xóa bài</button>
        ` : ''}
      </div>`);
  } catch (e) { showToast('error', 'Lỗi', e.message); }
}

async function approvePost(docId, userId, title) {
  const ok = await showConfirm('Duyệt bài đăng', 'Xác nhận duyệt bài đăng phòng trọ này?', 'success');
  if (!ok) return;
  try {
    await db.collection('rooms').doc(docId).update({ status: 'approved', rejectReason: '' });
    await sendNotification(userId, 'Bài đăng đã được duyệt!', `Bài đăng "${title}" đã được admin duyệt và hiển thị trên ứng dụng.`, 'post_approved');
    showToast('success', 'Thành công', 'Bài đăng đã được duyệt!');
    loadPosts(getActiveTab('postsTabGroup'));
  } catch (e) { showToast('error', 'Lỗi', e.message); }
}

async function rejectPost(docId, userId, title) {
  const reason = await showPrompt('Từ chối bài đăng', 'Nhập lý do từ chối bài đăng:', 'Lý do từ chối...');
  if (reason === null) return;
  if (!reason || reason.length < 5) { showToast('warning', 'Cảnh báo', 'Lý do phải ít nhất 5 ký tự'); return; }
  try {
    await db.collection('rooms').doc(docId).update({ status: 'rejected', rejectReason: reason });
    await sendNotification(userId, 'Bài đăng bị từ chối', `Bài đăng "${title}" bị từ chối. Lý do: ${reason}`, 'post_rejected');
    showToast('warning', 'Đã từ chối', 'Bài đăng đã bị từ chối.');
    loadPosts(getActiveTab('postsTabGroup'));
  } catch (e) { showToast('error', 'Lỗi', e.message); }
}

function filterPostsSearch() {
  clearTimeout(postsSearchTimeout);
  postsSearchTimeout = setTimeout(() => {
    const kw = document.getElementById('searchPost').value;
    postsSearchKeyword = normalizeVietnameseText(kw);
    state.posts.page = 1;
    renderPosts();
  }, 300);
}

function changeSortPosts() {
  state.posts.sort = document.getElementById('sortPosts').value;
  state.posts.page = 1;
  state.posts.docs = sortDocs(state.posts.docs, state.posts.sort);
  renderPosts();
}

async function deletePost(docId) {
  const ok = await showConfirm('Xóa bài đăng', 'Bạn có chắc chắn muốn xóa bài đăng này? Hành động này không thể hoàn tác.', 'danger');
  if (!ok) return;
  try {
    await deletePostRecordCompletely(docId);
    showToast('success', 'Thành công', 'Đã xóa bài đăng!');
    loadPosts(getActiveTab('postsTabGroup'));
  } catch (e) {
    showToast('error', 'Lỗi', 'Không thể xóa bài đăng: ' + e.message);
  }
}

// ════════════════════════════════════════
// USERS
// ════════════════════════════════════════
function getRemainingLockTime(lockUntil) {
  if (!lockUntil) return "";
  const now = Date.now();
  const diff = lockUntil - now;
  if (diff <= 0) return "Sắp mở khóa...";

  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
  const seconds = Math.floor((diff % (60 * 1000)) / 1000);

  if (days > 365) return "Vĩnh viễn";

  if (days === 0 && hours === 0) {
    if (minutes === 0) return `Còn ${seconds}s`;
    return `Còn ${minutes}p ${seconds}s`;
  }

  let res = "Còn ";
  if (days > 0) res += `${days}n `;
  if (hours > 0) res += `${hours}h `;
  res += `${minutes}p`;
  return res;
}

function formatPresenceElapsed(lastSeenMs) {
  if (!lastSeenMs) return 'Không rõ thời gian';

  const diffMs = Math.max(0, Date.now() - lastSeenMs);
  const totalSec = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  return `${days} ngày ${hours} giờ ${mins} phút ${secs} giây`;
}

function renderUserActivityStatus(d) {
  if (d.isLocked) {
    const lockUntilMs = d.lockUntil ? (d.lockUntil.toMillis ? d.lockUntil.toMillis() : Number(d.lockUntil)) : 0;
    return `
      <div>
        <span class="badge badge-rejected"><i class="fas fa-lock"></i> Đã khóa</span>
        <div class="lock-countdown" data-lockuntil="${lockUntilMs}"
             style="font-size:10.5px;color:#ef4444;font-weight:700;margin-top:4px;display:flex;align-items:center;gap:4px">
          <i class="fas fa-hourglass-half" style="animation:spin .8s linear infinite"></i>
          <span>Đang tính...</span>
        </div>
      </div>`;
  }

  const lastSeenMs = toEpochMs(d.lastSeen);
  const isOnline = d.isOnline === true;
  const ONLINE_STALE_TIMEOUT_MS = 90 * 1000;
  const consideredOnline = isOnline && (!lastSeenMs || (Date.now() - lastSeenMs) <= ONLINE_STALE_TIMEOUT_MS);

  if (consideredOnline) {
    return `
      <div>
        <span class="badge" style="background:#ecfdf5;color:#10b981;border:1px solid #a7f3d0;"><i class="fas fa-check-circle" style="margin-right:3px"></i> Hoạt động</span>
        <div style="font-size:10.5px;color:#10b981;font-weight:700;margin-top:4px;display:flex;align-items:center;gap:4px">
          <i class="fas fa-circle" style="font-size:8px"></i>
          <span>Đang online</span>
        </div>
      </div>`;
  }

  const offlineSinceText = lastSeenMs ? fmtDateTime(lastSeenMs) : 'N/A';
  const elapsedText = lastSeenMs ? formatPresenceElapsed(lastSeenMs) : 'Không rõ thời gian';

  return `
    <div>
      <span class="badge" style="background:#f8fafc;color:#64748b;border:1px solid #cbd5e1;"><i class="fas fa-circle" style="margin-right:3px;font-size:8px"></i> Offline</span>
      <div style="font-size:10.5px;color:#64748b;font-weight:700;margin-top:4px">Từ: ${offlineSinceText}</div>
      <div style="font-size:10.5px;color:#0f172a;font-weight:700;margin-top:2px">Offline: ${elapsedText}</div>
    </div>`;
}

async function checkAndUnlockExpiredUsers() {
  const now = Date.now();
  try {
    const lockedSnap = await db.collection('users')
      .where('isLocked', '==', true)
      .where('lockUntil', '<=', now)
      .get();

    if (!lockedSnap.empty) {
      const batch = db.batch();
      lockedSnap.forEach(doc => {
        batch.update(doc.ref, {
          isLocked: false,
          lockReason: '',
          lockUntil: 0,
          unlockedAt: now,
          unlockedBy: 'system'
        });

        const notifRef = db.collection('notifications').doc();
        batch.set(notifRef, {
          userId: doc.id,
          title: 'Tài khoản đã được mở khóa',
          message: 'Chào mừng bạn quay trở lại! Thời gian tạm khóa đã hết, bạn có thể đăng nhập ngay bây giờ.',
          type: 'account_unlocked',
          seen: false,
          isRead: false,
          createdAt: now
        });
      });
      await batch.commit();
      console.log(`[Hệ thống] Đã tự động mở khóa ${lockedSnap.size} tài khoản.`);
      if (document.getElementById('pageUsers').classList.contains('active')) {
        loadUsers(getActiveTab('usersTabGroup'));
      }
    }
  } catch (e) {
    console.warn('Lỗi quét tự động mở khóa:', e);
  }
}

async function loadUsers(filter) {
  const tbody = document.getElementById('usersTableBody');
  selectedUserIds.clear();
  tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state">Đang tải...</div></td></tr>';
  try {
    // Luôn fetch toàn bộ users, sau đó filter client-side.
    const snap = await db.collection('users').get();
    let docs = snap.docs;

    if (filter === 'user') {
      // Tab "Chưa xác minh": không phải admin VÀ chưa xác minh
      docs = docs.filter(d => d.data().role !== 'admin' && d.data().isVerified !== true);
    } else if (filter === 'verified') {
      // Tab "Đã xác minh": isVerified = true và không phải admin
      docs = docs.filter(d => d.data().isVerified === true && d.data().role !== 'admin');
    } else if (filter === 'admin') {
      // Tab "Admin": chỉ admin
      docs = docs.filter(d => d.data().role === 'admin');
    }

    const sorted = sortDocs(docs, state.users.sort);

    // Luôn ghim Admin lên đầu danh sách khi xem "Tất cả"
    if (filter === 'all') {
      const admins    = sorted.filter(d => d.data().role === 'admin');
      const nonAdmins = sorted.filter(d => d.data().role !== 'admin');
      state.users.docs = [...admins, ...nonAdmins];
    } else {
      state.users.docs = sorted;
    }
    state.users.page = 1;
    renderUsers();
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state">Lỗi tải dữ liệu</div></td></tr>';
    console.error(e);
  }
}

// Từ khóa tìm kiếm hiện tại cho users
let usersSearchKeyword = '';
const selectedUserIds = new Set();

function getFilteredUsersDocs() {
  let all = state.users.docs;
  if (usersSearchKeyword) {
    const kw = usersSearchKeyword;
    all = all.filter(doc => {
      const d = doc.data();
      const haystack = normalizeVietnameseText([
        d.fullName || '',
        d.email || '',
        d.phone || '',
        d.phoneNumber || '',
      ].join(' '));
      return haystack.includes(kw);
    });
  }
  return all.filter(doc => isInDateRange(doc.data().createdAt, dateFilterState.users));
}

function updateUsersSelectAllState(pageDocs) {
  const selectAll = document.getElementById('usersSelectAll');
  if (!selectAll) return;
  const selectable = (pageDocs || []).filter(doc => doc.data().role !== 'admin');
  if (selectable.length === 0) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    return;
  }
  const selectedCount = selectable.filter(doc => selectedUserIds.has(doc.id)).length;
  selectAll.checked = selectedCount === selectable.length;
  selectAll.indeterminate = selectedCount > 0 && selectedCount < selectable.length;
}

function renderUsers() {
  const tbody = document.getElementById('usersTableBody');
  const all = getFilteredUsersDocs();

  const total = all.length;
  updateSupportSelectAllState(page);
  updateReviewsSelectAllState(page);
  updatePaymentsSelectAllState(page);
  if (total === 0) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><i class="fas fa-users"></i>Không có người dùng nào</div></td></tr>';
    renderResultInfo('usersResultInfo', 1, 0);
    document.getElementById('usersPagination').innerHTML = '';
    updateUsersSelectAllState([]);
    return;
  }
  renderResultInfo('usersResultInfo', state.users.page, total);
  renderPagination('usersPagination', 'users', total);
  const page = all.slice((state.users.page-1)*PAGE_SIZE, state.users.page*PAGE_SIZE);
  tbody.innerHTML = page.map(doc => {
    const d    = doc.data();
    const rl   = d.role === 'admin' ? 'Admin' : 'User';
    const rc   = d.role === 'admin' ? 'badge-admin' : 'badge-tenant';
    const vrfd = d.isVerified
      ? `<span style="color:#10b981;font-size:12px;font-weight:700"><i class="fas fa-check-circle"></i> Đã xác minh</span>`
      : `<span style="color:#94a3b8;font-size:12px;font-weight:600">Chưa xác minh</span>`;

    const lockStatus = renderUserActivityStatus(d);

    const canSelect = d.role !== 'admin';
    return `<tr data-created-at="${toEpochMs(d.createdAt)}">
      <td style="text-align:center">
        <input type="checkbox"
          ${canSelect && selectedUserIds.has(doc.id) ? 'checked' : ''}
          ${canSelect ? '' : 'disabled'}
          onchange="toggleUserSelection('${doc.id}', this.checked)">
      </td>
      <td>
        <div class="td-user">
          <div class="td-avatar">${(d.fullName||'U').charAt(0).toUpperCase()}</div>
          <div>
            <div class="td-name">${d.fullName||'N/A'}</div>
          </div>
        </div>
      </td>
      <td>
        <div class="td-name" style="font-size:13px">${d.email||'N/A'}</div>
        <div class="td-email">${d.phone || d.phoneNumber || 'N/A'}</div>
      </td>
      <td><span class="badge ${rc}">${rl}</span></td>
      <td>${vrfd}</td>
      <td>${lockStatus}</td>
      <td><span style="font-size:12px;color:#94a3b8;font-weight:600">${fmtDate(d.createdAt)}</span></td>
      <td style="text-align:right">
        <div class="list-actions">
          <button class="btn btn-view" onclick="viewUser('${doc.id}')" title="Xem chi tiết">
            <i class="fas fa-eye"></i> Xem
          </button>
          ${d.role !== 'admin' ? `
            <button class="btn ${d.isLocked ? 'btn-approve' : 'btn-reject'}"
                    style="${!d.isLocked ? 'background:#f59e0b;border-color:#f59e0b;' : ''}"
                    onclick="toggleLockUser('${doc.id}', ${d.isLocked || false})"
                    title="${d.isLocked ? 'Mở khóa' : 'Khóa tài khoản'}">
              ${d.isLocked ? '<i class="fas fa-unlock"></i> Mở' : '<i class="fas fa-user-lock"></i> Khóa'}
            </button>
          ` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');

  // Khởi động live countdown sau khi render xong
  startLockCountdowns();
  updateUsersSelectAllState(page);
}

// ── Live countdown timer cho tài khoản bị khóa ──
let _lockCountdownInterval = null;
function startLockCountdowns() {
  if (_lockCountdownInterval) clearInterval(_lockCountdownInterval);

  function tick() {
    const now = Date.now();
    document.querySelectorAll('.lock-countdown').forEach(el => {
      const lockUntil = Number(el.dataset.lockuntil);
      if (!lockUntil) {
        el.querySelector('span').textContent = 'Khóa vĩnh viễn';
        return;
      }
      const diff = lockUntil - now;
      if (diff <= 0) {
        el.style.color = '#94a3b8';
        el.querySelector('i').className = 'fas fa-check-circle';
        el.querySelector('span').textContent = 'Đã hết hạn khóa';
        return;
      }
      const totalSec = Math.floor(diff / 1000);
      const days  = Math.floor(totalSec / 86400);
      const hours = Math.floor((totalSec % 86400) / 3600);
      const mins  = Math.floor((totalSec % 3600) / 60);
      const secs  = totalSec % 60;

      let text = '';
      if (days > 0)  text += `${days}n `;
      if (hours > 0) text += `${hours}g `;
      if (mins > 0)  text += `${mins}p `;
      text += `${secs}s`;

      el.querySelector('span').textContent = `Còn ${text}`;
    });
  }

  tick();
  _lockCountdownInterval = setInterval(tick, 1000);
}

async function viewUser(docId) {
  try {
    const doc = await db.collection('users').doc(docId).get();
    if (!doc.exists) { showToast('error', 'Lỗi', 'Người dùng không tồn tại'); return; }
    const d = doc.data();
    const userRoleLabel = d.role === 'admin' ? 'Admin' : (d.isVerified === true ? 'Đã xác minh' : 'Chưa xác minh');
    let verifyHtml = '';
    try {
      const vDoc = await db.collection('verifications').doc(docId).get();
      if (vDoc.exists) {
        const v = vDoc.data();
        verifyHtml = `
          <div class="detail-row"><div class="detail-label">Số CCCD</div><div class="detail-value">${escapeHtml(v.cccdNumber||'N/A')}</div></div>
          <div class="detail-row"><div class="detail-label">Địa chỉ TT</div><div class="detail-value">${escapeHtml(v.address||'N/A')}</div></div>
          <div class="detail-row"><div class="detail-label">Trạng thái XM</div><div class="detail-value">${v.status==='approved'?'Đã duyệt':v.status==='rejected'?'Từ chối':'Chờ duyệt'}</div></div>
          ${v.cccdFrontUrl?`<div class="detail-row"><div class="detail-label">CCCD trước</div><div class="detail-value"><img src="${safeUrl(v.cccdFrontUrl)}" class="cccd-img" onclick="showFullscreenImage('${safeForJsGlobal(safeUrl(v.cccdFrontUrl))}')"></div></div>`:''}
          ${v.cccdBackUrl ?`<div class="detail-row"><div class="detail-label">CCCD sau</div><div class="detail-value"><img src="${safeUrl(v.cccdBackUrl)}"  class="cccd-img" onclick="showFullscreenImage('${safeForJsGlobal(safeUrl(v.cccdBackUrl))}')"></div></div>`:''}
        `;
      }
    } catch (_) {}
    showModal(`
      <div class="modal-title">Thông tin người dùng</div>
      <div class="detail-row"><div class="detail-label">Họ tên</div><div class="detail-value">${escapeHtml(d.fullName||'N/A')}</div></div>
      <div class="detail-row"><div class="detail-label">Email</div><div class="detail-value">${escapeHtml(d.email||'N/A')}</div></div>
      <div class="detail-row"><div class="detail-label">SĐT</div><div class="detail-value">${escapeHtml(d.phone || d.phoneNumber || 'N/A')}</div></div>
      <div class="detail-row"><div class="detail-label">Vai trò</div><div class="detail-value">${escapeHtml(userRoleLabel)}</div></div>
      <div class="detail-row"><div class="detail-label">Giới tính</div><div class="detail-value">${escapeHtml(d.gender||'N/A')}</div></div>
      <div class="detail-row"><div class="detail-label">Địa chỉ</div><div class="detail-value">${escapeHtml(d.address||'N/A')}</div></div>
      <div class="detail-row"><div class="detail-label">Xác minh</div><div class="detail-value">${d.isVerified?'Đã xác minh':'Chưa'}</div></div>
      ${d.isLocked ? `
        <div class="detail-row"><div class="detail-label">Trạng thái</div><div class="detail-value" style="color:#ef4444;font-weight:700">ĐÃ KHÓA</div></div>
        <div class="detail-row"><div class="detail-label">Lý do khóa</div><div class="detail-value">${escapeHtml(d.lockReason || 'Không có')}</div></div>
        <div class="detail-row"><div class="detail-label">Khóa đến</div><div class="detail-value">${fmtDateTime(d.lockUntil)}</div></div>
      ` : ''}
      ${verifyHtml}
      <div class="modal-actions"><button class="btn btn-view" onclick="closeModal()">Đóng</button></div>`);
  } catch (e) { showToast('error', 'Lỗi', e.message); }
}

async function deleteUser(docId, options = {}) {
  const { skipConfirm = false, skipToast = false, skipRefresh = false } = options;
  if (!skipConfirm) {
    const ok = await showConfirm('Xóa người dùng', 'Bạn có chắc chắn muốn xóa tài khoản này? Hành động này không thể hoàn tác.', 'danger');
    if (!ok) return { deleted: false, cleanupErrors: [] };
  }

  try {
    if (!skipToast) {
      showToast('info', 'Đang xử lý', 'Đang tiến hành xóa tài khoản và dữ liệu liên quan...');
    }

    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch('https://us-central1-doantotnghiep-b39ae.cloudfunctions.net/deleteUserAccount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ uid: docId })
      });
      if (!res.ok) {
        let msg = '';
        try {
          const err = await res.json();
          msg = err?.error || err?.message || '';
        } catch (_) {
          msg = '';
        }
        if (!msg.toLowerCase().includes('no user record') &&
            !msg.toLowerCase().includes('user-not-found') &&
            !msg.toLowerCase().includes('not found')) {
          throw new Error(msg || `Không thể xóa tài khoản khỏi Authentication (HTTP ${res.status})`);
        }
        console.warn(`[deleteUser] User ${docId} không có trong Firebase Auth, bỏ qua bước xóa Auth.`);
      }
    } catch (authErr) {
      const msg = String(authErr?.message || '').toLowerCase();
      if (!msg.includes('no user record') &&
          !msg.includes('user-not-found') &&
          !msg.includes('not found')) {
        throw authErr;
      }
      console.warn(`[deleteUser] User ${docId} không có trong Firebase Auth, bỏ qua bước xóa Auth.`);
    }

    let cccdFromVerification = '';
    try {
      const verifySnap = await db.collection('verifications').doc(docId).get();
      if (verifySnap.exists) {
        cccdFromVerification = String(verifySnap.data()?.cccdNumber || '').trim();
      }
    } catch (e) {
      console.warn(`Không thể đọc CCCD từ hồ sơ xác minh của user ${docId}:`, e);
    }

    const batch = db.batch();
    batch.delete(db.collection('users').doc(docId));
    batch.delete(db.collection('verifications').doc(docId));
    await batch.commit();

    const cleanupErrors = [];
    const deleteCollection = async (col, field) => {
      try {
        const snap = await db.collection(col).where(field, '==', docId).get();
        if (!snap.empty) {
          const chunks = [];
          for (let i = 0; i < snap.docs.length; i += 500) chunks.push(snap.docs.slice(i, i + 500));
          for (const chunk of chunks) {
            const b = db.batch();
            chunk.forEach(d => b.delete(d.ref));
            await b.commit();
          }
        }
      } catch (e) {
        cleanupErrors.push(`${col}:${field}`);
        console.error(`Lỗi xóa collection ${col} theo ${field}:`, e);
      }
    };

    try {
      const roomsSnap = await db.collection('rooms').where('userId', '==', docId).get();
      if (!roomsSnap.empty) {
        for (const roomDoc of roomsSnap.docs) {
          const roomId = roomDoc.id;
          try {
            const listRef = storage.ref(`rooms/${roomId}`);
            const listSvc = await listRef.listAll();
            await Promise.all(listSvc.items.map(item => item.delete()));
          } catch (err) {
            cleanupErrors.push(`rooms-storage:${roomId}`);
            console.warn(`Không thể xóa folder ảnh room ${roomId}:`, err);
          }
          await roomDoc.ref.delete();
        }
      }
    } catch (e) {
      cleanupErrors.push('rooms:userId');
      console.error('Lỗi xóa rooms:', e);
    }

    try {
      await storage.ref(`avatars/${docId}`).delete();
    } catch (_) {}

    try {
      const avatarFolder = storage.ref(`avatars/${docId}`);
      const listSvc = await avatarFolder.listAll();
      await Promise.all(listSvc.items.map(item => item.delete()));
    } catch (e) {
      cleanupErrors.push('avatars:folder');
      console.warn('Lỗi xóa avatar folder:', e);
    }

    try {
      const verifyFolder = storage.ref(`verifications/${docId}`);
      const listSvc = await verifyFolder.listAll();
      await Promise.all(listSvc.items.map(item => item.delete()));
    } catch (e) {
      cleanupErrors.push('verifications-storage:folder');
      console.warn('Lỗi xóa verifications folder:', e);
    }

    const appointmentIds = new Set();
    const collectAppointmentIds = async field => {
      try {
        const snap = await db.collection('appointments').where(field, '==', docId).get();
        snap.forEach(d => appointmentIds.add(d.id));
      } catch (e) {
        cleanupErrors.push(`appointments:${field}:collect`);
        console.error(`Lỗi thu thập appointment theo ${field}:`, e);
      }
    };

    await deleteCollection('savedPosts', 'userId');
    await collectAppointmentIds('tenantId');
    await collectAppointmentIds('landlordId');
    await deleteCollection('appointments', 'tenantId');
    await deleteCollection('appointments', 'landlordId');
    await deleteCollection('notifications', 'userId');
    await deleteCollection('verifications', 'userId');
    await deleteCollection('cccd_registry', 'uid');

    // Fallback: xóa thẳng theo docId = cccdNumber nếu còn sót.
    if (cccdFromVerification) {
      try {
        await db.collection('cccd_registry').doc(cccdFromVerification).delete();
      } catch (e) {
        cleanupErrors.push(`cccd_registry:doc:${cccdFromVerification}`);
        console.warn(`Lỗi xóa cccd_registry theo docId ${cccdFromVerification}:`, e);
      }
    }

    if (appointmentIds.size > 0) {
      try {
        const ids = Array.from(appointmentIds);
        for (let i = 0; i < ids.length; i += 500) {
          const chunk = ids.slice(i, i + 500);
          const b = db.batch();
          chunk.forEach(id => b.delete(db.collection('bookedSlots').doc(id)));
          await b.commit();
        }
      } catch (e) {
        cleanupErrors.push('bookedSlots:appointmentId');
        console.error('Lỗi xóa bookedSlots theo appointmentId:', e);
      }
    }

    selectedUserIds.delete(docId);

    if (!skipToast) {
      if (cleanupErrors.length > 0) {
        showToast('warning', 'Hoàn tất một phần', 'Đã xóa tài khoản chính nhưng còn một số dữ liệu liên quan chưa dọn hết. Vui lòng kiểm tra log.');
      } else {
        showToast('success', 'Thành công', 'Đã xóa tài khoản người dùng!');
      }
    }
    if (!skipRefresh) {
      loadUsers(getActiveTab('usersTabGroup'));
    }
    return { deleted: true, cleanupErrors };
  } catch (e) {
    if (!skipToast) showToast('error', 'Lỗi', e.message);
    throw e;
  }
}

function toggleUserSelection(userId, checked) {
  if (checked) selectedUserIds.add(userId);
  else selectedUserIds.delete(userId);
  updateUsersSelectAllState(
    getFilteredUsersDocs().slice((state.users.page-1)*PAGE_SIZE, state.users.page*PAGE_SIZE)
  );
}

function toggleSelectAllUsers(checked) {
  const pageDocs = getFilteredUsersDocs().slice((state.users.page-1)*PAGE_SIZE, state.users.page*PAGE_SIZE);
  pageDocs.forEach(doc => {
    if (doc.data().role === 'admin') return;
    if (checked) selectedUserIds.add(doc.id);
    else selectedUserIds.delete(doc.id);
  });
  renderUsers();
}

async function deleteSelectedUsers() {
  const userMap = new Map(state.users.docs.map(doc => [doc.id, doc.data()]));
  const ids = Array.from(selectedUserIds).filter(id => {
    const d = userMap.get(id);
    return d && d.role !== 'admin';
  });

  if (ids.length === 0) {
    showToast('warning', 'Chưa chọn người dùng', 'Hãy tick chọn ít nhất 1 tài khoản user để xóa.');
    return;
  }

  const ok = await showConfirm('Xóa người dùng đã chọn', `Bạn sắp xóa ${ids.length} tài khoản user. Hành động này không thể hoàn tác.`, 'danger');
  if (!ok) return;

  showToast('info', 'Đang xử lý', `Đang tiến hành xóa ${ids.length} tài khoản...`, 3500);
  let failed = 0;
  let partialCleanup = 0;
  for (const id of ids) {
    try {
      const result = await deleteUser(id, { skipConfirm: true, skipToast: true, skipRefresh: true });
      if (result.cleanupErrors?.length) partialCleanup++;
    } catch (e) {
      failed++;
      console.warn(`Không thể xóa user ${id}:`, e);
    }
  }

  const deleted = ids.length - failed;
  if (failed === 0 && partialCleanup === 0) {
    showToast('success', 'Thành công', `Đã xóa ${deleted} tài khoản.`);
  } else {
    const tail = partialCleanup > 0 ? ` ${partialCleanup} tài khoản còn dữ liệu liên quan cần kiểm tra log.` : '';
    showToast('warning', 'Hoàn tất một phần', `Đã xóa ${deleted}/${ids.length} tài khoản. ${failed} tài khoản lỗi.${tail}`);
  }
  loadUsers(getActiveTab('usersTabGroup'));
}

function filterUsersSearch() {
  clearTimeout(usersSearchTimeout);
  usersSearchTimeout = setTimeout(() => {
    usersSearchKeyword = normalizeVietnameseText(document.getElementById('searchUser').value);
    state.users.page = 1; // Reset về trang 1 khi tìm kiếm
    renderUsers();
  }, 300);
}

function changeSortUsers() {
  state.users.sort = document.getElementById('sortUsers').value;
  state.users.page = 1;
  state.users.docs = sortDocs(state.users.docs, state.users.sort);
  renderUsers();
}

// ════════════════════════════════════════
// EXPORT EXCEL
// ════════════════════════════════════════

function getExportFileName(prefix) {
  const now = new Date();
  const d = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  const t = `${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
  return `${prefix}_${d}_${t}.xlsx`;
}

function exportUsersToExcel() {
  if (!state.users.docs || state.users.docs.length === 0) {
    showToast('warning', 'Không có dữ liệu', 'Vui lòng tải danh sách người dùng trước khi xuất.');
    return;
  }

  // Tiêu đề cột
  const headers = ['STT', 'Họ và tên', 'Email', 'Số điện thoại', 'Vai trò', 'Trạng thái xác minh',
                   'Tình trạng khóa', 'Giới tính', 'Địa chỉ', 'Ngày tham gia'];

  const rows = state.users.docs.map((doc, i) => {
    const d = doc.data();
    return [
      i + 1,
      d.fullName    || 'N/A',
      d.email       || 'N/A',
      d.phone || d.phoneNumber || 'N/A',
      d.role === 'admin' ? 'Admin' : 'User',
      d.isVerified ? 'Đã xác minh' : 'Chưa xác minh',
      d.isLocked   ? `Đã khóa (${d.lockReason || ''})` : 'Bình thường',
      d.gender     || 'N/A',
      d.address    || 'N/A',
      d.createdAt  ? new Date(d.createdAt).toLocaleDateString('vi-VN') : 'N/A'
    ];
  });

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  // Cài độ rộng cột
  ws['!cols'] = [
    { wch: 5 }, { wch: 25 }, { wch: 30 }, { wch: 15 }, { wch: 10 },
    { wch: 18 }, { wch: 25 }, { wch: 12 }, { wch: 30 }, { wch: 15 }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Người dùng');

  // Sheet thống kê tóm tắt
  const total      = state.users.docs.length;
  const verified   = state.users.docs.filter(d => d.data().isVerified === true && d.data().role !== 'admin').length;
  const unverified = state.users.docs.filter(d => d.data().isVerified !== true && d.data().role !== 'admin').length;
  const admins     = state.users.docs.filter(d => d.data().role === 'admin').length;
  const locked     = state.users.docs.filter(d => d.data().isLocked === true).length;

  const summaryData = [
    ['BÁO CÁO THỐNG KÊ NGƯỜI DÙNG - TimTro 24/7'],
    [`Xuất lúc: ${new Date().toLocaleString('vi-VN')}`],
    [],
    ['Chỉ tiêu', 'Số lượng'],
    ['Tổng tài khoản', total],
    ['Đã xác minh (User)', verified],
    ['Chưa xác minh (User)', unverified],
    ['Tài khoản Admin', admins],
    ['Tài khoản đang bị khóa', locked],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  wsSummary['!cols'] = [{ wch: 30 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Thống kê');

  XLSX.writeFile(wb, getExportFileName('DanhSach_NguoiDung'));
  showToast('success', 'Xuất thành công', `Đã xuất ${total} người dùng ra file Excel!`);
}

function exportPostsToExcel() {
  if (!state.posts.docs || state.posts.docs.length === 0) {
    showToast('warning', 'Không có dữ liệu', 'Vui lòng tải danh sách bài đăng trước khi xuất.');
    return;
  }

  const statusMap = {
    pending:  'Chờ duyệt',
    approved: 'Đã duyệt',
    rejected: 'Từ chối',
    rented:   'Đã cho thuê',
    expired:  'Hết hạn'
  };

  const headers = ['STT', 'Tiêu đề', 'Địa chỉ', 'Quận/Huyện', 'Giá thuê (VNĐ)', 'Diện tích (m²)',
                   'Loại phòng', 'Số phòng ngủ', 'Trạng thái', 'Đặc biệt', 'Ngày đăng', 'Ngày hết hạn'];

  const rows = state.posts.docs.map((doc, i) => {
    const d = doc.data();
    return [
      i + 1,
      d.title        || 'N/A',
      d.address      || 'N/A',
      d.district     || 'N/A',
      d.price        || 0,
      d.area         || 'N/A',
      d.roomType     || 'N/A',
      d.bedrooms     || 'N/A',
      statusMap[d.status] || d.status || 'N/A',
      d.isFeatured   ? 'Nổi bật' : '',
      d.createdAt    ? new Date(d.createdAt).toLocaleDateString('vi-VN') : 'N/A',
      d.expiryDate   ? new Date(d.expiryDate).toLocaleDateString('vi-VN') : 'N/A'
    ];
  });

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [
    { wch: 5 }, { wch: 35 }, { wch: 35 }, { wch: 18 }, { wch: 16 },
    { wch: 14 }, { wch: 15 }, { wch: 13 }, { wch: 14 }, { wch: 10 },
    { wch: 13 }, { wch: 13 }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Bài đăng');

  // Sheet thống kê
  const total    = state.posts.docs.length;
  const pending  = state.posts.docs.filter(d => d.data().status === 'pending').length;
  const approved = state.posts.docs.filter(d => d.data().status === 'approved').length;
  const rejected = state.posts.docs.filter(d => d.data().status === 'rejected').length;
  const rented   = state.posts.docs.filter(d => d.data().status === 'rented').length;
  const featured = state.posts.docs.filter(d => d.data().isFeatured === true).length;

  const summaryData = [
    ['BÁO CÁO THỐNG KÊ BÀI ĐĂNG - TimTro 24/7'],
    [`Xuất lúc: ${new Date().toLocaleString('vi-VN')}`],
    [],
    ['Chỉ tiêu', 'Số lượng'],
    ['Tổng bài đăng', total],
    ['Đang chờ duyệt', pending],
    ['Đã được duyệt', approved],
    ['Bị từ chối', rejected],
    ['Đã cho thuê', rented],
    ['Bài nổi bật', featured],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  wsSummary['!cols'] = [{ wch: 25 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Thống kê');

  XLSX.writeFile(wb, getExportFileName('DanhSach_BaiDang'));
  showToast('success', 'Xuất thành công', `Đã xuất ${total} bài đăng ra file Excel!`);
}


// ════════════════════════════════════════
async function loadAppointments(filter = 'all') {
  const tbody = document.getElementById('apptTableBody');
  selectedAppointmentIds.clear();
  tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state">Đang tải...</div></td></tr>';
  try {
    let q = db.collection('appointments');
    if (filter !== 'all') q = q.where('status', '==', filter);
    const snap = await q.get();
    state.appt.docs = sortDocs(snap.docs, state.appt.sort);
    state.appt.page = 1;
    renderAppt();
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state">Lỗi tải dữ liệu</div></td></tr>';
    console.error(e);
  }
}

const selectedAppointmentIds = new Set();

function getFilteredAppointmentDocs() {
  return state.appt.docs.filter(doc => isInDateRange(doc.data().createdAt, dateFilterState.appointments));
}

function updateAppointmentsSelectAllState(pageDocs) {
  const selectAll = document.getElementById('apptSelectAll');
  if (!selectAll) return;
  if (!pageDocs || pageDocs.length === 0) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    return;
  }
  const selectedCount = pageDocs.filter(doc => selectedAppointmentIds.has(doc.id)).length;
  selectAll.checked = selectedCount === pageDocs.length;
  selectAll.indeterminate = selectedCount > 0 && selectedCount < pageDocs.length;
}

function renderAppt() {
  const tbody = document.getElementById('apptTableBody');
  const all = getFilteredAppointmentDocs();
  const total = all.length;
  updateSupportSelectAllState(page);
  updateReviewsSelectAllState(page);
  updatePaymentsSelectAllState(page);
  if (total === 0) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><i class="fas fa-calendar"></i>Chưa có lịch hẹn nào</div></td></tr>';
    renderResultInfo('apptResultInfo', 1, 0);
    document.getElementById('apptPagination').innerHTML = '';
    updateAppointmentsSelectAllState([]);
    return;
  }
  renderResultInfo('apptResultInfo', state.appt.page, total);
  renderPagination('apptPagination', 'appt', total);
  const statusMap = {
    pending:             { label: 'Chờ xác nhận',       cls: 'badge-pending'  },
    confirmed:           { label: 'Chủ trọ xác nhận',     cls: 'badge-approved' },
    tenant_confirmed:    { label: 'Hoàn tất',              cls: 'badge-approved' },
    rejected:            { label: 'Từ chối',               cls: 'badge-rejected' },
    cancelled_by_tenant: { label: 'Đã hủy',                 cls: 'badge-rejected' },
  };
  const page = all.slice((state.appt.page-1)*PAGE_SIZE, state.appt.page*PAGE_SIZE);
  tbody.innerHTML = page.map(doc => {
    const d = doc.data();
    const s = statusMap[d.status] || { label: d.status, cls: 'badge-pending' };
    return `<tr data-created-at="${toEpochMs(d.createdAt)}">
      <td style="text-align:center">
        <input type="checkbox" ${selectedAppointmentIds.has(doc.id) ? 'checked' : ''} onchange="toggleAppointmentSelection('${doc.id}', this.checked)">
      </td>
      <td><div class="td-name">${d.roomTitle||'Phòng trọ'}</div><div class="td-email">${d.roomAddress||''}</div></td>
      <td><div class="td-name" style="font-size:13px">${d.tenantName||'N/A'}</div></td>
      <td><div style="font-size:12px;color:#64748b;font-weight:600">${d.landlordName||'N/A'}</div></td>
      <td>
        <div style="font-size:13px;font-weight:700">${d.dateDisplay||d.date||'N/A'}</div>
        <div style="font-size:11px;color:#94a3b8;font-weight:600">${d.time||''}</div>
      </td>
      <td><span class="badge ${s.cls}">${s.label}</span></td>
    </tr>`;
  }).join('');
  updateAppointmentsSelectAllState(page);
}

function changeSortAppt() {
  state.appt.sort = document.getElementById('sortAppt').value;
  state.appt.page = 1;
  state.appt.docs = sortDocs(state.appt.docs, state.appt.sort);
  renderAppt();
}

function toggleAppointmentSelection(appointmentId, checked) {
  if (checked) selectedAppointmentIds.add(appointmentId);
  else selectedAppointmentIds.delete(appointmentId);
  updateAppointmentsSelectAllState(
    getFilteredAppointmentDocs().slice((state.appt.page-1)*PAGE_SIZE, state.appt.page*PAGE_SIZE)
  );
}

function toggleSelectAllAppointments(checked) {
  const pageDocs = getFilteredAppointmentDocs().slice((state.appt.page-1)*PAGE_SIZE, state.appt.page*PAGE_SIZE);
  pageDocs.forEach(doc => {
    if (checked) selectedAppointmentIds.add(doc.id);
    else selectedAppointmentIds.delete(doc.id);
  });
  renderAppt();
}

async function deleteSelectedAppointments() {
  const ids = Array.from(selectedAppointmentIds);
  if (ids.length === 0) {
    showToast('warning', 'Chưa chọn lịch hẹn', 'Hãy tick chọn ít nhất 1 lịch hẹn để xóa.');
    return;
  }
  const ok = await showConfirm('Xóa lịch hẹn đã chọn', `Bạn sắp xóa ${ids.length} lịch hẹn. Hành động này không thể hoàn tác.`, 'danger');
  if (!ok) return;

  showToast('info', 'Đang xử lý', `Đang tiến hành xóa ${ids.length} lịch hẹn...`, 3500);
  let failed = 0;
  for (const id of ids) {
    try {
      await db.collection('appointments').doc(id).delete();
      selectedAppointmentIds.delete(id);
    } catch (e) {
      failed++;
      console.warn(`Không thể xóa lịch hẹn ${id}:`, e);
    }
  }

  const deleted = ids.length - failed;
  if (failed === 0) {
    showToast('success', 'Thành công', `Đã xóa ${deleted} lịch hẹn.`);
  } else {
    showToast('warning', 'Hoàn tất một phần', `Đã xóa ${deleted}/${ids.length} lịch hẹn. ${failed} lịch hẹn lỗi.`);
  }
  loadAppointments(getActiveTab('apptTabGroup'));
}

// ════════════════════════════════════════
// SUPPORT TICKETS
// ════════════════════════════════════════
async function loadSupportTickets(filter = 'new') {
  const tbody = document.getElementById('supportTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state">Đang tải...</div></td></tr>';
  try {
    let q = db.collection('support_tickets');
    if (filter !== 'all') q = q.where('status', '==', filter);
    const snap = await q.get();
    state.support.docs = snap.docs.sort((a, b) => toEpochMs(b.data().updatedAt) - toEpochMs(a.data().updatedAt));
    state.support.page = 1;
    renderSupportTickets();
  } catch (e) {
    console.error(e);
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state">Lỗi tải yêu cầu hỗ trợ</div></td></tr>';
  }
}

function supportStatusInfo(status) {
  const map = {
    new: { label: 'Mới', cls: 'badge-pending' },
    in_progress: { label: 'Đang xử lý', cls: 'badge-landlord' },
    resolved: { label: 'Đã xử lý', cls: 'badge-approved' },
    closed: { label: 'Đã đóng', cls: 'badge-rejected' },
  };
  return map[status] || { label: status || 'N/A', cls: 'badge-pending' };
}

function renderSupportTickets() {
  const tbody = document.getElementById('supportTableBody');
  if (!tbody) return;
  const all = state.support.docs || [];
  const total = all.length;
  updateSupportSelectAllState(page);
  updateReviewsSelectAllState(page);
  updatePaymentsSelectAllState(page);
  renderResultInfo('supportResultInfo', state.support.page, total);
  renderPagination('supportPagination', 'support', total);
  if (total === 0) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><i class="fas fa-headset"></i>Không có yêu cầu hỗ trợ</div></td></tr>';
    return;
  }
  const page = all.slice((state.support.page - 1) * PAGE_SIZE, state.support.page * PAGE_SIZE);
  tbody.innerHTML = page.map(doc => {
    const d = doc.data();
    const s = supportStatusInfo(d.status);
    const unread = d.unreadForAdmin === true ? '<span class="badge badge-rejected" style="margin-left:6px">Mới</span>' : '';
    return `<tr data-created-at="${toEpochMs(d.updatedAt)}">
      <td>
        <div class="td-user">
          <div class="td-avatar">${escapeHtml((d.userName || 'U').charAt(0).toUpperCase())}</div>
          <div><div class="td-name">${escapeHtml(d.userName || 'Người dùng')}</div><div class="td-email">${escapeHtml(d.userEmail || d.userId || '')}</div></div>
        </div>
      </td>
      <td>${escapeHtml(d.category || 'Khác')}</td>
      <td><b>${escapeHtml(d.title || 'Yêu cầu hỗ trợ')}</b>${unread}</td>
      <td>${escapeHtml(d.lastMessage || '')}</td>
      <td>${fmtDateTime(d.updatedAt)}</td>
      <td><span class="badge ${s.cls}">${s.label}</span></td>
      <td style="text-align:right"><div class="list-actions"><button class="btn btn-view" onclick="openSupportTicket('${doc.id}')">Xem</button>${['resolved','closed'].includes(d.status)?`<button class="btn btn-delete" onclick="deleteSupportTicket('${doc.id}')"><i class="fas fa-trash"></i></button>`:''}</div></td>
    </tr>`;
  }).join('');
}


async function deleteSupportTicket(ticketId) {
  const ok = await showConfirm('Xoa ticket', 'Xoa yeu cau ho tro nay?', 'danger');
  if (!ok) return;
  try {
    const msgsSnap = await db.collection('support_tickets').doc(ticketId).collection('messages').get();
    const batch = db.batch();
    msgsSnap.docs.forEach(m => batch.delete(m.ref));
    batch.delete(db.collection('support_tickets').doc(ticketId));
    await batch.commit();
    showToast('success', 'Da xoa', 'Ticket ho tro da bi xoa');
    loadSupportTickets(getActiveTab('supportTabGroup'));
  } catch (e) { showToast('error', 'Loi', e.message); }
}

async function deleteSelectedSupport() {
  const ids = Array.from(selectedSupportIds);
  const docs = (state.support.docs||[]).filter(doc => ids.includes(doc.id)).filter(doc => ['resolved','closed'].includes(doc.data().status));
  if (!docs.length) { showToast('warning', 'Khong the xoa', 'Chi xoa duoc ticket da xu ly hoac da dong.'); return; }
  const ok = await showConfirm('Xoa tat ca', 'Xoa ' + docs.length + ' ticket ho tro?', 'danger');
  if (!ok) return;
  showToast('info', 'Dang xu ly', 'Dang xoa ' + docs.length + ' ticket...', 3000);
  let failed = 0;
  for (const doc of docs) {
    try {
      const msgsSnap = await db.collection('support_tickets').doc(doc.id).collection('messages').get();
      const batch = db.batch();
      msgsSnap.docs.forEach(m => batch.delete(m.ref));
      batch.delete(db.collection('support_tickets').doc(doc.id));
      await batch.commit();
    } catch (e) { failed++; }
  }
  if (failed === 0) showToast('success', 'Thanh cong', 'Da xoa ' + docs.length + ' ticket.');
  else showToast('warning', 'Mot phan', 'Xoa ' + (docs.length - failed) + '/' + docs.length + '. ' + failed + ' loi.');
  loadSupportTickets(getActiveTab('supportTabGroup'));
}
async function openSupportTicket(ticketId) {
  try {
    const doc = await db.collection('support_tickets').doc(ticketId).get();
    if (!doc.exists) {
      showToast('error', 'Lỗi', 'Yêu cầu hỗ trợ không tồn tại');
      return;
    }
    await db.collection('support_tickets').doc(ticketId).update({ unreadForAdmin: false });
    const d = doc.data();
    const msgSnap = await db.collection('support_tickets').doc(ticketId)
      .collection('messages').orderBy('createdAt', 'asc').get();
    const messagesHtml = msgSnap.docs.map(m => renderSupportMessage(m.data())).join('') ||
      '<div class="empty-state">Chưa có tin nhắn</div>';
    const status = supportStatusInfo(d.status);
    closeModal();
    showModal(`
      <div class="modal-title">Yêu cầu hỗ trợ</div>
      <div class="detail-row"><div class="detail-label">Người gửi</div><div class="detail-value">${escapeHtml(d.userName || 'Người dùng')} &bull; ${escapeHtml(d.userEmail || '')}</div></div>
      <div class="detail-row"><div class="detail-label">Loại vấn đề</div><div class="detail-value">${escapeHtml(d.category || 'Khác')}</div></div>
      <div class="detail-row"><div class="detail-label">Tiêu đề</div><div class="detail-value">${escapeHtml(d.title || 'Yêu cầu hỗ trợ')}</div></div>
      <div class="detail-row"><div class="detail-label">Trạng thái</div><div class="detail-value"><span class="badge ${status.cls}">${status.label}</span></div></div>
      <div class="support-thread" id="supportThread">${messagesHtml}</div>
      ${d.status === 'closed' ? '<div class="empty-state" style="padding:16px">Yêu cầu này đã đóng.</div>' : `
        <div class="support-reply-row">
          <textarea id="supportReplyText" class="form-input" placeholder="Nhập phản hồi cho người dùng..."></textarea>
          <button class="btn btn-approve" onclick="sendSupportReply('${ticketId}')"><i class="fas fa-paper-plane"></i> Gửi</button>
        </div>
        <input type="file" id="supportReplyImage" accept="image/*" class="form-input" style="margin-top:10px">
        <div class="support-file-note">Có thể đính kèm 1 ảnh minh họa cho phản hồi.</div>
      `}
      <div class="modal-actions">
        <button class="btn btn-view" onclick="closeModal()">Đóng</button>
        ${d.status !== 'resolved' && d.status !== 'closed' ? `<button class="btn btn-approve" onclick="updateSupportStatus('${ticketId}','resolved')">Đánh dấu đã xử lý</button>` : ''}
        ${d.status !== 'closed' ? `<button class="btn btn-reject" onclick="updateSupportStatus('${ticketId}','closed')">Đóng ticket</button>` : ''}
      </div>
    `);
    setTimeout(() => {
      const thread = document.getElementById('supportThread');
      if (thread) thread.scrollTop = thread.scrollHeight;
    }, 80);
  } catch (e) {
    console.error(e);
    showToast('error', 'Lỗi', e.message);
  }
}

function renderSupportMessage(m) {
  const isAdmin = m.senderRole === 'admin';
  const name = isAdmin ? 'Admin' : 'Người dùng';
  const safeImage = safeUrl(m.imageUrl || '');
  return `<div class="support-msg ${isAdmin ? 'admin' : 'user'}">
    <div class="support-bubble">
      <div class="support-msg-meta">${name} &bull; ${fmtDateTime(m.createdAt)}</div>
      ${m.text ? `<div class="support-msg-text">${escapeHtml(m.text)}</div>` : ''}
      ${safeImage ? `<img src="${safeImage}" class="support-msg-img" onclick="showFullscreenImage('${safeForJsGlobal(safeImage)}')">` : ''}
    </div>
  </div>`;
}

async function sendSupportReply(ticketId) {
  const textEl = document.getElementById('supportReplyText');
  const fileEl = document.getElementById('supportReplyImage');
  const text = textEl?.value.trim() || '';
  const file = fileEl?.files?.[0] || null;
  if (!text && !file) {
    showToast('warning', 'Thiếu nội dung', 'Nhập nội dung hoặc chọn ảnh trước khi gửi.');
    return;
  }
  try {
    showToast('info', 'Đang gửi', 'Đang gửi phản hồi hỗ trợ...', 2500);
    let imageUrl = '';
    if (file) {
      const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}_${file.name}`;
      const ref = storage.ref(`support_images/${ticketId}/${fileName}`);
      await ref.put(file);
      imageUrl = await ref.getDownloadURL();
    }
    const admin = auth.currentUser;
    const adminDoc = admin ? await db.collection('users').doc(admin.uid).get() : null;
    const adminName = adminDoc?.data()?.fullName || admin?.email || 'Admin';
    const now = Date.now();
    const ticketRef = db.collection('support_tickets').doc(ticketId);
    const ticketDoc = await ticketRef.get();
    if (!ticketDoc.exists) throw new Error('Ticket không tồn tại');
    const ticket = ticketDoc.data();
    await ticketRef.collection('messages').add({
      senderId: admin?.uid || 'admin',
      senderRole: 'admin',
      text,
      imageUrl,
      createdAt: now,
      seenByUser: false,
      seenByAdmin: true
    });
    const lastMessage = text || '[Hình ảnh]';
    await ticketRef.update({
      status: ticket.status === 'new' ? 'in_progress' : ticket.status,
      updatedAt: now,
      lastMessage,
      lastSenderRole: 'admin',
      adminId: admin?.uid || '',
      adminName,
      unreadForUser: true,
      unreadForAdmin: false
    });
    await db.collection('notifications').add({
      userId: ticket.userId,
      title: 'Admin đã phản hồi hỗ trợ',
      message: lastMessage,
      type: 'support_reply',
      ticketId,
      ticketTitle: ticket.title || 'Yêu cầu hỗ trợ',
      seen: false,
      isRead: false,
      createdAt: now
    });
    showToast('success', 'Thành công', 'Đã gửi phản hồi cho người dùng.');
    openSupportTicket(ticketId);
    loadSupportTickets(getActiveTab('supportTabGroup'));
  } catch (e) {
    console.error(e);
    showToast('error', 'Lỗi', e.message);
  }
}

async function updateSupportStatus(ticketId, status) {
  try {
    await db.collection('support_tickets').doc(ticketId).update({
      status,
      updatedAt: Date.now(),
      unreadForAdmin: false
    });
    showToast('success', 'Đã cập nhật', 'Trạng thái yêu cầu hỗ trợ đã được cập nhật.');
    openSupportTicket(ticketId);
    loadSupportTickets(getActiveTab('supportTabGroup'));
  } catch (e) {
    showToast('error', 'Lỗi', e.message);
  }
}

// ════════════════════════════════════════
// DATE FILTER
// ════════════════════════════════════════
const dateFilterMap = {
  posts:          { from: 'postDateFrom',   to: 'postDateTo',   tbody: '#postsTableBody' },
  users:          { from: 'userDateFrom',   to: 'userDateTo',   tbody: '#usersTableBody' },
  appointments:  { from: 'apptDateFrom',   to: 'apptDateTo',   tbody: '#apptTableBody'  },
  verifications: { from: 'verifyDateFrom', to: 'verifyDateTo', tbody: '#verifyTableBody' },
  featured:      { from: 'featuredDateFrom', to: 'featuredDateTo', tbody: '#featuredTableBody' },
  payments:      { from: 'paymentsDateFrom', to: 'paymentsDateTo', tbody: '#paymentsTableBody' },
  reviews:       { from: 'reviewsDateFrom',  to: 'reviewsDateTo',  tbody: '#reviewsTableBody' },
  support:       { from: 'supportDateFrom',  to: 'supportDateTo',  tbody: '#supportTableBody' },
};
const dateFilterState = {
  posts: { fromMs: null, toMs: null },
  users: { fromMs: null, toMs: null },
  appointments: { fromMs: null, toMs: null },
  featured: { fromMs: null, toMs: null },
  payments: { fromMs: null, toMs: null },
  reviews: { fromMs: null, toMs: null },
  support: { fromMs: null, toMs: null },
};

function isInDateRange(value, filter) {
  if (!filter) return true;
  const ts = toEpochMs(value);
  return (!filter.fromMs || ts >= filter.fromMs) && (!filter.toMs || ts <= filter.toMs);
}

function _callRenderForPage(page) {
  if (page === 'posts') { state.posts.page = 1; renderPosts(); }
  if (page === 'users') { state.users.page = 1; renderUsers(); }
  if (page === 'appointments') { state.appt.page = 1; renderAppt(); }
  if (page === 'featured') { state.featured.page = 1; renderFeaturedRequests(); }
  if (page === 'payments') { state.payments.page = 1; renderPayments(); }
  if (page === 'reviews') { state.reviews.page = 1; renderReviews(); }
  if (page === 'support') { state.support.page = 1; renderSupportTickets(); }
}

function applyDateFilter(page) {
  const m = dateFilterMap[page]; if (!m) return;
  const fromVal = document.getElementById(m.from)?.value;
  const toVal   = document.getElementById(m.to)?.value;
  const fromMs  = fromVal ? new Date(fromVal).setHours(0,0,0,0) : null;
  const toMs    = toVal   ? new Date(toVal).setHours(23,59,59,999) : null;

  if (dateFilterState[page]) {
    dateFilterState[page] = { fromMs, toMs };
    _callRenderForPage(page);
    return;
  }

  if (!fromMs && !toMs) return;
  document.querySelectorAll(` tr`).forEach(row => {
    const ts = parseInt(row.dataset.createdAt||'0', 10);
    row.style.display = ((!fromMs||ts>=fromMs) && (!toMs||ts<=toMs)) ? '' : 'none';
  });
}

function clearDateFilter(page) {
  const m = dateFilterMap[page]; if (!m) return;
  document.getElementById(m.from).value = '';
  document.getElementById(m.to).value   = '';

  if (dateFilterState[page]) {
    dateFilterState[page] = { fromMs: null, toMs: null };
    _callRenderForPage(page);
    return;
  }

  document.querySelectorAll(` tr`).forEach(row => { row.style.display = ''; });
}

// ════════════════════════════════════════
// HELPER: Get active tab filter
// ════════════════════════════════════════
function getActiveTab(groupId) {
  return document.querySelector(`#${groupId} .tab-btn.active`)?.dataset.filter || 'all';
}

// ════════════════════════════════════════
// BROADCAST & CLEANUP FUNCTIONS
// ════════════════════════════════════════

async function sendBroadcast() {
  const title = document.getElementById('bcTitle').value.trim();
  const content = document.getElementById('bcContent').value.trim();

  if (!title || !content) {
    showToast('error', 'Lỗi', 'Vui lòng nhập đầy đủ tiêu đề và nội dung!');
    return;
  }

  const ok = await showConfirm('Xác nhận gửi', 'Thông báo này sẽ được gửi đến TẤT CẢ người dùng. Bạn chắc chắn chứ?', 'info');
  if (!ok) return;

  const btn = document.getElementById('btnSendBroadcast');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang gửi...';

  try {
    const broadcastRef = db.collection('system_notifications').doc();
    await broadcastRef.set({
      title: title,
      content: content,
      createdAt: Date.now(),
      type: 'BROADCAST',
      sender: 'Admin'
    });

    showToast('success', 'Thành công', 'Thông báo đã được đưa vào hàng đợi gửi!');
    document.getElementById('bcTitle').value = '';
    document.getElementById('bcContent').value = '';
  } catch (e) {
    console.error(e);
    showToast('error', 'Lỗi', 'Không thể gửi thông báo: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-paper-plane"></i> Gửi ngay bây giờ';
  }
}

let inactiveUsersList = [];

async function scanInactiveUsers() {
  const days = parseInt(document.getElementById('cleanupPeriod').value);
  const threshold = Date.now() - (days * 24 * 60 * 60 * 1000);

  const resultsArea = document.getElementById('cleanupResultArea');
  const tableBody = document.getElementById('cleanupTableBody');

  tableBody.innerHTML = '<tr><td colspan="4"><div class="empty-state">Đang quét dữ liệu...</div></td></tr>';
  resultsArea.style.display = 'block';

  try {
    const snapshot = await db.collection('users')
      .where('lastLoginAt', '<', threshold)
      .get();

    inactiveUsersList = [];
    snapshot.forEach(doc => {
      inactiveUsersList.push({ id: doc.id, ...doc.data() });
    });

    document.getElementById('cleanupInfo').innerText = `Tìm thấy ${inactiveUsersList.length} tài khoản không hoạt động > ${days} ngày`;

    if (inactiveUsersList.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="4"><div class="empty-state"><i class="fas fa-check-circle"></i>Hệ thống sạch, không có tài khoản ngủ đông!</div></td></tr>';
      return;
    }

    tableBody.innerHTML = inactiveUsersList.map(u => `
      <tr>
        <td>
          <div class="td-user">
            <div class="td-avatar">${(u.fullName||'U').charAt(0)}</div>
            <div>
              <div class="td-name">${u.fullName || 'Chưa đặt tên'}</div>
              <div class="td-email">${u.email || u.phoneNumber || 'N/A'}</div>
            </div>
          </div>
        </td>
        <td><span class="badge ${u.role === 'admin' ? 'badge-admin' : 'badge-tenant'}">${u.role === 'admin' ? 'Admin' : (u.isVerified === true ? 'Đã xác minh' : 'Chưa xác minh')}</span></td>
        <td style="font-size: 12px; font-weight: 600;">${fmtDate(u.lastLoginAt)}</td>
        <td style="text-align:right">
          <button class="btn btn-delete" onclick="deleteInactiveUser('${u.id}')"><i class="fas fa-trash"></i></button>
        </td>
      </tr>
    `).join('');

  } catch (e) {
    console.error(e);
    showToast('error', 'Lỗi', 'Lỗi khi quét dữ liệu: ' + e.message);
  }
}

async function deleteInactiveUser(uid) {
  const ok = await showConfirm('Xóa người dùng', 'Hành động này không thể hoàn tác. Bạn chắc chắn chứ?', 'danger');
  if (!ok) return;

  try {
    await db.collection('users').doc(uid).delete();
    showToast('success', 'Thành công', 'Đã xóa người dùng!');
    scanInactiveUsers();
  } catch (e) {
    showToast('error', 'Lỗi', 'Không thể xóa: ' + e.message);
  }
}

async function deleteAllInactive() {
  const count = inactiveUsersList.length;
  if (count === 0) return;

  const ok = await showConfirm('XÓA TẤT CẢ', `Bạn chuẩn bị xóa ${count} tài khoản. Điều này sẽ giải phóng nhiều tài nguyên nhưng không thể khôi phục!`, 'danger');
  if (!ok) return;

  showToast('info', 'Đang xử lý', `Đang tiến hành xóa ${count} tài khoản...`, 5000);

  const batch = db.batch();
  inactiveUsersList.forEach(u => {
    batch.delete(db.collection('users').doc(u.id));
  });

  try {
    await batch.commit();
    showToast('success', 'Hoàn tất', `Đã dọn dẹp xong ${count} tài khoản.`);
    scanInactiveUsers();
  } catch (e) {
    showToast('error', 'Lỗi', 'Lỗi khi xóa hàng loạt: ' + e.message);
  }
}

// ════════════════════════════════════════
// LOCK / UNLOCK USER
// ════════════════════════════════════════
async function toggleLockUser(uid, currentlyLocked) {
  if (currentlyLocked) {
    const ok = await showConfirm('Mở khóa tài khoản', 'Bạn có chắc chắn muốn mở khóa cho tài khoản này?', 'success');
    if (!ok) return;
    try {
      await db.collection('users').doc(uid).update({
        isLocked: false,
        lockReason: '',
        lockUntil: 0
      });

      await sendNotification(
        uid,
        'Tài khoản đã được mở khóa',
        'Chào mừng bạn quay trở lại! Tài khoản của bạn đã được mở khóa và có thể sử dụng bình thường.',
        'account_unlocked'
      );

      showToast('success', 'Thành công', 'Đã mở khóa tài khoản!');
      loadUsers(getActiveTab('usersTabGroup'));
    } catch (e) { showToast('error', 'Lỗi', e.message); }
  } else {
    showModal(`
      <div class="modal-title">Khóa tài khoản người dùng</div>
      <div class="form-group" style="margin-bottom: 15px;">
        <label style="display:block; margin-bottom:5px; font-weight:bold;">Lý do khóa</label>
        <input type="text" id="lockReasonInput" class="form-input" placeholder="Ví dụ: Vi phạm nội dung, spam..." style="width:100%;">
      </div>
      <div class="form-group" style="margin-bottom: 20px;">
        <label style="display:block; margin-bottom:5px; font-weight:bold;">Thời gian khóa (Nhập 999 ngày để khóa vĩnh viễn)</label>
        <div style="display: flex; gap: 8px;">
          <div style="flex: 1;">
            <span style="font-size: 10px; color: #64748b;">Ngày</span>
            <input type="number" id="lockDaysInput" class="form-input" value="0" min="0" style="padding: 8px;">
          </div>
          <div style="flex: 1;">
            <span style="font-size: 10px; color: #64748b;">Giờ</span>
            <input type="number" id="lockHoursInput" class="form-input" value="0" min="0" max="23" style="padding: 8px;">
          </div>
          <div style="flex: 1;">
            <span style="font-size: 10px; color: #64748b;">Phút</span>
            <input type="number" id="lockMinutesInput" class="form-input" value="1" min="0" max="59" style="padding: 8px;">
          </div>
          <div style="flex: 1;">
            <span style="font-size: 10px; color: #64748b;">Giây</span>
            <input type="number" id="lockSecondsInput" class="form-input" value="0" min="0" max="59" style="padding: 8px;">
          </div>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-view" onclick="closeModal()">Hủy</button>
        <button class="btn btn-reject" onclick="processLockUser('${uid}')" style="background:#ef4444; color:white;">Xác nhận khóa</button>
      </div>
    `);
  }
}

async function processLockUser(uid) {
  const reason = document.getElementById('lockReasonInput').value.trim();
  const days = parseInt(document.getElementById('lockDaysInput').value) || 0;
  const hours = parseInt(document.getElementById('lockHoursInput').value) || 0;
  const mins = parseInt(document.getElementById('lockMinutesInput').value) || 0;
  const secs = parseInt(document.getElementById('lockSecondsInput').value) || 0;

  if (!reason) {
    showToast('warning', 'Thiếu thông tin', 'Vui lòng nhập lý do khóa');
    return;
  }

  const totalMs = (days * 24 * 60 * 60 * 1000) +
                  (hours * 60 * 60 * 1000) +
                  (mins * 60 * 1000) +
                  (secs * 1000);

  if (totalMs < 60000 && days < 999) {
    showToast('warning', 'Thời gian quá ngắn', 'Thời gian khóa tối thiểu là 1 phút để hệ thống kịp quét và gửi thông báo.');
    return;
  }

  const now = Date.now();
  let lockUntil;
  if (days >= 999) {
    lockUntil = new Date('2100-01-01').getTime();
  } else {
    lockUntil = now + totalMs;
  }

  try {
    await db.collection('users').doc(uid).update({
      isLocked: true,
      lockReason: reason,
      lockUntil: lockUntil,
      lockDays: days,
      lockHours: hours,
      lockMinutes: mins,
      lockSeconds: secs
    });

    let lockTimeText = "";
    if (days >= 999) {
      lockTimeText = "vĩnh viễn";
    } else {
      const parts = [];
      if (days > 0) parts.push(`${days} ngày`);
      if (hours > 0) parts.push(`${hours} giờ`);
      if (mins > 0) parts.push(`${mins} phút`);
      if (secs > 0) parts.push(`${secs} giây`);
      lockTimeText = parts.join(" ");
    }

    await sendNotification(
      uid,
      'Tài khoản đã bị khóa',
      `Tài khoản của bạn đã bị Admin đóng trong ${lockTimeText}. Lý do: ${reason}. Mở khóa lúc: ${fmtDateTime(lockUntil)}`,
      'account_locked'
    );

    showToast('warning', 'Đã khóa', `Đã khóa tài khoản ${lockTimeText}`);
    closeModal();
    loadUsers(getActiveTab('usersTabGroup'));
  } catch (e) {
    showToast('error', 'Lỗi', e.message);
  }
}

// === VERIFICATION_PATCH_V2_2026 ===
function isVerificationPendingLike(status) {
  const s = String(status || '').trim().toLowerCase();
  return s === 'pending' || s === 'pending_admin_review' || s === 'queued_manual';
}

function shouldShowInAdminVerificationQueue(data) {
  const status = String(data?.status || '').trim().toLowerCase();
  if (!isVerificationPendingLike(status)) return false;
  return data?.escalatedToAdmin === true || status === 'pending_admin_review' || status === 'queued_manual';
}

function getAutoCheckStatusLabel(status) {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'pass') return 'Auto-check: Đạt';
  if (s === 'failed_escalated') return 'Auto-check: Lỗi > 3 lần (đã đẩy admin)';
  if (s === 'review' || s === 'need_review') return 'Auto-check: Cần xem thủ công';
  if (s === 'fail') return 'Auto-check: Không đạt';
  return 'Auto-check: Chưa có';
}

function compareVerificationPriority(a, b) {
  const aEscalated = a?.escalatedToAdmin === true ? 1 : 0;
  const bEscalated = b?.escalatedToAdmin === true ? 1 : 0;
  if (aEscalated !== bEscalated) return bEscalated - aEscalated;

  const aDeadline = toEpochMs(a?.escalationDeadlineAt);
  const bDeadline = toEpochMs(b?.escalationDeadlineAt);
  if (aEscalated && bEscalated && aDeadline !== bDeadline) return aDeadline - bDeadline;

  return toEpochMs(b?.createdAt) - toEpochMs(a?.createdAt);
}

async function loadVerifications() {
  const tbody = document.getElementById('verifyTableBody');
  tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state">Đang tải...</div></td></tr>';
  try {
    const snap = await db.collection('verifications').orderBy('createdAt', 'desc').get();
    const docs = snap.docs
      .filter(doc => shouldShowInAdminVerificationQueue(doc.data()))
      .sort((a, b) => compareVerificationPriority(a.data(), b.data()));

    if (docs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><i class="fas fa-check-circle"></i>Không có yêu cầu xác minh nào</div></td></tr>';
      return;
    }

    tbody.innerHTML = docs.map(doc => {
      const d = doc.data();
      const uid = d.userId || doc.id;
      const escalated = d.escalatedToAdmin === true;
      const deadlineMs = toEpochMs(d.escalationDeadlineAt);
      const overdue = escalated && deadlineMs > 0 && deadlineMs < Date.now();
      const autoText = getAutoCheckStatusLabel(d.autoCheckStatus);
      const statusHtml = escalated
        ? `<span class="badge ${overdue ? 'badge-rejected' : 'badge-approved'}">${overdue ? 'Quá hạn 24h' : 'Ưu tiên 24h'}</span>`
        : '<span class="badge badge-pending">Chờ duyệt</span>';

      return `<tr data-created-at="${toEpochMs(d.createdAt)}">
        <td>
          <div class="td-user">
            <div class="td-avatar">${(d.fullName||'U').charAt(0).toUpperCase()}</div>
            <div><div class="td-name">${d.fullName||'N/A'}</div></div>
          </div>
        </td>
        <td><span style="font-size:13px;font-weight:600">${d.cccdNumber||'N/A'}</span></td>
        <td><span style="font-size:13px;font-weight:600;color:#64748b">${d.phone || d.phoneNumber || 'N/A'}</span></td>
        <td><span style="font-size:12px;color:#94a3b8;font-weight:600">${fmtDate(d.createdAt)}</span></td>
        <td>
          ${statusHtml}
          <div style="margin-top:6px;font-size:11px;color:#64748b;font-weight:600">${autoText}</div>
          ${escalated && deadlineMs > 0 ? `<div style="margin-top:4px;font-size:11px;color:${overdue ? '#dc2626' : '#0f766e'};font-weight:700">Deadline: ${fmtDateTime(deadlineMs)}</div>` : ''}
        </td>
        <td style="text-align:right">
          <div class="list-actions">
            <button class="btn btn-view" onclick="viewVerification('${doc.id}')">Xem</button>
            <button class="btn btn-approve" onclick="approveVerification('${doc.id}','${uid}')">Duyệt</button>
            <button class="btn btn-reject" onclick="rejectVerification('${doc.id}','${uid}')">Từ chối</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state">Lỗi tải dữ liệu</div></td></tr>';
    console.error(e);
  }
}

async function viewVerification(docId) {
  try {
    const doc = await db.collection('verifications').doc(docId).get();
    if (!doc.exists) { showToast('error', 'Lỗi', 'Yêu cầu không tồn tại'); return; }
    const d = doc.data();
    const uid = d.userId || docId;
    const autoStatus = getAutoCheckStatusLabel(d.autoCheckStatus);
    const autoReason = d.autoCheckReason || 'Không có';
    const ocrValue = d.autoCheckRecognizedCccd || 'Không đọc được';
    const failCount = Number(d.autoFailCountToday || 0);
    const escalated = d.escalatedToAdmin === true;
    const deadlineLabel = escalated ? fmtDateTime(d.escalationDeadlineAt) : 'N/A';
    const imageSourceLabel = d.imageSource === 'camera_only' ? 'Chụp trực tiếp' : (d.imageSource || 'N/A');

    showModal(`
      <div class="modal-title">Chi tiết yêu cầu xác minh tài khoản</div>
      <div class="detail-row"><div class="detail-label">Họ tên</div><div class="detail-value">${escapeHtml(d.fullName||'N/A')}</div></div>
      <div class="detail-row"><div class="detail-label">Email</div><div class="detail-value">${escapeHtml(d.email||'N/A')}</div></div>
      <div class="detail-row"><div class="detail-label">Số CCCD</div><div class="detail-value">${escapeHtml(d.cccdNumber||'N/A')}</div></div>
      <div class="detail-row"><div class="detail-label">SĐT</div><div class="detail-value">${escapeHtml(d.phone || d.phoneNumber || 'N/A')}</div></div>
      <div class="detail-row"><div class="detail-label">Địa chỉ</div><div class="detail-value">${escapeHtml(d.address||'N/A')}</div></div>
      <div class="detail-row"><div class="detail-label">Nguồn ảnh</div><div class="detail-value">${escapeHtml(imageSourceLabel)}</div></div>
      <div class="detail-row"><div class="detail-label">Auto-check</div><div class="detail-value">${escapeHtml(autoStatus)}</div></div>
      <div class="detail-row"><div class="detail-label">CCCD OCR</div><div class="detail-value">${escapeHtml(ocrValue)}</div></div>
      <div class="detail-row"><div class="detail-label">Lý do auto-check</div><div class="detail-value">${escapeHtml(autoReason)}</div></div>
      <div class="detail-row"><div class="detail-label">Số lần lỗi hôm nay</div><div class="detail-value">${escapeHtml(String(failCount))}</div></div>
      <div class="detail-row"><div class="detail-label">Đã đẩy admin</div><div class="detail-value">${escalated ? 'Có' : 'Không'}</div></div>
      <div class="detail-row"><div class="detail-label">Deadline xử lý</div><div class="detail-value">${escapeHtml(deadlineLabel)}</div></div>
      <div class="detail-row"><div class="detail-label">CCCD mặt trước</div><div class="detail-value">${d.cccdFrontUrl?`<img src="${safeUrl(d.cccdFrontUrl)}" class="cccd-img" onclick="showFullscreenImage('${safeForJsGlobal(safeUrl(d.cccdFrontUrl))}')">`:'Chưa có'}</div></div>
      <div class="detail-row"><div class="detail-label">CCCD mặt sau</div><div class="detail-value">${d.cccdBackUrl?`<img src="${safeUrl(d.cccdBackUrl)}" class="cccd-img" onclick="showFullscreenImage('${safeForJsGlobal(safeUrl(d.cccdBackUrl))}')">`:'Chưa có'}</div></div>
      <div class="modal-actions">
        <button class="btn btn-view" onclick="closeModal()">Đóng</button>
        <button class="btn btn-approve" onclick="approveVerification('${docId}','${uid}');closeModal()">Cấp quyền đăng bài</button>
        <button class="btn btn-reject" onclick="rejectVerification('${docId}','${uid}');closeModal()">Từ chối</button>
      </div>`);
  } catch (e) { showToast('error', 'Lỗi', e.message); }
}

async function approveVerification(docId, userId) {
  const ok = await showConfirm('Cấp quyền đăng bài', 'Xác nhận cấp quyền đăng bài cho tài khoản này?', 'success');
  if (!ok) return;
  try {
    const now = Date.now();
    const reviewerId = auth.currentUser?.uid || 'admin_web';
    const verificationRef = db.collection('verifications').doc(docId);
    const userRef = db.collection('users').doc(userId);

    const verificationSnap = await verificationRef.get();
    if (!verificationSnap.exists) {
      showToast('error', 'Lỗi', 'Yêu cầu xác minh không tồn tại.');
      return;
    }

    const verificationData = verificationSnap.data() || {};
    const status = String(verificationData.status || '').trim().toLowerCase();
    const escalated = verificationData.escalatedToAdmin === true
      || status === 'pending_admin_review'
      || status === 'queued_manual'
      || Number(verificationData.autoFailCountToday || 0) >= 4;

    const postingUnlockAt = 0;

    const batch = db.batch();
    batch.update(verificationRef, {
      status: 'approved',
      reviewedAt: now,
      reviewedBy: reviewerId,
      approvedByAdminAt: now,
      postingUnlockAt,
      escalatedToAdmin: escalated,
      escalationDeadlineAt: 0,
      rejectReason: '',
      autoCheckStatus: escalated ? 'approved_by_admin_after_manual_review' : 'approved_by_admin'
    });
    batch.update(userRef, {
      isVerified: true,
      role: 'user',
      verifiedAt: now,
      postingUnlockAt
    });
    await batch.commit();

    await sendNotification(
      userId,
      'Xác minh thành công!',
      'Tài khoản của bạn đã được xác minh. Bạn có thể đăng tin cho thuê ngay!',
      'verification_approved'
    );
    showToast('success', 'Thành công', 'Đã cấp quyền đăng bài cho tài khoản!');

    loadVerifications();
  } catch (e) {
    showToast('error', 'Lỗi', e.message);
  }
}
async function rejectVerification(docId, userId) {
  const reason = await showPrompt('Từ chối xác minh', 'Nhập lý do từ chối:', 'Lý do từ chối...');
  if (reason === null) return;
  if (!reason || reason.length < 5) { showToast('warning', 'Cảnh báo', 'Lý do phải ít nhất 5 ký tự'); return; }
  try {
    const now = Date.now();
    const reviewerId = auth.currentUser?.uid || 'admin_web';
    const batch = db.batch();
    batch.update(db.collection('verifications').doc(docId), {
      status: 'rejected',
      rejectReason: reason,
      escalatedToAdmin: false,
      escalationDeadlineAt: 0,
      reviewedAt: now,
      reviewedBy: reviewerId
    });
    await batch.commit();
    await sendNotification(userId, 'Xác minh bị từ chối', 'Yêu cầu xác minh của bạn bị từ chối. Lý do: ' + reason, 'verification_rejected');
    showToast('warning', 'Đã từ chối', 'Yêu cầu xác minh đã bị từ chối.');
    loadVerifications();
  } catch (e) { showToast('error', 'Lỗi', e.message); }
}
// === END_VERIFICATION_PATCH_V2_2026 ===
