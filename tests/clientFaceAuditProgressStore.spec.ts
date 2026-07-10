import {describe, expect, it} from 'vitest';
import {
  buildFaceAuditAreaReviewTemplate,
  buildFaceAuditChecklistExport,
  buildFaceAuditReviewTemplate,
} from '../src/common/faceAudit';
import {faceAuditChecklistFromPayload} from '../src/client/faceAuditViewOptions';
import {
  buildFaceAuditProgressArtifact,
  faceAuditAreaProgress,
  faceAuditChecklistFingerprint,
  faceAuditItemKey,
  faceAuditProgressCount,
  faceAuditProgressLabel,
  faceAuditProgressStorageKey,
  parseFaceAuditProgressArtifact,
  parseFaceAuditReviewArtifactProgress,
  readFaceAuditReviewedKeys,
  serializeFaceAuditProgressArtifact,
  updateFaceAuditReviewedKeys,
  writeFaceAuditReviewedKeys,
  type FaceAuditProgressStorageAdapter,
} from '../src/client/faceAuditProgressStore';

class MemoryStorage implements FaceAuditProgressStorageAdapter {
  values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class ThrowingStorage implements FaceAuditProgressStorageAdapter {
  getItem(): string | null {
    throw new Error('storage disabled');
  }

  setItem(): void {
    throw new Error('storage disabled');
  }
}

function testChecklist() {
  return faceAuditChecklistFromPayload({faceAudit: buildFaceAuditChecklistExport()});
}

describe('client face-audit progress store', () => {
  it('returns no reviewed keys when storage is unavailable or malformed', () => {
    const checklist = testChecklist();
    const storage = new MemoryStorage();
    storage.setItem(faceAuditProgressStorageKey, '{not-json');

    expect(readFaceAuditReviewedKeys(checklist, undefined)).toEqual([]);
    expect(readFaceAuditReviewedKeys(checklist, storage)).toEqual([]);
    expect(readFaceAuditReviewedKeys(checklist, new ThrowingStorage())).toEqual([]);
  });

  it('filters unknown, duplicate, and blank reviewed item keys while preserving checklist order', () => {
    const checklist = testChecklist();
    const storage = new MemoryStorage();
    const industryKey = faceAuditItemKey(checklist.items.find((item) => item.area === 'industryTiles')!);
    const regularCardKey = faceAuditItemKey(checklist.items.find((item) => item.area === 'regularCards')!);
    storage.setItem(faceAuditProgressStorageKey, JSON.stringify({
      reviewedItemKeys: [
        ` ${regularCardKey} `,
        'unknownArea:unknownItem',
        industryKey,
        regularCardKey,
        '   ',
        42,
      ],
    }));

    expect(readFaceAuditReviewedKeys(checklist, storage)).toEqual([industryKey, regularCardKey]);
  });

  it('writes only known item keys back to storage', () => {
    const checklist = testChecklist();
    const storage = new MemoryStorage();
    const firstKey = faceAuditItemKey(checklist.items[0]!);
    const secondKey = faceAuditItemKey(checklist.items[1]!);

    expect(writeFaceAuditReviewedKeys(checklist, [secondKey, 'unknown:key', firstKey, secondKey], storage))
      .toEqual([firstKey, secondKey]);
    expect(JSON.parse(storage.getItem(faceAuditProgressStorageKey) ?? '{}')).toEqual({
      reviewedItemKeys: [firstKey, secondKey],
    });
  });

  it('returns normalized progress even when writes fail', () => {
    const checklist = testChecklist();
    const firstKey = faceAuditItemKey(checklist.items[0]!);

    expect(writeFaceAuditReviewedKeys(checklist, [firstKey, 'unknown:key'], new ThrowingStorage()))
      .toEqual([firstKey]);
  });

  it('toggles individual reviewed keys without keeping stale keys', () => {
    const checklist = testChecklist();
    const first = checklist.items[0]!;
    const second = checklist.items[1]!;
    const firstKey = faceAuditItemKey(first);
    const secondKey = faceAuditItemKey(second);

    const reviewed = updateFaceAuditReviewedKeys(checklist, ['unknown:key'], first, true);
    expect(reviewed).toEqual([firstKey]);
    expect(updateFaceAuditReviewedKeys(checklist, reviewed, second, true)).toEqual([firstKey, secondKey]);
    expect(updateFaceAuditReviewedKeys(checklist, [firstKey, secondKey], first, false)).toEqual([secondKey]);
  });

  it('calculates overall and per-area progress counts', () => {
    const checklist = testChecklist();
    const industryItems = checklist.items.filter((item) => item.area === 'industryTiles');
    const regularCard = checklist.items.find((item) => item.area === 'regularCards')!;
    const reviewed = [
      faceAuditItemKey(industryItems[0]!),
      faceAuditItemKey(industryItems[1]!),
      faceAuditItemKey(regularCard),
      'unknown:key',
    ];

    expect(faceAuditProgressCount(checklist, reviewed)).toEqual({
      reviewed: 3,
      total: 185,
    });
    expect(faceAuditProgressLabel(faceAuditProgressCount(checklist, reviewed))).toBe('3 / 185 reviewed');
    expect(faceAuditAreaProgress(checklist, checklist.areas.find((area) => area.area === 'industryTiles')!, reviewed))
      .toEqual({
        area: 'industryTiles',
        reviewed: 2,
        total: 45,
      });
    expect(faceAuditAreaProgress(checklist, checklist.areas.find((area) => area.area === 'regularCards')!, reviewed))
      .toEqual({
        area: 'regularCards',
        reviewed: 1,
        total: 64,
      });
  });

  it('builds a shareable progress artifact with normalized keys and area counts', () => {
    const checklist = testChecklist();
    const firstIndustryKey = faceAuditItemKey(checklist.items.find((item) => item.area === 'industryTiles')!);
    const firstLinkKey = faceAuditItemKey(checklist.items.find((item) => item.area === 'linkLines')!);

    expect(buildFaceAuditProgressArtifact(checklist, [firstLinkKey, 'unknown:key', firstIndustryKey, firstLinkKey]))
      .toEqual({
        version: 2,
        checklistFingerprint: faceAuditChecklistFingerprint(checklist),
        checklistItemCount: 185,
        areaProgress: [
          {area: 'industryTiles', reviewed: 1, total: 45},
          {area: 'linkLines', reviewed: 1, total: 39},
          {area: 'locationsAndSlots', reviewed: 0, total: 20},
          {area: 'merchantTiles', reviewed: 0, total: 9},
          {area: 'regularCards', reviewed: 0, total: 64},
          {area: 'wildCards', reviewed: 0, total: 8},
        ],
        reviewedItemKeys: [firstIndustryKey, firstLinkKey],
      });
  });

  it('changes the checklist fingerprint when any checked face field changes', () => {
    const checklist = testChecklist();
    const mutatedChecklist = {
      ...checklist,
      items: checklist.items.map((item, index) => index === 0
        ? {...item, expectedFields: [...item.expectedFields, 'mutated=true']}
        : item),
    };

    expect(faceAuditChecklistFingerprint(checklist)).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(faceAuditChecklistFingerprint(mutatedChecklist)).not.toBe(faceAuditChecklistFingerprint(checklist));
  });

  it('serializes and imports a progress artifact while reporting ignored keys', () => {
    const checklist = testChecklist();
    const firstIndustryKey = faceAuditItemKey(checklist.items.find((item) => item.area === 'industryTiles')!);
    const firstLinkKey = faceAuditItemKey(checklist.items.find((item) => item.area === 'linkLines')!);
    const serialized = serializeFaceAuditProgressArtifact(checklist, [firstLinkKey, firstIndustryKey]);

    expect(JSON.parse(serialized)).toEqual(buildFaceAuditProgressArtifact(checklist, [firstIndustryKey, firstLinkKey]));
    expect(parseFaceAuditProgressArtifact(checklist, serialized)).toEqual({
      ok: true,
      reviewedItemKeys: [firstIndustryKey, firstLinkKey],
      ignoredItemKeyCount: 0,
    });
    expect(parseFaceAuditProgressArtifact(checklist, JSON.stringify({
      version: 2,
      checklistFingerprint: faceAuditChecklistFingerprint(checklist),
      reviewedItemKeys: [firstLinkKey, 'unknown:key', firstIndustryKey, 'unknown:key', 42, '   '],
    }))).toEqual({
      ok: true,
      reviewedItemKeys: [firstIndustryKey, firstLinkKey],
      ignoredItemKeyCount: 1,
    });
  });

  it('imports reviewed progress from full and area review artifacts', () => {
    const checklist = testChecklist();
    const fullTemplate = buildFaceAuditReviewTemplate();
    const industryItem = fullTemplate.items.find((item) => item.area === 'industryTiles')!;
    const fullArtifact = {
      ...fullTemplate,
      items: fullTemplate.items.map((item) => item.key === industryItem.key
        ? {...item, reviewStatus: 'differs_from_official_face'}
        : item),
    };

    expect(parseFaceAuditReviewArtifactProgress(checklist, JSON.stringify(fullArtifact))).toEqual({
      ok: true,
      reviewedItemKeys: [faceAuditItemKey(industryItem)],
      ignoredItemKeyCount: 0,
    });

    const areaTemplate = buildFaceAuditAreaReviewTemplate('regularCards');
    const firstRegular = areaTemplate.items[0]!;
    const secondRegular = areaTemplate.items[1]!;
    const areaArtifact = {
      ...areaTemplate,
      items: [
        {...firstRegular, reviewStatus: 'matches_official_face'},
        {...secondRegular, reviewStatus: 'needs_better_reference'},
        {...areaTemplate.items[2]!, reviewStatus: 'unreviewed'},
        {...firstRegular, reviewStatus: 'matches_official_face'},
        {
          ...firstRegular,
          area: 'unknownArea',
          id: 'unknownItem',
          key: 'unknownArea:unknownItem',
          reviewStatus: 'matches_official_face',
        },
      ],
    };

    expect(parseFaceAuditReviewArtifactProgress(checklist, JSON.stringify(areaArtifact))).toEqual({
      ok: true,
      reviewedItemKeys: [
        faceAuditItemKey(firstRegular),
        faceAuditItemKey(secondRegular),
      ],
      ignoredItemKeyCount: 1,
    });
  });

  it('rejects malformed review artifacts before importing progress', () => {
    const checklist = testChecklist();
    const template = buildFaceAuditReviewTemplate();

    expect(parseFaceAuditReviewArtifactProgress(checklist, '{not-json')).toEqual({
      ok: false,
      error: 'Review artifact must be valid JSON',
    });
    expect(parseFaceAuditReviewArtifactProgress(checklist, JSON.stringify({
      artifactType: 'face_audit_lock_evidence',
      version: 1,
      checklistFingerprint: faceAuditChecklistFingerprint(checklist),
      checklistItemCount: checklist.items.length,
      items: [],
    }))).toEqual({
      ok: false,
      error: 'Review artifact must be a version 1 full or area face-audit review object',
    });
    expect(parseFaceAuditReviewArtifactProgress(checklist, JSON.stringify({
      ...template,
      checklistFingerprint: 'fnv1a32:00000000',
    }))).toEqual({
      ok: false,
      error: 'Review artifact does not match the current face-audit checklist',
    });
    expect(parseFaceAuditReviewArtifactProgress(checklist, JSON.stringify({
      ...template,
      checklistItemCount: checklist.items.length + 1,
    }))).toEqual({
      ok: false,
      error: 'Review artifact item count does not match the current face-audit checklist',
    });
    expect(parseFaceAuditReviewArtifactProgress(checklist, JSON.stringify({
      ...template,
      items: [
        {...template.items[0]!, reviewStatus: 'mostly_reviewed'},
      ],
    }))).toEqual({
      ok: false,
      error: 'Review artifact contains 1 unknown review status value(s)',
    });
  });

  it('rejects malformed progress artifacts with stable messages', () => {
    const checklist = testChecklist();

    expect(parseFaceAuditProgressArtifact(checklist, '{not-json')).toEqual({
      ok: false,
      error: 'Progress artifact must be valid JSON',
    });
    expect(parseFaceAuditProgressArtifact(checklist, JSON.stringify({
      version: 2,
      reviewedItemKeys: [],
    }))).toEqual({
      ok: false,
      error: 'Progress artifact does not match the current face-audit checklist',
    });
    expect(parseFaceAuditProgressArtifact(checklist, JSON.stringify({
      version: 2,
      reviewedItemKeys: 'not-an-array',
    }))).toEqual({
      ok: false,
      error: 'Progress artifact must be a version 2 face-audit progress object',
    });
    expect(parseFaceAuditProgressArtifact(checklist, JSON.stringify({
      version: 1,
      reviewedItemKeys: [],
    }))).toEqual({
      ok: false,
      error: 'Progress artifact must be a version 2 face-audit progress object',
    });
    expect(parseFaceAuditProgressArtifact(checklist, JSON.stringify({
      version: 2,
      checklistFingerprint: 'fnv1a32:00000000',
      reviewedItemKeys: [],
    }))).toEqual({
      ok: false,
      error: 'Progress artifact does not match the current face-audit checklist',
    });
  });
});
