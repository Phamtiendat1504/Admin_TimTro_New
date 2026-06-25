// ════════════════════════════════════════
// PAGINATION STATE
// ════════════════════════════════════════

function sortDocs(docs, sort) {
  const c = [...docs];
  if (sort === 'newest')
    return c.sort((a, b) => (b.data().createdAt || 0) - (a.data().createdAt || 0));
  if (sort === 'oldest')
    return c.sort((a, b) => (a.data().createdAt || 0) - (b.data().createdAt || 0));
  if (sort === 'price_asc') return c.sort((a, b) => (a.data().price || 0) - (b.data().price || 0));
  if (sort === 'price_desc') return c.sort((a, b) => (b.data().price || 0) - (a.data().price || 0));
  if (sort === 'name_asc')
    return c.sort((a, b) => (a.data().fullName || '').localeCompare(b.data().fullName || ''));
  if (sort === 'name_desc')
    return c.sort((a, b) => (b.data().fullName || '').localeCompare(a.data().fullName || ''));
  return c;
}

function renderPagination(containerId, key, total) {
  const el = document.getElementById(containerId);
  if (!el) return;

  // --- Cursor mode: chỉ hiển thị Trước / Sau ---
  if (key === 'posts' && cursorMode.posts.active) {
    const cur = cursorMode.posts;
    let html = `<span style="font-size:12px;color:#64748b;margin-right:8px;">Trang ${cur.currentPage + 1}</span>`;
    if (cur.currentPage > 0)
      html += `<button class="page-btn" onclick="goPostsCursorPrev()">← Trước</button>`;
    if (cur.hasMore)
      html += `<button class="page-btn" onclick="goPostsCursorNext()">Sau →</button>`;
    el.innerHTML = html;
    return;
  }
  if (key === 'users' && cursorMode.users.active) {
    const cur = cursorMode.users;
    let html = `<span style="font-size:12px;color:#64748b;margin-right:8px;">Trang ${cur.currentPage + 1}</span>`;
    if (cur.currentPage > 0)
      html += `<button class="page-btn" onclick="goUsersCursorPrev()">← Trước</button>`;
    if (cur.hasMore)
      html += `<button class="page-btn" onclick="goUsersCursorNext()">Sau →</button>`;
    el.innerHTML = html;
    return;
  }

  // --- Client-side mode: số trang truyền thống ---
  const totalPages = Math.ceil(total / PAGE_SIZE);
  if (totalPages <= 1) {
    el.innerHTML = '';
    return;
  }
  const cur = state[key].page;
  let html = '';
  if (cur > 1)
    html += `<button class="page-btn" onclick="goPage('${key}',${cur - 1})">← Trước</button>`;
  for (let i = Math.max(1, cur - 2); i <= Math.min(totalPages, cur + 2); i++) {
    html += `<button class="page-btn ${i === cur ? 'active' : ''}" onclick="goPage('${key}',${i})">${i}</button>`;
  }
  if (cur < totalPages)
    html += `<button class="page-btn" onclick="goPage('${key}',${cur + 1})">Sau →</button>`;
  el.innerHTML = html;
}

function renderResultInfo(containerId, page, total) {
  const el = document.getElementById(containerId);
  if (!el) return;
  // Cursor mode: hiển thị thông tin trang
  if (containerId === 'postsResultInfo' && cursorMode.posts.active) {
    el.textContent = `Trang ${cursorMode.posts.currentPage + 1}${cursorMode.posts.hasMore ? ' (còn trang tiếp)' : ' (trang cuối)'}`;
    return;
  }
  if (containerId === 'usersResultInfo' && cursorMode.users.active) {
    el.textContent = `Trang ${cursorMode.users.currentPage + 1}${cursorMode.users.hasMore ? ' (còn trang tiếp)' : ' (trang cuối)'}`;
    return;
  }
  if (total === 0) {
    el.textContent = '';
    return;
  }
  const from = Math.min((page - 1) * PAGE_SIZE + 1, total);
  const to = Math.min(page * PAGE_SIZE, total);
  el.textContent =
    total < MAX_SEARCH_DOCS
      ? `Hiển thị ${from}–${to} trong tổng ${total} kết quả`
      : `Hiển thị ${from}–${to} trong ${total} kết quả (giới hạn ${MAX_SEARCH_DOCS} bản ghi gần nhất)`;
}

function goPage(key, page) {
  state[key].page = page;
  if (key === 'posts') renderPosts();
  if (key === 'users') renderUsers();
  if (key === 'support') renderSupportTickets();
  if (key === 'featured') renderFeaturedRequests();
  if (key === 'payments') renderPayments();
  if (key === 'appointments') renderAppointments();
}

// ════════════════════════════════════════
// POSTS — Dual-mode pagination
// - Cursor mode  : không có search/filter → Firestore startAfter, load PAGE_SIZE/lần
// - Search mode  : có search/filter    → load MAX_SEARCH_DOCS, filter client-side
// ════════════════════════════════════════
async function loadPosts(filter) {
  const tbody = document.getElementById('postsTableBody');
  tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state">Đang tải...</div></td></tr>';

  const isSearchMode = !!(
    postsSearchKeyword ||
    postsPhuongFilter ||
    postsXaFilter ||
    dateFilterState.posts.fromMs ||
    dateFilterState.posts.toMs
  );

  // Reset cursor khi filter thay đổi hoặc mode thay đổi
  if (cursorMode.posts.filter !== filter || cursorMode.posts.active === isSearchMode) {
    cursorMode.posts.pageStarts = [null];
    cursorMode.posts.currentPage = 0;
    cursorMode.posts.hasMore = false;
    cursorMode.posts.filter = filter;
  }

  try {
    if (isSearchMode) {
      // === Search mode: load tối đa MAX_SEARCH_DOCS ===
      cursorMode.posts.active = false;
      let q = db.collection('rooms');
      if (filter !== 'all') q = q.where('status', '==', filter);
      q = q.orderBy('createdAt', 'desc').limit(MAX_SEARCH_DOCS);
      const snap = await q.get();
      state.posts.docs = sortDocs(snap.docs, state.posts.sort);
    } else {
      // === Cursor mode: load đúng PAGE_SIZE+1 (để detect hasMore) ===
      cursorMode.posts.active = true;
      const cursor = cursorMode.posts.pageStarts[cursorMode.posts.currentPage];
      let q = db.collection('rooms');
      if (filter !== 'all') q = q.where('status', '==', filter);
      q = q.orderBy('createdAt', 'desc').limit(PAGE_SIZE + 1);
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.get();
      cursorMode.posts.hasMore = snap.docs.length > PAGE_SIZE;
      state.posts.docs = snap.docs.slice(0, PAGE_SIZE);
    }

    state.posts.page = 1;
    populatePostLocationFilterOptions();
    renderPosts();
  } catch (e) {
    tbody.innerHTML =
      '<tr><td colspan="7"><div class="empty-state">Lỗi tải dữ liệu</div></td></tr>';
    console.error('[Posts] loadPosts lỗi:', e);
  }
}

// Nâng trang tiếp trong cursor mode
window.goPostsCursorNext = async function () {
  if (!cursorMode.posts.hasMore) return;
  const lastDoc = state.posts.docs[state.posts.docs.length - 1];
  if (!lastDoc) return;
  const nextPage = cursorMode.posts.currentPage + 1;
  if (cursorMode.posts.pageStarts.length <= nextPage) {
    cursorMode.posts.pageStarts.push(lastDoc); // lưu cursor đầu trang tiếp
  }
  cursorMode.posts.currentPage = nextPage;
  await loadPosts(cursorMode.posts.filter);
};

// Quay về trang trước trong cursor mode
window.goPostsCursorPrev = async function () {
  if (cursorMode.posts.currentPage <= 0) return;
  cursorMode.posts.currentPage--;
  await loadPosts(cursorMode.posts.filter);
};

function getFilteredPostsDocs() {
  let all = state.posts.docs;
  if (postsSearchKeyword) {
    const kw = postsSearchKeyword;
    all = all.filter((doc) => {
      const d = doc.data();
      const haystack = normalizeVietnameseText(
        [d.title || '', d.ownerName || '', d.address || '', d.ward || '', d.district || ''].join(
          ' '
        )
      );
      return haystack.includes(kw);
    });
  }
  if (postsPhuongFilter) {
    const phuongNeedle = normalizeVietnameseText(postsPhuongFilter);
    all = all.filter((doc) => {
      const d = doc.data();
      const ward = normalizeVietnameseText(d.ward || '');
      return ward === phuongNeedle;
    });
  }
  if (postsXaFilter) {
    const xaNeedle = normalizeVietnameseText(postsXaFilter);
    all = all.filter((doc) => {
      const d = doc.data();
      const ward = normalizeVietnameseText(d.ward || '');
      return ward === xaNeedle;
    });
  }
  return all.filter((doc) => isInDateRange(doc.data().createdAt, dateFilterState.posts));
}

function updatePostsSelectAllState(pageDocs) {
  const selectAll = document.getElementById('postsSelectAll');
  if (!selectAll) return;
  if (!pageDocs || pageDocs.length === 0) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    return;
  }
  const selectedCount = pageDocs.filter((doc) => selectedPostIds.has(doc.id)).length;
  selectAll.checked = selectedCount === pageDocs.length;
  selectAll.indeterminate = selectedCount > 0 && selectedCount < pageDocs.length;
}

function renderPosts() {
  const tbody = document.getElementById('postsTableBody');
  const all = getFilteredPostsDocs();
  const total = all.length;
  if (total === 0) {
    tbody.innerHTML =
      '<tr><td colspan="7"><div class="empty-state"><i class="fas fa-file-alt"></i>Không có bài đăng nào</div></td></tr>';
    renderResultInfo('postsResultInfo', 1, 0);
    document.getElementById('postsPagination').innerHTML = '';
    updatePostsSelectAllState([]);
    return;
  }
  renderResultInfo('postsResultInfo', state.posts.page, total);
  renderPagination('postsPagination', 'posts', total);
  const page = cursorMode.posts.active
    ? state.posts.docs // cursor mode: toàn bộ docs đã là 1 trang
    : all.slice((state.posts.page - 1) * PAGE_SIZE, state.posts.page * PAGE_SIZE);
  tbody.innerHTML = page
    .map((doc) => {
      const d = doc.data();
      const s = (d.status || 'pending').toLowerCase();

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

      const safeTitle = (d.title || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `<tr data-created-at="${toEpochMs(d.createdAt)}">
      <td style="text-align:center">
        <input type="checkbox" ${selectedPostIds.has(doc.id) ? 'checked' : ''} onchange="togglePostSelection('${doc.id}', this.checked)">
      </td>
      <td>
        <div class="td-user">
          <div class="td-avatar" style="border-radius:10px;background:#f1f5f9"><i class="fas fa-home" style="color:#94a3b8"></i></div>
          <div><div class="td-name" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(d.title || 'Chưa có tiêu đề')}</div>
          <div class="td-email">${escapeHtml(d.ownerName || '')}</div></div>
        </div>
      </td>
      <td><div style="font-size:12px;color:#64748b;font-weight:600;max-width:160px">${escapeHtml(d.ward || d.district || '')}</div></td>
      <td>
        <div style="font-size:13px;font-weight:800;color:#0f172a">${fmt(d.price || 0)} đ</div>
        <div style="font-size:11px;color:#94a3b8;font-weight:600">${d.area || 0} m²</div>
      </td>
      <td>
        <span style="font-size:12px;color:#94a3b8;font-weight:600">${fmtDate(d.createdAt)}</span>
        ${s === 'rented' ? `<div style="font-size:10px;color:#6366f1;font-weight:700;margin-top:2px">Thuê lúc: ${fmtDate(d.rentedAt)}</div>` : ''}
      </td>
      <td><span class="badge ${bc}">${bt}</span></td>
      <td style="text-align:right">
        <div class="list-actions">
          <button class="btn btn-view" onclick="viewPost('${doc.id}')">Xem</button>
          ${
            s === 'pending'
              ? `
            <button class="btn btn-approve" onclick="approvePost('${doc.id}','${d.userId}','${safeTitle}')">Duyệt</button>
            <button class="btn btn-reject"  onclick="rejectPost('${doc.id}','${d.userId}','${safeTitle}')">Từ chối</button>
          `
              : ''
          }
          ${
            s === 'approved' || s === 'rented' || s === 'rejected' || s === 'expired'
              ? `
            <button class="btn btn-delete" onclick="deletePost('${doc.id}')"><i class="fas fa-trash"></i></button>
          `
              : ''
          }
        </div>
      </td>
    </tr>`;
    })
    .join('');
  updatePostsSelectAllState(page);
}

function normalizeVietnameseText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd')
    .replace(/\u0110/g, 'D')
    .toLowerCase()
    .trim();
}

const ADDRESS_PHUONG = [
  'Ba Đình',
  'Bạch Mai',
  'Bồ Đề',
  'Cầu Giấy',
  'Chương Mỹ',
  'Cửa Nam',
  'Dương Nội',
  'Đại Mỗ',
  'Định Công',
  'Đông Ngạc',
  'Đống Đa',
  'Giảng Võ',
  'Hà Đông',
  'Hai Bà Trưng',
  'Hoàn Kiếm',
  'Hoàng Liệt',
  'Hoàng Mai',
  'Hồng Hà',
  'Khương Đình',
  'Kiến Hưng',
  'Kim Liên',
  'Láng',
  'Lĩnh Nam',
  'Long Biên',
  'Nghĩa Đô',
  'Ngọc Hà',
  'Ô Chợ Dừa',
  'Phú Diễn',
  'Phú Lương',
  'Phú Thượng',
  'Phúc Lợi',
  'Phương Liệt',
  'Sơn Tây',
  'Tây Hồ',
  'Tây Mỗ',
  'Tây Tựu',
  'Thanh Liệt',
  'Thanh Xuân',
  'Thượng Cát',
  'Từ Liêm',
  'Tùng Thiện',
  'Tương Mai',
  'Văn Miếu - Quốc Tử Giám',
  'Việt Hưng',
  'Vĩnh Hưng',
  'Vĩnh Tuy',
  'Xuân Đỉnh',
  'Xuân Phương',
  'Yên Hòa',
  'Yên Nghĩa',
  'Yên Sở',
];

const ADDRESS_XA = [
  'An Tiến',
  'Ba Vì',
  'Bình Minh',
  'Bình Yên',
  'Cao Dương',
  'Châu Can',
  'Chương Dương',
  'Chuyên Mỹ',
  'Cổ Loa',
  'Dân Hòa',
  'Dục Tú',
  'Đa Tốn',
  'Đại Cường',
  'Đại Thanh',
  'Đại Thắng',
  'Đại Xuyên',
  'Đan Phượng',
  'Đông Hội',
  'Đồng Tán',
  'Đồng Tháp',
  'Đường Lâm',
  'Gia Lâm',
  'Hiệp Thuận',
  'Hòa Nam',
  'Hòa Xá',
  'Hồng Vân',
  'Hương Sơn',
  'Hợp Tiến',
  'Khai Thái',
  'Kim An',
  'Kim Bài',
  'Mê Linh',
  'Minh Tân',
  'Mỹ Đức',
  'Nam Phù',
  'Ngọc Hồi',
  'Ngọc Mỹ',
  'Ninh Hiệp',
  'Phú Cát',
  'Phú Xuyên',
  'Phúc Lâm',
  'Phúc Thọ',
  'Phù Đổng',
  'Phù Linh',
  'Phượng Dực',
  'Phương Trung',
  'Quang Trung',
  'Quốc Oai',
  'Sóc Sơn',
  'Song Phượng',
  'Sơn Tây',
  'Tam Hưng',
  'Tân Lập',
  'Tế Tiêu',
  'Tiến Xuân',
  'Tiền Phong',
  'Thạch Thất',
  'Thanh Oai',
  'Thanh Thủy',
  'Thanh Trì',
  'Thống Nhất',
  'Thượng Phúc',
  'Thường Tín',
  'Tòng Bạt',
  'Trâu Quỳ',
  'Tri Thủy',
  'Vạn Điểm',
  'Vạn Thái',
  'Vân Đình',
  'Vân Hà',
  'Vật Lại',
  'Võng Xuyên',
  'Xuân Khanh',
  'Yên Bình',
  'Yên Viên',
];

function populatePostLocationFilterOptions() {
  const selectPhuong = document.getElementById('filterPostPhuong');
  const selectXa = document.getElementById('filterPostXa');
  if (!selectPhuong || !selectXa) return;

  // Điền danh sách Phường
  selectPhuong.innerHTML = [
    '<option value="">Tất cả Phường</option>',
    ...ADDRESS_PHUONG.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`),
  ].join('');

  // Điền danh sách Xã
  selectXa.innerHTML = [
    '<option value="">Tất cả Xã</option>',
    ...ADDRESS_XA.map((x) => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`),
  ].join('');

  selectPhuong.value = postsPhuongFilter || '';
  selectXa.value = postsXaFilter || '';
}

async function filterPostsByLocation(type) {
  const selectPhuong = document.getElementById('filterPostPhuong');
  const selectXa = document.getElementById('filterPostXa');

  if (type === 'phuong') {
    postsPhuongFilter = selectPhuong?.value || '';
    postsXaFilter = ''; // Reset xã khi lọc phường
    if (selectXa) selectXa.value = '';
  } else if (type === 'xa') {
    postsXaFilter = selectXa?.value || '';
    postsPhuongFilter = ''; // Reset phường khi lọc xã
    if (selectPhuong) selectPhuong.value = '';
  }

  state.posts.page = 1;
  // Reset cursor và reload (có location filter → search mode)
  cursorMode.posts.pageStarts = [null];
  cursorMode.posts.currentPage = 0;
  await loadPosts(cursorMode.posts.filter || getActiveTab('postsTabGroup'));
}

function togglePostSelection(postId, checked) {
  if (checked) selectedPostIds.add(postId);
  else selectedPostIds.delete(postId);
  updatePostsSelectAllState(
    getFilteredPostsDocs().slice((state.posts.page - 1) * PAGE_SIZE, state.posts.page * PAGE_SIZE)
  );
}

function toggleSelectAllPosts(checked) {
  const pageDocs = getFilteredPostsDocs().slice(
    (state.posts.page - 1) * PAGE_SIZE,
    state.posts.page * PAGE_SIZE
  );
  pageDocs.forEach((doc) => {
    if (checked) selectedPostIds.add(doc.id);
    else selectedPostIds.delete(doc.id);
  });
  renderPosts();
}

async function deletePostRecordCompletely(docId) {
  const doc = await db.collection('rooms').doc(docId).get();
  let roomTitle = 'Phòng trọ';
  if (doc.exists) {
    const d = doc.data();
    roomTitle = d.title || 'Phòng trọ';
    // 1. Xóa ảnh trên Storage
    if (Array.isArray(d.imageUrls) && d.imageUrls.length > 0) {
      const delImgs = d.imageUrls.map(async (url) => {
        try {
          return storage.refFromURL(url).delete();
        } catch (_) {
          return Promise.resolve();
        }
      });
      await Promise.all(delImgs);
    }
  }

  const now = Date.now();
  const batch = db.batch();

  // 2. Xóa bài lưu trong savedPosts của người thuê
  try {
    const savedSnap = await db.collection('savedPosts').where('roomId', '==', docId).get();
    savedSnap.forEach((sDoc) => {
      batch.delete(sDoc.ref);
    });
  } catch (e) {
    console.error('[Posts] Lỗi quét savedPosts:', e);
  }

  // 3. Xử lý và tự động hủy lịch hẹn của phòng này
  try {
    const apptSnap = await db.collection('appointments').where('roomId', '==', docId).get();
    const activeStatuses = [
      STATUS.APPT.PENDING,
      STATUS.APPT.CONFIRMED,
      STATUS.APPT.TENANT_CONFIRMED,
    ];

    for (const aDoc of apptSnap.docs) {
      const apptData = aDoc.data();
      const apptId = aDoc.id;
      const status = apptData.status || '';

      // Hủy lịch hẹn
      batch.update(aDoc.ref, {
        status: 'cancelled_by_system',
        hasUnreadUpdate: true,
        updatedAt: now,
      });

      // Xóa slot đặt trong bookedSlots
      try {
        const slotsSnap = await db
          .collection('bookedSlots')
          .where('appointmentId', '==', apptId)
          .get();
        slotsSnap.forEach((slotDoc) => {
          batch.delete(slotDoc.ref);
        });
      } catch (slotErr) {
        console.error('[Posts] Lỗi xóa bookedSlots:', slotErr);
      }

      // Gửi thông báo cho người thuê nếu lịch hẹn đang hoạt động
      if (activeStatuses.includes(status)) {
        const tenantId = apptData.tenantId;
        if (tenantId) {
          await sendNotification(
            tenantId,
            'Lịch hẹn bị hủy',
            `Phòng trọ "${roomTitle}" trong lịch hẹn xem phòng của bạn đã bị gỡ bỏ khỏi hệ thống. Lịch hẹn tự động hủy.`,
            'room_already_rented'
          );
        }
      }
    }
  } catch (e) {
    console.error('[Posts] Lỗi xử lý appointments:', e);
  }

  // 4. Xóa chính bài trọ
  batch.delete(db.collection('rooms').doc(docId));

  // Thực thi batch write để tối ưu hóa hiệu suất
  await batch.commit();

  selectedPostIds.delete(docId);
}

async function deleteSelectedPosts() {
  const ids = Array.from(selectedPostIds);
  if (ids.length === 0) {
    showToast('warning', 'Chưa chọn bài đăng', 'Hãy tick chọn ít nhất 1 bài để xóa.');
    return;
  }
  const ok = await showConfirm(
    'Xóa bài đã chọn',
    `Bạn sắp xóa ${ids.length} bài đăng. Hành động này không thể hoàn tác.`,
    'danger'
  );
  if (!ok) return;

  showToast('info', 'Đang xử lý', `Đang tiến hành xóa ${ids.length} bài đăng...`, 3500);
  let failed = 0;
  for (const id of ids) {
    try {
      await deletePostRecordCompletely(id);
    } catch (e) {
      failed++;
      console.error(`[Posts] Không thể xóa bài ${id}:`, e);
    }
  }

  const deleted = ids.length - failed;
  if (failed === 0) {
    showToast('success', 'Thành công', `Đã xóa ${deleted} bài đăng.`);
  } else {
    showToast(
      'warning',
      'Hoàn tất một phần',
      `Đã xóa ${deleted}/${ids.length} bài. ${failed} bài lỗi, kiểm tra console log.`
    );
  }
  loadPosts(getActiveTab('postsTabGroup'));
}

async function viewPost(docId) {
  try {
    const doc = await db.collection('rooms').doc(docId).get();
    if (!doc.exists) {
      showToast('error', 'Lỗi', 'Bài đăng không tồn tại');
      return;
    }
    const d = doc.data();

    // Luôn dùng SĐT snapshot lúc đăng bài (ownerPhone trong room doc).
    // Không fetch live từ users collection để tránh SĐT thay đổi theo profile.
    const liveOwnerPhone = d.ownerPhone || 'N/A';

    const statusMap = {
      pending: { label: 'Chờ duyệt', cls: 'badge-pending' },
      approved: { label: 'Đã duyệt', cls: 'badge-approved' },
      rented: { label: 'Đã cho thuê', cls: 'badge-landlord' },
      rejected: { label: 'Từ chối', cls: 'badge-rejected' },
      expired: { label: 'Hết hạn', cls: 'badge-rejected' },
    };
    const statusKey = String(d.status || 'pending').toLowerCase();
    const statusInfo = statusMap[statusKey] || { label: d.status || 'N/A', cls: 'badge-pending' };
    const sf = (v) =>
      String(v || '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'");

    // ── Images ──────────────────────────────────────────────────────────────
    const images = Array.isArray(d.imageUrls) ? d.imageUrls.filter(Boolean) : [];
    const mainImage = images[0] || '';
    const thumbImgs = images.slice(1, 13);

    // ── Amenities (match app: setupAmenities) ────────────────────────────────
    const aqty = (key) => Number(d[key] || 0);
    const alabel = (name, qty) => (qty > 1 ? `${name} x${qty}` : name);
    const amenityList = [
      d.hasAirCon && alabel('Điều hòa', aqty('airConQty')),
      d.hasWaterHeater && alabel('Bình nóng lạnh', aqty('waterHeaterQty')),
      d.hasWasher && alabel('Máy giặt', aqty('washerQty')),
      d.hasDryingArea && alabel('Sân phơi đồ', aqty('dryingAreaQty')),
      d.hasWardrobe && alabel('Tủ quần áo', aqty('wardrobeQty')),
      d.hasBed && alabel('Giường ngủ', aqty('bedQty')),
    ].filter(Boolean);

    // Đồ dùng thêm (furnitureItems)
    const furnitureItems = Array.isArray(d.furnitureItems) ? d.furnitureItems : [];
    furnitureItems.forEach((item) => {
      const name = item.name || '';
      const qty = Number(item.qty || 1);
      if (name) amenityList.push(qty > 1 ? `${name} x${qty}` : name);
    });

    // Dịch vụ thêm (serviceItems)
    const serviceItems = Array.isArray(d.serviceItems) ? d.serviceItems : [];
    const serviceList = serviceItems
      .filter((item) => item.name)
      .map((item) => {
        const price = Number(item.price || 0);
        return price > 0 ? `${item.name} - ${fmt(price)} đ/tháng` : item.name;
      });

    // ── Parking (match app) ──────────────────────────────────────────────────
    const motorbikeFee = Number(d.motorbikeFee || 0);
    const eBikeFee = Number(d.eBikeFee || d.ebikeFee || 0);
    const bicycleFee = Number(d.bicycleFee || 0);
    const parkingList = [
      d.hasMotorbike && `Xe máy (${motorbikeFee > 0 ? fmt(motorbikeFee) + ' đ/xe' : 'miễn phí'})`,
      d.hasEBike && `Xe đạp điện (${eBikeFee > 0 ? fmt(eBikeFee) + ' đ/xe' : 'miễn phí'})`,
      d.hasBicycle && `Xe đạp (${bicycleFee > 0 ? fmt(bicycleFee) + ' đ/xe' : 'miễn phí'})`,
    ].filter(Boolean);

    // ── Costs ────────────────────────────────────────────────────────────────
    const deposit = Number(d.depositAmount || 0);
    const depositMonths = Number(d.depositMonths || 0);
    const electricPrice = Number(d.electricPrice || 0);
    const waterPrice = Number(d.waterPrice || 0);
    const wifiPrice = Number(d.wifiPrice || 0);
    const otherFees = Array.isArray(d.otherFees) ? d.otherFees : [];

    // ── Rules ────────────────────────────────────────────────────────────────
    const pet = d.pet || '';
    const petDetail =
      pet === 'Cho nuôi'
        ? [d.petName, d.petCount > 0 ? `${d.petCount} con` : ''].filter(Boolean).join(', ')
        : '';
    const curfewText =
      d.curfew === 'Tùy chọn' && d.curfewTime ? `Đóng cửa lúc ${d.curfewTime}` : d.curfew || '';

    // ── Helpers ──────────────────────────────────────────────────────────────
    const row = (label, value) =>
      value
        ? `<div class="pv-row"><span class="pv-label">${label}</span><span class="pv-value">${escapeHtml(String(value))}</span></div>`
        : '';
    const section = (icon, title, content) =>
      content.trim()
        ? `<div class="pv-section"><div class="pv-section-title">${title}</div>${content}</div>`
        : '';
    const tags = (items) =>
      items.length
        ? `<div class="pv-tags">${items.map((i) => `<span class="pv-tag">${escapeHtml(i)}</span>`).join('')}</div>`
        : '<div class="pv-empty">Không có</div>';

    const locationText =
      [...new Set([d.address, d.ward, d.district].filter(Boolean))].join(', ') || 'Chưa cập nhật';
    const safeTitle = sf(d.title || '');

    showModal(`
      <div data-modal-size="post">
        <div class="post-modal-head">
          <div class="post-modal-title">${escapeHtml(d.title || 'Chi tiết bài đăng')}</div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
            ${d.isFeatured ? '<span class="badge badge-approved"><i class="fas fa-star" style="margin-right:3px;font-size:9px"></i>Nổi bật</span>' : ''}
            <span class="badge ${statusInfo.cls}">${statusInfo.label}</span>
          </div>
        </div>

        <div class="post-modal-grid">

          <!-- LEFT: thông tin chi tiết -->
          <div class="pv-scroll">

            ${section(
              '📋',
              'Thông tin cơ bản',
              row('Chủ trọ', d.ownerName || 'N/A') +
                row('Giới tính chủ trọ', d.ownerGender) +
                row('Số điện thoại', liveOwnerPhone) +
                row('Giá thuê', `${fmt(d.price || 0)} đ/tháng`) +
                row('Diện tích', `${d.area || 0} m²`) +
                row('Số người tối đa', d.peopleCount ? `${d.peopleCount} người` : '') +
                row('Loại phòng', d.roomType) +
                row('Tổng số phòng', d.roomCount > 0 ? `${d.roomCount} phòng` : '') +
                row('Đã cho thuê', d.rentedCount > 0 ? `${d.rentedCount} phòng` : '') +
                row('Ưu tiên giới tính', d.genderPrefer) +
                row('Ngày đăng', fmtDate(d.createdAt)) +
                (d.postExpiryDate > 0 ? row('Hết hạn hiển thị', fmtDate(d.postExpiryDate)) : '') +
                row('UID chủ trọ', d.userId)
            )}

            ${
              d.availableTimeSlots
                ? section(
                    '🕐',
                    'Khung giờ nhận lịch hẹn',
                    `<div class="pv-desc" style="white-space:pre-line">${escapeHtml(d.availableTimeSlots)}</div>`
                  )
                : ''
            }

            ${section(
              '💰',
              'Chi phí',
              (deposit > 0 ? row('Tiền đặt cọc', `${fmt(deposit)} đ`) : '') +
                (depositMonths > 0 ? row('Số tháng cọc', `${depositMonths} tháng`) : '') +
                (electricPrice > 0 ? row('Tiền điện', `${fmt(electricPrice)} đ/kWh`) : '') +
                (waterPrice > 0 ? row('Tiền nước', `${fmt(waterPrice)} đ/m³`) : '') +
                (d.hasWifi
                  ? row('Wifi', wifiPrice > 0 ? `${fmt(wifiPrice)} đ/tháng` : 'Miễn phí')
                  : '') +
                otherFees
                  .filter((f) => f.label)
                  .map((f) => row(f.label, `${fmt(Number(f.price || 0))} đ/tháng`))
                  .join('')
            )}

            ${section(
              '🛋️',
              'Nội thất & Tiện ích',
              tags(amenityList) +
                (parkingList.length ? `<div style="margin-top:8px">${tags(parkingList)}</div>` : '')
            )}

            ${serviceList.length ? section('⚙️', 'Dịch vụ thêm', tags(serviceList)) : ''}

            ${section(
              '📋',
              'Quy định & Cơ sở vật chất',
              row('Phòng bếp', d.kitchen) +
                row('Phòng vệ sinh', d.bathroom) +
                row('Giờ giấc', curfewText) +
                row(
                  'Thú cưng',
                  pet ? (pet === 'Cho nuôi' && petDetail ? `${pet} (${petDetail})` : pet) : ''
                )
            )}

            ${section(
              '📍',
              'Địa chỉ',
              `<div class="pv-value" style="text-align:left;padding:2px 0">${escapeHtml(locationText)}</div>` +
                (d.latitude && d.longitude
                  ? `<div style="margin-top:6px"><a href="https://www.google.com/maps?q=${d.latitude},${d.longitude}" target="_blank" style="font-size:12px;color:#4f46e5;text-decoration:none">🗺️ Xem trên Google Maps</a></div>`
                  : '')
            )}

            ${section(
              '📝',
              'Mô tả',
              `<div class="pv-desc">${escapeHtml(d.description || 'Không có mô tả')}</div>`
            )}

          </div>

          <!-- RIGHT: ảnh -->
          <div style="border:1px solid var(--border);border-radius:12px;background:#fafbfc;overflow:hidden">
            ${
              mainImage
                ? `<img src="${escapeHtml(mainImage)}" alt="Ảnh chính" class="post-gallery-main" onclick="showFullscreenImage('${sf(mainImage)}')">`
                : `<div class="empty-state" style="padding:40px 14px"><i class="fas fa-image"></i>Chưa có ảnh</div>`
            }
            ${
              thumbImgs.length
                ? `<div class="post-gallery-thumbs">
                  ${thumbImgs.map((img) => `<img src="${escapeHtml(img)}" alt="" class="post-gallery-thumb" onclick="showFullscreenImage('${sf(img)}')">`).join('')}
                </div>`
                : ''
            }
          </div>

        </div>
      </div>

      <div class="modal-actions">
        <button class="btn btn-view" onclick="closeModal()">Đóng</button>
        ${
          d.status === 'pending'
            ? `
          <button class="btn btn-approve" onclick="approvePost('${docId}','${escapeHtml(d.userId || '')}','${safeTitle}');closeModal()">
            <i class="fas fa-check"></i> Duyệt
          </button>
          <button class="btn btn-reject" onclick="rejectPost('${docId}','${escapeHtml(d.userId || '')}','${safeTitle}');closeModal()">
            <i class="fas fa-times"></i> Từ chối
          </button>
        `
            : ''
        }
        ${
          d.status === 'approved' ||
          d.status === 'rented' ||
          d.status === 'rejected' ||
          d.status === 'expired'
            ? `
          <button class="btn btn-delete" onclick="deletePost('${docId}');closeModal()">
            <i class="fas fa-trash"></i> Xóa bài
          </button>
        `
            : ''
        }
      </div>`);
  } catch (e) {
    showToast('error', 'Lỗi', e.message);
  }
}

async function approvePost(docId, userId, title) {
  const ok = await showConfirm(
    'Duyệt bài đăng',
    'Xác nhận duyệt bài đăng phòng trọ này?',
    'success'
  );
  if (!ok) return;
  try {
    const roomRef = db.collection('rooms').doc(docId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(roomRef);
      if (!snap.exists) throw new Error('Bài đăng không tồn tại.');
      if (snap.data().status !== 'pending')
        throw new Error('Bài đăng này đã được xử lý bởi một admin khác.');
      tx.update(roomRef, { status: 'approved', rejectReason: '' });
    });
    await sendNotification(
      userId,
      'Bài đăng đã được duyệt!',
      `Bài đăng "${title}" đã được admin duyệt và hiển thị trên ứng dụng.`,
      'post_approved'
    );
    showToast('success', 'Thành công', 'Bài đăng đã được duyệt!');
    loadPosts(getActiveTab('postsTabGroup'));
  } catch (e) {
    showToast('error', 'Lỗi', e.message);
  }
}

async function rejectPost(docId, userId, title) {
  const reason = await showPrompt(
    'Từ chối bài đăng',
    'Nhập lý do từ chối bài đăng:',
    'Lý do từ chối...'
  );
  if (reason === null) return;
  const trimmedReason = reason.trim();
  if (trimmedReason.length < 5) {
    showToast('warning', 'Cảnh báo', 'Lý do phải ít nhất 5 ký tự');
    return;
  }
  try {
    const roomRef = db.collection('rooms').doc(docId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(roomRef);
      if (!snap.exists) throw new Error('Bài đăng không tồn tại.');
      if (snap.data().status !== 'pending')
        throw new Error('Bài đăng này đã được xử lý bởi một admin khác.');
      tx.update(roomRef, { status: 'rejected', rejectReason: trimmedReason });
    });
    await sendNotification(
      userId,
      'Bài đăng bị từ chối',
      `Bài đăng "${title}" bị từ chối. Lý do: ${trimmedReason}`,
      'post_rejected'
    );
    showToast('warning', 'Đã từ chối', 'Bài đăng đã bị từ chối.');
    loadPosts(getActiveTab('postsTabGroup'));
  } catch (e) {
    showToast('error', 'Lỗi', e.message);
  }
}

function filterPostsSearch() {
  clearTimeout(postsSearchTimeout);
  postsSearchTimeout = setTimeout(async () => {
    const kw = document.getElementById('searchPost').value;
    postsSearchKeyword = normalizeVietnameseText(kw);
    state.posts.page = 1;
    // Reset cursor và reload (sẽ tự chọn mode phù hợp)
    cursorMode.posts.pageStarts = [null];
    cursorMode.posts.currentPage = 0;
    await loadPosts(cursorMode.posts.filter || getActiveTab('postsTabGroup'));
  }, 300);
}

async function changeSortPosts() {
  state.posts.sort = document.getElementById('sortPosts').value;
  state.posts.page = 1;
  // Khi đổi sort → reset cursor và reload với mode phù hợp
  cursorMode.posts.pageStarts = [null];
  cursorMode.posts.currentPage = 0;
  await loadPosts(cursorMode.posts.filter || getActiveTab('postsTabGroup'));
}

async function deletePost(docId) {
  const ok = await showConfirm(
    'Xóa bài đăng',
    'Bạn có chắc chắn muốn xóa bài đăng này? Hành động này không thể hoàn tác.',
    'danger'
  );
  if (!ok) return;
  try {
    await deletePostRecordCompletely(docId);
    showToast('success', 'Thành công', 'Đã xóa bài đăng!');
    loadPosts(getActiveTab('postsTabGroup'));
  } catch (e) {
    showToast('error', 'Lỗi', 'Không thể xóa bài đăng: ' + e.message);
  }
}
