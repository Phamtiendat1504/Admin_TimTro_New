// Professional theme controls
document.addEventListener('DOMContentLoaded', () => {

    let currentTheme = localStorage.getItem('ultra_theme') || 'dark';

    const applyTheme = (theme) => {
        currentTheme = theme;
        localStorage.setItem('ultra_theme', theme);
        if (theme === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
            if (toggleBtn) toggleBtn.innerHTML = '<i class="fas fa-sun"></i>';
        } else {
            document.documentElement.removeAttribute('data-theme');
            if (toggleBtn) toggleBtn.innerHTML = '<i class="fas fa-moon"></i>';
        }
    };

    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'ultraThemeToggle';
    toggleBtn.className = 'theme-toggle-btn';
    toggleBtn.innerHTML = currentTheme === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
    toggleBtn.title = 'Đổi chế độ sáng/tối';
    toggleBtn.onclick = () => applyTheme(currentTheme === 'dark' ? 'light' : 'dark');

    const topbarRight = document.querySelector('.topbar-right');
    if (topbarRight) topbarRight.insertBefore(toggleBtn, topbarRight.firstChild);

    applyTheme(currentTheme);

});
