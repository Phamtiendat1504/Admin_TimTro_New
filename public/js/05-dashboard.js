// ════════════════════════════════════════
// REAL-TIME DASHBOARD LISTENERS & AUTO-UNLOCK SWEEP
// ════════════════════════════════════════
function startRealtimeListeners() {
  stopAllListeners();
  usersRealtimeRefreshTimer = null;

  // 1. Luồng logic: Quét mở khóa trên Firestore (10 giây/lần để tiết kiệm Read)
  const unlockInterval = setInterval(() => {
    checkAndUnlockExpiredUsers();
  }, 10000);
  activeListeners.push(() => clearInterval(unlockInterval));

  // NOTE: Không còn interval re-render renderUsers() mỗi giây nữa.
  // startLockCountdowns() trong 08-users.js đã tự xử lý countdown timer riêng.
  // Việc re-render toàn bộ tbody mỗi giây gây flicker và tốn CPU không cần thiết.

  // Chạy quét lần đầu ngay khi khởi động
  checkAndUnlockExpiredUsers();

  activeListeners.push(
    db
      .collection('users')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .onSnapshot(() => {
        // NOTE: Tự động refresh danh sách Users khi có thay đổi mới nhất (giới hạn 1 doc để tiết kiệm Read)
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

  const fetchPending = async () => {
    try {
      const snap = await db
        .collection('rooms')
        .where('status', '==', STATUS.ROOM.PENDING)
        .count()
        .get();
      const p = snap.data().count;
      document.getElementById('statPending').textContent = p;
      setBadge('badgePosts', p);
    } catch (e) {
      console.error('[Dashboard] fetchPending lỗi:', e);
    }
  };
  fetchPending();
  const pendingInterval = setInterval(fetchPending, 30000);
  activeListeners.push(() => clearInterval(pendingInterval));

  activeListeners.push(
    db
      .collection('verifications')
      .where('status', 'in', [
        STATUS.VERIFY.PENDING,
        STATUS.VERIFY.PENDING_ADMIN,
        STATUS.VERIFY.QUEUED_MANUAL,
      ])
      .onSnapshot((snap) => {
        const p = snap.docs.filter((doc) => shouldShowInAdminVerificationQueue(doc.data())).length;
        document.getElementById('statVerify').textContent = p;
        setBadge('badgeVerify', p);
      })
  );

  activeListeners.push(
    db
      .collection('support_tickets')
      .where('unreadForAdmin', '==', true)
      .onSnapshot((snap) => {
        const unread = snap.size;
        setBadge('badgeSupport', unread);
        if (document.getElementById('pageSupport')?.classList.contains('active')) {
          loadSupportTickets(getActiveTab('supportTabGroup'));
        }
      })
  );

  activeListeners.push(
    db
      .collection('featured_upgrade_requests')
      .where('status', 'in', [STATUS.PAYMENT.PAID, STATUS.PAYMENT.PAID_PENDING])
      .onSnapshot((snap) => {
        const pending = snap.size;
        setBadge('badgeFeatured', pending);
        if (document.getElementById('pageFeatured')?.classList.contains('active')) {
          loadFeaturedRequests(getActiveTab('featuredTabGroup'));
        }
      })
  );
}

function setBadge(id, count) {
  const el = document.getElementById(id);
  if (!el) return;
  if (count > 0) {
    el.textContent = count;
    el.classList.add('show');
  } else {
    el.classList.remove('show');
  }
}

// ════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════
async function loadDashboard() {
  try {
    // Kéo dữ liệu thống kê từ Cloud Function thay vì kéo toàn bộ collections
    const getDashboardStats = functions.httpsCallable('getDashboardStats');

    // Vẫn kéo 5 bài đăng và 5 user mới nhất cho phần list (giới hạn 5 docs, chi phí rất thấp)
    const [postsSnap, usersSnap, statsRes] = await Promise.all([
      db
        .collection('rooms')
        .where('status', '==', STATUS.ROOM.PENDING)
        .orderBy('createdAt', 'desc')
        .limit(5)
        .get(),
      db.collection('users').orderBy('createdAt', 'desc').limit(5).get(),
      getDashboardStats(),
    ]);

    const stats = statsRes.data;

    // Cập nhật tổng số (kể cả không có listener realtime)
    document.getElementById('statUsers').textContent = stats.totalUsers || 0;
    document.getElementById('statPosts').textContent = stats.totalRooms || 0;

    // Charts disabled — canvases hidden in UI

    const postsEl = document.getElementById('dashRecentPosts');
    if (postsSnap.empty) {
      postsEl.innerHTML =
        '<div class="empty-state"><i class="fas fa-file-alt"></i>Không có bài chờ duyệt</div>';
    } else {
      postsEl.innerHTML = postsSnap.docs
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
          }

          return `<div class="list-item" data-created-at="${toEpochMs(d.createdAt)}">
          <div class="list-avatar"><i class="fas fa-file-alt"></i></div>
          <div class="list-info">
            <div class="list-name">${escapeHtml(d.title || 'Chưa có tiêu đề')}</div>
            <div class="list-meta">${escapeHtml(d.ward || d.district || '')} &bull; ${fmt(d.price || 0)} đ/tháng</div>
          </div>
          <span class="badge ${bc}">${bt}</span>
        </div>`;
        })
        .join('');
    }

    const usersEl = document.getElementById('dashRecentUsers');
    if (usersSnap.empty) {
      usersEl.innerHTML =
        '<div class="empty-state"><i class="fas fa-users"></i>Chưa có người dùng</div>';
    } else {
      usersEl.innerHTML = usersSnap.docs
        .map((doc) => {
          const d = doc.data();
          const roleLabel = d.role === 'admin' ? 'Admin' : 'User';
          const roleClass = d.role === 'admin' ? 'badge-admin' : 'badge-tenant';
          return `<div class="list-item">
          <div class="list-avatar-user">${escapeHtml((d.fullName || 'U').charAt(0).toUpperCase())}</div>
          <div class="list-info">
            <div class="list-name">${escapeHtml(d.fullName || 'N/A')}</div>
            <div class="list-meta">${escapeHtml(d.email || '')}</div>
          </div>
          <span class="badge ${roleClass}">${roleLabel}</span>
        </div>`;
        })
        .join('');
    }
  } catch (e) {
    console.error('[Dashboard] loadDashboard lỗi:', e);
    showToast('error', 'Lỗi', 'Không thể tải dữ liệu tổng quan: ' + e.message);
  }
}

// Bỏ hàm lọc theo ngày ở client, tính năng này tạm vô hiệu hóa hoặc cần Cloud Function hỗ trợ nếu cần
window.updatePostChartByDate = function () {
  showToast(
    'info',
    'Thông báo',
    'Tính năng lọc biểu đồ theo ngày tạm thời bị vô hiệu hóa để tối ưu hóa hiệu suất hệ thống.'
  );
};

// Render charts từ aggregated data
function renderAggregatedCharts(last6Months, userGroupsParams) {
  const postsCtx = document.getElementById('postsChart').getContext('2d');
  if (postsChartInstance) postsChartInstance.destroy();
  // Create gradient fill for area chart
  const lineGrad = postsCtx.createLinearGradient(0, 0, 0, 300);
  lineGrad.addColorStop(0, 'rgba(37, 99, 235, 0.32)');
  lineGrad.addColorStop(0.62, 'rgba(37, 99, 235, 0.12)');
  lineGrad.addColorStop(1, 'rgba(37, 99, 235, 0)');
  postsChartInstance = new Chart(postsCtx, {
    type: 'line',
    data: {
      labels: last6Months.map((i) => i.label),
      datasets: [
        {
          label: 'Bài đăng mới',
          data: last6Months.map((i) => i.count),
          borderColor: '#2563eb',
          borderWidth: 2.5,
          backgroundColor: lineGrad,
          fill: true,
          tension: 0.45,
          pointBackgroundColor: '#2563eb',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 8,
          pointHoverBackgroundColor: '#1d4ed8',
          pointHoverBorderColor: '#ffffff',
          pointHoverBorderWidth: 3,
        },
      ],
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
          callbacks: { label: (ctx) => `  ${ctx.parsed.y} bài đăng` },
        },
      },
      scales: {
        x: {
          grid: { display: false, drawBorder: false },
          ticks: { color: '#94a3b8', font: { size: 12 } },
        },
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, color: '#94a3b8', font: { size: 12 }, padding: 8 },
          grid: { color: 'rgba(148,163,184,0.12)', borderDash: [4, 4], drawBorder: false },
        },
      },
    },
  });

  // 2. Users Pie Chart - Sử dụng luôn dữ liệu từ parameter
  const usersCtx = document.getElementById('usersChart').getContext('2d');
  if (usersChartInstance) usersChartInstance.destroy();
  usersChartInstance = new Chart(usersCtx, {
    type: 'doughnut',
    data: {
      labels: ['Thành viên tiêu chuẩn', 'Đã xác minh', 'Admin'],
      datasets: [
        {
          data: [userGroupsParams.standard, userGroupsParams.verified, userGroupsParams.admin],
          backgroundColor: ['#60a5fa', '#34d399', '#f59e0b'],
          borderWidth: 0,
          hoverOffset: 10,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 18,
            color: '#64748b',
            usePointStyle: true,
            pointStyle: 'circle',
            font: { size: 12 },
          },
        },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,0.92)',
          titleColor: '#f8fafc',
          bodyColor: '#cbd5e1',
          borderColor: 'rgba(99,102,241,0.4)',
          borderWidth: 1,
          padding: 12,
          cornerRadius: 10,
        },
      },
    },
  });
}
