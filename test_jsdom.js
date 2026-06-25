const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, 'public');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');

const virtualConsole = new jsdom.VirtualConsole();

virtualConsole.on("jsdomError", (error) => {
  console.error("JSDOM Error:", error.message, error.detail);
});

virtualConsole.on("error", (msg) => {
  console.error("Console Error:", msg);
});

virtualConsole.on("warn", (msg) => {
  console.warn("Console Warn:", msg);
});

virtualConsole.on("info", (msg) => {
  console.info("Console Info:", msg);
});

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  resources: "usable",
  url: "file://" + path.join(publicDir, 'index.html'),
  virtualConsole
});

dom.window.addEventListener('error', (event) => {
  console.error('Unhandled Error:', event.error);
});

dom.window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled Promise Rejection:', event.reason);
});

// Chờ 5 giây để xem script có lỗi Reference hay Scope không
setTimeout(() => {
  console.log('Test completed.');
  process.exit(0);
}, 5000);