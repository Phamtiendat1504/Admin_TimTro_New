// ════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════
const pageConfig = {
  dashboard: { title: 'Bảng điều khiển', bread: 'Tổng quan', load: () => loadDashboard() },
  verifications: {
    title: 'Xác minh tài khoản',
    bread: 'Xác minh',
    load: () => loadVerifications(),
  },
  posts: { title: 'Quản lý bài đăng', bread: 'Bài đăng', load: () => loadPosts('pending') },
  users: { title: 'Quản lý người dùng', bread: 'Người dùng', load: () => loadUsers('all') },
  support: { title: 'Hỗ trợ người dùng', bread: 'Hỗ trợ', load: () => loadSupportTickets('new') },
  featured: {
    title: 'Duyệt bài nổi bật',
    bread: 'Nổi bật',
    load: () => loadFeaturedRequests('paid_waiting_admin'),
  },
  payments: { title: 'Lịch sử thanh toán', bread: 'Thanh toán', load: () => loadPayments('all') },
};

function navigateTo(page) {
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  document
    .getElementById('page' + page.charAt(0).toUpperCase() + page.slice(1))
    ?.classList.add('active');
  const cfg = pageConfig[page] || {};
  document.getElementById('pageTitle').textContent = cfg.title || page;
  document.getElementById('breadcrumbCurrent').textContent = cfg.bread || page;
  cfg.load?.();
  // Close mobile nav
  document.getElementById('navItems')?.classList.remove('open');
  const hbBtn = document.getElementById('btnHamburger');
  if (hbBtn) hbBtn.querySelector('i').className = 'fas fa-bars';
}

document.querySelectorAll('.nav-item[data-page]').forEach((item) => {
  item.addEventListener('click', () => navigateTo(item.dataset.page));
});

document.querySelectorAll('.card-link[data-goto]').forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo(link.dataset.goto);
  });
});

// ════════════════════════════════════════
// TAB HELPERS
// ════════════════════════════════════════
function bindTabs(groupId, loadFn) {
  document
    .getElementById(groupId)
    ?.querySelectorAll('.tab-btn')
    .forEach((btn) => {
      btn.addEventListener('click', () => {
        document
          .getElementById(groupId)
          .querySelectorAll('.tab-btn')
          .forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        loadFn(btn.dataset.filter);
      });
    });
}

bindTabs('postsTabGroup', (filter) => {
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
bindTabs('usersTabGroup', (filter) => {
  state.users.page = 1;
  selectedUserIds.clear();
  // Reset search khi chuyển tab
  usersSearchKeyword = '';
  const searchInput = document.getElementById('searchUser');
  if (searchInput) searchInput.value = '';
  loadUsers(filter);
});
bindTabs('supportTabGroup', (filter) => {
  state.support.page = 1;
  loadSupportTickets(filter);
});
bindTabs('featuredTabGroup', (filter) => {
  state.featured.page = 1;
  loadFeaturedRequests(filter);
});
bindTabs('paymentsTabGroup', (filter) => {
  state.payments.page = 1;
  loadPayments(filter);
});
