const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const html = `
<!DOCTYPE html>
<html>
<body>
<script>
const a = 10;
let b = 20;
var c = 30;
function d() {}
</script>
<script>
console.log('a =', a);
console.log('b =', b);
console.log('c =', c);
</script>
</body>
</html>
`;
const virtualConsole = new jsdom.VirtualConsole();
virtualConsole.on("log", (msg, val) => console.log(msg, val));
virtualConsole.on("jsdomError", (error) => console.error("JSDOM Error:", error.message));
new JSDOM(html, { runScripts: "dangerously", virtualConsole });