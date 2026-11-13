import path from 'path';
import { promises as fs } from 'fs';
import { looksLikeSecret } from '../secrets';
import { scanResult } from '../scan/result';

const ROLES = path.resolve(__dirname, '../../../../../hostinger/roles');
const read = (name: string) => fs.readFile(path.join(ROLES, name), 'utf8');

const SEO_ROLES = ['seo-strategist-sbuddy.md', 'seo-strategist-petvee.md'];
const ALL = [...SEO_ROLES, 'chief-of-staff.md'];

describe.each(ALL)('role file %s', (name) => {
  it('starts as a role, stays a size an agent reads whole, and holds no secret', async () => {
    const text = await read(name);
    expect(text).toMatch(/^(?:ROLE|VAI TRÒ):/);
    expect(text.length).toBeLessThan(10_000);
    expect(looksLikeSecret(text)).toBe(false);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('names the one result file and never lets the agent move or publish', async () => {
    const text = await read(name);
    expect(text).toContain('deliverable');
    expect(text).toContain('status: FAILED');
    expect(text).toMatch(/status: DONE/);
  });
});

describe.each(SEO_ROLES)('SEO role %s', (name) => {
  it('is fail-closed and drafts only', async () => {
    const text = await read(name);
    expect(text).toMatch(/FAILED/);
    expect(text).toContain('DRAFT');
    expect(text).toContain('[INSERT');
    expect(text).toMatch(/Drafts/);
    expect(text).toMatch(/Open questions/);
  });
});

describe('the PetVee role file', () => {
  let text: string;
  beforeAll(async () => {
    text = await read('seo-strategist-petvee.md');
  });

  it('says what PetVee is, from the facts the owner gave, and no more', () => {
    for (const fact of [
      'petvee.app',
      'app.petvee.app',
      'com.petvee',
      '09/11/2026',
      'iOS: chưa có',
      '16 mục',
    ]) {
      expect(text).toContain(fact);
    }
    expect(text).toContain('/home/deploy/tasks/inputs/petvee/');
  });

  it('keeps private details out: the reason iOS was refused and the owner’s name', () => {
    expect(text).not.toMatch(/Guideline|4\.8|từ chối .*Apple|Apple .*từ chối/i);
    expect(text).not.toMatch(/Vincent/);
  });

  it('does not say anyone with veterinary training reviews the content, and names the owner as the reviewer', () => {
    expect(text).not.toMatch(/có người có chuyên môn rà soát/);
    expect(text).toContain('cũng là người duyệt mọi bản nháp');
    expect(text).toContain('Hiện chưa có chuyên gia thú y rà soát nội dung');
    expect(text).toContain('người duyệt mọi bản nháp là chủ sản phẩm');
  });

  it('keeps the medical-review marker and the placeholder for expert content, and asks for confirmation before publishing', () => {
    expect(text).toContain('CẦN DUYỆT Y KHOA');
    expect(text).toContain('[INSERT: nội dung do người có chuyên môn thú y cung cấp]');
    expect(text).toContain('cần người có chuyên môn thú y xác nhận trước khi đăng');
    expect(text).toMatch(/không nêu rằng có chuyên gia rà soát nội dung/);
  });

  it('forbids veterinary diagnosis and treatment advice and asks for a medical review', () => {
    expect(text).toContain('KHÔNG đưa ra lời khuyên chẩn đoán hay điều trị thú y');
    expect(text).toContain('CẦN DUYỆT Y KHOA');
    expect(text).toMatch(/liều lượng/);
    expect(text).toMatch(/KHÔNG trả lời nội dung y khoa/);
  });

  it('refuses a task that asks for a forbidden step, like the SBuddy role', () => {
    expect(text).toMatch(/đừng làm bất cứ phần nào của nó\. Ghi `status: FAILED`/);
  });

  it('keeps the section names the scanner looks for', () => {
    for (const heading of [
      '1. Summary',
      '2. Actions',
      '3. Drafts',
      '4. Sources',
      '5. Open questions',
    ]) {
      expect(text).toContain(heading);
    }
  });

  it('lists only banned words that the result scanner really flags', () => {
    const list = /nếu chủ chưa đưa cho bạn: ([^]*?)\. Kết bản nháp/.exec(text)?.[1] ?? '';
    const terms = list
      .replace(/\([^)]*\)/g, '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    expect(terms.length).toBeGreaterThan(20);
    const missed = terms.filter((term) => {
      const found = scanResult(`Drafts\nDRAFT ${term} cho bạn\n`).warnings;
      return !found.some((w) => w.code === 'banned_claim');
    });
    expect(missed).toEqual([]);
  });
});
