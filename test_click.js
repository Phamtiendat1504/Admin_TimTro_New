const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, 'public');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');

// Thay the script CDN bang stub de chay nhanh, hoac chi test doan local scripts
let modifiedHtml = html.replace(/<script src="https:\/\/www\.gstatic\.com[^>]*><\/script>/g, '');

const virtualConsole = new jsdom.VirtualConsole();

virtualConsole.on("jsdomError", (error) => {
  console.error("JSDOM Error:", error.message, error.detail);
});
virtualConsole.on("error", (msg) => { console.error("Console Error:", msg); });

const dom = new JSDOM(modifiedHtml, {
  runScripts: "dangerously",
  resources: "usable",
  url: "file://" + path.join(publicDir, 'index.html'),
  virtualConsole,
  beforeParse(window) {
    // Mock firebase objects
    window.firebase = {
      initializeApp: () => {},
      auth: () => ({ onAuthStateChanged: () => {} }),
      firestore: () => ({}),
      storage: () => ({})
    };
  }
});

dom.window.addEventListener('error', (event) => {
  console.error('Unhandled Error:', event.error);
});

setTimeout(() => {
  console.log('Scripts executed. Testing click...');
  try {
      const postsTab = dom.window.document.querySelector('.nav-item[data-page="posts"]');
      if (postsTab) {
          postsTab.click();
          console.log('Click executed');
      } else {
          console.log('No posts tab found');
      }
  } catch (e) {
      console.error('Error on click:', e);
  }
  process.exit(0);
}, 2000);