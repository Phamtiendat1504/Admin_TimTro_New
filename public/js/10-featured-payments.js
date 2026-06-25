// ????????????????????????????????????????
// FEATURED REQUESTS
// ????????????????????????????????????????
async function loadFeaturedRequests(filter) {
  const tbody = document.getElementById('featuredTableBody');
  tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state">Đang tải...</div></td></tr>';
  try {
    let q = db.collection('featured_upgrade_requests').orderBy('createdAt', 'desc').limit(200);
    const snap = await q.get();
    let docs = snap.docs;
    if (filter === 'paid_waiting_admin') {
      docs = docs.filter((doc) => ['paid', 'paid_waiting_admin'].includes(doc.data().status));
    } else if (filter !== 'all') {
      docs = docs.filter((doc) => doc.data().status === filter);
    }
    state.featured.docs = docs;
    state.featured.page = 1;
    renderFeaturedRequests();
  } catch (e) {
    console.error('[Featured] loadFeaturedRequests lỗi:', e);
    tbody.innerHTML =
      '<tr><td colspan="6"><div class="empty-state">Lỗi tải yêu cầu nổi bật</div></td></tr>';
  }
}

function filterFeaturedSearch() {
  featuredSearchKw = document.getElementById('searchFeatured')?.value || '';
  state.featured.page = 1;
  renderFeaturedRequests();
}
function getFilteredFeaturedDocs() {
  const kw = normalizeVietnameseText(featuredSearchKw);
  let all = state.featured.docs || [];
  if (
    dateFilterState.featured &&
    (dateFilterState.featured.fromMs || dateFilterState.featured.toMs)
  ) {
    all = all.filter((doc) => isInDateRange(doc.data().createdAt, dateFilterState.featured));
  }
  if (!kw) return all;
  return all.filter((doc) => {
    const d = doc.data();
    return (
      normalizeVietnameseText(d.roomTitle || '').includes(kw) ||
      normalizeVietnameseText(d.roomId || '').includes(kw) ||
      normalizeVietnameseText(d.uid || '').includes(kw)
    );
  });
}

function renderFeaturedRequests() {
  const tbody = document.getElementById('featuredTableBody');
  const all = getFilteredFeaturedDocs();
  if (!all.length) {
    tbody.innerHTML =
      '<tr><td colspan="6"><div class="empty-state">Không có yêu cầu nổi bật</div></td></tr>';
    renderResultInfo('featuredResultInfo', 1, 0);
    document.getElementById('featuredPagination').innerHTML = '';
    return;
  }
  renderResultInfo('featuredResultInfo', state.featured.page, all.length);
  renderPagination('featuredPagination', 'featured', all.length);
  const page = all.slice((state.featured.page - 1) * PAGE_SIZE, state.featured.page * PAGE_SIZE);
  tbody.innerHTML = page
    .map((doc) => {
      const d = doc.data();
      const safeTitle = String(d.roomTitle || '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'");
      const status = d.status || 'waiting_for_payment';
      return `<tr data-created-at="${toEpochMs(d.createdAt)}">
        <td style="text-align:center"><input type="checkbox" ${selectedFeaturedIds.has(doc.id) ? 'checked' : ''} onchange="toggleFeaturedSelection('${doc.id}', this.checked)"></td>
      <td><div class="td-name">${escapeHtml(d.roomTitle || d.roomId || 'Bài đăng')}</div><div class="td-email">${escapeHtml(d.roomId || '')}</div></td>
      <td><b>${escapeHtml(d.label || d.code || '')}</b><div class="td-email">${d.days || 0} ngày</div></td>
      <td><b>${fmt(d.amount || 0)} đ</b><div class="td-email">${escapeHtml(d.transferNote || '')}</div></td>
      <td><span class="badge ${paymentStatusBadge(status, 'featured')}">${paymentStatusText(status, 'featured')}</span></td>
      <td style="text-align:right"><div class="list-actions">
        ${
          ['paid', 'paid_waiting_admin'].includes(status)
            ? `
          <button class="btn btn-approve" onclick="approveFeaturedRequest('${doc.id}','${d.uid}','${d.roomId}','${safeTitle}')">Duyệt</button>
          <button class="btn btn-reject" onclick="rejectFeaturedRequest('${doc.id}','${d.uid}','${d.roomId}','${safeTitle}')">Từ chối</button>
        `
            : ''
        }
        <button class="btn btn-view" onclick="viewPost('${d.roomId}')">Xem bài</button>
        <button class="btn btn-delete" onclick="deleteFeaturedRequest('${doc.id}','${d.roomId}','${status}')"><i class="fas fa-trash"></i></button>
      </div></td>
    </tr>`;
    })
    .join('');
}

async function deleteFeaturedRequest(reqId, roomId, status) {
  const ok = await showConfirm('Xóa yêu cầu', 'Xóa yêu cầu nổi bật này?', 'danger');
  if (!ok) return;
  try {
    const reqRef = db.collection('featured_upgrade_requests').doc(reqId);
    const roomRef = roomId ? db.collection('rooms').doc(roomId) : null;

    await db.runTransaction(async (tx) => {
      // Reads phải thực hiện trước tất cả writes trong transaction
      const roomSnap = roomRef ? await tx.get(roomRef) : null;

      tx.delete(reqRef);
      if (roomRef && roomSnap && roomSnap.exists) {
        const now = Date.now();
        if (status === 'approved') {
          tx.set(
            roomRef,
            {
              isFeatured: false,
              featuredUntil: null,
              featuredRequestStatus: null,
              featuredRequestId: null,
              featuredRequestUpdatedAt: now,
            },
            { merge: true }
          );
        } else {
          tx.set(
            roomRef,
            {
              featuredRequestStatus: null,
              featuredRequestId: null,
              featuredRequestUpdatedAt: now,
            },
            { merge: true }
          );
        }
      }
    });

    showToast('success', 'Đã xóa', 'Yêu cầu nổi bật đã bị xóa');
    loadFeaturedRequests(getActiveTab('featuredTabGroup'));
  } catch (e) {
    showToast('error', 'Lỗi', e.message);
  }
}

async function deleteSelectedFeatured() {
  const ids = Array.from(selectedFeaturedIds);
  const docs = state.featured.docs.filter((d) => ids.includes(d.id));
  if (!docs.length) {
    showToast('warning', 'Không có dữ liệu', 'Không có yêu cầu nào để xóa.');
    return;
  }
  const ok = await showConfirm(
    'Xóa tất cả',
    `Bạn sắp xóa ${docs.length} yêu cầu nổi bật. Hành động này không thể hoàn tác.`,
    'danger'
  );
  if (!ok) return;
  showToast('info', 'Đang xử lý', `Đang xóa ${docs.length} yêu cầu...`, 3000);
  let failed = 0;
  for (const doc of docs) {
    try {
      const d = doc.data();
      await db.collection('featured_upgrade_requests').doc(doc.id).delete();
      if (d.roomId) {
        const roomRef = db.collection('rooms').doc(d.roomId);
        const roomSnap = await roomRef.get();
        if (roomSnap.exists) {
          const now = Date.now();
          if (d.status === 'approved') {
            await roomRef.set(
              {
                isFeatured: false,
                featuredUntil: null,
                featuredRequestStatus: null,
                featuredRequestId: null,
                featuredRequestUpdatedAt: now,
              },
              { merge: true }
            );
          } else {
            await roomRef.set(
              {
                featuredRequestStatus: null,
                featuredRequestId: null,
                featuredRequestUpdatedAt: now,
              },
              { merge: true }
            );
          }
        }
      }
    } catch (e) {
      failed++;
    }
  }
  if (failed === 0) showToast('success', 'Thành công', `Đã xóa ${docs.length} yêu cầu.`);
  else
    showToast('warning', 'Một phần', `Xóa ${docs.length - failed}/${docs.length}. ${failed} lỗi.`);
  loadFeaturedRequests(getActiveTab('featuredTabGroup'));
}

async function approveFeaturedRequest(requestId, uid, roomId, title) {
  const ok = await showConfirm(
    'Duyệt nổi bật',
    'Xác nhận đưa bài này lên mục Phòng nổi bật?',
    'success'
  );
  if (!ok) return;
  try {
    const reqRef = db.collection('featured_upgrade_requests').doc(requestId);
    let freshRequest = null;
    await db.runTransaction(async (tx) => {
      const freshSnap = await tx.get(reqRef);
      if (!freshSnap.exists) throw new Error('Yêu cầu nổi bật không tồn tại.');
      const req = freshSnap.data() || {};
      if (req.status !== 'paid_waiting_admin') {
        throw new Error('Yêu cầu này không còn ở trạng thái chờ duyệt.');
      }
      const now = Date.now();
      const days = Number(req.days || 0);
      const targetRoomId = String(req.roomId || roomId || '');

      const roomRef = db.collection('rooms').doc(targetRoomId);
      const roomSnap = await tx.get(roomRef);
      if (!roomSnap.exists) {
        throw new Error('Bài đăng phòng trọ liên quan không tồn tại hoặc đã bị xóa.');
      }

      const roomData = roomSnap.data() || {};
      if (roomData.status !== 'approved' && roomData.status !== 'pending') {
        throw new Error(
          'Bài đăng chưa được duyệt hiển thị hoặc đang chờ duyệt, không thể đưa lên nổi bật.'
        );
      }

      const currentFeaturedUntil = Number(roomData.featuredUntil || 0);
      const isCurrentlyFeatured = roomData.isFeatured === true;

      // Cộng dồn hạn nổi bật nếu bài viết đang còn hạn nổi bật
      const baseTime =
        isCurrentlyFeatured && currentFeaturedUntil > now ? currentFeaturedUntil : now;
      const featuredUntil = baseTime + Math.max(days, 1) * 24 * 60 * 60 * 1000;

      freshRequest = { ...req, featuredUntil, featuredStartAt: now, roomId: targetRoomId };
      tx.set(
        reqRef,
        {
          status: 'approved',
          approvalStatus: 'approved',
          approvedAt: now,
          updatedAt: now,
          featuredStartAt: now,
          featuredUntil,
        },
        { merge: true }
      );
      tx.set(
        roomRef,
        {
          status: 'approved', // Tự động duyệt luôn bài đăng nếu bài đang ở trạng thái Chờ duyệt
          isFeatured: true,
          featuredStartAt: now,
          featuredUntil,
          featuredPackageCode: req.code || '',
          featuredPaymentId: requestId,
          featuredRequestId: requestId,
          featuredRequestStatus: 'approved',
          featuredRequestUpdatedAt: now,
          featuredRequestRejectReason: '',
        },
        { merge: true }
      );
    });
    await sendNotification(
      freshRequest?.uid || uid,
      'Bài đăng đã lên nổi bật',
      `Bài đăng "${title || freshRequest?.roomTitle || 'của bạn'}" đã được admin duyệt nổi bật.`,
      'featured_approved'
    );
    showToast('success', 'Thành công', 'Đã duyệt bài nổi bật');
    loadFeaturedRequests(getActiveTab('featuredTabGroup'));
  } catch (e) {
    showToast('error', 'Lỗi', e.message);
  }
}

async function rejectFeaturedRequest(requestId, uid, roomId, title) {
  const reason = await showPrompt('Từ chối nổi bật', 'Nhập lý do từ chối:', 'Lý do...');
  if (reason === null) return;
  const trimmedReason = reason.trim();
  if (trimmedReason.length < 5) {
    showToast('warning', 'Cảnh báo', 'Lý do phải ít nhất 5 ký tự');
    return;
  }
  try {
    const reqRef = db.collection('featured_upgrade_requests').doc(requestId);
    let freshRequest = null;
    await db.runTransaction(async (tx) => {
      const freshSnap = await tx.get(reqRef);
      if (!freshSnap.exists) throw new Error('Yêu cầu nổi bật không tồn tại.');
      const req = freshSnap.data() || {};
      if (req.status !== 'paid_waiting_admin') {
        throw new Error('Yêu cầu này không còn ở trạng thái chờ duyệt.');
      }
      const now = Date.now();
      const targetRoomId = String(req.roomId || roomId || '');

      const roomRef = db.collection('rooms').doc(targetRoomId);
      const roomSnap = targetRoomId ? await tx.get(roomRef) : null;

      freshRequest = { ...req, roomId: targetRoomId };
      tx.set(
        reqRef,
        {
          status: 'rejected',
          approvalStatus: 'rejected',
          rejectReason: trimmedReason,
          rejectedAt: now,
          updatedAt: now,
        },
        { merge: true }
      );
      if (roomSnap.exists) {
        tx.set(
          roomRef,
          {
            featuredRequestStatus: 'rejected',
            featuredRequestId: requestId,
            featuredRequestUpdatedAt: now,
            featuredRequestRejectReason: trimmedReason,
          },
          { merge: true }
        );
      }
    });
    await sendNotification(
      freshRequest?.uid || uid,
      'Yêu cầu nổi bật bị từ chối',
      `Bài "${title || freshRequest?.roomTitle || 'của bạn'}" bị từ chối nổi bật. Lý do: ${trimmedReason}`,
      'featured_rejected'
    );
    showToast('warning', 'Đã từ chối', 'Yêu cầu nổi bật đã bị từ chối');
    loadFeaturedRequests(getActiveTab('featuredTabGroup'));
  } catch (e) {
    showToast('error', 'Lỗi', e.message);
  }
}

async function loadPayments(filter) {
  const tbody = document.getElementById('paymentsTableBody');
  selectedPaymentsIds.clear();
  tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state">Đang tải...</div></td></tr>';
  try {
    const tasks = [];
    if (filter === 'all' || filter === 'slot')
      tasks.push(
        db.collection('slot_upgrade_requests').orderBy('createdAt', 'desc').limit(200).get()
      );
    if (filter === 'all' || filter === 'featured')
      tasks.push(
        db.collection('featured_upgrade_requests').orderBy('createdAt', 'desc').limit(200).get()
      );
    const snaps = await Promise.all(tasks);
    const docs = [];
    snaps.forEach((snap) =>
      snap.docs.forEach((doc) =>
        docs.push({
          docId: doc.id,
          type: doc.ref.parent.id === 'featured_upgrade_requests' ? 'featured' : 'slot',
          data: doc.data(),
        })
      )
    );
    state.payments.docs = docs.sort(
      (a, b) => toEpochMs(b.data.createdAt) - toEpochMs(a.data.createdAt)
    );
    state.payments.page = 1;
    renderPayments();
  } catch (e) {
    console.error('[Payments] loadPayments lỗi:', e);
    tbody.innerHTML =
      '<tr><td colspan="7"><div class="empty-state">Lỗi tải thanh toán</div></td></tr>';
    showToast('error', 'Lỗi tải thanh toán', e.message || 'Không thể tải dữ liệu');
  }
}

function filterPaymentsSearch() {
  clearTimeout(paymentsSearchTimeout);
  paymentsSearchTimeout = setTimeout(() => {
    paymentsSearchKw = document.getElementById('searchPayments')?.value || '';
    state.payments.page = 1;
    renderPayments();
  }, 300);
}
function getFilteredPaymentsDocs() {
  const kw = normalizeVietnameseText(paymentsSearchKw);
  let all = state.payments.docs || [];
  if (
    dateFilterState.payments &&
    (dateFilterState.payments.fromMs || dateFilterState.payments.toMs)
  ) {
    all = all.filter((item) => isInDateRange(item.data.createdAt, dateFilterState.payments));
  }
  if (!kw) return all;
  return all.filter((item) => {
    const d = item.data;
    return (
      normalizeVietnameseText(d.uid || '').includes(kw) ||
      normalizeVietnameseText(d.transferNote || '').includes(kw) ||
      normalizeVietnameseText(d.label || '').includes(kw) ||
      normalizeVietnameseText(d.roomTitle || '').includes(kw)
    );
  });
}

function renderPayments() {
  const tbody = document.getElementById('paymentsTableBody');
  const all = getFilteredPaymentsDocs();
  if (!all.length) {
    tbody.innerHTML =
      '<tr><td colspan="7"><div class="empty-state">Không có giao dịch</div></td></tr>';
    renderResultInfo('paymentsResultInfo', 1, 0);
    document.getElementById('paymentsPagination').innerHTML = '';
    return;
  }
  renderResultInfo('paymentsResultInfo', state.payments.page, all.length);
  renderPagination('paymentsPagination', 'payments', all.length);
  const page = all.slice((state.payments.page - 1) * PAGE_SIZE, state.payments.page * PAGE_SIZE);

  // Xây dựng map tra cứu họ tên người dùng từ cache cục bộ
  const userMap = new Map();
  if (state.users && Array.isArray(state.users.docs)) {
    state.users.docs.forEach((doc) => {
      const ud = doc.data();
      if (ud && ud.fullName) {
        userMap.set(doc.id, ud.fullName);
      }
    });
  }

  tbody.innerHTML = page
    .map((item) => {
      const docId = item.docId;
      const d = item.data;
      const status = d.status || 'waiting_for_payment';
      const canDelete = ['cancelled', 'expired', 'failed', 'waiting_for_payment'].includes(status);
      const userName = userMap.get(d.uid) || '';
      return `<tr data-created-at="${toEpochMs(d.createdAt)}">
        <td style="text-align:center"><input type="checkbox" ${selectedPaymentsIds.has(docId) ? 'checked' : ''} ${!canDelete ? 'disabled' : ''} onchange="togglePaymentsSelection('${docId}', this.checked)"></td>
      <td><div class="td-name">${item.type === 'featured' ? 'Đẩy nổi bật' : 'Mua lượt đăng'}</div><div class="td-email">${escapeHtml(d.label || d.code || '')}</div></td>
      <td>
        ${userName ? `<div class="td-name">${escapeHtml(userName)}</div>` : ''}
        <div class="td-email">${escapeHtml(d.uid || '')}</div>
        ${d.roomTitle ? `<div class="td-email">${escapeHtml(d.roomTitle)}</div>` : ''}
      </td>
      <td><b>${fmt(d.amount || 0)} đ</b><div class="td-email">${escapeHtml(d.transferNote || '')}</div></td>
      <td>${fmtDateTime(d.paidAt || d.updatedAt || d.createdAt)}</td>
      <td><span class="badge ${paymentStatusBadge(status, item.type)}">${paymentStatusText(status, item.type)}</span></td>
      <td style="text-align:right">${canDelete ? `<button class="btn btn-delete" onclick="deletePaymentRecord('${docId}','${item.type}')"><i class="fas fa-trash"></i></button>` : ''}</td>
    </tr>`;
    })
    .join('');
}

async function deletePaymentRecord(id, type) {
  const col = type === 'featured' ? 'featured_upgrade_requests' : 'slot_upgrade_requests';
  const ok = await showConfirm('Xóa giao dịch', 'Xóa bản ghi giao dịch này?', 'danger');
  if (!ok) return;
  try {
    await db.collection(col).doc(id).delete();
    showToast('success', 'Đã xóa', 'Giao dịch đã bị xóa');
    loadPayments(getActiveTab('paymentsTabGroup'));
  } catch (e) {
    showToast('error', 'Lỗi', e.message);
  }
}

async function deleteSelectedPayments() {
  const ids = Array.from(selectedPaymentsIds);
  const items = state.payments.docs
    .filter((item) => ids.includes(item.docId))
    .filter((item) =>
      ['cancelled', 'expired', 'failed', 'waiting_for_payment'].includes(item.data.status || '')
    );
  if (!items.length) {
    showToast(
      'warning',
      'Không thể xóa',
      'Chỉ có thể xóa các giao dịch hết hạn, đã hủy hoặc chờ thanh toán.'
    );
    return;
  }
  const ok = await showConfirm('Xóa tất cả', `Xóa ${items.length} giao dịch?`, 'danger');
  if (!ok) return;
  let failed = 0;
  for (const item of items) {
    try {
      const col = item.type === 'featured' ? 'featured_upgrade_requests' : 'slot_upgrade_requests';
      await db.collection(col).doc(item.docId).delete();
    } catch (e) {
      failed++;
    }
  }
  if (failed === 0) showToast('success', 'Thành công', `Đã xóa ${items.length} giao dịch.`);
  else
    showToast(
      'warning',
      'Một phần',
      `Xóa ${items.length - failed}/${items.length}. ${failed} lỗi.`
    );
  loadPayments(getActiveTab('paymentsTabGroup'));
}

// ????????????????????????????????????????
// SELECTION TOGGLES � Featured & Payments
// ????????????????????????????????????????
function updateFeaturedSelectAllState(pageDocs) {
  const selectAll = document.getElementById('selectAllFeatured');
  if (!selectAll) return;
  if (!pageDocs || pageDocs.length === 0) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    return;
  }
  const selectedCount = pageDocs.filter((doc) => selectedFeaturedIds.has(doc.id)).length;
  selectAll.checked = selectedCount === pageDocs.length;
  selectAll.indeterminate = selectedCount > 0 && selectedCount < pageDocs.length;
}
function toggleFeaturedSelection(id, checked) {
  if (checked) selectedFeaturedIds.add(id);
  else selectedFeaturedIds.delete(id);
  updateFeaturedSelectAllState(
    getFilteredFeaturedDocs().slice(
      (state.featured.page - 1) * PAGE_SIZE,
      state.featured.page * PAGE_SIZE
    )
  );
}
function toggleSelectAllFeatured(checked) {
  const pageDocs = getFilteredFeaturedDocs().slice(
    (state.featured.page - 1) * PAGE_SIZE,
    state.featured.page * PAGE_SIZE
  );
  pageDocs.forEach((doc) => {
    if (checked) selectedFeaturedIds.add(doc.id);
    else selectedFeaturedIds.delete(doc.id);
  });
  renderFeaturedRequests();
}

function updatePaymentsSelectAllState(pageDocs) {
  const selectAll = document.getElementById('selectAllPayments');
  if (!selectAll) return;
  if (!pageDocs || pageDocs.length === 0) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    return;
  }
  const selectedCount = pageDocs.filter((doc) => selectedPaymentsIds.has(doc.docId)).length;
  selectAll.checked = selectedCount === pageDocs.length;
  selectAll.indeterminate = selectedCount > 0 && selectedCount < pageDocs.length;
}
function togglePaymentsSelection(id, checked) {
  if (checked) selectedPaymentsIds.add(id);
  else selectedPaymentsIds.delete(id);
  updatePaymentsSelectAllState(
    getFilteredPaymentsDocs().slice(
      (state.payments.page - 1) * PAGE_SIZE,
      state.payments.page * PAGE_SIZE
    )
  );
}
function toggleSelectAllPayments(checked) {
  const pageDocs = getFilteredPaymentsDocs().slice(
    (state.payments.page - 1) * PAGE_SIZE,
    state.payments.page * PAGE_SIZE
  );
  pageDocs.forEach((doc) => {
    if (checked) selectedPaymentsIds.add(doc.docId);
    else selectedPaymentsIds.delete(doc.docId);
  });
  renderPayments();
}
