// ════════════════════════════════════════
// DATE FILTER
// ════════════════════════════════════════
const dateFilterMap = {
  posts: { from: 'postDateFrom', to: 'postDateTo', tbody: '#postsTableBody' },
  users: { from: 'userDateFrom', to: 'userDateTo', tbody: '#usersTableBody' },
  verifications: { from: 'verifyDateFrom', to: 'verifyDateTo', tbody: '#verifyTableBody' },
  featured: { from: 'featuredDateFrom', to: 'featuredDateTo', tbody: '#featuredTableBody' },
  payments: { from: 'paymentsDateFrom', to: 'paymentsDateTo', tbody: '#paymentsTableBody' },
  support: { from: 'supportDateFrom', to: 'supportDateTo', tbody: '#supportTableBody' },
};
const dateFilterState = {
  posts: { fromMs: null, toMs: null },
  users: { fromMs: null, toMs: null },
  verifications: { fromMs: null, toMs: null },
  featured: { fromMs: null, toMs: null },
  payments: { fromMs: null, toMs: null },
  support: { fromMs: null, toMs: null },
};

function isInDateRange(value, filter) {
  if (!filter) return true;
  const ts = toEpochMs(value);
  return (!filter.fromMs || ts >= filter.fromMs) && (!filter.toMs || ts <= filter.toMs);
}

async function _callRenderForPage(page) {
  // Posts và Users dùng cursor pagination → cần reload lại từ Firestore khi filter thay đổi
  if (page === 'posts') {
    cursorMode.posts.pageStarts = [null];
    cursorMode.posts.currentPage = 0;
    cursorMode.posts.hasMore = false;
    loadPosts(cursorMode.posts.filter || getActiveTab('postsTabGroup'));
    return;
  }
  if (page === 'users') {
    cursorMode.users.pageStarts = [null];
    cursorMode.users.currentPage = 0;
    cursorMode.users.hasMore = false;
    loadUsers(cursorMode.users.filter || getActiveTab('usersTabGroup'));
    return;
  }
  if (page === 'verifications') {
    loadVerifications();
    return;
  }
  if (page === 'featured') {
    state.featured.page = 1;
    renderFeaturedRequests();
  }
  if (page === 'payments') {
    state.payments.page = 1;
    renderPayments();
  }
  if (page === 'support') {
    state.support.page = 1;
    renderSupportTickets();
  }
}

function applyDateFilter(page) {
  const m = dateFilterMap[page];
  if (!m) return;
  const fromVal = document.getElementById(m.from)?.value;
  const toVal = document.getElementById(m.to)?.value;
  const _HCM = 7 * 3600 * 1000;
  const fromMs = fromVal
    ? (([y, m, d]) => Date.UTC(y, m - 1, d) - _HCM)(fromVal.split('-').map(Number))
    : null;
  const toMs = toVal
    ? (([y, m, d]) => Date.UTC(y, m - 1, d + 1) - _HCM - 1)(toVal.split('-').map(Number))
    : null;

  if (dateFilterState[page]) {
    dateFilterState[page] = { fromMs, toMs };
    _callRenderForPage(page);
    return;
  }

  if (!fromMs && !toMs) return;
  const targetTable = m.tbody || '';
  document.querySelectorAll(`${targetTable} tr`).forEach((row) => {
    const ts = parseInt(row.dataset.createdAt || '0', 10);
    row.style.display = (!fromMs || ts >= fromMs) && (!toMs || ts <= toMs) ? '' : 'none';
  });
}

function clearDateFilter(page) {
  const m = dateFilterMap[page];
  if (!m) return;
  document.getElementById(m.from).value = '';
  document.getElementById(m.to).value = '';

  if (dateFilterState[page]) {
    dateFilterState[page] = { fromMs: null, toMs: null };
    _callRenderForPage(page);
    return;
  }

  const targetTable = m.tbody || '';
  document.querySelectorAll(`${targetTable} tr`).forEach((row) => {
    row.style.display = '';
  });
}

// ════════════════════════════════════════
// HELPER: Get active tab filter
// ════════════════════════════════════════
function getActiveTab(groupId) {
  return document.querySelector(`#${groupId} .tab-btn.active`)?.dataset.filter || 'all';
}

// ════════════════════════════════════════
// LOCK / UNLOCK USER
// ════════════════════════════════════════
async function toggleLockUser(uid, currentlyLocked) {
  if (currentlyLocked) {
    const ok = await showConfirm(
      'Mở khóa tài khoản',
      'Bạn có chắc chắn muốn mở khóa cho tài khoản này?',
      'success'
    );
    if (!ok) return;
    try {
      await db.collection('users').doc(uid).update({
        isLocked: false,
        lockReason: '',
        lockUntil: 0,
      });

      await sendNotification(
        uid,
        'Tài khoản đã được mở khóa',
        'Chào mừng bạn quay trở lại! Tài khoản của bạn đã được mở khóa và có thể sử dụng bình thường.',
        'account_unlocked'
      );

      showToast('success', 'Thành công', 'Đã mở khóa tài khoản!');
      loadUsers(getActiveTab('usersTabGroup'));
    } catch (e) {
      showToast('error', 'Lỗi', e.message);
    }
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

  const totalMs =
    days * 24 * 60 * 60 * 1000 + hours * 60 * 60 * 1000 + mins * 60 * 1000 + secs * 1000;

  if (totalMs < 60000 && days < 999) {
    showToast(
      'warning',
      'Thời gian quá ngắn',
      'Thời gian khóa tối thiểu là 1 phút để hệ thống kịp quét và gửi thông báo.'
    );
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
      lockSeconds: secs,
    });

    let lockTimeText = '';
    if (days >= 999) {
      lockTimeText = 'vĩnh viễn';
    } else {
      const parts = [];
      if (days > 0) parts.push(`${days} ngày`);
      if (hours > 0) parts.push(`${hours} giờ`);
      if (mins > 0) parts.push(`${mins} phút`);
      if (secs > 0) parts.push(`${secs} giây`);
      lockTimeText = parts.join(' ');
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
  const s = String(status || '')
    .trim()
    .toLowerCase();
  return s === 'pending' || s === 'pending_admin_review' || s === 'queued_manual';
}

function shouldShowInAdminVerificationQueue(data) {
  const status = String(data?.status || '')
    .trim()
    .toLowerCase();
  if (!isVerificationPendingLike(status)) return false;
  return (
    data?.escalatedToAdmin === true ||
    status === 'pending_admin_review' ||
    status === 'queued_manual'
  );
}

function getAutoCheckStatusLabel(status) {
  const s = String(status || '')
    .trim()
    .toLowerCase();
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
    let docs = snap.docs
      .filter((doc) => shouldShowInAdminVerificationQueue(doc.data()))
      .sort((a, b) => compareVerificationPriority(a.data(), b.data()));

    if (dateFilterState.verifications) {
      docs = docs.filter((doc) =>
        isInDateRange(doc.data().createdAt, dateFilterState.verifications)
      );
    }

    if (docs.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="6"><div class="empty-state"><i class="fas fa-check-circle"></i>Không có yêu cầu xác minh nào</div></td></tr>';
      return;
    }

    tbody.innerHTML = docs
      .map((doc) => {
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
            <div class="td-avatar">${(d.fullName || 'U').charAt(0).toUpperCase()}</div>
            <div><div class="td-name">${d.fullName || 'N/A'}</div></div>
          </div>
        </td>
        <td><span style="font-size:13px;font-weight:600">${d.cccdNumber || 'N/A'}</span></td>
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
      })
      .join('');
  } catch (e) {
    tbody.innerHTML =
      '<tr><td colspan="6"><div class="empty-state">Lỗi tải dữ liệu</div></td></tr>';
    console.error('[Utils] loadVerificationsTable lỗi:', e);
  }
}

async function viewVerification(docId) {
  try {
    const doc = await db.collection('verifications').doc(docId).get();
    if (!doc.exists) {
      showToast('error', 'Lỗi', 'Yêu cầu không tồn tại');
      return;
    }
    const d = doc.data();
    const uid = d.userId || docId;
    const autoStatus = getAutoCheckStatusLabel(d.autoCheckStatus);
    const autoReason = d.autoCheckReason || 'Không có';
    const ocrValue = d.autoCheckRecognizedCccd || 'Không đọc được';
    const failCount = Number(d.autoFailCountToday || 0);
    const escalated = d.escalatedToAdmin === true;
    const deadlineLabel = escalated ? fmtDateTime(d.escalationDeadlineAt) : 'N/A';
    const imageSourceLabel =
      d.imageSource === 'camera_only' ? 'Chụp trực tiếp' : d.imageSource || 'N/A';

    showModal(`
      <div class="modal-title">Chi tiết yêu cầu xác minh tài khoản</div>
      <div class="detail-row"><div class="detail-label">Họ tên</div><div class="detail-value">${escapeHtml(d.fullName || 'N/A')}</div></div>
      <div class="detail-row"><div class="detail-label">Email</div><div class="detail-value">${escapeHtml(d.email || 'N/A')}</div></div>
      <div class="detail-row"><div class="detail-label">Số CCCD</div><div class="detail-value">${escapeHtml(d.cccdNumber || 'N/A')}</div></div>
      <div class="detail-row"><div class="detail-label">SĐT</div><div class="detail-value">${escapeHtml(d.phone || d.phoneNumber || 'N/A')}</div></div>
      <div class="detail-row"><div class="detail-label">Địa chỉ</div><div class="detail-value">${escapeHtml(d.address || 'N/A')}</div></div>
      <div class="detail-row"><div class="detail-label">Nguồn ảnh</div><div class="detail-value">${escapeHtml(imageSourceLabel)}</div></div>
      <div class="detail-row"><div class="detail-label">Auto-check</div><div class="detail-value">${escapeHtml(autoStatus)}</div></div>
      <div class="detail-row"><div class="detail-label">CCCD OCR</div><div class="detail-value">${escapeHtml(ocrValue)}</div></div>
      <div class="detail-row"><div class="detail-label">Lý do auto-check</div><div class="detail-value">${escapeHtml(autoReason)}</div></div>
      <div class="detail-row"><div class="detail-label">Số lần lỗi hôm nay</div><div class="detail-value">${escapeHtml(String(failCount))}</div></div>
      <div class="detail-row"><div class="detail-label">Đã đẩy admin</div><div class="detail-value">${escalated ? 'Có' : 'Không'}</div></div>
      <div class="detail-row"><div class="detail-label">Deadline xử lý</div><div class="detail-value">${escapeHtml(deadlineLabel)}</div></div>
      <div class="detail-row"><div class="detail-label">CCCD mặt trước</div><div class="detail-value">${d.cccdFrontUrl ? `<img src="${safeUrl(d.cccdFrontUrl)}" class="cccd-img" onclick="showFullscreenImage('${safeForJsGlobal(safeUrl(d.cccdFrontUrl))}')">` : 'Chưa có'}</div></div>
      <div class="detail-row"><div class="detail-label">CCCD mặt sau</div><div class="detail-value">${d.cccdBackUrl ? `<img src="${safeUrl(d.cccdBackUrl)}" class="cccd-img" onclick="showFullscreenImage('${safeForJsGlobal(safeUrl(d.cccdBackUrl))}')">` : 'Chưa có'}</div></div>
      <div class="modal-actions">
        <button class="btn btn-view" onclick="closeModal()">Đóng</button>
        <button class="btn btn-approve" onclick="approveVerification('${docId}','${uid}');closeModal()">Cấp quyền đăng bài</button>
        <button class="btn btn-reject" onclick="rejectVerification('${docId}','${uid}');closeModal()">Từ chối</button>
      </div>`);
  } catch (e) {
    showToast('error', 'Lỗi', e.message);
  }
}

async function approveVerification(docId, userId) {
  const ok = await showConfirm(
    'Cấp quyền đăng bài',
    'Xác nhận cấp quyền đăng bài cho tài khoản này?',
    'success'
  );
  if (!ok) return;
  try {
    const now = Date.now();
    const reviewerId = auth.currentUser?.uid || 'admin_web';
    const verificationRef = db.collection('verifications').doc(docId);
    const userRef = db.collection('users').doc(userId);

    await db.runTransaction(async (transaction) => {
      const verificationSnap = await transaction.get(verificationRef);
      if (!verificationSnap.exists) {
        throw new Error('Yêu cầu xác minh không tồn tại.');
      }

      const verificationData = verificationSnap.data() || {};
      const currentStatus = String(verificationData.status || '')
        .trim()
        .toLowerCase();
      if (!isVerificationPendingLike(currentStatus)) {
        throw new Error('Yêu cầu này đã được xử lý bởi một admin khác.');
      }

      const escalated =
        verificationData.escalatedToAdmin === true ||
        currentStatus === 'pending_admin_review' ||
        currentStatus === 'queued_manual' ||
        Number(verificationData.autoFailCountToday || 0) >= 4;

      const postingUnlockAt = 0;

      transaction.update(verificationRef, {
        status: 'approved',
        reviewedAt: now,
        reviewedBy: reviewerId,
        approvedByAdminAt: now,
        postingUnlockAt,
        escalatedToAdmin: escalated,
        escalationDeadlineAt: 0,
        rejectReason: '',
        autoCheckStatus: escalated ? 'approved_by_admin_after_manual_review' : 'approved_by_admin',
      });
      transaction.update(userRef, {
        isVerified: true,
        role: 'user',
        verifiedAt: now,
        postingUnlockAt,
      });
    });

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
  const trimmedReason = reason.trim();
  if (trimmedReason.length < 5) {
    showToast('warning', 'Cảnh báo', 'Lý do phải ít nhất 5 ký tự');
    return;
  }
  try {
    const now = Date.now();
    const reviewerId = auth.currentUser?.uid || 'admin_web';
    const verificationRef = db.collection('verifications').doc(docId);

    let cccdNumber = null;
    await db.runTransaction(async (transaction) => {
      const verificationSnap = await transaction.get(verificationRef);
      if (!verificationSnap.exists) {
        throw new Error('Yêu cầu xác minh không tồn tại.');
      }
      const currentStatus = String(verificationSnap.data().status || '')
        .trim()
        .toLowerCase();
      if (!isVerificationPendingLike(currentStatus)) {
        throw new Error('Yêu cầu này đã được xử lý bởi một admin khác.');
      }
      cccdNumber = verificationSnap.data()?.cccdNumber || null;
      transaction.update(verificationRef, {
        status: 'rejected',
        rejectReason: trimmedReason,
        escalatedToAdmin: false,
        escalationDeadlineAt: 0,
        reviewedAt: now,
        reviewedBy: reviewerId,
      });
      if (cccdNumber) {
        transaction.delete(db.collection('cccd_registry').doc(cccdNumber));
      }
    });

    await sendNotification(
      userId,
      'Xác minh bị từ chối',
      'Yêu cầu xác minh của bạn bị từ chối. Lý do: ' + trimmedReason,
      'verification_rejected'
    );
    showToast('warning', 'Đã từ chối', 'Yêu cầu xác minh đã bị từ chối.');
    loadVerifications();
  } catch (e) {
    showToast('error', 'Lỗi', e.message);
  }
}
// === END_VERIFICATION_PATCH_V2_2026 ===
