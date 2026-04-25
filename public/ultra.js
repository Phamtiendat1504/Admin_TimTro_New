// ultra.js - CYBERPUNK EDITION
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
    toggleBtn.title = 'Cyberpunk Theme Toggle';
    toggleBtn.onclick = () => applyTheme(currentTheme === 'dark' ? 'light' : 'dark');

    const topbarRight = document.querySelector('.topbar-right');
    if (topbarRight) topbarRight.insertBefore(toggleBtn, topbarRight.firstChild);

    applyTheme(currentTheme);

    // MATRIX/CYBERPUNK PARTICLES
    const canvas = document.createElement('canvas');
    canvas.id = 'ultraCanvas';
    Object.assign(canvas.style, {
        position: 'fixed', top: '0', left: '0',
        width: '100vw', height: '100vh',
        pointerEvents: 'none', zIndex: '0', opacity: '0.8'
    });
    document.body.insertBefore(canvas, document.body.firstChild);

    const pCtx = canvas.getContext('2d');
    let W = canvas.width = window.innerWidth;
    let H = canvas.height = window.innerHeight;
    window.addEventListener('resize', () => { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; });

    const dots = Array.from({ length: 60 }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2,
        r: Math.random() * 2 + 1,
        color: Math.random() > 0.5 ? '#00ffff' : '#ff00ff'
    }));

    let mouseX = null, mouseY = null;
    window.addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; });
    window.addEventListener('mouseout', () => { mouseX = null; mouseY = null; });

    const tick = () => {
        pCtx.clearRect(0, 0, W, H);
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        
        dots.forEach((d, i) => {
            d.x += d.vx; d.y += d.vy;
            if (d.x < 0 || d.x > W) d.vx *= -1;
            if (d.y < 0 || d.y > H) d.vy *= -1;

            if (mouseX !== null) {
                let dx = mouseX - d.x;
                let dy = mouseY - d.y;
                let dist = Math.sqrt(dx*dx + dy*dy);
                if (dist < 150) {
                    d.x -= dx * 0.05;
                    d.y -= dy * 0.05;
                }
            }

            pCtx.beginPath();
            pCtx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
            pCtx.fillStyle = isDark ? d.color : 'rgba(0,0,0,0.2)';
            pCtx.shadowBlur = 10;
            pCtx.shadowColor = d.color;
            pCtx.fill();

            // Draw lasers between close particles
            for(let j = i+1; j < dots.length; j++) {
                const p2 = dots[j];
                const dx = d.x - p2.x;
                const dy = d.y - p2.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                if (dist < 100) {
                    pCtx.beginPath();
                    pCtx.moveTo(d.x, d.y);
                    pCtx.lineTo(p2.x, p2.y);
                    pCtx.strokeStyle = isDark ? `rgba(0, 255, 255, ${1 - dist/100})` : `rgba(0,0,0, ${0.1 * (1 - dist/100)})`;
                    pCtx.lineWidth = 1;
                    pCtx.stroke();
                }
            }
        });
        requestAnimationFrame(tick);
    };
    tick();

    // CYBERPUNK 3D TILT EFFECT
    setTimeout(() => {
        const cards = document.querySelectorAll('.stat-card, .card');
        cards.forEach(el => {
            el.addEventListener('mousemove', e => {
                const rect = el.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const cx = rect.width / 2;
                const cy = rect.height / 2;
                const tiltX = (y - cy) / cy * -10; // Aggressive tilt
                const tiltY = (x - cx) / cx * 10;
                el.style.transform = `perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale3d(1.05, 1.05, 1.05)`;
            });
            el.addEventListener('mouseleave', () => {
                el.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
            });
        });
    }, 1000);
});
