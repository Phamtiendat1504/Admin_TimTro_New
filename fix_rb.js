const fs = require('fs');
const files = [
  'C:/Users/tiend/AndroidStudioProjects/Doantotnghiep/app/src/main/res/layout/fragment_post.xml',
  'C:/Users/tiend/AndroidStudioProjects/Doantotnghiep/app/src/main/res/layout/activity_edit_post.xml'
];
files.forEach(file => {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(/<RadioButton([\s\S]*?)(\/?>)/g, (match, p1, p2) => {
      if (!p1.includes('android:maxLines')) {
        return '<RadioButton' + p1 + '\n                                      android:maxLines="1"' + p2;
      }
      return match;
    });
    fs.writeFileSync(file, content, 'utf8');
    console.log('Updated ' + file);
  }
});