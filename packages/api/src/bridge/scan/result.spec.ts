import { scanResult, MAX_WARNINGS } from './result';

const codes = (text: string) => scanResult(text).warnings.map((w) => w.code);
const terms = (text: string) =>
  scanResult(text)
    .warnings.filter((w) => w.term)
    .map((w) => `${w.code}:${w.term}`);

/** The drafts the SEO Strategist produced on Hermes in the S3′ runs, as Kem reported them. */
const S3_V3_RUN = `status: DONE

## 3. Drafts
**DRAFT — Google Business Profile Post**
Transform your kitchen this season — and save 10%!
[INSERT: Company name, e.g. "SBuddy Home Renovations"] is offering **10% off** kitchen renovations.
What's included: • Free consultation [INSERT: confirm or remove] • Licensed and insured [INSERT: confirm or remove]
Ready to get started? Contact us today to book your free consultation.

## 4. Sources
role file only
`;

const S3_V4_RUN_1 = `status: DONE

1. Summary
All placeholders are marked [INSERT: ...] where owner-supplied details are required.

3. Drafts
**DRAFT — Google Business Profile Post**
🍳 Save on Your Kitchen Renovation This [INSERT: season/month]!
[INSERT: Business name] is offering **10% off** kitchen renovations — book your project before [INSERT: offer end date] and save.
📐 [INSERT: one specific service or feature the owner wants to highlight, e.g. "custom cabinetry" or "quartz countertop installation"]
✅ [INSERT: one additional detail the owner wants to include, e.g. a turnaround time, a process step, or a service area detail]
[INSERT: any conditions or eligibility details for the 10% discount, e.g. "On new bookings only. Minimum project value applies."]
Contact us to book.

4. Sources
role file and task file only
`;

const S3_V4_RUN_2 = `status: DONE

3. Drafts
**DRAFT — Google Business Profile Post**
> Thinking about a kitchen upgrade? For a limited time, [INSERT: company name] is offering 10% off kitchen renovations for homes in [INSERT: service area, e.g. Surrey and Vancouver].
> Whether you're planning a full kitchen remodel or a focused refresh, our team handles every detail — from layout to finishing touches.
> Contact us to book.
**Notes for owner before posting:**
- Do not add claims about being licensed, insured, award-winning, or years in business unless you can verify them.
- Keep the post under ~1,500 characters for best GBP display.

4. Sources
role file and task file only
`;

describe('claims a draft must not make', () => {
  it('flags the unsupplied offer in the v3 draft, once per line and term', () => {
    expect(terms(S3_V3_RUN)).toEqual(
      expect.arrayContaining([
        'banned_claim:free',
        'banned_claim:licensed',
        'banned_claim:insured',
      ]),
    );
    const free = scanResult(S3_V3_RUN).warnings.filter((w) => w.term === 'free');
    expect(free.map((w) => w.line)).toEqual([7, 8]);
  });

  it('finds nothing banned in the v4 drafts, and flags the fact-like examples inside [INSERT]', () => {
    expect(terms(S3_V4_RUN_1).filter((t) => t.startsWith('banned_claim'))).toEqual([]);
    expect(codes(S3_V4_RUN_1).filter((c) => c === 'placeholder_example')).toHaveLength(3);
  });

  it('flags how-the-work-is-done claims in the second v4 draft but not the warning to the owner', () => {
    const found = terms(S3_V4_RUN_2);
    expect(found).toEqual(
      expect.arrayContaining([
        'claim_phrase:limited time',
        'claim_phrase:our team handles',
        'claim_phrase:every detail',
      ]),
    );
    expect(found.filter((t) => t.startsWith('banned_claim'))).toEqual([]);
    expect(codes(S3_V4_RUN_2)).toContain('placeholder_example');
  });

  it.each([
    ['free', 'Book a free quote today'],
    ['complimentary', 'A complimentary visit'],
    ['no obligation', 'No-obligation estimates'],
    ['guarantee', 'We guarantee the finish'],
    ['guarantee', 'Fully guaranteed work'],
    ['licensed', 'Fully licensed crew'],
    ['licensed', 'Licenced and ready'],
    ['insured', 'Insured for your peace of mind'],
    ['bonded', 'Bonded contractor'],
    ['certified', 'Certified installers'],
    ['award-winning', 'Our award winning design'],
    ['years of experience', 'Over 20 years of experience'],
    ['years of experience', "20 years' experience"],
    ['best', 'The best kitchens in Surrey'],
    ['cheapest', 'The cheapest quote around'],
    ['lowest price', 'Lowest-price promise'],
  ])('flags %s in "%s"', (term, line) => {
    expect(terms(`${line}\n`)).toContain(`banned_claim:${term}`);
  });

  it('does not flag a line that tells the owner what to avoid', () => {
    for (const line of [
      'Do not claim to be licensed or insured.',
      "Don't promise a free estimate.",
      'Never say best price unless the owner said so.',
      'Avoid the word guaranteed.',
    ]) {
      expect(terms(`${line}\n`).filter((t) => t.startsWith('banned_claim'))).toEqual([]);
    }
  });

  it('does not flag ordinary words that only contain a banned word', () => {
    expect(codes('Carefree, a feel for the bestseller, certifications and licences.\n')).toEqual(
      [],
    );
  });

  it('looks only inside the Drafts section when there is one', () => {
    const text = `1. Summary
The owner may want a free quote offer. Free tools: Search Console.

3. Drafts
DRAFT: Contact us to book.

5. Open questions
Is there a licence or certified status to mention? Best way to reach you?
`;
    expect(codes(text)).toEqual([]);
  });

  it('looks at the whole text when there is no Drafts section', () => {
    expect(terms('Our free estimate\n')).toContain('banned_claim:free');
  });

  it('stops at the notes to the owner at the end of a draft', () => {
    const text = `Drafts
DRAFT post. Contact us to book.
Notes for owner: this is the best time to post and a free photo helps.
`;
    expect(codes(text)).toEqual([]);
  });
});

describe('placeholders', () => {
  it.each([
    '[INSERT: offer period, e.g. "before December 31"]',
    '[INSERT: service such as custom cabinetry]',
    '[INSERT: one detail, for example a turnaround time]',
    '[INSERT: tagline "Built right"]',
    '[INSERT: tagline “Built right”]',
  ])('flags an example inside %s', (placeholder) => {
    expect(codes(`Drafts\n${placeholder}\n`)).toContain('placeholder_example');
  });

  it.each([
    '[INSERT: offer period]',
    '[INSERT: phone number]',
    "[INSERT: the owner's website URL]",
  ])('accepts %s', (placeholder) => {
    expect(codes(`Drafts\n${placeholder}\n`)).toEqual([]);
  });
});

describe('links that carry data', () => {
  it.each([
    ['https://x.example/a?token=abc123', 'link_data'],
    ['https://x.example/a?session=1', 'link_data'],
    [`https://x.example/a?d=${'a'.repeat(120)}`, 'link_data'],
    ['https://user:pw@x.example/', 'link_credentials'],
    ['https://xn--e1afmkfd.example/', 'link_host'],
    ['http://192.168.1.5/admin', 'link_host'],
  ])('flags %s', (url, code) => {
    expect(codes(`See ${url} now\n`)).toContain(code);
  });

  it('flags a dangerous link scheme', () => {
    expect(codes('click javascript:alert(1)\n')).toContain('link_scheme');
  });

  it('flags a link inside Markdown, and names only the host, never the secret', () => {
    const scanned = scanResult('[offer](https://evil.example/c?api_key=SUPERSECRETVALUE1)\n');
    expect(scanned.warnings).toEqual([
      { code: 'secret', line: 1 },
      { code: 'link_data', line: 1, term: 'evil.example' },
    ]);
    expect(JSON.stringify(scanned.warnings)).not.toContain('SUPERSECRETVALUE1');
    expect(scanned.text).not.toContain('SUPERSECRETVALUE1');
  });

  it('accepts ordinary links', () => {
    expect(
      codes(
        '[Surrey](https://www.example.com/surrey/kitchens?page=2) and https://example.org/a-b.html\n',
      ),
    ).toEqual([]);
  });

  it('does not report credentials in a link, even to the host', () => {
    const scanned = scanResult('https://admin:hunter2@x.example/\n');
    expect(JSON.stringify(scanned.warnings)).not.toContain('hunter2');
  });
});

describe('secrets', () => {
  const key = 'sk-ant-api03-' + 'A1b2C3d4E5'.repeat(4);

  it('hides a secret in the text that is shown and flags the line, without echoing it', () => {
    const scanned = scanResult(`Line one\nuse ${key} for the demo\nline three\n`);
    expect(scanned.text).not.toContain(key);
    expect(scanned.text).toContain('[hidden: looks like a secret]');
    expect(scanned.text).toContain('Line one');
    expect(scanned.warnings).toEqual([{ code: 'secret', line: 2 }]);
    expect(JSON.stringify(scanned)).not.toContain(key);
  });

  it.each([
    'password: hunter2hunter2',
    '-----BEGIN RSA PRIVATE KEY-----',
    'AKIA' + 'ABCDEFGHIJKLMNOP',
    'ghp_' + 'a'.repeat(36),
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk',
    '0x' + 'ab'.repeat(32),
  ])('hides and flags %s', (secret) => {
    const scanned = scanResult(`note ${secret}\n`);
    expect(scanned.warnings.map((w) => w.code)).toContain('secret');
    expect(scanned.text).toContain('[hidden: looks like a secret]');
  });

  it('hides a recovery phrase', () => {
    const scanned = scanResult(
      'seed phrase: apple banana cherry dragon eagle forest garden harbor island jungle kitten lemon\n',
    );
    expect(scanned.text).toContain('[hidden: looks like a secret]');
    expect(scanned.text).not.toContain('cherry dragon');
  });

  it('scans a secret outside the Drafts section too', () => {
    expect(codes(`Drafts\nfine\n\nOpen questions\nkey: ${key}\n`)).toContain('secret');
  });
});

describe('invisible characters', () => {
  it('flags them and makes them visible in the text that is shown', () => {
    const scanned = scanResult('ok\nab‮cd​ef\n');
    expect(scanned.warnings.map((w) => w.code)).toEqual(['hidden_char']);
    expect(scanned.warnings[0].line).toBe(2);
    expect(scanned.text).toContain('ab⟦U+202E⟧cd⟦U+200B⟧ef');
    expect(scanned.text).not.toContain('‮');
  });

  it('shows a tag character as a visible code', () => {
    expect(scanResult(`a${String.fromCodePoint(0xe0041)}b`).text).toBe('a⟦U+E0041⟧b');
  });

  it('leaves ordinary text, accents and emoji alone', () => {
    const text = 'Kitchen 🍳 renovation — dịch vụ cải tạo nhà bếp ✅\n';
    const scanned = scanResult(text);
    expect(scanned.warnings).toEqual([]);
    expect(scanned.text).toBe(text);
  });
});

describe('the report', () => {
  it('is empty and returns the text unchanged for a clean result', () => {
    const text = 'status: DONE\n\n1. Summary\nA plan.\n\n3. Drafts\nDRAFT: Contact us to book.\n';
    expect(scanResult(text)).toEqual({ text, warnings: [], omitted: 0 });
  });

  it('is capped, says how many were left out, and cannot flood the reader', () => {
    const text = 'free offer\n'.repeat(200) + 'https://a.example/?token=1\n'.repeat(200);
    const scanned = scanResult(text);
    expect(scanned.warnings.length).toBeLessThanOrEqual(MAX_WARNINGS);
    expect(scanned.warnings.filter((w) => w.code === 'banned_claim').length).toBeLessThanOrEqual(5);
    expect(scanned.omitted).toBeGreaterThan(0);
  });

  it('never carries text from the result other than a term from a fixed list or a host', () => {
    const scanned = scanResult(
      'Drafts\nOur free consultation for SECRETCLIENT at https://k.example/?token=zzz\n',
    );
    for (const warning of scanned.warnings) {
      expect(Object.keys(warning).sort()).toEqual(
        warning.term ? ['code', 'line', 'term'] : ['code', 'line'],
      );
    }
    expect(JSON.stringify(scanned.warnings)).not.toContain('SECRETCLIENT');
  });

  it('handles a very long hostile result quickly', () => {
    const started = Date.now();
    scanResult(('free '.repeat(20_000) + '\n').repeat(5));
    scanResult('a'.repeat(200_000));
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('handles an empty result', () => {
    expect(scanResult('')).toEqual({ text: '', warnings: [], omitted: 0 });
  });
});

describe('Vietnamese drafts', () => {
  const draft = (line: string) =>
    `status: DONE\n\n3. Drafts (Bản nháp)\nDRAFT\n${line}\n\n4. Sources (Nguồn)\nkhông có\n`;

  it.each([
    ['miễn phí', 'Dùng thử miễn phí ngay hôm nay'],
    ['tặng', 'Tặng bạn một tháng sử dụng'],
    ['đảm bảo', 'Chúng tôi đảm bảo kết quả'],
    ['đảm bảo', 'Bảo đảm chất lượng'],
    ['cam kết', 'Cam kết hoàn tiền'],
    ['chữa khỏi', 'Giúp chữa khỏi bệnh da'],
    ['chữa bệnh', 'Ứng dụng chữa bệnh cho mèo'],
    ['điều trị', 'Hướng dẫn điều trị tại nhà'],
    ['chẩn đoán', 'AI chẩn đoán bệnh chính xác'],
    ['an toàn tuyệt đối', 'An toàn tuyệt đối cho thú cưng'],
    ['hiệu quả 100%', 'Hiệu quả 100% cho chó mèo'],
    ['được chứng nhận', 'Được chứng nhận bởi hiệp hội'],
    ['có giấy phép', 'Phòng khám có giấy phép hoạt động'],
    ['giải thưởng', 'Đạt giải thưởng ứng dụng của năm'],
    ['năm kinh nghiệm', 'Hơn 10 năm kinh nghiệm chăm sóc'],
    ['tốt nhất', 'Ứng dụng tốt nhất cho chủ nuôi'],
    ['số 1', 'PetVee là số 1 Việt Nam'],
    ['số 1', 'Ứng dụng hàng đầu về thú cưng'],
    ['rẻ nhất', 'Giá rẻ nhất thị trường'],
    ['bác sĩ xác nhận', 'Được bác sĩ thú y xác nhận'],
    ['bác sĩ xác nhận', 'Bác sĩ khuyên dùng'],
  ])('flags %s in "%s"', (term, line) => {
    expect(terms(draft(line))).toContain(`banned_claim:${term}`);
  });

  it('flags the same word written with decomposed accents', () => {
    const decomposed = 'miễn phí'; // miễn phí
    expect(terms(draft(`Dùng ${decomposed} nhé`))).toContain('banned_claim:miễn phí');
  });

  it.each([
    ['đội ngũ chuyên nghiệp', 'Đội ngũ chuyên nghiệp của chúng tôi'],
    ['trọn gói', 'Dịch vụ trọn gói cho thú cưng'],
    ['uy tín', 'Ứng dụng uy tín'],
    ['hàng nghìn người dùng', 'Được hàng nghìn người dùng yêu thích'],
    ['ưu đãi có hạn', 'Ưu đãi có hạn, nhanh tay'],
    ['sự hài lòng', 'Khách hàng hài lòng'],
  ])('flags the claim "%s" in "%s"', (term, line) => {
    expect(terms(draft(line))).toContain(`claim_phrase:${term}`);
  });

  it('does not flag a line that tells the writer what to avoid', () => {
    for (const line of [
      'Không được viết chữa khỏi bệnh hoặc đảm bảo kết quả.',
      'Đừng dùng từ tốt nhất hay số 1.',
      'Tránh nói miễn phí nếu chủ chưa cho phép.',
      'Trừ khi chủ cung cấp, không khẳng định giải thưởng.',
    ]) {
      expect(codes(draft(line))).toEqual([]);
    }
  });

  it('accepts ordinary app copy and a plain medical disclaimer', () => {
    const copy =
      'Theo dõi đi dạo, tạo hồ sơ nhiều thú cưng và lưu album ảnh sức khỏe cùng PetVee. PetVee không thay thế bác sĩ thú y. Tải PetVee trên Google Play.';
    expect(codes(draft(copy))).toEqual([]);
  });

  it('looks only inside the Drafts section, whichever language its heading is in', () => {
    const outside = `1. Summary (Tóm tắt)\nỨng dụng tốt nhất, miễn phí.\n\n3. Bản nháp\nDRAFT: Tải PetVee trên Google Play.\n\n5. Open questions (Câu hỏi mở)\nCó giấy phép không?\n`;
    expect(codes(outside)).toEqual([]);
    const inside = `1. Tóm tắt\nổn.\n\n3. Bản nháp\nDRAFT: tốt nhất cho chủ nuôi.\n\n4. Nguồn\nkhông có\n`;
    expect(terms(inside)).toEqual(['banned_claim:tốt nhất']);
  });

  it('stops at the notes to the owner', () => {
    const text = `Bản nháp\nDRAFT: Tải PetVee trên Google Play.\nGhi chú cho chủ: đây là cách tốt nhất để đăng.\n`;
    expect(codes(text)).toEqual([]);
  });

  it('flags an example inside a Vietnamese placeholder, and accepts a plain one', () => {
    expect(codes('Bản nháp\n[INSERT: số điện thoại, ví dụ 0901 234 567]\n')).toContain(
      'placeholder_example',
    );
    expect(codes('Bản nháp\n[INSERT: số điện thoại, vd. 0901 234 567]\n')).toContain(
      'placeholder_example',
    );
    expect(codes('Bản nháp\n[INSERT: số điện thoại]\n')).toEqual([]);
  });
});
