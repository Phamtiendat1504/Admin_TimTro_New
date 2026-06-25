let supportUnsubscribe = null;

async function loadSupportTickets(filter = 'new') {
  const tbody = document.getElementById('supportTableBody');
  if (!tbody) return;
  selectedSupportIds.clear();

  if (supportUnsubscribe) {
    supportUnsubscribe();
    supportUnsubscribe = null;
  }

  tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state">Đang tải...</div></td></tr>';
  try {
    let q = db.collection('support_tickets').limit(200);
    if (filter !== 'all') q = q.where('status', '==', filter);

    supportUnsubscribe = q.onSnapshot(
      (snap) => {
        state.support.docs = snap.docs.sort(
          (a, b) => toEpochMs(b.data().updatedAt) - toEpochMs(a.data().updatedAt)
        );
        const maxPage = Math.ceil(state.support.docs.length / PAGE_SIZE) || 1;
        if (state.support.page > maxPage) {
          state.support.page = maxPage;
        }
        renderSupportTickets();
      },
      (e) => {
        console.error('Lỗi kết nối lắng nghe hỗ trợ:', e);
        tbody.innerHTML =
          '<tr><td colspan="8"><div class="empty-state">Lỗi kết nối thời gian thực</div></td></tr>';
      }
    );

    activeListeners.push(() => {
      if (supportUnsubscribe) {
        supportUnsubscribe();
        supportUnsubscribe = null;
      }
    });
  } catch (e) {
    console.error('[Support] loadSupportTickets lỗi:', e);
    tbody.innerHTML =
      '<tr><td colspan="8"><div class="empty-state">Lỗi tải yêu cầu hỗ trợ</div></td></tr>';
    showToast('error', 'Lỗi tải hỗ trợ', e.message || 'Không thể tải danh sách ticket');
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

function getFilteredSupportDocs() {
  let all = state.support.docs || [];
  if (dateFilterState.support && (dateFilterState.support.fromMs || dateFilterState.support.toMs)) {
    all = all.filter((doc) => isInDateRange(doc.data().updatedAt, dateFilterState.support));
  }
  return all;
}

function renderSupportTickets() {
  const tbody = document.getElementById('supportTableBody');
  if (!tbody) return;
  const all = getFilteredSupportDocs();
  const total = all.length;
  renderResultInfo('supportResultInfo', state.support.page, total);
  renderPagination('supportPagination', 'support', total);
  if (total === 0) {
    tbody.innerHTML =
      '<tr><td colspan="8"><div class="empty-state"><i class="fas fa-headset"></i>Không có yêu cầu hỗ trợ</div></td></tr>';
    return;
  }
  const page = all.slice((state.support.page - 1) * PAGE_SIZE, state.support.page * PAGE_SIZE);
  tbody.innerHTML = page
    .map((doc) => {
      const d = doc.data();
      const s = supportStatusInfo(d.status);
      const unread =
        d.unreadForAdmin === true
          ? '<span class="badge badge-rejected" style="margin-left:6px">Mới</span>'
          : '';
      return `<tr data-created-at="${toEpochMs(d.updatedAt)}">
      <td style="text-align:center"><input type="checkbox" ${selectedSupportIds.has(doc.id) ? 'checked' : ''} onchange="toggleSupportSelection('${doc.id}', this.checked)"></td>
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
      <td style="text-align:right"><div class="list-actions"><button class="btn btn-view" onclick="openSupportTicket('${doc.id}')">Xem</button>${['resolved', 'closed'].includes(d.status) ? `<button class="btn btn-delete" onclick="deleteSupportTicket('${doc.id}')"><i class="fas fa-trash"></i></button>` : ''}</div></td>
    </tr>`;
    })
    .join('');
}

async function deleteSupportTicket(ticketId) {
  const ok = await showConfirm(
    'Xóa ticket',
    'Xóa vĩnh viễn yêu cầu hỗ trợ này và toàn bộ ảnh chụp đính kèm?',
    'danger'
  );
  if (!ok) return;
  try {
    showToast('info', 'Đang xử lý', 'Đang dọn dẹp ảnh đính kèm và dữ liệu...', 2000);
    // 1. Dọn dẹp ảnh trên Storage song song bằng Promise.all
    try {
      const listRef = storage.ref(`support_images/${ticketId}`);
      const res = await listRef.listAll();
      await Promise.all(res.items.map((item) => item.delete()));
    } catch (err) {
      console.error('[Support] Lỗi dọn dẹp Storage:', err.message);
    }

    // 2. Xóa tài liệu Firestore
    const msgsSnap = await db
      .collection('support_tickets')
      .doc(ticketId)
      .collection('messages')
      .get();
    for (let i = 0; i < msgsSnap.docs.length; i += 499) {
      const b = db.batch();
      msgsSnap.docs.slice(i, i + 499).forEach((m) => b.delete(m.ref));
      await b.commit();
    }
    await db.collection('support_tickets').doc(ticketId).delete();
    showToast('success', 'Đã xóa', 'Ticket hỗ trợ đã bị xóa hoàn toàn.');
    loadSupportTickets(getActiveTab('supportTabGroup'));
  } catch (e) {
    showToast('error', 'Lỗi', e.message);
  }
}

async function deleteSelectedSupport() {
  const ids = Array.from(selectedSupportIds);
  const docs = (state.support.docs || [])
    .filter((doc) => ids.includes(doc.id))
    .filter((doc) => ['resolved', 'closed'].includes(doc.data().status));
  if (!docs.length) {
    showToast('warning', 'Không thể xóa', 'Chi xóa được ticket đã xử lý hoặc đã đóng.');
    return;
  }
  const ok = await showConfirm(
    'Xóa tất cả',
    `Xóa vĩnh viễn ${docs.length} ticket hỗ trợ đã chọn và toàn bộ ảnh chụp?`,
    'danger'
  );
  if (!ok) return;
  showToast('info', 'Đang xử lý', `Đang tiến hành xóa ${docs.length} ticket...`, 3000);

  // Tận dụng xử lý song song thông qua Promise.allSettled để đạt tốc độ cao nhất
  const deletePromises = docs.map(async (doc) => {
    const ticketId = doc.id;
    // 1. Dọn dẹp Storage của ticket này chạy song song
    try {
      const listRef = storage.ref(`support_images/${ticketId}`);
      const res = await listRef.listAll();
      await Promise.all(res.items.map((item) => item.delete()));
    } catch (err) {
      console.error(`[Support] Lỗi dọn dẹp Storage của ticket ${ticketId}:`, err.message);
    }

    // 2. Xóa các message con trong Firestore (Chunking batch 499)
    const msgsSnap = await db
      .collection('support_tickets')
      .doc(ticketId)
      .collection('messages')
      .get();
    for (let i = 0; i < msgsSnap.docs.length; i += 499) {
      const b = db.batch();
      msgsSnap.docs.slice(i, i + 499).forEach((m) => b.delete(m.ref));
      await b.commit();
    }
    // 3. Xóa document ticket cha
    await db.collection('support_tickets').doc(ticketId).delete();
  });

  const results = await Promise.allSettled(deletePromises);
  const failed = results.filter((r) => r.status === 'rejected').length;

  if (failed === 0) showToast('success', 'Thành công', `Đã xóa hoàn toàn ${docs.length} ticket.`);
  else
    showToast(
      'warning',
      'Một phần',
      `Xóa thành công ${docs.length - failed}/${docs.length}. Có ${failed} ticket lỗi.`
    );
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
    const msgSnap = await db
      .collection('support_tickets')
      .doc(ticketId)
      .collection('messages')
      .orderBy('createdAt', 'desc')
      .limit(500)
      .get();
    const docsReversed = msgSnap.docs.slice().reverse();
    const messagesHtml =
      docsReversed.map((m) => renderSupportMessage(m.data())).join('') ||
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
      ${
        d.status === 'closed'
          ? '<div class="empty-state" style="padding:16px">Yêu cầu này đã đóng.</div>'
          : `
        <div class="support-reply-row">
          <textarea id="supportReplyText" class="form-input" placeholder="Nhập phản hồi cho người dùng..."></textarea>
          <button class="btn btn-approve" onclick="sendSupportReply('${ticketId}')"><i class="fas fa-paper-plane"></i> Gửi</button>
        </div>
        <input type="file" id="supportReplyImage" accept="image/*" class="form-input" style="margin-top:10px">
        <div class="support-file-note">Có thể đính kèm 1 ảnh minh họa cho phản hồi.</div>
      `
      }
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
    console.error('[Support] openSupportTicket lỗi:', e);
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
  if (file && file.size > 5 * 1024 * 1024) {
    showToast('warning', 'Tệp quá lớn', 'Ảnh đính kèm không được vượt quá 5MB.');
    return;
  }
  try {
    showToast('info', 'Đang gửi', 'Đang kiểm tra và gửi phản hồi...', 2500);

    // 1. Kiểm tra sự tồn tại của ticket trước khi upload để tiết kiệm chi phí/tệp mồ côi
    const ticketRef = db.collection('support_tickets').doc(ticketId);
    const ticketDoc = await ticketRef.get();
    if (!ticketDoc.exists) throw new Error('Ticket không tồn tại hoặc đã bị xóa.');
    const ticket = ticketDoc.data();

    // 2. Upload ảnh nếu có
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
    const lastMessage = text || '[Hình ảnh]';

    // 3. Gom 3 bước ghi vào WriteBatch để đảm bảo tính nguyên tố (Atomic)
    const batch = db.batch();

    // Bước 3.1: Ghi tin nhắn mới
    const messageRef = ticketRef.collection('messages').doc();
    batch.set(messageRef, {
      senderId: admin?.uid || 'admin',
      senderRole: 'admin',
      text,
      imageUrl,
      createdAt: now,
      seenByUser: false,
      seenByAdmin: true,
    });

    // Bước 3.2: Cập nhật thông tin ticket cha
    batch.update(ticketRef, {
      status: ticket.status === 'new' ? 'in_progress' : ticket.status,
      updatedAt: now,
      lastMessage,
      lastSenderRole: 'admin',
      adminId: admin?.uid || '',
      adminName,
      unreadForUser: true,
      unreadForAdmin: false,
    });

    // Bước 3.3: Tạo thông báo cho người dùng
    const notifRef = db.collection('notifications').doc();
    batch.set(notifRef, {
      userId: ticket.userId,
      title: 'Admin đã phản hồi hỗ trợ',
      message: lastMessage,
      type: 'support_reply',
      ticketId,
      ticketTitle: ticket.title || 'Yêu cầu hỗ trợ',
      seen: false,
      isRead: false,
      createdAt: now,
    });

    await batch.commit();

    showToast('success', 'Thành công', 'Đã gửi phản hồi cho người dùng.');
    openSupportTicket(ticketId);
    loadSupportTickets(getActiveTab('supportTabGroup'));
  } catch (e) {
    console.error('[Support] sendSupportReply lỗi:', e);
    showToast('error', 'Lỗi', e.message);
  }
}

async function updateSupportStatus(ticketId, status) {
  try {
    const ticketRef = db.collection('support_tickets').doc(ticketId);
    const ticketDoc = await ticketRef.get();
    if (!ticketDoc.exists) throw new Error('Ticket không tồn tại hoặc đã bị xóa.');
    const d = ticketDoc.data();
    const now = Date.now();
    const msg =
      status === 'resolved'
        ? 'Yêu cầu hỗ trợ của bạn đã được xử lý xong.'
        : 'Yêu cầu hỗ trợ của bạn đã được đóng.';

    const batch = db.batch();
    batch.update(ticketRef, { status, updatedAt: now, unreadForAdmin: false });
    const notifRef = db.collection('notifications').doc();
    batch.set(notifRef, {
      userId: d.userId,
      title: 'Cập nhật yêu cầu hỗ trợ',
      message: msg,
      type: 'support_status',
      ticketId,
      ticketTitle: d.title || 'Yêu cầu hỗ trợ',
      seen: false,
      isRead: false,
      createdAt: now,
    });
    await batch.commit();

    showToast('success', 'Đã cập nhật', 'Trạng thái yêu cầu hỗ trợ đã được cập nhật.');
    openSupportTicket(ticketId);
    loadSupportTickets(getActiveTab('supportTabGroup'));
  } catch (e) {
    showToast('error', 'Lỗi', e.message);
  }
}

// ════════════════════════════════════════
// SELECTION TOGGLES — Support
// ════════════════════════════════════════
function updateSupportSelectAllState(pageDocs) {
  const selectAll = document.getElementById('selectAllSupport');
  if (!selectAll) return;
  if (!pageDocs || pageDocs.length === 0) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    return;
  }
  const selectedCount = pageDocs.filter((doc) => selectedSupportIds.has(doc.id)).length;
  selectAll.checked = selectedCount === pageDocs.length;
  selectAll.indeterminate = selectedCount > 0 && selectedCount < pageDocs.length;
}
function toggleSupportSelection(id, checked) {
  if (checked) selectedSupportIds.add(id);
  else selectedSupportIds.delete(id);
  updateSupportSelectAllState(
    getFilteredSupportDocs().slice(
      (state.support.page - 1) * PAGE_SIZE,
      state.support.page * PAGE_SIZE
    )
  );
}
function toggleSelectAllSupport(checked) {
  const pageDocs = getFilteredSupportDocs().slice(
    (state.support.page - 1) * PAGE_SIZE,
    state.support.page * PAGE_SIZE
  );
  pageDocs.forEach((doc) => {
    if (checked) selectedSupportIds.add(doc.id);
    else selectedSupportIds.delete(doc.id);
  });
  renderSupportTickets();
}
