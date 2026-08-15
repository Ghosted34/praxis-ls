const fs = require('fs');
const file = 'client/src/components/ui/form.tsx';
let code = fs.readFileSync(file, 'utf8');

// Note: document.querySelector(`[name="${CSS.escape(path)}"]`) will escape quotes and backslashes, but it might escape standard characters like '[' which are not valid in the attribute value unless quoted. But wait, `[name="items[0].name"]` is valid. If we CSS.escape "items[0].name", it becomes `items\[0\]\.name`, so `[name="items\[0\]\.name"]` which might not match the element with `name="items[0].name"`.
// So we should replace the CSS.escape back to the manual replace, but properly escaped for CodeQL.

code = code.replace(
  'const selectorPath = CSS.escape(path);',
  'const selectorPath = path.replace(/\\\\/g, "\\\\\\\\").replace(/"/g, \'\\\\"\');'
);

fs.writeFileSync(file, code);
