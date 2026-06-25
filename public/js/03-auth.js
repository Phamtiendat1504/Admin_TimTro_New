// ════════════════════════════════════════
// TOPBAR DATE
// ════════════════════════════════════════
function updateDate() {
  const d = new Date();
  const el = document.getElementById('topbarDate');
  if (el)
    el.textContent = d.toLocaleDateString('vi-VN', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
}
updateDate();

// ════════════════════════════════════════
// AUTH
// ════════════════════════════════════════
auth.onAuthStateChanged(async (user) => {
  document.getElementById('loadingScreen').style.display = 'none';
  const btnLogin = document.getElementById('btnLogin');
  if (!user) {
    if (typeof hideEntrySplash === 'function') hideEntrySplash();
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
      const reason = !userDoc.exists
        ? 'Không tìm thấy thông tin tài khoản (userDoc.exists = false)'
        : `Role hiện tại là: "${userDoc.data().role}" (yêu cầu "admin")`;
      console.error('[Auth] Admin Login Failed:', reason);
      await auth.signOut();
      if (typeof hideEntrySplash === 'function') hideEntrySplash();
      const errEl = document.getElementById('loginError');
      const errorMsg = 'Tài khoản không có quyền Admin. ' + reason;
      if (errEl) {
        errEl.textContent = errorMsg;
        errEl.style.display = 'block';
      } else {
        alert(errorMsg);
      }
      return;
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
    if (playEntrySplashOnNextAuth && typeof showEntrySplash === 'function') {
      await showEntrySplash(name);
    } else {
      if (typeof hideEntrySplash === 'function') hideEntrySplash();
    }
    playEntrySplashOnNextAuth = false;
    startRealtimeListeners();
    loadDashboard();
  } catch (e) {
    console.error('Auth Error:', e);
    alert('Lỗi đăng nhập (chi tiết trong console): ' + e.message);
    playEntrySplashOnNextAuth = false;
    if (typeof hideEntrySplash === 'function') hideEntrySplash();
    await auth.signOut();
  }
});

// LOGIN
document.getElementById('btnLogin').addEventListener('click', async () => {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
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
document.getElementById('loginPassword').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('btnLogin').click();
});

// LOGOUT
document.getElementById('btnLogout').addEventListener('click', async () => {
  const ok = await showConfirm(
    'Đăng xuất',
    'Bạn có chắc chắn muốn đăng xuất khỏi hệ thống?',
    'warn'
  );
  if (ok) {
    stopAllListeners();
    closeModal();
    await auth.signOut();
  }
});

// MOBILE MENU
document.getElementById('btnMenuMobile').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});
document.addEventListener('click', (e) => {
  const sidebar = document.getElementById('sidebar');
  const btnMenu = document.getElementById('btnMenuMobile');
  if (!sidebar || !btnMenu || window.innerWidth > 900) return;
  if (!sidebar.classList.contains('open')) return;
  if (!sidebar.contains(e.target) && !btnMenu.contains(e.target)) {
    sidebar.classList.remove('open');
  }
});
