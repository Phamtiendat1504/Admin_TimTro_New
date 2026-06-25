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

  const headers = ['STT', 'Tiêu đề', 'Địa chỉ', 'Phường/Xã', 'Giá thuê (VNĐ)', 'Diện tích (m²)',
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

