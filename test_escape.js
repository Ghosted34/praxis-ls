const paths = ['items[0].name', 'name"with"quotes', 'name\\with\\backslashes'];
for (const p of paths) {
    const escaped = p.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    console.log(`[name="${escaped}"]`);
}
