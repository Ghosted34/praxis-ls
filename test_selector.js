const p = "name\\with\\backslashes";
console.log(p);
const escaped = p.replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\\"');
console.log(escaped);
