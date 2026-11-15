import { parseFollowUps, MAX_FOLLOW_UPS } from './followups';

const doc = (block: string) => `status: DONE\n\n1. Summary\nok\n\n${block}\n`;

describe('parseFollowUps', () => {
  it('finds nothing when there is no section', () => {
    expect(parseFollowUps(doc('5. Open questions\nnone'))).toEqual({
      items: [],
      malformed: 0,
      overflow: 0,
    });
    expect(parseFollowUps('')).toEqual({ items: [], malformed: 0, overflow: 0 });
  });

  it('reads bulleted and numbered items, lowercases the role and keeps the task one line', () => {
    const found = parseFollowUps(
      doc(
        [
          '## Proposed follow-ups',
          '- role: Seo-Strategist-PetVee | task: Draft   the store   listing.',
          '* role: chief-of-staff | task: Write the brief.',
          '1. role: a1 | task: Third.',
          '2) role: b2 | task: Fourth.',
        ].join('\n'),
      ),
    );
    expect(found.items).toEqual([
      { index: 0, role: 'seo-strategist-petvee', task: 'Draft the store listing.' },
      { index: 1, role: 'chief-of-staff', task: 'Write the brief.' },
      { index: 2, role: 'a1', task: 'Third.' },
      { index: 3, role: 'b2', task: 'Fourth.' },
    ]);
    expect(found.malformed).toBe(0);
  });

  it.each([
    '## Proposed follow-ups',
    '### proposed follow-ups',
    '## Proposed Follow-Ups:',
    '#  PROPOSED FOLLOW-UPS',
  ])('accepts the heading %s', (heading) => {
    const found = parseFollowUps(doc(`${heading}\n- role: r1 | task: Do it.`));
    expect(found.items).toHaveLength(1);
  });

  it('does not treat the words inside other text as the section', () => {
    const text = doc('See the ## Proposed follow-ups below.\n- role: r1 | task: Do it.');
    expect(parseFollowUps(text).items).toEqual([]);
    expect(parseFollowUps(doc('Proposed follow-ups\n- role: r1 | task: Do it.')).items).toEqual([]);
  });

  it('ignores items above the heading and stops at the next heading', () => {
    const found = parseFollowUps(
      [
        '- role: before | task: Not mine.',
        '## Proposed follow-ups',
        '- role: r1 | task: In.',
        '## Sources',
        '- role: after | task: Not mine either.',
      ].join('\n'),
    );
    expect(found.items.map((item) => item.role)).toEqual(['r1']);
  });

  it('counts a line that is not an item and ignores it', () => {
    const found = parseFollowUps(
      doc(
        [
          '## Proposed follow-ups',
          'Some chatter.',
          '- role: Not A Slug | task: Bad role.',
          '- role: r1 | task:',
          '- task: no role',
          '- role: r1 | task: Good.',
          '',
        ].join('\n'),
      ),
    );
    expect(found.items).toHaveLength(1);
    expect(found.malformed).toBe(4);
  });

  it('keeps at most five items and counts the rest', () => {
    const lines = Array.from({ length: 8 }, (_, n) => `- role: r${n} | task: Task ${n}.`);
    const found = parseFollowUps(doc(['## Proposed follow-ups', ...lines].join('\n')));
    expect(MAX_FOLLOW_UPS).toBe(5);
    expect(found.items).toHaveLength(5);
    expect(found.items[4].index).toBe(4);
    expect(found.overflow).toBe(3);
  });

  it('keeps a pipe, accents and other characters inside the task', () => {
    const found = parseFollowUps(
      doc('## Proposed follow-ups\n- role: r1 | task: Viết mô tả | giữ "dấu" và (ngoặc).'),
    );
    expect(found.items[0].task).toBe('Viết mô tả | giữ "dấu" và (ngoặc).');
  });

  it('normalises accented text so the same words give the same task', () => {
    const decomposed = 'Viê̂́t'; // "Việt" built from combining marks
    const found = parseFollowUps(doc(`## Proposed follow-ups\n- role: r1 | task: ${decomposed}`));
    expect(found.items[0].task).toBe(decomposed.normalize('NFC'));
  });
});
