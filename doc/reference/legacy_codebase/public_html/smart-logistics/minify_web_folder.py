#!/usr/bin/env python3
import sys
import re
from pathlib import Path

# ----------------------------
# Minifiers (safe-ish, no deps)
# ----------------------------

def minify_css(code: str) -> str:
    # Remove block comments
    code = re.sub(r"/\*.*?\*/", "", code, flags=re.S)
    # Collapse whitespace
    code = re.sub(r"\s+", " ", code)
    # Trim around tokens
    code = re.sub(r"\s*([{}:;,>+~])\s*", r"\1", code)
    return code.strip()


def minify_js(code: str) -> str:
    """
    Conservative JS minifier:
    - removes /* */ comments
    - removes // comments (only when safe-ish)
    - collapses whitespace
    NOTE: Real JS minification is complex; this is adequate for many scripts,
    but can break edge cases (regex literals, URLs, etc.). Use with care.
    """
    code = re.sub(r"/\*.*?\*/", "", code, flags=re.S)

    out = []
    i = 0
    n = len(code)
    in_str = None
    escape = False

    while i < n:
        ch = code[i]

        # Strings
        if in_str:
            out.append(ch)
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == in_str:
                in_str = None
            i += 1
            continue

        if ch in ("'", '"', "`"):
            in_str = ch
            out.append(ch)
            i += 1
            continue

        # Line comment //
        if code.startswith("//", i):
            # Skip until newline
            while i < n and code[i] != "\n":
                i += 1
            continue

        out.append(ch)
        i += 1

    code = "".join(out)
    code = re.sub(r"[ \t]+", " ", code)
    code = re.sub(r"\n\s*\n+", "\n", code)
    code = re.sub(r"\s*([{}();,:=<>+\-*/%&|!?])\s*", r"\1", code)
    return code.strip()


def minify_html(code: str) -> str:
    """
    Conservative HTML whitespace minifier:
    - collapses whitespace between tags
    - preserves content inside <pre>, <textarea> minimally (best-effort)
    """
    # Protect <pre> and <textarea> blocks
    protected = []
    def _protect(m):
        protected.append(m.group(0))
        return f"___HTML_PROTECT_{len(protected)-1}___"

    code = re.sub(r"<(pre|textarea)\b[^>]*>.*?</\1>", _protect, code, flags=re.S | re.I)

    # Remove HTML comments (keep conditional comments? ignored here)
    code = re.sub(r"<!--(?!\[if).*?-->", "", code, flags=re.S)

    # Collapse whitespace
    code = re.sub(r">\s+<", "><", code)
    code = re.sub(r"\s+", " ", code)

    # Restore protected blocks
    for idx, block in enumerate(protected):
        code = code.replace(f"___HTML_PROTECT_{idx}___", block)

    return code.strip()


def minify_php_code(code: str) -> str:
    """
    PHP minifier for PHP-only content. Preserves strings and heredocs.
    Removes //, #, /* */ comments outside strings/heredocs.
    """
    tokens = []
    i = 0
    length = len(code)

    while i < length:
        ch = code[i]

        # Strings
        if ch in ("'", '"'):
            quote = ch
            start = i
            i += 1
            while i < length:
                if code[i] == "\\":
                    i += 2
                elif code[i] == quote:
                    i += 1
                    break
                else:
                    i += 1
            tokens.append(code[start:i])
            continue

        # HEREDOC / NOWDOC (best-effort)
        if code.startswith("<<<", i):
            m = re.match(r"<<<\s*([A-Za-z_][A-Za-z0-9_]*)", code[i:])
            if m:
                tag = m.group(1)
                end = code.find(f"\n{tag};", i)
                if end != -1:
                    end += len(tag) + 2
                    tokens.append(code[i:end])
                    i = end
                    continue

        # Single-line comments
        if code.startswith("//", i) or code.startswith("#", i):
            while i < length and code[i] != "\n":
                i += 1
            continue

        # Block comments
        if code.startswith("/*", i):
            end = code.find("*/", i + 2)
            if end == -1:
                break
            i = end + 2
            continue

        tokens.append(ch)
        i += 1

    result = "".join(tokens)

    # Whitespace normalization (conservative)
    result = re.sub(r"[ \t]+", " ", result)
    result = re.sub(r"\n\s*\n+", "\n", result)
    result = re.sub(r"\s*([{}();,=<>+\-*/.%&|!?])\s*", r"\1", result)
    return result.strip()


def minify_php_mixed(full_text: str) -> str:
    """
    Splits into PHP blocks and non-PHP blocks:
    - PHP blocks: minify_php_code
    - Outside PHP: minify_html
    """
    parts = []
    pos = 0
    for m in re.finditer(r"<\?(php|=)?", full_text, flags=re.I):
        start = m.start()
        if start > pos:
            parts.append(("html", full_text[pos:start]))
        # Find end tag
        end = full_text.find("?>", start)
        if end == -1:
            # No closing tag, treat rest as PHP
            parts.append(("php", full_text[start:]))
            pos = len(full_text)
            break
        end += 2
        parts.append(("php", full_text[start:end]))
        pos = end

    if pos < len(full_text):
        parts.append(("html", full_text[pos:]))

    out = []
    for kind, text in parts:
        if kind == "php":
            # Preserve opening tag, minify inside
            # If tag is short echo <?= ... ?>, still safe to pass whole block
            out.append(minify_php_code(text))
        else:
            out.append(minify_html(text))

    return "".join(out).strip()


# ----------------------------
# Folder processing
# ----------------------------

def process_file(src: Path, dst: Path):
    raw = src.read_text(encoding="utf-8", errors="ignore")

    if src.suffix.lower() == ".php":
        minified = minify_php_mixed(raw)
    elif src.suffix.lower() in (".html", ".htm"):
        minified = minify_html(raw)
    elif src.suffix.lower() == ".css":
        minified = minify_css(raw)
    elif src.suffix.lower() == ".js":
        minified = minify_js(raw)
    else:
        # Copy through unchanged for unknown types
        minified = raw

    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(minified, encoding="utf-8")


def main():
    if len(sys.argv) != 3:
        print("Usage: python minify_web_folder.py <input_file_or_dir> <output_file_or_dir>")
        sys.exit(1)

    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])

    if src.is_file():
        process_file(src, dst)
        return

    # Directory mode: process common web assets
    exts = {".php", ".html", ".htm", ".css", ".js"}
    for f in src.rglob("*"):
        if f.is_file():
            rel = f.relative_to(src)
            out = dst / rel
            if f.suffix.lower() in exts:
                process_file(f, out)
            else:
                # Copy non-target files as-is
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(f.read_bytes())


if __name__ == "__main__":
    main()
