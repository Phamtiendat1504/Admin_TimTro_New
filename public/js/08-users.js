// ════════════════════════════════════════
// USERS
// ════════════════════════════════════════
function getRemainingLockTime(lockUntil) {
  if (!lockUntil) return '';
  const now = Date.now();
  const diff = lockUntil - now;
  if (diff <= 0) return 'Sắp mở khóa...';

  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
  const seconds = Math.floor((diff % (60 * 1000)) / 1000);

  if (days > 365) return 'Vĩnh viễn';

  if (days === 0 && hours === 0) {
    if (minutes === 0) return `Còn ${seconds}s`;
    return `Còn ${minutes}p ${seconds}s`;
  }

  let res = 'Còn ';
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
    const lockUntilMs = d.lockUntil
      ? d.lockUntil.toMillis
        ? d.lockUntil.toMillis()
        : Number(d.lockUntil)
      : 0;
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
  // Heartbeat Android cập nhật mỗi 60 giây → đặt ngưỡng 3 phút để tránh nhấp nháy Online/Offline
  const ONLINE_STALE_TIMEOUT_MS = 3 * 60 * 1000;
  const consideredOnline =
    isOnline && (!lastSeenMs || Date.now() - lastSeenMs <= ONLINE_STALE_TIMEOUT_MS);

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
      <div class="offline-elapsed" data-lastseen="${lastSeenMs || 0}" style="font-size:10.5px;color:#0f172a;font-weight:700;margin-top:2px">Offline: ${elapsedText}</div>
    </div>`;
}

async function checkAndUnlockExpiredUsers() {
  const now = Date.now();
  try {
    const lockedSnap = await db.collection('users').where('isLocked', '==', true).limit(100).get();

    if (!lockedSnap.empty) {
      const expiredDocs = lockedSnap.docs.filter((doc) => {
        const d = doc.data();
        const lockUntil = d.lockUntil
          ? d.lockUntil.toMillis
            ? d.lockUntil.toMillis()
            : Number(d.lockUntil)
          : 0;
        return lockUntil > 0 && lockUntil <= now;
      });

      if (expiredDocs.length > 0) {
        const batch = db.batch();
        expiredDocs.forEach((doc) => {
          batch.update(doc.ref, {
            isLocked: false,
            lockReason: '',
            lockUntil: 0,
            unlockedAt: now,
            unlockedBy: 'system',
          });
        });
        await batch.commit();
        expiredDocs.forEach((doc) =>
          sendNotification(
            doc.id,
            'Tài khoản đã được mở khóa',
            'Chào mừng bạn quay trở lại! Thời gian tạm khóa đã hết, bạn có thể đăng nhập ngay bây giờ.',
            'account_unlocked'
          )
        );
        // Đã tự động mở khóa tài khoản hết hạn phạt
        if (document.getElementById('pageUsers').classList.contains('active')) {
          loadUsers(getActiveTab('usersTabGroup'));
        }
      }
    }
  } catch (e) {
    console.error('[Users] Lỗi quét tự động mở khóa:', e);
  }
}

// ════════════════════════════════════════
// USERS — Dual-mode pagination
// Cursor mode : filter='all', không có search → startAfter, PAGE_SIZE/lần
// Search mode : có search hoặc filter role đặc biệt → load MAX_SEARCH_DOCS, client-side
// ════════════════════════════════════════
async function loadUsers(filter) {
  const tbody = document.getElementById('usersTableBody');
  selectedUserIds.clear();
  tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state">Đang tải...</div></td></tr>';

  const isSearchMode = !!(
    usersSearchKeyword ||
    dateFilterState.users.fromMs ||
    dateFilterState.users.toMs
  );
  // Chỉ dùng cursor mode khi: filter='all' và không có search
  const canUseCursor = !isSearchMode && filter === 'all';

  // Reset cursor khi filter hoặc mode thay đổi
  if (cursorMode.users.filter !== filter || cursorMode.users.active !== canUseCursor) {
    cursorMode.users.pageStarts = [null];
    cursorMode.users.currentPage = 0;
    cursorMode.users.hasMore = false;
    cursorMode.users.filter = filter;
  }

  try {
    if (canUseCursor) {
      // === Cursor mode (chỉ cho filter='all') ===
      cursorMode.users.active = true;
      const cursor = cursorMode.users.pageStarts[cursorMode.users.currentPage];
      let q = db
        .collection('users')
        .orderBy('createdAt', 'desc')
        .limit(PAGE_SIZE + 1);
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.get();
      cursorMode.users.hasMore = snap.docs.length > PAGE_SIZE;
      const docs = snap.docs.slice(0, PAGE_SIZE);
      // Ghim Admin lên đầu trong trang hiện tại
      const admins = docs.filter((d) => d.data().role === 'admin');
      const nonAdmins = docs.filter((d) => d.data().role !== 'admin');
      state.users.docs = [...admins, ...nonAdmins];
    } else {
      // === Search/filter mode: load MAX_SEARCH_DOCS, xử lý client-side ===
      cursorMode.users.active = false;
      const snap = await db
        .collection('users')
        .orderBy('createdAt', 'desc')
        .limit(MAX_SEARCH_DOCS)
        .get();
      let docs = snap.docs;

      if (filter === 'user') {
        docs = docs.filter((d) => d.data().role !== 'admin' && d.data().isVerified !== true);
      } else if (filter === 'verified') {
        docs = docs.filter((d) => d.data().isVerified === true && d.data().role !== 'admin');
      } else if (filter === 'admin') {
        docs = docs.filter((d) => d.data().role === 'admin');
      }

      const sorted = sortDocs(docs, state.users.sort);
      if (filter === 'all') {
        const admins = sorted.filter((d) => d.data().role === 'admin');
        const nonAdmins = sorted.filter((d) => d.data().role !== 'admin');
        state.users.docs = [...admins, ...nonAdmins];
      } else {
        state.users.docs = sorted;
      }
    }

    state.users.page = 1;
    renderUsers();
  } catch (e) {
    tbody.innerHTML =
      '<tr><td colspan="8"><div class="empty-state">Lỗi tải dữ liệu</div></td></tr>';
    console.error('[Users] loadUsers lỗi:', e);
  }
}

// Nâng trang tiếp — cursor mode users
window.goUsersCursorNext = async function () {
  if (!cursorMode.users.hasMore) return;
  const lastDoc = state.users.docs[state.users.docs.length - 1];
  if (!lastDoc) return;
  const nextPage = cursorMode.users.currentPage + 1;
  if (cursorMode.users.pageStarts.length <= nextPage) {
    cursorMode.users.pageStarts.push(lastDoc);
  }
  cursorMode.users.currentPage = nextPage;
  await loadUsers(cursorMode.users.filter);
};

// Quay về trang trước — cursor mode users
window.goUsersCursorPrev = async function () {
  if (cursorMode.users.currentPage <= 0) return;
  cursorMode.users.currentPage--;
  await loadUsers(cursorMode.users.filter);
};

// Từ khóa tìm kiếm hiện tại cho users

function getFilteredUsersDocs() {
  let all = state.users.docs;
  if (usersSearchKeyword) {
    const kw = usersSearchKeyword;
    all = all.filter((doc) => {
      const d = doc.data();
      const haystack = normalizeVietnameseText(
        [d.fullName || '', d.email || '', d.phone || '', d.phoneNumber || ''].join(' ')
      );
      return haystack.includes(kw);
    });
  }
  return all.filter((doc) => isInDateRange(doc.data().createdAt, dateFilterState.users));
}

function updateUsersSelectAllState(pageDocs) {
  const selectAll = document.getElementById('usersSelectAll');
  if (!selectAll) return;
  const selectable = (pageDocs || []).filter((doc) => doc.data().role !== 'admin');
  if (selectable.length === 0) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    return;
  }
  const selectedCount = selectable.filter((doc) => selectedUserIds.has(doc.id)).length;
  selectAll.checked = selectedCount === selectable.length;
  selectAll.indeterminate = selectedCount > 0 && selectedCount < selectable.length;
}

function renderUsers() {
  const tbody = document.getElementById('usersTableBody');
  const all = getFilteredUsersDocs();

  const total = all.length;
  if (total === 0) {
    tbody.innerHTML =
      '<tr><td colspan="8"><div class="empty-state"><i class="fas fa-users"></i>Không có người dùng nào</div></td></tr>';
    renderResultInfo('usersResultInfo', 1, 0);
    document.getElementById('usersPagination').innerHTML = '';
    updateUsersSelectAllState([]);
    return;
  }
  renderResultInfo('usersResultInfo', state.users.page, total);
  renderPagination('usersPagination', 'users', total);
  const page = all.slice((state.users.page - 1) * PAGE_SIZE, state.users.page * PAGE_SIZE);
  updateUsersSelectAllState(page);
  tbody.innerHTML = page
    .map((doc) => {
      const d = doc.data();
      const rl = d.role === 'admin' ? 'Admin' : 'User';
      const rc = d.role === 'admin' ? 'badge-admin' : 'badge-tenant';
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
          <div class="td-avatar">${escapeHtml((d.fullName || 'U').charAt(0).toUpperCase())}</div>
          <div>
            <div class="td-name">${escapeHtml(d.fullName || 'N/A')}</div>
          </div>
        </div>
      </td>
      <td>
        <div class="td-name" style="font-size:13px">${escapeHtml(d.email || 'N/A')}</div>
        <div class="td-email">${escapeHtml(d.phone || d.phoneNumber || 'N/A')}</div>
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
          ${
            d.role !== 'admin'
              ? `
            <button class="btn ${d.isLocked ? 'btn-approve' : 'btn-reject'}"
                    style="${!d.isLocked ? 'background:#f59e0b;border-color:#f59e0b;' : ''}"
                    onclick="toggleLockUser('${doc.id}', ${d.isLocked || false})"
                    title="${d.isLocked ? 'Mở khóa' : 'Khóa tài khoản'}">
              ${d.isLocked ? '<i class="fas fa-unlock"></i> Mở' : '<i class="fas fa-user-lock"></i> Khóa'}
            </button>
            <button class="btn btn-delete" onclick="deleteUser('${doc.id}')" title="Xóa tài khoản">
              <i class="fas fa-trash"></i> Xóa
            </button>
          `
              : ''
          }
        </div>
      </td>
    </tr>`;
    })
    .join('');

  // Khởi động live countdown sau khi render xong
  startLockCountdowns();
  startOfflineElapsedTimers();
  updateUsersSelectAllState(page);
}

// ── Live countdown timer cho tài khoản bị khóa ──
let _lockCountdownInterval = null;
function startLockCountdowns() {
  if (_lockCountdownInterval) clearInterval(_lockCountdownInterval);

  function tick() {
    const now = Date.now();
    document.querySelectorAll('.lock-countdown').forEach((el) => {
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
      const days = Math.floor(totalSec / 86400);
      const hours = Math.floor((totalSec % 86400) / 3600);
      const mins = Math.floor((totalSec % 3600) / 60);
      const secs = totalSec % 60;

      let text = '';
      if (days > 0) text += `${days}n `;
      if (hours > 0) text += `${hours}g `;
      if (mins > 0) text += `${mins}p `;
      text += `${secs}s`;

      el.querySelector('span').textContent = `Còn ${text}`;
    });
  }

  tick();
  _lockCountdownInterval = setInterval(tick, 1000);
  activeListeners.push(() => {
    clearInterval(_lockCountdownInterval);
    _lockCountdownInterval = null;
  });
}

let _offlineElapsedInterval = null;
function startOfflineElapsedTimers() {
  if (_offlineElapsedInterval) clearInterval(_offlineElapsedInterval);

  function tick() {
    document.querySelectorAll('.offline-elapsed').forEach((el) => {
      const lastSeenMs = Number(el.dataset.lastseen);
      if (!lastSeenMs) return;

      const diffMs = Math.max(0, Date.now() - lastSeenMs);
      const totalSec = Math.floor(diffMs / 1000);
      const days = Math.floor(totalSec / 86400);
      const hours = Math.floor((totalSec % 86400) / 3600);
      const mins = Math.floor((totalSec % 3600) / 60);
      const secs = totalSec % 60;

      el.textContent = `Offline: ${days} ngày ${hours} giờ ${mins} phút ${secs} giây`;
    });
  }

  tick();
  _offlineElapsedInterval = setInterval(tick, 1000);
  activeListeners.push(() => {
    clearInterval(_offlineElapsedInterval);
    _offlineElapsedInterval = null;
  });
}

async function viewUser(docId) {
  try {
    const [doc, vDoc] = await Promise.all([
      db.collection('users').doc(docId).get(),
      db.collection('verifications').doc(docId).get(),
    ]);
    if (!doc.exists) {
      showToast('error', 'Lỗi', 'Người dùng không tồn tại');
      return;
    }
    const d = doc.data();
    const isAdmin = d.role === 'admin';

    // ── Header badges ──────────────────────────────────────────
    const roleBadge = isAdmin
      ? `<span class="badge badge-admin"><i class="fas fa-shield-alt" style="margin-right:3px"></i>Admin</span>`
      : `<span class="badge badge-tenant">User</span>`;
    const verifyBadge = d.isVerified
      ? `<span class="badge badge-approved"><i class="fas fa-check-circle" style="margin-right:3px"></i>Đã xác minh</span>`
      : `<span class="badge badge-warning">Chưa xác minh</span>`;
    const lockBadge = d.isLocked
      ? `<span class="badge badge-rejected"><i class="fas fa-lock" style="margin-right:3px"></i>Đã khóa</span>`
      : `<span class="badge" style="background:#ecfdf5;color:#10b981;border:1px solid #a7f3d0"><i class="fas fa-check-circle" style="margin-right:3px"></i>Hoạt động</span>`;

    // ── Helpers ────────────────────────────────────────────────
    const row = (label, value, style = '') =>
      value !== null && value !== undefined && value !== '' && value !== 'N/A'
        ? `<div class="um-row"><span class="um-label">${label}</span><span class="um-value"${style ? ` style="${style}"` : ''}>${value}</span></div>`
        : '';

    // ── Timestamps ─────────────────────────────────────────────
    const lockUntilMs = toEpochMs(d.lockUntil);
    const verifiedAtMs = toEpochMs(d.verifiedAt);
    const lastLoginMs = toEpochMs(d.lastLogin);
    const postUnlockMs = toEpochMs(d.postingUnlockAt);
    const createdAtMs = toEpochMs(d.createdAt);

    // ── Col 1: Thông tin cơ bản ────────────────────────────────
    const col1 = `
      <div class="um-section">
        <div class="um-section-title">Thông tin cơ bản</div>
        ${row('Họ tên', escapeHtml(d.fullName || 'N/A'))}
        ${row('Email', escapeHtml(d.email || 'N/A'))}
        ${row('SĐT', escapeHtml(d.phone || d.phoneNumber || 'N/A'))}
        ${row('Giới tính', escapeHtml(d.gender || ''))}
        ${row('Ngày sinh', escapeHtml(d.birthday || ''))}
        ${row('Địa chỉ', escapeHtml(d.address || ''))}
        ${d.bio ? row('Giới thiệu', escapeHtml(d.bio)) : ''}
        <div class="um-row"><span class="um-label">UID</span><span class="um-value"><span class="um-uid">${escapeHtml(docId)}</span></span></div>
        ${createdAtMs ? row('Ngày tạo TK', fmtDateTime(createdAtMs)) : ''}
      </div>`;

    // ── Col 2: Tài khoản & Trạng thái ─────────────────────────
    const lockUntilText =
      lockUntilMs > 0
        ? lockUntilMs > new Date('2090-01-01').getTime()
          ? 'Vĩnh viễn'
          : fmtDateTime(lockUntilMs)
        : 'N/A';
    const col2 = `
      <div class="um-section">
        <div class="um-section-title">Tài khoản & Trạng thái</div>
        <div class="um-row"><span class="um-label">Trạng thái</span><span class="um-value">
          ${
            d.isLocked
              ? `<span style="color:#ef4444;font-weight:800">Đã khóa</span>`
              : `<span style="color:#10b981;font-weight:700">Hoạt động</span>`
          }
        </span></div>
        ${d.isLocked ? row('Lý do khóa', escapeHtml(d.lockReason || 'Không có'), 'color:#ef4444') : ''}
        ${d.isLocked && lockUntilMs > 0 ? row('Khóa đến', lockUntilText, 'color:#ef4444') : ''}
        <div class="um-row"><span class="um-label">Xác minh</span><span class="um-value">
          ${
            d.isVerified
              ? `<span style="color:#10b981;font-weight:700"><i class="fas fa-check-circle" style="margin-right:3px"></i>Đã xác minh</span>`
              : `<span style="color:#94a3b8">Chưa xác minh</span>`
          }
        </span></div>
        ${verifiedAtMs > 0 ? row('Ngày xác minh', fmtDateTime(verifiedAtMs)) : ''}
        ${row('Slot mua thêm', `<b>${d.purchasedSlots || 0}</b> lượt`)}
        ${row('Bài đăng hôm nay', `${d.dailyPostCount || 0}/3 lượt miễn phí (${escapeHtml(d.dailyPostCountDate || 'Chưa đăng ngày nào')})`)}

        ${postUnlockMs > 0 && postUnlockMs > Date.now() ? row('Mở đăng bài lúc', fmtDateTime(postUnlockMs), 'color:#f59e0b;font-weight:700') : ''}
        ${lastLoginMs > 0 ? row('Đăng nhập cuối', fmtDateTime(lastLoginMs)) : ''}
        ${d.lastDevice ? row('Thiết bị', escapeHtml(d.lastDevice)) : ''}
        ${d.lastOsVersion ? row('Phiên bản OS', escapeHtml(d.lastOsVersion)) : ''}
      </div>`;

    // ── Verification section ───────────────────────────────────
    let verifySection = '';
    if (vDoc.exists) {
      const v = vDoc.data();
      const vStatusMap = {
        approved: '<span class="badge badge-approved">Đã duyệt</span>',
        rejected: '<span class="badge badge-rejected">Từ chối</span>',
        pending: '<span class="badge badge-pending">Chờ duyệt</span>',
        pending_admin_review: '<span class="badge badge-warning">Đang xét duyệt</span>',
        queued_manual: '<span class="badge badge-warning">Chờ xét thủ công</span>',
      };
      const vStatus =
        vStatusMap[v.status] ||
        `<span class="badge badge-pending">${escapeHtml(v.status || '')}</span>`;
      const cccdImgs =
        v.cccdFrontUrl || v.cccdBackUrl
          ? `
        <div class="um-cccd-grid">
          ${
            v.cccdFrontUrl
              ? `<div>
                <div style="font-size:10px;font-weight:700;color:var(--text-muted);margin-bottom:5px;text-transform:uppercase">Mặt trước</div>
                <img src="${escapeHtml(safeUrl(v.cccdFrontUrl))}" class="um-cccd-img"
                     onclick="showFullscreenImage('${safeForJsGlobal(safeUrl(v.cccdFrontUrl))}')" alt="CCCD mặt trước">
               </div>`
              : '<div></div>'
          }
          ${
            v.cccdBackUrl
              ? `<div>
                <div style="font-size:10px;font-weight:700;color:var(--text-muted);margin-bottom:5px;text-transform:uppercase">Mặt sau</div>
                <img src="${escapeHtml(safeUrl(v.cccdBackUrl))}" class="um-cccd-img"
                     onclick="showFullscreenImage('${safeForJsGlobal(safeUrl(v.cccdBackUrl))}')" alt="CCCD mặt sau">
               </div>`
              : ''
          }
        </div>`
          : '';
      verifySection = `
        <div class="um-section full">
          <div class="um-section-title">Xác minh danh tính</div>
          ${row('Số CCCD', escapeHtml(v.cccdNumber || 'N/A'))}
          ${row('Địa chỉ TT', escapeHtml(v.address || ''))}
          <div class="um-row"><span class="um-label">Trạng thái XM</span><span class="um-value">${vStatus}</span></div>
          ${v.rejectReason ? row('Lý do từ chối', escapeHtml(v.rejectReason), 'color:#ef4444') : ''}
          ${cccdImgs}
        </div>`;
    }

    // ── Action buttons ─────────────────────────────────────────
    const actions = !isAdmin
      ? `
      <button class="btn btn-delete" onclick="closeModal();deleteUser('${docId}')">
        <i class="fas fa-trash"></i> Xóa TK
      </button>
      <button class="btn ${d.isLocked ? 'btn-approve' : ''}"
              style="${!d.isLocked ? 'background:#f59e0b;border-color:#f59e0b;color:#fff' : ''}"
              onclick="closeModal();toggleLockUser('${docId}',${d.isLocked || false})">
        ${
          d.isLocked
            ? '<i class="fas fa-unlock"></i> Mở khóa'
            : '<i class="fas fa-user-lock"></i> Khóa TK'
        }
      </button>`
      : '';

    showModal(`
      <div data-modal-size="user">
        <div class="um-header">
          <div class="um-avatar">${escapeHtml((d.fullName || 'U').charAt(0).toUpperCase())}</div>
          <div class="um-header-info">
            <div class="um-name">${escapeHtml(d.fullName || 'N/A')}</div>
            <div class="um-sub">${escapeHtml(d.email || '')}${d.phone ? ' · ' + escapeHtml(d.phone) : ''}</div>
            <div class="um-badges">${roleBadge} ${verifyBadge} ${lockBadge}</div>
          </div>
        </div>
        <div class="um-body">
          ${col1}
          ${col2}
          ${verifySection}
        </div>
        <div class="um-actions">
          ${actions}
          <button class="btn btn-view" onclick="closeModal()"><i class="fas fa-times"></i> Đóng</button>
        </div>
      </div>`);
  } catch (e) {
    showToast('error', 'Lỗi', e.message);
  }
}

async function deleteUser(docId, options = {}) {
  const { skipConfirm = false, skipToast = false, skipRefresh = false } = options;
  if (!skipConfirm) {
    const ok = await showConfirm(
      'Xóa người dùng',
      'Bạn có chắc chắn muốn xóa tài khoản này? Hành động này không thể hoàn tác.',
      'danger'
    );
    if (!ok) return { deleted: false, cleanupErrors: [] };
  }

  try {
    if (!skipToast) {
      showToast(
        'info',
        'Đang xử lý',
        'Đang tiến hành xóa tài khoản và dữ liệu liên quan ở server...'
      );
    }

    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch(CF_DELETE_USER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ uid: docId }),
    });

    if (!res.ok) {
      let msg = '';
      try {
        const err = await res.json();
        msg = err?.error || err?.message || '';
      } catch (_) {
        /* JSON parse thất bại → dùng HTTP status message */
      }
      throw new Error(msg || `Không thể xóa tài khoản (HTTP ${res.status})`);
    }

    selectedUserIds.delete(docId);

    if (!skipToast) {
      showToast(
        'success',
        'Thành công',
        'Đã xóa hoàn toàn tài khoản người dùng và toàn bộ dữ liệu liên quan!'
      );
    }
    if (!skipRefresh) {
      loadUsers(getActiveTab('usersTabGroup'));
    }
    return { deleted: true, cleanupErrors: [] };
  } catch (e) {
    if (!skipToast) showToast('error', 'Lỗi', e.message);
    throw e;
  }
}

function toggleUserSelection(userId, checked) {
  if (checked) selectedUserIds.add(userId);
  else selectedUserIds.delete(userId);
  updateUsersSelectAllState(
    getFilteredUsersDocs().slice((state.users.page - 1) * PAGE_SIZE, state.users.page * PAGE_SIZE)
  );
}

function toggleSelectAllUsers(checked) {
  const pageDocs = getFilteredUsersDocs().slice(
    (state.users.page - 1) * PAGE_SIZE,
    state.users.page * PAGE_SIZE
  );
  pageDocs.forEach((doc) => {
    if (doc.data().role === 'admin') return;
    if (checked) selectedUserIds.add(doc.id);
    else selectedUserIds.delete(doc.id);
  });
  renderUsers();
}

async function deleteSelectedUsers() {
  const userMap = new Map(state.users.docs.map((doc) => [doc.id, doc.data()]));
  const ids = Array.from(selectedUserIds).filter((id) => {
    const d = userMap.get(id);
    return d && d.role !== 'admin';
  });

  if (ids.length === 0) {
    showToast('warning', 'Chưa chọn người dùng', 'Hãy tick chọn ít nhất 1 tài khoản user để xóa.');
    return;
  }

  const ok = await showConfirm(
    'Xóa người dùng đã chọn',
    `Bạn sắp xóa ${ids.length} tài khoản user. Hành động này không thể hoàn tác.`,
    'danger'
  );
  if (!ok) return;

  showToast('info', 'Đang xử lý', `Đang tiến hành xóa ${ids.length} tài khoản...`, 3500);
  let failed = 0;
  let partialCleanup = 0;
  for (const id of ids) {
    try {
      const result = await deleteUser(id, {
        skipConfirm: true,
        skipToast: true,
        skipRefresh: true,
      });
      if (result.cleanupErrors?.length) partialCleanup++;
    } catch (e) {
      failed++;
      console.error(`[Users] Không thể xóa user ${id}:`, e);
    }
  }

  const deleted = ids.length - failed;
  if (failed === 0 && partialCleanup === 0) {
    showToast('success', 'Thành công', `Đã xóa ${deleted} tài khoản.`);
  } else {
    const tail =
      partialCleanup > 0
        ? ` ${partialCleanup} tài khoản còn dữ liệu liên quan cần kiểm tra log.`
        : '';
    showToast(
      'warning',
      'Hoàn tất một phần',
      `Đã xóa ${deleted}/${ids.length} tài khoản. ${failed} tài khoản lỗi.${tail}`
    );
  }
  loadUsers(getActiveTab('usersTabGroup'));
}

function filterUsersSearch() {
  clearTimeout(usersSearchTimeout);
  usersSearchTimeout = setTimeout(async () => {
    usersSearchKeyword = normalizeVietnameseText(document.getElementById('searchUser').value);
    state.users.page = 1;
    // Reset cursor và reload (có search → search mode)
    cursorMode.users.pageStarts = [null];
    cursorMode.users.currentPage = 0;
    await loadUsers(cursorMode.users.filter || getActiveTab('usersTabGroup'));
  }, 300);
}

async function changeSortUsers() {
  state.users.sort = document.getElementById('sortUsers').value;
  state.users.page = 1;
  // Cursor mode không hỗ trợ sort tùy ý → reset sang search mode
  cursorMode.users.pageStarts = [null];
  cursorMode.users.currentPage = 0;
  await loadUsers(cursorMode.users.filter || getActiveTab('usersTabGroup'));
}
