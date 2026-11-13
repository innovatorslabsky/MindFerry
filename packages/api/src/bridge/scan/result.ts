import type { TBridgeResultWarning, TBridgeResultWarningCode } from 'librechat-data-provider';
import { looksLikeSecret, maskSecrets } from '../secrets';

/**
 * A read of an agent's result before a person uses it. It costs no model call and changes nothing on
 * disk: it returns the text to show (secrets hidden, invisible characters made visible) and a short
 * list of things worth a second look. It is a speed bump for a reader, not a guarantee.
 *
 * The claim checks follow the SEO Strategist's role file: a draft must not state an offer, a service,
 * a credential or a way of working the owner did not give. They look only inside the Drafts section
 * when the result has one, and skip a line that is telling the owner to avoid a claim.
 */

export const MAX_WARNINGS = 30;
const MAX_PER_CODE = 5;
const MAX_LINE = 20_000;

/** A whole-word match that understands accented letters, which `\b` does not. */
const word = (pattern: string): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, 'iu');

/** Words a draft must not use unless the owner supplied them (the role files' lists). */
export const BANNED_CLAIMS: ReadonlyArray<readonly [string, RegExp]> = [
  ['free', /\bfree\b/i],
  ['complimentary', /\bcomplimentary\b/i],
  ['no obligation', /\bno[- ]obligation\b/i],
  ['guarantee', /\bguarantee[ds]?\b/i],
  ['licensed', /\blicen[sc]ed\b/i],
  ['insured', /\binsured\b/i],
  ['bonded', /\bbonded\b/i],
  ['certified', /\bcertified\b/i],
  ['award-winning', /\baward[- ]winning\b/i],
  ['years of experience', /\byears['’]? (?:of )?experience\b/i],
  ['best', /\bbest\b/i],
  ['cheapest', /\bcheapest\b/i],
  ['lowest price', /\blowest[- ]price\b/i],
  ['cure', /\b(?:cures?|cured)\b/i],
  ['diagnose', /\bdiagnos(?:e|es|ed|is|ing)\b/i],
  // Vietnamese, for the PetVee role: offers, guarantees, medical claims and credentials.
  ['miễn phí', word('miễn phí')],
  ['tặng', word('tặng|quà tặng')],
  ['đảm bảo', word('đảm bảo|bảo đảm')],
  ['cam kết', word('cam kết')],
  ['chữa khỏi', word('chữa khỏi|khỏi hẳn|chữa hết')],
  ['chữa bệnh', word('chữa bệnh|chữa trị')],
  ['điều trị', word('điều trị')],
  ['chẩn đoán', word('chẩn đoán')],
  ['an toàn tuyệt đối', word('an toàn tuyệt đối')],
  ['hiệu quả 100%', word('hiệu quả 100\\s?%')],
  ['được chứng nhận', word('(?:được )?chứng nhận')],
  ['có giấy phép', word('(?:có )?giấy phép|được cấp phép')],
  ['giải thưởng', word('giải thưởng|đạt giải')],
  ['năm kinh nghiệm', word('(?:\\d+\\s*)?năm kinh nghiệm')],
  ['tốt nhất', word('tốt nhất')],
  ['số 1', word('số 1|số một|hàng đầu')],
  ['rẻ nhất', word('rẻ nhất|giá thấp nhất|giá rẻ nhất')],
  [
    'bác sĩ xác nhận',
    word('(?:được )?bác sĩ (?:thú y )?(?:xác nhận|chứng nhận|khuyên dùng|kiểm duyệt)'),
  ],
];

/** Statements about how the work is done or who does it, which a draft only makes if told to. */
export const CLAIM_PHRASES: ReadonlyArray<readonly [string, RegExp]> = [
  ['our team handles', /\bour (?:team|crew|experts?) (?:handles?|takes? care of|manages?)\b/i],
  ['limited time', /\blimited[- ]time\b/i],
  ['start to finish', /\b(?:from )?start to finish\b/i],
  ['every detail', /\bevery detail\b/i],
  ['trusted by', /\btrusted by\b/i],
  ['family-owned', /\b(?:family|locally)[- ]owned\b/i],
  ['top-rated', /\b(?:top|highly)[- ]rated\b/i],
  ['number one', /(?:#1\b|\bnumber one\b)/i],
  ['satisfaction', /\bsatisfaction\b/i],
  ['no hidden fees', /\bno hidden (?:fees|costs|charges)\b/i],
  [
    'đội ngũ chuyên nghiệp',
    word('đội ngũ (?:của chúng tôi )?(?:chuyên nghiệp|tận tâm|giàu kinh nghiệm)'),
  ],
  ['trọn gói', word('trọn gói|từ đầu đến cuối')],
  ['uy tín', word('uy tín|được tin dùng|đáng tin cậy nhất')],
  [
    'hàng nghìn người dùng',
    word('hàng (?:nghìn|ngàn|triệu|chục nghìn) (?:người|chủ|lượt|thú cưng|khách)'),
  ],
  ['ưu đãi có hạn', word('(?:ưu đãi|khuyến mãi|số lượng|thời gian) có hạn|trong thời gian ngắn')],
  ['sự hài lòng', word('hài lòng|sự hài lòng')],
];

/** A line that tells the owner what to avoid mentions a banned word without claiming it. */
const NEGATION =
  /\b(?:do not|don['’]t|never|avoid|without|unless|must not|should not|shouldn['’]t|excluded|not claim)\b|(?<![\p{L}\p{N}])(?:không (?:được|nên|dùng|viết|khẳng định|hứa|nói|đưa)|đừng|tránh|trừ khi|cấm|chưa được)(?![\p{L}\p{N}])/iu;

const KNOWN_HEADING =
  /^\s{0,3}(?:#{1,6}\s*)?(?:\*\*)?\s*(?:\d+[.)]\s*)?(?:summary|key findings|actions|drafts?|sources|open questions|next steps|tóm tắt|hành động|bản nháp|nguồn|câu hỏi mở|bước tiếp theo)(?![\p{L}\p{N}])/iu;
const DRAFTS_HEADING =
  /^\s{0,3}(?:#{1,6}\s*)?(?:\*\*)?\s*(?:\d+[.)]\s*)?(?:drafts?|bản nháp)(?![\p{L}\p{N}])/iu;
const OWNER_NOTES = /^\W*(?:notes?\s+(?:for|to)\s+(?:the\s+)?owner|ghi chú (?:cho|gửi) chủ)/iu;

const PLACEHOLDER_EXAMPLE = [
  /\[INSERT[^\]\n]*\b(?:e\.g\.?|eg|for example|such as)\b[^\]\n]*\]/i,
  /\[INSERT[^\]\n]*(?<![\p{L}\p{N}])(?:ví dụ|vd\.|chẳng hạn|ví như)(?![\p{L}\p{N}])[^\]\n]*\]/iu,
  /\[INSERT[^\]\n]*["“”][^\]\n]*\]/i,
];

const URL = /https?:\/\/[^\s<>"')\]]+/gi;
const BAD_SCHEME = /(?<![A-Za-z0-9])(javascript|vbscript|data|file):/i;
const SECRET_PARAM = /key|token|secret|passw|auth|session|credential|api/i;

/** Characters a reader cannot see but a model, or a layout, can act on. */
const HIDDEN: ReadonlyArray<readonly [number, number]> = [
  [0x180e, 0x180e],
  [0x200b, 0x200b],
  [0x200e, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
  [0xe0000, 0xe007f],
  [0xe0100, 0xe01ef],
];

const isHidden = (cp: number): boolean => HIDDEN.some(([first, last]) => cp >= first && cp <= last);

class Collector {
  readonly items: TBridgeResultWarning[] = [];
  omitted = 0;
  private perCode = new Map<TBridgeResultWarningCode, number>();

  add(code: TBridgeResultWarningCode, line?: number, term?: string): void {
    const count = this.perCode.get(code) ?? 0;
    if (count >= MAX_PER_CODE || this.items.length >= MAX_WARNINGS) {
      this.omitted += 1;
      return;
    }
    this.perCode.set(code, count + 1);
    this.items.push({ code, ...(line ? { line } : {}), ...(term ? { term } : {}) });
  }
}

function linkWarnings(line: string, number: number, found: Collector): void {
  for (const match of line.matchAll(URL)) {
    let parts: URL;
    try {
      parts = new globalThis.URL(match[0]);
    } catch {
      continue;
    }
    if (parts.username || parts.password) {
      found.add('link_credentials', number);
    }
    const params = [...parts.searchParams.keys()];
    if (parts.search.length > 100 || params.some((key) => SECRET_PARAM.test(key))) {
      found.add('link_data', number, parts.hostname);
    }
    const host = parts.hostname.toLowerCase();
    if (host.startsWith('xn--') || host.includes('.xn--') || /^[\d.]+$/.test(host)) {
      found.add('link_host', number, host);
    }
  }
  if (BAD_SCHEME.test(line)) {
    found.add('link_scheme', number);
  }
}

/** The lines the claim checks look at: the Drafts section if there is one, otherwise all of them. */
function claimRange(lines: string[]): boolean[] {
  const start = lines.findIndex((line) => DRAFTS_HEADING.test(line));
  if (start === -1) {
    return lines.map(() => true);
  }
  const inScope = lines.map(() => false);
  for (let i = start + 1; i < lines.length; i += 1) {
    if (KNOWN_HEADING.test(lines[i]) && !DRAFTS_HEADING.test(lines[i])) {
      break;
    }
    if (OWNER_NOTES.test(lines[i])) {
      break;
    }
    inScope[i] = true;
  }
  return inScope;
}

/** Makes each invisible character visible, so it cannot reorder or hide what the reader sees. */
function showHidden(text: string): string {
  let out = '';
  for (const char of text) {
    const cp = char.codePointAt(0) as number;
    out += isHidden(cp) ? `⟦U+${cp.toString(16).toUpperCase().padStart(4, '0')}⟧` : char;
  }
  return out;
}

export interface ScannedResult {
  /** What to show: secrets replaced, invisible characters made visible. */
  text: string;
  warnings: TBridgeResultWarning[];
  omitted: number;
}

export function scanResult(raw: string): ScannedResult {
  const found = new Collector();
  const lines = raw.split('\n');
  const scope = claimRange(lines);

  lines.forEach((full, index) => {
    const number = index + 1;
    const line = full.slice(0, MAX_LINE).normalize('NFC');

    if (looksLikeSecret(line)) {
      found.add('secret', number);
    }
    for (const char of line) {
      if (isHidden(char.codePointAt(0) as number)) {
        found.add('hidden_char', number);
        break;
      }
    }
    linkWarnings(line, number, found);

    if (!scope[index]) {
      return;
    }
    if (PLACEHOLDER_EXAMPLE.some((pattern) => pattern.test(line))) {
      found.add('placeholder_example', number);
    }
    if (NEGATION.test(line)) {
      return;
    }
    for (const [term, pattern] of BANNED_CLAIMS) {
      if (pattern.test(line)) {
        found.add('banned_claim', number, term);
      }
    }
    for (const [term, pattern] of CLAIM_PHRASES) {
      if (pattern.test(line)) {
        found.add('claim_phrase', number, term);
      }
    }
  });

  const shown = showHidden(maskSecrets(raw));
  return { text: shown, warnings: found.items, omitted: found.omitted };
}
