#!/usr/bin/env python3
"""Checks files before they are put where Hermes or OpenClaw can read them.

An agent treats what it reads as text it may act on. A file that comes from outside (a Search
Console export, notes copied from a web page) can carry instructions meant for the agent, hidden
characters, a spreadsheet formula, or something that is not text at all. This script reads each file
once, never runs or opens it with anything but a plain read, and gives a verdict:

  OK      nothing found
  REVIEW  something a person should look at (an instruction aimed at an AI, a link that carries
          data, markup, a spreadsheet formula). It is a warning: normal SEO text can trip it.
  REJECT  not a plain text file we accept (type, size, bad encoding, hidden characters, a link or
          symbolic link that is not a file). Never copied.

It does not change the files it scans. With --install it copies the files that passed (the very
bytes it checked) into a folder such as /home/deploy/tasks/inputs/sbuddy/, never over an existing file
unless asked. It costs no model calls. It cannot stop a determined attacker: it catches the careless
and the obvious. The real limits are the agents' own tool limits and a person reading the result.

  scan-inputs.py [--json] [--max-bytes N] [--install DIR [--allow-review] [--overwrite]] PATH...

Exit status: 0 all OK, 1 something to review, 2 something rejected, 3 usage error.
"""
import argparse
import csv
import errno
import io
import json
import os
import re
import stat
import sys
import unicodedata
from urllib.parse import parse_qsl, urlsplit

SCHEMA = 1
ALLOWED_EXT = {".txt", ".csv", ".tsv", ".md", ".json"}
NAME_OK = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
DEFAULT_MAX_BYTES = 1024 * 1024
MAX_LINE_FOR_MATCHING = 20000
LONG_LINE = 4000
MAX_PER_CODE = 5
MAX_FINDINGS = 50
EXCERPT_CHARS = 80

# First bytes of files that are not plain text, whatever their name says.
MAGIC = (
    (b"PK\x03\x04", "a zip or Office file"),
    (b"PK\x05\x06", "a zip file"),
    (b"%PDF", "a PDF"),
    (b"\x7fELF", "a program"),
    (b"MZ", "a Windows program"),
    (b"\x1f\x8b", "a compressed file"),
    (b"\xd0\xcf\x11\xe0", "an old Office file"),
    (b"Rar!", "an archive"),
    (b"7z\xbc\xaf", "an archive"),
    (b"BZh", "a compressed file"),
    (b"\xff\xd8\xff", "an image"),
    (b"\x89PNG", "an image"),
    (b"GIF8", "an image"),
    (b"SQLite format 3", "a database"),
    (b"#!", "a script"),
)

# Characters a reader cannot see but a model reads: (first, last, what it is).
HIDDEN_REJECT = (
    (0x180E, 0x180E, "Mongolian vowel separator"),
    (0x200B, 0x200B, "zero-width space"),
    (0x200E, 0x200F, "text direction mark"),
    (0x202A, 0x202E, "bidirectional control"),
    (0x2060, 0x2064, "invisible operator"),
    (0x2066, 0x2069, "bidirectional isolate"),
    (0xFEFF, 0xFEFF, "byte order mark inside the text"),
    (0xE0000, 0xE007F, "tag character"),
    (0xE0100, 0xE01EF, "variation selector"),
)
# These occur in real emoji and some scripts, so they are a warning, not a rejection.
HIDDEN_REVIEW = {0x200C: "zero-width non-joiner", 0x200D: "zero-width joiner"}

_I = re.I
# (code, pattern, what it means). Matched against NFKC text, one line at a time and once more across
# line breaks. Every quantifier is bounded so a hostile line cannot make this slow.
PHRASES = (
    ("inject_override",
     re.compile(r"\b(ignore|disregard|forget|override|bypass|neglect)\b.{0,30}\b(previous|prior|above|earlier|all|any|your|the|these|those)\b.{0,30}\b(instructions?|rules?|prompts?|guidelines?|constraints?|restrictions?|directions?)\b", _I),
     "tries to override the agent's rules"),
    ("inject_override",
     re.compile(r"\b(you are now|from now on,? you|new instructions?|updated instructions?|developer mode|jailbreak|dan mode)\b", _I),
     "tries to change the agent's role or rules"),
    ("inject_override",
     re.compile(r"\bdo not (tell|inform|mention)\b.{0,20}\b(user|owner|human|operator|kem|vincent)\b", _I),
     "asks the agent to hide something from its owner"),
    ("inject_override",
     re.compile(r"\b(bỏ qua|phớt lờ|quên)\b.{0,30}\b(hướng dẫn|chỉ thị|quy tắc|luật|lệnh trước|chỉ dẫn)\b", _I),
     "tries to override the agent's rules (Vietnamese)"),
    ("inject_override",
     re.compile(r"\bthông báo hệ thống\b|\bhệ thống:\s", _I),
     "pretends to be a system message (Vietnamese)"),
    ("inject_markers",
     re.compile(r"^\s*(system|assistant|developer)\s*:", _I),
     "starts a line like a chat role"),
    ("inject_markers",
     re.compile(r"<\|(im_start|im_end|system|user|assistant|endoftext)\|>|\[/?inst\]|^\s*#{2,}\s*(system|instructions?)\b", _I),
     "contains a chat-template marker"),
    ("inject_markers",
     re.compile(r"\bsystem (notice|message|prompt|override|alert)\b", _I),
     "pretends to be a system message"),
    ("inject_addressing",
     re.compile(r"\b(assistant|ai|agent|model|llm|hermes|openclaw|claude|chatgpt|gpt)\b[ ,:;-]{1,3}(you )?(must|should|shall|need to|have to|are to|will now|now)\b", _I),
     "speaks to the AI and tells it what to do"),
    ("inject_secret_access",
     re.compile(r"\b(print|show|reveal|output|read|cat|dump|leak|send|write|include|copy)\b.{0,40}(\.env\b|api[ _-]?key|auth\.json|secrets?\b|passwords?\b|credentials?\b|private key)", _I),
     "asks for secrets or credential files"),
    ("inject_exfil",
     re.compile(r"\bexfiltrat|\b(curl|wget)\b[^\n]{0,80}https?://|base64\s+(-d|--decode)\b", _I),
     "contains a command or word used to move data out"),
)
MARKUP = re.compile(
    r"<\s*(script|iframe|object|embed|style|svg|form|meta|link|base)\b|<!--|\bon[a-z]{3,15}\s*=\s*[\"']|style\s*=\s*[\"'][^\"']*display\s*:\s*none|javascript\s*:|vbscript\s*:",
    _I,
)
ENCODED = (
    ("encoded_blob", re.compile(r"[A-Za-z0-9+/]{120,}={0,2}"), "a long encoded block"),
    ("encoded_blob", re.compile(r"\b[0-9a-fA-F]{100,}\b"), "a long hexadecimal block"),
    ("encoded_blob", re.compile(r"data:[\w/+.-]{1,40};base64,", _I), "a data: link with embedded content"),
)
# Matched against the raw text and never echoed: the text may be a real secret.
SECRETS = re.compile(
    r"\bsk-[A-Za-z0-9_-]{20,}|\bAKIA[0-9A-Z]{16}\b|\bghp_[A-Za-z0-9]{30,}|\bxox[abp]-[A-Za-z0-9-]{10,}|-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}"
)
URL = re.compile(r"https?://[^\s<>\"')\]]+", _I)
BAD_SCHEME = re.compile(r"(?<![A-Za-z0-9])(javascript|vbscript|data|file):", _I)
SECRET_PARAM = re.compile(r"key|token|secret|passw|auth|session|credential|api", _I)
SAFE_CELL = re.compile(r"[+-]?[\d\s().,%/-]+")


class Findings:
    """Collects findings with a cap, so one hostile file cannot flood the report."""

    def __init__(self):
        self.items = []
        self.suppressed = 0
        self._per_code = {}

    def add(self, code, severity, line, detail, excerpt=None):
        count = self._per_code.get(code, 0)
        if count >= MAX_PER_CODE or len(self.items) >= MAX_FINDINGS:
            self.suppressed += 1
            return
        self._per_code[code] = count + 1
        item = {"code": code, "severity": severity, "line": line, "detail": detail}
        if excerpt:
            item["excerpt"] = excerpt
        self.items.append(item)


def excerpt_of(line, span=None):
    """A short, printable piece of a line around a match. Never contains control or hidden characters."""
    text = line.strip()
    if span is not None:
        start = max(0, span[0] - 20)
        text = line[start:start + EXCERPT_CHARS].strip()
    elif len(text) > EXCERPT_CHARS:
        text = text[:EXCERPT_CHARS]
    return "".join(ch if ch.isprintable() else "·" for ch in text)


def hidden_findings(text, findings, where=None):
    """Hidden characters. `where` names a place other than a line, such as a JSON string."""
    for number, line in enumerate(text.split("\n"), 1):
        for ch in line:
            cp = ord(ch)
            label = None
            severity = "reject"
            for first, last, name in HIDDEN_REJECT:
                if first <= cp <= last:
                    label = name
                    break
            if label is None and cp in HIDDEN_REVIEW:
                label, severity = HIDDEN_REVIEW[cp], "review"
            if label is None and unicodedata.category(ch) == "Cc" and ch not in "\t\r":
                label = "control character"
            if label:
                findings.add(
                    "control_char" if label == "control character" else "hidden_char",
                    severity,
                    None if where else number,
                    f"{label} (U+{cp:04X})" + (f" in {where}" if where else ""),
                )


def phrase_findings(text, findings, where=None):
    matched = set()
    for number, raw in enumerate(text.split("\n"), 1):
        line = unicodedata.normalize("NFKC", raw[:MAX_LINE_FOR_MATCHING])
        for index, (code, pattern, detail) in enumerate(PHRASES):
            found = pattern.search(line)
            if found:
                matched.add(index)
                findings.add(code, "review", None if where else number,
                             detail + (f" (in {where})" if where else ""), excerpt_of(line, found.span()))
        if MARKUP.search(line):
            findings.add("markup", "review", None if where else number, "contains markup that can hide text",
                         excerpt_of(line, MARKUP.search(line).span()))
        for code, pattern, detail in ENCODED:
            if pattern.search(line):
                findings.add(code, "review", None if where else number, detail)
        if SECRETS.search(raw):
            findings.add("secret_like", "review", None if where else number,
                         "looks like a key, token or private key (not shown)")
        for url in URL.findall(line):
            url_findings(url, number if not where else None, findings)
        if BAD_SCHEME.search(line):
            findings.add("url_scheme", "review", None if where else number, "a javascript:, data: or file: link")
    # Instructions can be wrapped over several lines.
    flat = unicodedata.normalize("NFKC", " ".join(text.split())[: MAX_LINE_FOR_MATCHING * 5])
    for index, (code, pattern, detail) in enumerate(PHRASES):
        if index not in matched:
            found = pattern.search(flat)
            if found:
                findings.add(code, "review", None, detail + " (spread over several lines)",
                             excerpt_of(flat, found.span()))


def url_findings(url, line, findings):
    try:
        parts = urlsplit(url)
    except ValueError:
        findings.add("url_odd", "review", line, "a link that cannot be read")
        return
    if parts.username or parts.password:
        findings.add("url_credentials", "review", line, "a link with a user name or password in it")
    if len(parts.query) > 100:
        findings.add("url_long_query", "review", line, "a link carrying a lot of data in its query")
    if any(SECRET_PARAM.search(k) for k, _ in parse_qsl(parts.query, keep_blank_values=True)):
        findings.add("url_secret_param", "review", line, "a link with a key, token or session in its query")
    host = (parts.hostname or "").lower()
    if host.startswith("xn--") or ".xn--" in host or re.fullmatch(r"[\d.]+", host or ""):
        findings.add("url_host", "review", line, "a link to an address or an encoded host name")


def csv_findings(text, delimiter, findings):
    try:
        reader = csv.reader(io.StringIO(text, newline=""), delimiter=delimiter)
        for row in reader:
            for cell in row:
                if not cell:
                    continue
                first = cell[0]
                stripped = cell.strip()
                risky = first in "\t\r" or stripped[:1] == "=" or stripped[:1] == "@"
                if not risky and stripped[:1] in ("+", "-") and stripped not in ("+", "-"):
                    risky = SAFE_CELL.fullmatch(stripped) is None
                if risky:
                    findings.add("csv_formula", "review", reader.line_num,
                                 "a cell that a spreadsheet would run as a formula", excerpt_of(stripped))
    except csv.Error:
        findings.add("bad_csv", "review", None, "the file is not valid CSV")


def json_strings(value, out, depth=0):
    if depth > 50:
        raise RecursionError
    if isinstance(value, str):
        out.append(value)
    elif isinstance(value, dict):
        for k, v in value.items():
            out.append(str(k))
            json_strings(v, out, depth + 1)
    elif isinstance(value, list):
        for v in value:
            json_strings(v, out, depth + 1)


def json_findings(text, findings):
    """A JSON file can hide characters as \\u escapes, so the decoded strings are scanned too."""
    try:
        strings = []
        json_strings(json.loads(text), strings)
    except (ValueError, RecursionError):
        findings.add("bad_json", "review", None, "the file is not valid JSON (or is nested too deeply)")
        return
    decoded = "\n".join(strings)
    hidden_findings(decoded, findings, where="a JSON string")
    phrase_findings(decoded, findings, where="a JSON string")


def scan_bytes(name, data):
    """Findings for one file's bytes. `name` is the file name, not a path."""
    findings = Findings()
    ext = os.path.splitext(name)[1].lower()
    if ext not in ALLOWED_EXT:
        findings.add("bad_type", "reject", None, f"{ext or 'no extension'} is not accepted (allowed: {', '.join(sorted(ALLOWED_EXT))})")
    if not NAME_OK.match(name):
        findings.add("bad_name", "reject", None, "the name may only use letters, digits, dot, dash and underscore")
    for magic, what in MAGIC:
        if data.startswith(magic):
            findings.add("binary_content", "reject", None, f"the content is {what}, not plain text")
            return findings
    if b"\x00" in data:
        findings.add("binary_content", "reject", None, "the content has NUL bytes, so it is not plain text")
        return findings
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        findings.add("not_utf8", "reject", None, "the content is not valid UTF-8 text")
        return findings
    head = text.lstrip()[:200].lower()
    if head.startswith(("<!doctype html", "<html", "<?xml", "<svg")):
        findings.add("markup", "review", 1, "the file starts as HTML or XML")
    hidden_findings(text, findings)
    phrase_findings(text, findings)
    for number, line in enumerate(text.split("\n"), 1):
        if len(line) > LONG_LINE and ext in (".txt", ".md"):
            findings.add("long_line", "review", number, f"a line of {len(line)} characters")
    if ext == ".csv":
        csv_findings(text, ",", findings)
    elif ext == ".tsv":
        csv_findings(text, "\t", findings)
    elif ext == ".json":
        json_findings(text, findings)
    return findings


def verdict_of(findings):
    if any(i["severity"] == "reject" for i in findings.items):
        return "reject"
    if findings.items:
        return "review"
    return "ok"


def read_regular(path, max_bytes):
    """(data, size, problem). Reads without following a symbolic link, and only a regular file."""
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    except OSError as error:
        if error.errno == errno.ELOOP:
            return None, 0, ("symlink", "a symbolic link is never followed")
        return None, 0, ("unreadable", f"cannot be read ({errno.errorcode.get(error.errno, 'error')})")
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode):
        os.close(fd)
        return None, 0, ("not_regular", "not a regular file")
    if info.st_size > max_bytes:
        os.close(fd)
        return None, info.st_size, ("too_big", f"{info.st_size} bytes is over the limit of {max_bytes}")
    with os.fdopen(fd, "rb") as handle:
        data = handle.read(max_bytes + 1)
        if len(data) > max_bytes:
            return None, len(data), ("too_big", f"over the limit of {max_bytes} bytes")
        return data, len(data), None


def scan_path(path, max_bytes=DEFAULT_MAX_BYTES):
    """The result for one file path: dict with path, size, verdict, findings and the bytes read."""
    name = os.path.basename(path)
    data, size, problem = read_regular(path, max_bytes)
    if problem is not None:
        findings = Findings()
        findings.add(problem[0], "reject", None, problem[1])
        extra = scan_bytes(name, b"")
        for item in extra.items:
            if item["code"] in ("bad_type", "bad_name"):
                findings.add(item["code"], item["severity"], None, item["detail"])
        data = None
    else:
        findings = scan_bytes(name, data)
    return {
        "path": path,
        "name": name,
        "size": size,
        "verdict": verdict_of(findings),
        "findings": findings.items,
        "suppressed": findings.suppressed,
        "_data": data,
    }


def collect(paths):
    files = []
    for path in paths:
        if os.path.isdir(path) and not os.path.islink(path):
            for root, dirs, names in os.walk(path, followlinks=False):
                dirs.sort()
                files.extend(os.path.join(root, n) for n in sorted(names))
        else:
            files.append(path)
    return files


def install(result, dest, allow_review, overwrite):
    """Copies the checked bytes into dest. Returns a short status line."""
    if result["verdict"] == "reject" or result["_data"] is None:
        return "not installed (rejected)"
    if result["verdict"] == "review" and not allow_review:
        return "not installed (needs review; use --allow-review once a person has looked)"
    target = os.path.join(dest, result["name"])
    flags = os.O_WRONLY | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
    if os.path.lexists(target) and not overwrite:
        return "skipped (already exists; use --overwrite)"
    temp = os.path.join(dest, f".{result['name']}.new")
    try:
        fd = os.open(temp, flags | os.O_EXCL, 0o644)
    except FileExistsError:
        return "skipped (a leftover temporary file is in the way)"
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(result["_data"])
            os.fchmod(handle.fileno(), 0o644)
        os.replace(temp, target)
    except OSError as error:
        try:
            os.unlink(temp)
        except OSError:
            pass
        return f"failed ({errno.errorcode.get(error.errno, 'error')})"
    return f"installed to {target}"


def human_size(n):
    return f"{n} B" if n < 1024 else f"{n / 1024:.1f} KB"


def main(argv=None, out=None):
    out = out or sys.stdout
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("paths", nargs="+")
    parser.add_argument("--json", action="store_true", help="print the report as JSON")
    parser.add_argument("--max-bytes", type=int, default=DEFAULT_MAX_BYTES)
    parser.add_argument("--install", metavar="DIR", help="copy the files that passed into DIR")
    parser.add_argument("--allow-review", action="store_true", help="with --install: also copy REVIEW files")
    parser.add_argument("--overwrite", action="store_true", help="with --install: replace a file of the same name")
    try:
        args = parser.parse_args(argv)
    except SystemExit as stop:
        return 0 if stop.code in (0, None) else 3
    if args.max_bytes < 1:
        print("--max-bytes must be positive", file=sys.stderr)
        return 3
    if args.install is not None and (not os.path.isdir(args.install) or os.path.islink(args.install)):
        print(f"--install needs an existing folder that is not a symbolic link: {args.install}", file=sys.stderr)
        return 3

    results = [scan_path(p, args.max_bytes) for p in collect(args.paths)]
    if args.install is not None:
        for r in results:
            r["install"] = install(r, args.install, args.allow_review, args.overwrite)
    counts = {v: sum(1 for r in results if r["verdict"] == v) for v in ("ok", "review", "reject")}

    if args.json:
        public = [{k: v for k, v in r.items() if k != "_data"} for r in results]
        json.dump({"schema": SCHEMA, "counts": counts, "files": public}, out, indent=2, ensure_ascii=True)
        out.write("\n")
    else:
        for r in results:
            out.write(f"{r['verdict'].upper():7} {r['path']}  ({human_size(r['size'])})\n")
            for item in r["findings"]:
                where = f"line {item['line']}" if item["line"] else "file"
                tail = f' - "{item["excerpt"]}"' if item.get("excerpt") else ""
                out.write(f"    [{item['code']}] {where}: {item['detail']}{tail}\n")
            if r["suppressed"]:
                out.write(f"    ... and {r['suppressed']} more findings\n")
            if "install" in r:
                out.write(f"    -> {r['install']}\n")
        out.write(f"{len(results)} files: {counts['ok']} ok, {counts['review']} to review, {counts['reject']} rejected\n")

    if counts["reject"]:
        return 2
    if counts["review"]:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
