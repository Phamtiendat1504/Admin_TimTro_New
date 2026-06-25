// ════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════
const fmt = (n) => new Intl.NumberFormat('vi-VN').format(n);
const toEpochMs = (value) => {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const fmtDate = (ts) => {
  const ms = toEpochMs(ts);
  return ms ? new Date(ms).toLocaleDateString('vi-VN') : 'N/A';
};
const fmtDateTime = (ts) => {
  const ms = toEpochMs(ts);
  return ms ? new Date(ms).toLocaleString('vi-VN') : 'N/A';
};
const statusText = (status) =>
  ({
    waiting_for_payment: 'Chờ thanh toán',
    paid: 'Đã thanh toán',
    paid_waiting_admin: 'Chờ admin duyệt',
    approved: 'Đã duyệt',
    rejected: 'Từ chối',
    expired: 'Hết hạn',
    cancelled: 'Đã hủy',
    failed: 'Lỗi',
  })[status] ||
  status ||
  'N/A';
const paymentStatusText = (status, type = '') =>
  type === 'featured' && status === 'paid' ? 'Đã thanh toán, chờ admin duyệt' : statusText(status);
const paymentStatusBadge = (status, type = '') => {
  if (status === 'approved') return 'badge-approved';
  if (status === 'paid') return type === 'featured' ? 'badge-pending' : 'badge-approved';
  if (status === 'paid_waiting_admin') return 'badge-pending';
  if (['rejected', 'expired', 'cancelled', 'failed'].includes(status)) return 'badge-rejected';
  return 'badge-pending';
};
const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function stopAllListeners() {
  activeListeners.forEach((u) => u());
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
  return new Promise((resolve) => {
    const splash = document.getElementById('entrySplash');
    if (!splash) {
      resolve();
      return;
    }

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
  const icons = {
    success: 'fa-check-circle',
    error: 'fa-times-circle',
    warning: 'fa-exclamation-circle',
    info: 'fa-info-circle',
  };
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.style.setProperty('--dur', duration + 'ms');
  t.innerHTML = `
    <div class="toast-icon"><i class="fas ${icons[type] || icons.info}"></i></div>
    <div class="toast-body"><div class="toast-title">${safeTitle}</div><div class="toast-msg">${safeMessage}</div></div>
    <button class="toast-close" onclick="this.closest('.toast').classList.add('toast-out');setTimeout(()=>this.closest('.toast').remove(),300)"><i class="fas fa-times"></i></button>
    <div class="toast-bar"></div>
  `;
  document.getElementById('toastContainer').appendChild(t);
  setTimeout(() => {
    if (t.parentNode) {
      t.classList.add('toast-out');
      setTimeout(() => t.remove(), 300);
    }
  }, duration);
}

// ════════════════════════════════════════
// CONFIRM
// ════════════════════════════════════════
function showConfirm(title, message, type = 'warn') {
  return new Promise((resolve) => {
    const iconMap = {
      danger: 'fa-trash-alt',
      success: 'fa-check-circle',
      info: 'fa-info-circle',
      warn: 'fa-exclamation-triangle',
    };
    const btnClass = {
      danger: 'btn-confirm-danger',
      success: 'btn-confirm-success',
      warn: 'btn-confirm-ok',
      info: 'btn-confirm-ok',
    };
    const safeTitle = escapeHtml(title);
    const safeMessage = escapeHtml(message);
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-icon-wrap ${type}"><i class="fas ${iconMap[type] || iconMap.warn}"></i></div>
        <div class="confirm-title">${safeTitle}</div>
        <div class="confirm-message">${safeMessage}</div>
        <div class="confirm-actions">
          <button class="btn btn-confirm-cancel" id="cfCancel">Hủy</button>
          <button class="btn ${btnClass[type] || 'btn-confirm-ok'}" id="cfOk">Xác nhận</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#cfOk').onclick = () => {
      overlay.remove();
      resolve(true);
    };
    overlay.querySelector('#cfCancel').onclick = () => {
      overlay.remove();
      resolve(false);
    };
  });
}

// ════════════════════════════════════════
// PROMPT
// ════════════════════════════════════════
function showPrompt(title, message, placeholder = '') {
  return new Promise((resolve) => {
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
    overlay.querySelector('#pfOk').onclick = () => {
      overlay.remove();
      resolve(inp.value.trim() || null);
    };
    overlay.querySelector('#pfCancel').onclick = () => {
      overlay.remove();
      resolve(null);
    };
    inp.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') overlay.querySelector('#pfOk').click();
    });
  });
}

// ════════════════════════════════════════
// MODAL
// ════════════════════════════════════════
// CAUTION: html param must have all user-supplied values escaped with escapeHtml()
// before being passed here — this function uses innerHTML and will render raw HTML.
function showModal(html) {
  const m = document.createElement('div');
  m.className = 'modal-overlay';
  m.innerHTML = `<div class="modal-box">${html}</div>`;
  const box = m.querySelector('.modal-box');
  if (html.includes('data-modal-size="post"')) {
    box?.classList.remove('modal-box');
    box?.classList.add('post-modal-box');
  } else if (html.includes('data-modal-size="user"')) {
    box?.classList.remove('modal-box');
    box?.classList.add('user-modal-box');
  }
  m.addEventListener('click', (e) => {
    if (e.target === m) m.remove();
  });
  document.body.appendChild(m);
}
function closeModal() {
  document.querySelector('.modal-overlay')?.remove();
}

function safeUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw, window.location.origin);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch (_) {
    /* URL không hợp lệ → trả về '' */
  }
  return '';
}

function safeForJsGlobal(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

window.showFullscreenImage = function (url) {
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
  return db
    .collection('notifications')
    .add({
      ...extra,
      userId,
      title,
      message,
      type,
      seen: false,
      isRead: false,
      createdAt: Date.now(),
    })
    .catch((e) => console.error('[Helpers] Notification failed:', e));
}

// ?? ADMIN BELL DROPDOWN ??
let adminNotifUnsubscribe = null;

// --- NOTIFICATIONS SYSTEM REMOVED ---
// Web Admin does not need to receive notifications anymore.

// Đóng / Mở dropdown thông báo quản trị
window.toggleAdminNotif = function (e) {
  if (e) e.stopPropagation();
  const dropdown = document.getElementById('adminNotifDropdown');
  if (dropdown) dropdown.classList.toggle('open');
};

// Đóng dropdown khi click ra ngoài
document.addEventListener('click', (e) => {
  const dropdownNotif = document.getElementById('adminNotifDropdown');
  const btnBell = document.getElementById('btnNotifBell');
  if (
    dropdownNotif &&
    btnBell &&
    !dropdownNotif.contains(e.target) &&
    !btnBell.contains(e.target)
  ) {
    dropdownNotif.classList.remove('open');
  }
});
