import {describe, expect, it} from 'vitest';
import {
  applyFaceAuditReviewSheet,
  buildFaceAuditAreaMatchReviewArtifact,
  buildFaceAuditAreaReviewerInstructions,
  buildFaceAuditAreaReviewerInstructionsReport,
  buildFaceAuditAreaReviewSheet,
  buildFaceAuditAreaReviewTodoSummary,
  buildFaceAuditAreaReviewTemplate,
  buildFaceAuditChecklist,
  buildFaceAuditChecklistExport,
  buildFaceAuditEvidenceRefTemplate,
  buildFaceAuditLockArtifact,
  buildFaceAuditLockPreview,
  buildFaceAuditMatchReviewArtifact,
  buildFaceAuditMappedMatchReviewArtifact,
  buildFaceAuditReviewerHandoff,
  buildFaceAuditReviewerInstructions,
  buildFaceAuditReviewPlan,
  buildFaceAuditReviewSheet,
  buildFaceAuditReviewTodo,
  buildFaceAuditReviewTodoSummary,
  buildFaceAuditReviewTemplate,
  buildFaceAuditSourceIdsByAreaTemplate,
  FACE_AUDIT_EVIDENCE_SOURCE_TYPES,
  FACE_AUDIT_REVIEW_STATUSES,
  FACE_AUDIT_AREAS,
  faceAuditAreaReviewerInstructionsArtifactFileName,
  faceAuditAreaReviewArtifactFileName,
  faceAuditAreaReviewTodoSummaryArtifactFileName,
  faceAuditChecklistFingerprint,
  faceAuditEvidenceRefForSource,
  faceAuditItemKey,
  faceAuditReviewFingerprint,
  mergeFaceAuditReviewArtifacts,
  parseFaceAuditEvidenceRefMode,
  summarizeFaceAuditReviewerHandoffResponse,
  summarizeFaceAuditReviewCompletion,
  summarizeFaceAuditChecklist,
  summarizeFaceAuditReviewStatus,
  validateFaceAuditAreaReviewArtifact,
  validateFaceAuditLockArtifact,
  validateFaceAuditReviewerHandoffArtifact,
  validateFaceAuditReviewArtifact,
  validateFaceAuditReadyArtifact,
  validateFaceAuditStaticLockGate,
  validFaceAuditEvidenceSourceId,
  type FaceAuditArea,
  type FaceAuditEvidenceSource,
  type FaceAuditReviewItem,
} from '../src/common/faceAudit';
import {getCardIdsForPlayerCount, getWildIndustryCardIds, getWildLocationCardIds, staticConfig} from '../src/common/staticData';
import type {PlayerCount} from '../src/common/types';

function checklistCounts() {
  return FACE_AUDIT_AREAS.reduce((counts, area) => ({
    ...counts,
    [area]: buildFaceAuditChecklist().filter((item) => item.area === area).length,
  }), {} as Record<FaceAuditArea, number>);
}

function expectedCityCount(): number {
  return Object.values(staticConfig.locations)
    .filter((location) => location.kind === 'city')
    .length;
}

function item(area: FaceAuditArea, id: string) {
  const found = buildFaceAuditChecklist().find((candidate) => candidate.area === area && candidate.id === id);
  if (!found) {
    throw new Error(`Missing face-audit item ${area}:${id}`);
  }
  return found;
}

function pendingFaceAuditAreas(): FaceAuditArea[] {
  return Object.entries(staticConfig.audit)
    .filter(([, audit]) => audit.status === 'manifest_locked_face_audit_pending')
    .map(([area]) => area as FaceAuditArea)
    .sort();
}

function evidenceRefForArea(area: FaceAuditArea): string {
  return `official-component:photo-set#${area}`;
}

function evidenceSource(): FaceAuditEvidenceSource {
  return {
    id: 'photo-set',
    label: 'Official component photo set',
    sourceType: 'official_physical_component',
    citation: 'Reviewer-owned official Brass: Birmingham component photos',
    locator: 'reviewer-photos/official-component-set.zip',
    notes: '',
  };
}

describe('static face-audit checklist', () => {
  it('builds reusable evidence ref templates and matching review artifacts', () => {
    expect(parseFaceAuditEvidenceRefMode('area')).toBe('area');
    expect(parseFaceAuditEvidenceRefMode('items')).toBe('items');
    expect(parseFaceAuditEvidenceRefMode('item')).toBeUndefined();
    expect(validFaceAuditEvidenceSourceId('photo-set')).toBe(true);
    expect(validFaceAuditEvidenceSourceId(' invalid id ')).toBe(false);
    expect(faceAuditEvidenceRefForSource('photo-set', 'regularCards'))
      .toBe('official-component:photo-set#regularCards');
    expect(faceAuditEvidenceRefForSource('photo-set', 'wildCards', 'wild-location-1'))
      .toBe('official-component:photo-set#wildCards:wild-location-1');

    const evidenceRefTemplate = buildFaceAuditEvidenceRefTemplate('photo-set', 'wildCards', 'items');
    expect(evidenceRefTemplate).toMatchObject({
      artifactType: 'face_audit_evidence_ref_template',
      version: 1,
      sourceId: 'photo-set',
      area: 'wildCards',
      mode: 'items',
      evidenceRefCount: 8,
    });
    expect(evidenceRefTemplate.evidenceRefs).toHaveLength(8);
    expect(evidenceRefTemplate.items[0]).toEqual({
      key: expect.stringMatching(/^wildCards:/),
      id: expect.any(String),
      label: expect.any(String),
      evidenceRef: expect.stringMatching(/^official-component:photo-set#wildCards:/),
    });

    const sourceArtifact = {evidenceSources: [evidenceSource()]};
    const areaMatch = buildFaceAuditAreaMatchReviewArtifact(
      'regularCards',
      sourceArtifact,
      'photo-set',
      ' Ada ',
      '2026-07-10T00:00:00.000Z',
    );
    expect(areaMatch.ok).toBe(true);
    expect(areaMatch.issues).toEqual([]);
    expect(areaMatch.review.area).toBe('regularCards');
    expect(areaMatch.review.evidenceSources).toEqual([evidenceSource()]);
    expect(areaMatch.review.items).toHaveLength(64);
    expect(areaMatch.review.items.every((item) => item.reviewStatus === 'matches_official_face')).toBe(true);
    expect(areaMatch.review.items.every((item) => item.reviewer === 'Ada')).toBe(true);
    expect(areaMatch.review.items.every((item) => item.evidenceRef === 'official-component:photo-set#regularCards'))
      .toBe(true);
    expect(areaMatch.review.completion).toMatchObject({
      status: 'ready_to_lock',
      reviewedItemCount: 64,
      matchingItemCount: 64,
    });

    const fullMatch = buildFaceAuditMatchReviewArtifact(
      sourceArtifact,
      'photo-set',
      'Ada',
      '2026-07-10T00:00:00.000Z',
      'items',
    );
    expect(fullMatch.ok).toBe(true);
    expect(fullMatch.review.items).toHaveLength(185);
    expect(fullMatch.review.items.every((item) =>
      item.evidenceRef === `official-component:photo-set#${item.area}:${item.id}`,
    )).toBe(true);
    expect(fullMatch.review.completion).toMatchObject({
      status: 'ready_to_lock',
      reviewedItemCount: 185,
      matchingItemCount: 185,
      unreviewedItemCount: 0,
    });

    const mappedSources = FACE_AUDIT_AREAS.map((area) => ({
      ...evidenceSource(),
      id: `${area}-source`,
      label: `${area} official component evidence`,
      locator: `reviewer-photos/${area}.zip`,
    }));
    const sourceIdsByArea = Object.fromEntries(mappedSources.map((source) => [
      source.id.replace(/-source$/, '') as FaceAuditArea,
      source.id,
    ]));
    const mappedMatch = buildFaceAuditMappedMatchReviewArtifact(
      {evidenceSources: mappedSources},
      sourceIdsByArea,
      'Ada',
      '2026-07-10T00:00:00.000Z',
      'items',
    );

    expect(mappedMatch.ok).toBe(true);
    expect(mappedMatch.issues).toEqual([]);
    expect(mappedMatch.review.evidenceSources).toEqual(mappedSources);
    for (const area of FACE_AUDIT_AREAS) {
      expect(mappedMatch.review.items
        .filter((reviewItem) => reviewItem.area === area)
        .every((reviewItem) =>
          reviewItem.evidenceRef === `official-component:${sourceIdsByArea[area]}#${area}:${reviewItem.id}`,
        )).toBe(true);
    }
    expect(mappedMatch.review.completion).toMatchObject({
      status: 'ready_to_lock',
      reviewedItemCount: 185,
      matchingItemCount: 185,
      unreviewedItemCount: 0,
    });
  });

  it('generates full source-id maps for area-specific matching review templates', () => {
    const sourceArtifact = {
      evidenceSources: [
        evidenceSource(),
        {...evidenceSource(), id: 'tiles-source', label: 'Tile evidence'},
        {...evidenceSource(), id: 'board-source', label: 'Board evidence'},
      ],
    };
    const template = buildFaceAuditSourceIdsByAreaTemplate(sourceArtifact, 'photo-set', {
      industryTiles: 'tiles-source',
      linkLines: 'board-source',
      locationsAndSlots: 'board-source',
    });

    expect(template).toEqual({
      ok: true,
      sourceIdsByArea: {
        ...Object.fromEntries(FACE_AUDIT_AREAS.map((area) => [area, 'photo-set'])),
        industryTiles: 'tiles-source',
        linkLines: 'board-source',
        locationsAndSlots: 'board-source',
      },
      issueCount: 0,
      issues: [],
    });

    const invalid = buildFaceAuditSourceIdsByAreaTemplate({evidenceSources: []}, 'bad id', {
      regularCards: 'missing-source',
      secretArea: 'photo-set',
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.sourceIdsByArea).toBeUndefined();
    expect(invalid.issueCount).toBe(3);
    expect(invalid.issues).toEqual(expect.arrayContaining([
      {
        field: 'defaultSourceId',
        message: 'Face-audit source ids by area template default source id must match the evidenceRef source id format',
      },
      {
        field: 'sourceIdsByAreaOverrides.regularCards',
        message: 'Face-audit source ids by area template source id for regularCards is not declared in the source artifact: missing-source',
      },
      {
        field: 'sourceIdsByAreaOverrides.secretArea',
        message: 'Face-audit source ids by area template area is not known: secretArea',
      },
    ]));
  });

  it('rejects invalid matching review template inputs', () => {
    const invalid = buildFaceAuditMatchReviewArtifact(
      {evidenceSources: []},
      'bad id',
      ' ',
      'not-a-date',
      'item' as 'items',
    );

    expect(invalid.ok).toBe(false);
    expect(invalid.review.completion.status).toBe('not_started');
    expect(invalid.issues).toEqual(expect.arrayContaining([
      {
        field: 'sourceId',
        message: 'Face-audit match template source id must match the evidenceRef source id format',
      },
      {
        field: 'reviewer',
        message: 'Face-audit match template reviewer is required',
      },
      {
        field: 'reviewedAt',
        message: 'Face-audit match template reviewedAt must be a valid review timestamp',
      },
      {
        field: 'mode',
        message: 'Face-audit match template mode must be area or items',
      },
      {
        field: 'sourceId',
        message: 'Face-audit match template source id is not declared in the source artifact: bad id',
      },
    ]));

    const missingSources = buildFaceAuditAreaMatchReviewArtifact(
      'regularCards',
      {},
      'photo-set',
      'Ada',
      '2026-07-10T00:00:00.000Z',
    );
    expect(missingSources.ok).toBe(false);
    expect(missingSources.issues).toContainEqual({
      field: 'sourceArtifact.evidenceSources',
      message: 'Face-audit match template source artifact must include an evidenceSources array',
    });

    const invalidMapped = buildFaceAuditMappedMatchReviewArtifact(
      {evidenceSources: [evidenceSource()]},
      {
        regularCards: 'bad id',
        wildCards: 'missing-source',
      },
      'Ada',
      '2026-07-10T00:00:00.000Z',
    );
    expect(invalidMapped.ok).toBe(false);
    expect(invalidMapped.issues).toEqual(expect.arrayContaining([
      {
        field: 'sourceIdsByArea.regularCards',
        message: 'Face-audit match template source id for regularCards must match the evidenceRef source id format',
      },
      {
        field: 'sourceIdsByArea.wildCards',
        message: 'Face-audit match template source id for wildCards is not declared in the source artifact: missing-source',
      },
      {
        field: 'sourceIdsByArea.industryTiles',
        message: 'Face-audit match template source id for industryTiles must match the evidenceRef source id format',
      },
    ]));
  });

  it('enumerates every pending face-audit area with current static-data counts', () => {
    expect([...FACE_AUDIT_AREAS].sort()).toEqual(pendingFaceAuditAreas());
    expect(checklistCounts()).toEqual({
      industryTiles: staticConfig.components.industryTilesPerPlayer,
      linkLines: Object.keys(staticConfig.linkLines).length,
      locationsAndSlots: expectedCityCount(),
      merchantTiles: staticConfig.components.merchantTileCount,
      regularCards: staticConfig.components.locationAndIndustryCardCount,
      wildCards: staticConfig.components.wildCards.total,
    });
  });

  it('keeps every checklist item uniquely addressable with non-empty expected fields', () => {
    const seen = new Set<string>();

    for (const checklistItem of buildFaceAuditChecklist()) {
      const key = `${checklistItem.area}:${checklistItem.id}`;
      expect(seen.has(key), `Duplicate face-audit item ${key}`).toBe(false);
      seen.add(key);
      expect(checklistItem.label.trim()).toBe(checklistItem.label);
      expect(checklistItem.label.length).toBeGreaterThan(0);
      expect(checklistItem.expectedFields.length).toBeGreaterThan(0);
      for (const field of checklistItem.expectedFields) {
        expect(field.trim()).toBe(field);
        expect(field.length).toBeGreaterThan(0);
        expect(field).toContain('=');
      }
    }
  });

  it('uses the complete 4-player regular deck as the physical regular-card face list', () => {
    const regularItemIds = buildFaceAuditChecklist()
      .filter((checklistItem) => checklistItem.area === 'regularCards')
      .map((checklistItem) => checklistItem.id)
      .sort();

    expect(regularItemIds).toEqual([...getCardIdsForPlayerCount(4)].sort());
    expect(regularItemIds.some((cardId) => cardId.startsWith('wild-'))).toBe(false);
    for (const playerCount of [2, 3] as PlayerCount[]) {
      expect(getCardIdsForPlayerCount(playerCount).every((cardId) =>
        !regularItemIds.includes(cardId) || cardId.startsWith('p4-'),
      )).toBe(true);
    }
  });

  it('enumerates wild cards, map locations, and links from their public static ids', () => {
    const wildItemIds = buildFaceAuditChecklist()
      .filter((checklistItem) => checklistItem.area === 'wildCards')
      .map((checklistItem) => checklistItem.id)
      .sort();
    const locationItemIds = buildFaceAuditChecklist()
      .filter((checklistItem) => checklistItem.area === 'locationsAndSlots')
      .map((checklistItem) => checklistItem.id)
      .sort();
    const linkItemIds = buildFaceAuditChecklist()
      .filter((checklistItem) => checklistItem.area === 'linkLines')
      .map((checklistItem) => checklistItem.id)
      .sort();

    expect(wildItemIds).toEqual([...getWildIndustryCardIds(), ...getWildLocationCardIds()].sort());
    expect(locationItemIds).toEqual(Object.values(staticConfig.locations)
      .filter((location) => location.kind === 'city')
      .map((location) => location.id)
      .sort());
    expect(linkItemIds).toEqual(Object.keys(staticConfig.linkLines).sort());
  });

  it('records the visible fields a human must compare for representative pieces', () => {
    expect(item('locationsAndSlots', 'birmingham').expectedFields).toEqual(expect.arrayContaining([
      'name=Birmingham',
      'region=birmingham',
      'printedLinkIcons=0',
      'slots=birmingham-0:cotton_mill+manufacturer;birmingham-1:manufacturer;birmingham-2:iron_works;birmingham-3:manufacturer',
    ]));
    expect(item('linkLines', 'kidderminster-worcester').expectedFields).toContain('viaFarmBreweryId=southern');
    expect(item('industryTiles', 'pottery-1-1').expectedFields).toEqual(expect.arrayContaining([
      'industryType=pottery',
      'level=1',
      'cost=17/0/1',
      'special=lightbulbPottery',
    ]));
    expect(item('merchantTiles', 'gloucester-cotton').expectedFields).toEqual(expect.arrayContaining([
      'acceptedIndustryTypes=cotton_mill',
      'merchantBonus=develop:1',
    ]));
    expect(item('wildCards', 'wild-location-1').expectedFields).toContain('type=wild_location');
    expect(item('regularCards', 'p4-location-derby-1').expectedFields).toContain('locationId=derby');
  });

  it('keeps pending audit metadata pointing at the executable face-audit checklist tests', () => {
    for (const area of FACE_AUDIT_AREAS) {
      expect(staticConfig.audit[area].coveredByTests).toContain('tests/faceAudit.spec.ts');
    }
  });

  it('builds a grouped public export with metadata, counts, and field-name coverage', () => {
    const faceAuditExport = buildFaceAuditChecklistExport();
    const areaSummaries = summarizeFaceAuditChecklist(faceAuditExport.items);
    const byArea = new Map(areaSummaries.map((summary) => [summary.area, summary]));

    expect(faceAuditExport.version).toBe(1);
    expect(faceAuditExport.checklistFingerprint).toBe(faceAuditChecklistFingerprint(faceAuditExport));
    expect(faceAuditExport.checklistItemCount).toBe(faceAuditExport.items.length);
    expect(faceAuditExport.items).toEqual(buildFaceAuditChecklist());
    expect(faceAuditExport.areas).toEqual(areaSummaries);
    expect(areaSummaries.map((summary) => summary.area)).toEqual([...FACE_AUDIT_AREAS]);

    for (const area of FACE_AUDIT_AREAS) {
      const summary = byArea.get(area);
      expect(summary).toBeDefined();
      if (!summary) {
        throw new Error(`Missing face-audit area summary ${area}`);
      }
      expect(summary.status).toBe(staticConfig.audit[area].status);
      expect(summary.rulebookPages).toEqual(staticConfig.audit[area].rulebookPages);
      expect(summary.sourceRefs).toEqual(staticConfig.audit[area].sourceRefs);
      expect(summary.coveredByTests).toEqual(staticConfig.audit[area].coveredByTests);
      expect(summary.itemCount).toBe(checklistCounts()[area]);
      expect(summary.expectedFieldNames.length).toBeGreaterThan(0);
    }

    expect(byArea.get('industryTiles')?.expectedFieldNames).toEqual([
      'beerRequiredToSell',
      'buildableEras',
      'canDevelop',
      'cost',
      'flip',
      'industryType',
      'level',
      'resourcesWhenBuilt',
      'special',
    ]);
    expect(byArea.get('regularCards')?.expectedFieldNames).toEqual([
      'industryType',
      'locationId',
      'representedBy',
      'type',
    ]);
    expect(byArea.get('wildCards')?.expectedFieldNames).toEqual(['type', 'wild']);
  });

  it('uses a shared fingerprint that changes when checked face fields change', () => {
    const faceAuditExport = buildFaceAuditChecklistExport();
    const mutatedExport = {
      ...faceAuditExport,
      items: faceAuditExport.items.map((checklistItem, index) => index === 0
        ? {...checklistItem, expectedFields: [...checklistItem.expectedFields, 'mutated=true']}
        : checklistItem),
    };

    expect(faceAuditChecklistFingerprint(faceAuditExport)).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(faceAuditChecklistFingerprint(mutatedExport)).not.toBe(faceAuditChecklistFingerprint(faceAuditExport));
  });

  it('builds a fillable review template for every pending face-audit item', () => {
    const faceAuditExport = buildFaceAuditChecklistExport();
    const template = buildFaceAuditReviewTemplate(faceAuditExport);

    expect(template.version).toBe(1);
    expect(template.checklistFingerprint).toBe(faceAuditChecklistFingerprint(faceAuditExport));
    expect(template.checklistItemCount).toBe(faceAuditExport.items.length);
    expect(template.evidenceSources).toEqual([]);
    expect(template.completion).toEqual({
      status: 'not_started',
      reviewedItemCount: 0,
      matchingItemCount: 0,
      differenceItemCount: 0,
      needsReferenceItemCount: 0,
      unreviewedItemCount: 185,
      totalItemCount: 185,
    });
    expect(template.areas.map((area) => area.area)).toEqual([...FACE_AUDIT_AREAS]);
    for (const area of template.areas) {
      expect(area.reviewCounts).toEqual({
        unreviewed: area.itemCount,
        matches_official_face: 0,
        differs_from_official_face: 0,
        needs_better_reference: 0,
      });
    }
    expect(template.items.map((reviewItem) => reviewItem.key))
      .toEqual(faceAuditExport.items.map(faceAuditItemKey));
    expect(template.items.every((reviewItem) => reviewItem.reviewStatus === 'unreviewed')).toBe(true);
    expect(template.items.every((reviewItem) =>
      reviewItem.reviewer === '' &&
      reviewItem.reviewedAt === '' &&
      reviewItem.evidenceRef === '' &&
      reviewItem.notes === '',
    )).toBe(true);
  });

  it('builds and validates area-level review templates for split human audit work', () => {
    const areaTemplate = buildFaceAuditAreaReviewTemplate('regularCards');

    expect(areaTemplate.artifactType).toBe('face_audit_area_review');
    expect(areaTemplate.version).toBe(1);
    expect(areaTemplate.area).toBe('regularCards');
    expect(areaTemplate.checklistItemCount).toBe(185);
    expect(areaTemplate.areaItemCount).toBe(staticConfig.components.locationAndIndustryCardCount);
    expect(areaTemplate.evidenceSources).toEqual([]);
    expect(areaTemplate.items).toHaveLength(staticConfig.components.locationAndIndustryCardCount);
    expect(areaTemplate.items.every((reviewItem) => reviewItem.area === 'regularCards')).toBe(true);
    expect(areaTemplate.areaSummary.reviewCounts).toEqual({
      unreviewed: staticConfig.components.locationAndIndustryCardCount,
      matches_official_face: 0,
      differs_from_official_face: 0,
      needs_better_reference: 0,
    });
    expect(areaTemplate.completion).toEqual({
      status: 'not_started',
      reviewedItemCount: 0,
      matchingItemCount: 0,
      differenceItemCount: 0,
      needsReferenceItemCount: 0,
      unreviewedItemCount: staticConfig.components.locationAndIndustryCardCount,
      totalItemCount: staticConfig.components.locationAndIndustryCardCount,
    });

    const filledAreaArtifact = {
      ...areaTemplate,
      evidenceSources: [evidenceSource()],
      areaSummary: {
        ...areaTemplate.areaSummary,
        reviewCounts: {
          unreviewed: 999,
          matches_official_face: 0,
          differs_from_official_face: 0,
          needs_better_reference: 0,
        },
      },
      completion: areaTemplate.completion,
      items: areaTemplate.items.map((reviewItem) => ({
        ...reviewItem,
        reviewStatus: 'matches_official_face',
        reviewer: 'Ada',
        reviewedAt: '2026-07-10T00:00:00.000Z',
        evidenceRef: evidenceRefForArea(reviewItem.area),
      })),
    };

    const validation = validateFaceAuditAreaReviewArtifact(filledAreaArtifact);

    expect(validation.ok).toBe(true);
    expect(validation.issues).toEqual([]);
    expect(validation.review.evidenceSources).toEqual([evidenceSource()]);
    expect(validation.review.areaSummary.reviewCounts).toEqual({
      unreviewed: 0,
      matches_official_face: staticConfig.components.locationAndIndustryCardCount,
      differs_from_official_face: 0,
      needs_better_reference: 0,
    });
    expect(validation.review.completion).toEqual({
      status: 'ready_to_lock',
      reviewedItemCount: staticConfig.components.locationAndIndustryCardCount,
      matchingItemCount: staticConfig.components.locationAndIndustryCardCount,
      differenceItemCount: 0,
      needsReferenceItemCount: 0,
      unreviewedItemCount: 0,
      totalItemCount: staticConfig.components.locationAndIndustryCardCount,
    });

    const wrongAreaValidation = validateFaceAuditAreaReviewArtifact(filledAreaArtifact, 'industryTiles');
    expect(wrongAreaValidation.ok).toBe(false);
    expect(wrongAreaValidation.issues).toContainEqual({
      field: 'area',
      message: 'Face-audit area review artifact area does not match the requested area',
    });
  });

  it('normalizes optional evidence source locator and content hash metadata', () => {
    const template = buildFaceAuditAreaReviewTemplate('regularCards');
    const artifact = {
      ...template,
      evidenceSources: [{
        ...evidenceSource(),
        locator: '  reviewer-photos/regular-cards-fronts.zip  ',
        contentHash: `SHA256:${'A'.repeat(64)}`,
      }],
      items: template.items.map((reviewItem) => ({
        ...reviewItem,
        reviewStatus: 'matches_official_face',
        reviewer: 'Ada',
        reviewedAt: '2026-07-10T00:00:00.000Z',
        evidenceRef: evidenceRefForArea(reviewItem.area),
      })),
    };

    const validation = validateFaceAuditAreaReviewArtifact(artifact, 'regularCards');

    expect(validation.ok).toBe(true);
    expect(validation.review.evidenceSources).toEqual([{
      ...evidenceSource(),
      locator: 'reviewer-photos/regular-cards-fronts.zip',
      contentHash: `sha256:${'a'.repeat(64)}`,
    }]);
    const merged = mergeFaceAuditReviewArtifacts([artifact]);
    expect(merged.ok).toBe(true);
    expect(faceAuditReviewFingerprint({
      ...merged.review,
      evidenceSources: [{
        ...merged.review.evidenceSources[0]!,
        locator: 'reviewer-photos/regular-cards-fronts-v2.zip',
      }],
    })).not.toBe(faceAuditReviewFingerprint(merged.review));

    const invalidHashValidation = validateFaceAuditAreaReviewArtifact({
      ...artifact,
      evidenceSources: [{
        ...evidenceSource(),
        contentHash: 'sha256:not-a-real-hash',
      }],
    }, 'regularCards');

    expect(invalidHashValidation.ok).toBe(false);
    expect(invalidHashValidation.issues).toContainEqual({
      field: 'evidenceSources[0].contentHash',
      message: 'Face-audit evidence source contentHash must use sha256:<64 hex>, sha1:<40 hex>, or md5:<32 hex>',
    });
  });

  it('merges split area review artifacts into one full review artifact', () => {
    const areaArtifacts = FACE_AUDIT_AREAS.map((area, areaIndex) => {
      const areaTemplate = buildFaceAuditAreaReviewTemplate(area);
      return {
        ...areaTemplate,
        evidenceSources: [evidenceSource()],
        items: areaTemplate.items.map((reviewItem) => ({
          ...reviewItem,
          reviewStatus: 'matches_official_face',
          reviewer: areaIndex % 2 === 0 ? 'Ada' : 'Ben',
          reviewedAt: new Date(Date.UTC(2026, 6, 10, areaIndex)).toISOString(),
          evidenceRef: evidenceRefForArea(reviewItem.area),
        })),
      };
    });

    const merge = mergeFaceAuditReviewArtifacts(areaArtifacts);

    expect(merge.ok).toBe(true);
    expect(merge.issues).toEqual([]);
    expect(merge.review.evidenceSources).toEqual([evidenceSource()]);
    expect(merge.review.items).toHaveLength(185);
    expect(merge.review.completion).toEqual({
      status: 'ready_to_lock',
      reviewedItemCount: 185,
      matchingItemCount: 185,
      differenceItemCount: 0,
      needsReferenceItemCount: 0,
      unreviewedItemCount: 0,
      totalItemCount: 185,
    });
    expect(validateFaceAuditReadyArtifact(merge.review).ok).toBe(true);
    expect(buildFaceAuditLockArtifact(merge.review).ok).toBe(true);
  });

  it('does not silently overwrite conflicting split review evidence during merge', () => {
    const areaTemplate = buildFaceAuditAreaReviewTemplate('regularCards');
    const firstItem = areaTemplate.items[0]!;
    const firstArtifact = {
      ...areaTemplate,
      evidenceSources: [evidenceSource()],
      items: areaTemplate.items.map((reviewItem, index) => index === 0
        ? {
            ...reviewItem,
            reviewStatus: 'matches_official_face',
            reviewer: 'Ada',
            reviewedAt: '2026-07-10T00:00:00.000Z',
            evidenceRef: evidenceRefForArea(reviewItem.area),
          }
        : reviewItem),
    };
    const conflictingArtifact = {
      ...areaTemplate,
      evidenceSources: [evidenceSource()],
      items: areaTemplate.items.map((reviewItem, index) => index === 0
        ? {
            ...reviewItem,
            reviewStatus: 'matches_official_face',
            reviewer: 'Ben',
            reviewedAt: '2026-07-10T01:00:00.000Z',
            evidenceRef: evidenceRefForArea(reviewItem.area),
          }
        : reviewItem),
    };

    const merge = mergeFaceAuditReviewArtifacts([firstArtifact, conflictingArtifact]);

    expect(merge.ok).toBe(false);
    expect(merge.issues).toContainEqual({
      itemKey: firstItem.key,
      field: 'artifacts[1].items',
      message: 'Face-audit reviewed item conflicts with an earlier artifact',
    });
    expect(merge.review.completion).toMatchObject({
      status: 'in_progress',
      reviewedItemCount: 1,
      unreviewedItemCount: 184,
    });
  });

  it('summarizes review status across partial full or area artifacts', () => {
    const regularCards = buildFaceAuditAreaReviewTemplate('regularCards');
    const wildCards = buildFaceAuditAreaReviewTemplate('wildCards');
    const regularArtifact = {
      ...regularCards,
      evidenceSources: [evidenceSource()],
      items: regularCards.items.map((reviewItem) => ({
        ...reviewItem,
        reviewStatus: 'matches_official_face',
        reviewer: 'Ada',
        reviewedAt: '2026-07-10T00:00:00.000Z',
        evidenceRef: evidenceRefForArea(reviewItem.area),
      })),
    };
    const wildArtifact = {
      ...wildCards,
      evidenceSources: [evidenceSource()],
      items: wildCards.items.map((reviewItem, index) => index === 0
        ? {
            ...reviewItem,
            reviewStatus: 'needs_better_reference',
            reviewer: 'Ben',
            reviewedAt: '2026-07-10T01:00:00.000Z',
            evidenceRef: `official-component:photo-set#${reviewItem.area}:${reviewItem.id}`,
            notes: 'Official reference image is too low-resolution to confirm print details.',
          }
        : reviewItem),
    };

    const report = summarizeFaceAuditReviewStatus([regularArtifact, wildArtifact]);

    expect(report.artifactType).toBe('face_audit_review_status');
    expect(report.version).toBe(1);
    expect(report.ok).toBe(true);
    expect(report.artifactCount).toBe(2);
    expect(report.checklistFingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(report.reviewFingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(report.artifactCounts).toEqual({
      fullReviewArtifactCount: 0,
      areaReviewArtifactCount: 2,
      unknownArtifactCount: 0,
    });
    expect(report.evidenceSourceCount).toBe(1);
    expect(report.usedEvidenceSourceCount).toBe(1);
    expect(report.usedEvidenceSourceIds).toEqual(['photo-set']);
    expect(report.unusedEvidenceSourceCount).toBe(0);
    expect(report.unusedEvidenceSourceIds).toEqual([]);
    expect(report.issueCount).toBe(0);
    expect(report.completion).toEqual({
      status: 'needs_better_reference',
      reviewedItemCount: 65,
      matchingItemCount: 64,
      differenceItemCount: 0,
      needsReferenceItemCount: 1,
      unreviewedItemCount: 120,
      totalItemCount: 185,
    });
    expect(report.areaCompletionCounts).toEqual({
      not_started: 4,
      in_progress: 0,
      ready_to_lock: 1,
      has_differences: 0,
      needs_better_reference: 1,
    });
    expect(report.areaProgress.find((area) => area.area === 'regularCards')).toMatchObject({
      itemCount: 64,
      reviewedItemCount: 64,
      matchingItemCount: 64,
      unreviewedItemCount: 0,
      evidenceRefCount: 1,
      areaLevelEvidenceRefCount: 1,
      itemSpecificEvidenceRefCount: 0,
      itemSpecificEvidenceItemCount: 0,
      evidenceSourceIds: ['photo-set'],
      evidenceRefs: [evidenceRefForArea('regularCards')],
      reviewers: ['Ada'],
      firstReviewedAt: '2026-07-10T00:00:00.000Z',
      lastReviewedAt: '2026-07-10T00:00:00.000Z',
      differenceItemKeys: [],
      needsReferenceItemKeys: [],
      unreviewedItemKeys: [],
      completionStatus: 'ready_to_lock',
    });
    expect(report.areaProgress.find((area) => area.area === 'wildCards')).toMatchObject({
      itemCount: 8,
      reviewedItemCount: 1,
      needsReferenceItemCount: 1,
      unreviewedItemCount: 7,
      evidenceRefCount: 1,
      areaLevelEvidenceRefCount: 0,
      itemSpecificEvidenceRefCount: 1,
      itemSpecificEvidenceItemCount: 1,
      evidenceSourceIds: ['photo-set'],
      evidenceRefs: [`official-component:photo-set#wildCards:${wildCards.items[0]!.id}`],
      reviewers: ['Ben'],
      firstReviewedAt: '2026-07-10T01:00:00.000Z',
      lastReviewedAt: '2026-07-10T01:00:00.000Z',
      differenceItemKeys: [],
      needsReferenceItemKeys: [wildCards.items[0]!.key],
      unreviewedItemKeys: wildCards.items.slice(1).map((item) => item.key),
      completionStatus: 'needs_better_reference',
    });
    expect(report.areaProgress.find((area) => area.area === 'industryTiles')).toMatchObject({
      itemCount: 45,
      reviewedItemCount: 0,
      unreviewedItemCount: 45,
      evidenceRefCount: 0,
      areaLevelEvidenceRefCount: 0,
      itemSpecificEvidenceRefCount: 0,
      itemSpecificEvidenceItemCount: 0,
      evidenceSourceIds: [],
      evidenceRefs: [],
      reviewers: [],
      firstReviewedAt: '',
      lastReviewedAt: '',
      completionStatus: 'not_started',
    });
    expect(report.areaProgress.find((area) => area.area === 'industryTiles')?.unreviewedItemKeys).toHaveLength(45);
  });

  it('reports declared but unused evidence sources separately from used review evidence', () => {
    const template = buildFaceAuditReviewTemplate();
    const report = summarizeFaceAuditReviewStatus([{
      ...template,
      evidenceSources: [evidenceSource()],
    }]);

    expect(report.ok).toBe(true);
    expect(report.evidenceSourceCount).toBe(1);
    expect(report.usedEvidenceSourceCount).toBe(0);
    expect(report.usedEvidenceSourceIds).toEqual([]);
    expect(report.unusedEvidenceSourceCount).toBe(1);
    expect(report.unusedEvidenceSourceIds).toEqual(['photo-set']);
    expect(report.completion.status).toBe('not_started');
    expect(report.areaProgress.every((area) => area.evidenceRefCount === 0)).toBe(true);
    expect(report.areaProgress.every((area) => area.areaLevelEvidenceRefCount === 0)).toBe(true);
    expect(report.areaProgress.every((area) => area.itemSpecificEvidenceRefCount === 0)).toBe(true);
    expect(report.areaProgress.every((area) => area.itemSpecificEvidenceItemCount === 0)).toBe(true);
  });

  it('builds a compact todo artifact for unfinished face-audit handoff work', () => {
    const regularCards = buildFaceAuditAreaReviewTemplate('regularCards');
    const wildCards = buildFaceAuditAreaReviewTemplate('wildCards');
    const regularArtifact = {
      ...regularCards,
      evidenceSources: [evidenceSource()],
      items: regularCards.items.map((reviewItem) => ({
        ...reviewItem,
        reviewStatus: 'matches_official_face',
        reviewer: 'Ada',
        reviewedAt: '2026-07-10T00:00:00.000Z',
        evidenceRef: evidenceRefForArea(reviewItem.area),
      })),
    };
    const wildArtifact = {
      ...wildCards,
      evidenceSources: [evidenceSource()],
      items: wildCards.items.map((reviewItem, index) => index === 0
        ? {
            ...reviewItem,
            reviewStatus: 'needs_better_reference',
            reviewer: 'Ben',
            reviewedAt: '2026-07-10T01:00:00.000Z',
            evidenceRef: `official-component:photo-set#${reviewItem.area}:${reviewItem.id}`,
            notes: 'Official reference image is too low-resolution to confirm print details.',
          }
        : reviewItem),
    };

    const todo = buildFaceAuditReviewTodo([regularArtifact, wildArtifact]);

    expect(todo.artifactType).toBe('face_audit_review_todo');
    expect(todo.version).toBe(1);
    expect(todo.ok).toBe(true);
    expect(todo.artifactCount).toBe(2);
    expect(todo.pendingAreaCount).toBe(5);
    expect(todo.readyAreaCount).toBe(1);
    expect(todo.completion.status).toBe('needs_better_reference');
    expect(todo.commands).toEqual({
      blankTemplate: 'npm run face-audit:template',
      blankTemplateWithSources: 'npm run face-audit:template-with-sources -- .\\path\\to\\evidence-sources.json',
      sourceIdsByAreaTemplate: 'npm run face-audit:source-ids-by-area-template -- .\\path\\to\\evidence-sources.json <default-source-id> [area=source-id...]',
      reviewMatchTemplate: 'npm run face-audit:review-match-template -- .\\path\\to\\evidence-sources.json <source-id> <reviewer> <reviewed-at>',
      reviewMatchTemplateWithItemRefs: 'npm run face-audit:review-match-template -- .\\path\\to\\evidence-sources.json <source-id> <reviewer> <reviewed-at> items',
      reviewMatchTemplateByArea: 'npm run face-audit:review-match-template-by-area -- .\\path\\to\\evidence-sources.json .\\path\\to\\source-ids-by-area.json <reviewer> <reviewed-at>',
      reviewMatchTemplateByAreaWithItemRefs: 'npm run face-audit:review-match-template-by-area -- .\\path\\to\\evidence-sources.json .\\path\\to\\source-ids-by-area.json <reviewer> <reviewed-at> items',
    });
    expect(todo.areas.map((area) => area.area)).not.toContain('regularCards');
    expect(todo.areas.find((area) => area.area === 'wildCards')).toMatchObject({
      completionStatus: 'needs_better_reference',
      nextStep: 'find_better_reference',
      itemCount: 8,
      reviewedItemCount: 1,
      needsReferenceItemCount: 1,
      unreviewedItemCount: 7,
      remainingItemCount: 8,
      evidenceRefCount: 1,
      itemSpecificEvidenceRefCount: 1,
      itemSpecificEvidenceItemCount: 1,
      evidenceSourceIds: ['photo-set'],
      nextItemKeys: [
        wildCards.items[0]!.key,
        ...wildCards.items.slice(1, 10).map((item) => item.key),
      ],
      remainingItemKeyCount: 8,
      commands: {
        blankTemplate: 'npm run face-audit:area-template -- wildCards',
        blankTemplateWithSources: 'npm run face-audit:area-template-with-sources -- wildCards .\\path\\to\\evidence-sources.json',
        areaMatchTemplate: 'npm run face-audit:area-match-template -- wildCards .\\path\\to\\evidence-sources.json <source-id> <reviewer> <reviewed-at>',
        areaMatchTemplateWithItemRefs: 'npm run face-audit:area-match-template -- wildCards .\\path\\to\\evidence-sources.json <source-id> <reviewer> <reviewed-at> items',
      },
    });
    expect(todo.areas.find((area) => area.area === 'industryTiles')).toMatchObject({
      completionStatus: 'not_started',
      nextStep: 'review_unreviewed_items',
      remainingItemCount: 45,
      nextItemKeys: buildFaceAuditAreaReviewTemplate('industryTiles').items.slice(0, 10).map((item) => item.key),
      remainingItemKeyCount: 45,
    });

    const summary = buildFaceAuditReviewTodoSummary(todo);
    expect(summary).toEqual({
      artifactType: 'face_audit_review_todo_summary',
      version: 1,
      ok: true,
      artifactCount: 2,
      checklistFingerprint: todo.checklistFingerprint,
      reviewFingerprint: todo.reviewFingerprint,
      checklistItemCount: todo.checklistItemCount,
      completion: todo.completion,
      pendingAreaCount: 5,
      readyAreaCount: 1,
      pendingItemCount: 121,
      unfinishedAreas: todo.areas.map((area) => ({
        area: area.area,
        completionStatus: area.completionStatus,
        nextStep: area.nextStep,
        remainingItemCount: area.remainingItemCount,
      })),
      issueCount: 0,
      issues: [],
    });

    expect(buildFaceAuditAreaReviewTodoSummary([regularArtifact, wildArtifact], 'regularCards')).toMatchObject({
      artifactType: 'face_audit_area_review_todo_summary',
      version: 1,
      ok: true,
      artifactCount: 2,
      area: 'regularCards',
      checklistFingerprint: todo.checklistFingerprint,
      reviewFingerprint: todo.reviewFingerprint,
      checklistItemCount: todo.checklistItemCount,
      itemCount: 64,
      completionStatus: 'ready_to_lock',
      nextStep: 'none',
      pendingItemCount: 0,
      remainingItemCount: 0,
      reviewedItemCount: 64,
      matchingItemCount: 64,
      differenceItemCount: 0,
      needsReferenceItemCount: 0,
      unreviewedItemCount: 0,
      evidenceRefCount: 1,
      areaLevelEvidenceRefCount: 1,
      itemSpecificEvidenceRefCount: 0,
      itemSpecificEvidenceItemCount: 0,
      evidenceSourceIds: ['photo-set'],
      issueCount: 0,
      issues: [],
    });
    expect(buildFaceAuditAreaReviewTodoSummary([regularArtifact, wildArtifact], 'wildCards')).toMatchObject({
      artifactType: 'face_audit_area_review_todo_summary',
      ok: true,
      area: 'wildCards',
      itemCount: 8,
      completionStatus: 'needs_better_reference',
      nextStep: 'find_better_reference',
      pendingItemCount: 8,
      remainingItemCount: 8,
      reviewedItemCount: 1,
      matchingItemCount: 0,
      differenceItemCount: 0,
      needsReferenceItemCount: 1,
      unreviewedItemCount: 7,
      evidenceRefCount: 1,
      areaLevelEvidenceRefCount: 0,
      itemSpecificEvidenceRefCount: 1,
      itemSpecificEvidenceItemCount: 1,
      evidenceSourceIds: ['photo-set'],
      issueCount: 0,
      issues: [],
    });
  });

  it('builds a reviewer plan with every unfinished item grouped by area', () => {
    const regularCards = buildFaceAuditAreaReviewTemplate('regularCards');
    const wildCards = buildFaceAuditAreaReviewTemplate('wildCards');
    const regularArtifact = {
      ...regularCards,
      evidenceSources: [evidenceSource()],
      items: regularCards.items.map((reviewItem) => ({
        ...reviewItem,
        reviewStatus: 'matches_official_face',
        reviewer: 'Ada',
        reviewedAt: '2026-07-10T00:00:00.000Z',
        evidenceRef: evidenceRefForArea(reviewItem.area),
      })),
    };
    const wildArtifact = {
      ...wildCards,
      evidenceSources: [evidenceSource()],
      items: wildCards.items.map((reviewItem, index) => index === 0
        ? {
            ...reviewItem,
            reviewStatus: 'needs_better_reference',
            reviewer: 'Ben',
            reviewedAt: '2026-07-10T01:00:00.000Z',
            evidenceRef: `official-component:photo-set#${reviewItem.area}:${reviewItem.id}`,
            notes: 'Official reference image is too low-resolution to confirm print details.',
          }
        : reviewItem),
    };

    const plan = buildFaceAuditReviewPlan([regularArtifact, wildArtifact]);

    expect(plan.artifactType).toBe('face_audit_review_plan');
    expect(plan.version).toBe(1);
    expect(plan.ok).toBe(true);
    expect(plan.artifactCount).toBe(2);
    expect(plan.pendingAreaCount).toBe(5);
    expect(plan.readyAreaCount).toBe(1);
    expect(plan.pendingItemCount).toBe(121);
    expect(plan.completion.status).toBe('needs_better_reference');
    expect(plan.commands.reviewMatchTemplateByAreaWithItemRefs)
      .toBe('npm run face-audit:review-match-template-by-area -- .\\path\\to\\evidence-sources.json .\\path\\to\\source-ids-by-area.json <reviewer> <reviewed-at> items');
    expect(plan.areas.map((area) => area.area)).not.toContain('regularCards');

    const wildPlan = plan.areas.find((area) => area.area === 'wildCards');
    expect(wildPlan).toBeDefined();
    if (!wildPlan) {
      throw new Error('Missing wildCards plan');
    }
    expect(wildPlan).toMatchObject({
      area: 'wildCards',
      completionStatus: 'needs_better_reference',
      nextStep: 'find_better_reference',
      remainingItemCount: 8,
    });
    expect(wildPlan.items).toHaveLength(8);
    expect(wildPlan.items[0]).toEqual({
      key: wildCards.items[0]!.key,
      id: wildCards.items[0]!.id,
      label: wildCards.items[0]!.label,
      expectedFields: wildCards.items[0]!.expectedFields,
      reviewStatus: 'needs_better_reference',
      nextStep: 'find_better_reference',
      evidenceRef: `official-component:photo-set#wildCards:${wildCards.items[0]!.id}`,
      notes: 'Official reference image is too low-resolution to confirm print details.',
    });
    expect(wildPlan.items.slice(1).every((item) =>
      item.reviewStatus === 'unreviewed' &&
      item.nextStep === 'review_unreviewed_items' &&
      item.evidenceRef === '' &&
      item.notes === '',
    )).toBe(true);

    const industryPlan = plan.areas.find((area) => area.area === 'industryTiles');
    expect(industryPlan).toBeDefined();
    if (!industryPlan) {
      throw new Error('Missing industryTiles plan');
    }
    expect(industryPlan.items).toHaveLength(45);
    expect(industryPlan.items[0]).toMatchObject({
      key: 'industryTiles:brewery-1-1',
      reviewStatus: 'unreviewed',
      nextStep: 'review_unreviewed_items',
    });
  });

  it('builds a TSV review sheet for spreadsheet-based face audits', () => {
    const regularCards = buildFaceAuditAreaReviewTemplate('regularCards');
    const firstRegularCard = regularCards.items[0]!;
    const artifact = {
      ...regularCards,
      evidenceSources: [evidenceSource()],
      items: regularCards.items.map((reviewItem, index) => index === 0
        ? {
            ...reviewItem,
            reviewStatus: 'needs_better_reference',
            reviewer: 'Ada\tLovelace',
            reviewedAt: '2026-07-10T00:00:00.000Z',
            evidenceRef: `official-component:photo-set#${reviewItem.area}:${reviewItem.id}`,
            notes: 'Line one\nLine two\tTabbed',
          }
        : reviewItem),
    };

    const sheet = buildFaceAuditReviewSheet([artifact]);
    const lines = sheet.tsv.endsWith('\n')
      ? sheet.tsv.slice(0, -1).split('\n')
      : sheet.tsv.split('\n');
    const firstRegularRow = lines.find((line) => line.includes(`\t${firstRegularCard.key}\t`));
    const firstIndustryRow = lines.find((line) => line.includes('\tindustryTiles:brewery-1-1\t'));

    expect(sheet.ok).toBe(true);
    expect(sheet.rowCount).toBe(185);
    expect(sheet.issueCount).toBe(0);
    expect(sheet.reviewFingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(lines).toHaveLength(186);
    expect(lines[0]).toBe('area\titemId\titemKey\tlabel\texpectedFields\treviewStatus\tnextStep\treviewer\treviewedAt\tevidenceRef\tnotes');
    expect(firstRegularRow?.split('\t')).toEqual([
      'regularCards',
      firstRegularCard.id,
      firstRegularCard.key,
      firstRegularCard.label,
      firstRegularCard.expectedFields.join('; '),
      'needs_better_reference',
      'find_better_reference',
      'Ada Lovelace',
      '2026-07-10T00:00:00.000Z',
      `official-component:photo-set#regularCards:${firstRegularCard.id}`,
      'Line one Line two Tabbed',
    ]);
    expect(firstIndustryRow?.split('\t')[6]).toBe('review_unreviewed_items');

    const areaSheet = buildFaceAuditAreaReviewSheet([artifact], 'regularCards');
    const areaLines = areaSheet.tsv.endsWith('\n')
      ? areaSheet.tsv.slice(0, -1).split('\n')
      : areaSheet.tsv.split('\n');
    expect(areaSheet.ok).toBe(true);
    expect(areaSheet.area).toBe('regularCards');
    expect(areaSheet.areaItemCount).toBe(64);
    expect(areaSheet.rowCount).toBe(64);
    expect(areaLines).toHaveLength(65);
    expect(areaLines[0]).toBe(lines[0]);
    expect(areaLines.every((line, index) => index === 0 || line.startsWith('regularCards\t'))).toBe(true);
    expect(areaLines.find((line) => line.includes(`\t${firstRegularCard.key}\t`))?.split('\t')).toEqual([
      'regularCards',
      firstRegularCard.id,
      firstRegularCard.key,
      firstRegularCard.label,
      firstRegularCard.expectedFields.join('; '),
      'needs_better_reference',
      'find_better_reference',
      'Ada Lovelace',
      '2026-07-10T00:00:00.000Z',
      `official-component:photo-set#regularCards:${firstRegularCard.id}`,
      'Line one Line two Tabbed',
    ]);
  });

  it('applies a TSV review sheet back onto review artifacts', () => {
    const baseReview = {
      ...buildFaceAuditReviewTemplate(),
      evidenceSources: [evidenceSource()],
    };
    const firstRegularCard = baseReview.items.find((reviewItem) => reviewItem.area === 'regularCards');
    if (!firstRegularCard) {
      throw new Error('Missing regularCards review item');
    }
    const sheet = buildFaceAuditReviewSheet([baseReview]);
    const lines = sheet.tsv.endsWith('\n')
      ? sheet.tsv.slice(0, -1).split('\n')
      : sheet.tsv.split('\n');
    const rowIndex = lines.findIndex((line) => line.includes(`\t${firstRegularCard.key}\t`));
    if (rowIndex < 1) {
      throw new Error('Missing regularCards TSV row');
    }
    const cells = lines[rowIndex]!.split('\t');
    cells[5] = 'matches_official_face';
    cells[6] = '';
    cells[7] = 'Ada';
    cells[8] = '2026-07-10T00:00:00.000Z';
    cells[9] = `official-component:photo-set#regularCards:${firstRegularCard.id}`;
    lines[rowIndex] = cells.join('\t');

    const imported = applyFaceAuditReviewSheet([baseReview], `${lines.join('\n')}\n`);
    const importedItem = imported.review.items.find((reviewItem) => reviewItem.key === firstRegularCard.key);

    expect(imported.artifactType).toBe('face_audit_review_sheet_import');
    expect(imported.version).toBe(1);
    expect(imported.ok).toBe(true);
    expect(imported.rowCount).toBe(185);
    expect(imported.appliedItemCount).toBe(185);
    expect(imported.issueCount).toBe(0);
    expect(imported.baseReviewFingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(imported.reviewFingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(imported.reviewFingerprint).not.toBe(imported.baseReviewFingerprint);
    expect(imported.review.evidenceSources).toEqual([evidenceSource()]);
    expect(importedItem).toMatchObject({
      reviewStatus: 'matches_official_face',
      reviewer: 'Ada',
      reviewedAt: '2026-07-10T00:00:00.000Z',
      evidenceRef: `official-component:photo-set#regularCards:${firstRegularCard.id}`,
      notes: '',
    });

    const invalid = applyFaceAuditReviewSheet([baseReview], sheet.tsv.replace('itemKey', 'badItemKey'));
    expect(invalid.ok).toBe(false);
    expect(invalid.issues).toContainEqual({
      field: 'reviewSheet.header',
      message: 'Face-audit review sheet header must match the exported TSV columns',
    });
  });

  it('builds reviewer handoff artifacts that preserve unfinished area review state', () => {
    const regularCards = buildFaceAuditAreaReviewTemplate('regularCards');
    const wildCards = buildFaceAuditAreaReviewTemplate('wildCards');
    const regularArtifact = {
      ...regularCards,
      evidenceSources: [evidenceSource()],
      items: regularCards.items.map((reviewItem) => ({
        ...reviewItem,
        reviewStatus: 'matches_official_face',
        reviewer: 'Ada',
        reviewedAt: '2026-07-10T00:00:00.000Z',
        evidenceRef: evidenceRefForArea(reviewItem.area),
      })),
    };
    const wildArtifact = {
      ...wildCards,
      evidenceSources: [evidenceSource()],
      items: wildCards.items.map((reviewItem, index) => index === 0
        ? {
            ...reviewItem,
            reviewStatus: 'needs_better_reference',
            reviewer: 'Ben',
            reviewedAt: '2026-07-10T01:00:00.000Z',
            evidenceRef: `official-component:photo-set#${reviewItem.area}:${reviewItem.id}`,
            notes: 'Official reference image is too low-resolution to confirm print details.',
          }
        : reviewItem),
    };

    const handoff = buildFaceAuditReviewerHandoff([regularArtifact, wildArtifact]);

    expect(handoff.artifactType).toBe('face_audit_reviewer_handoff');
    expect(handoff.version).toBe(1);
    expect(handoff.ok).toBe(true);
    expect(handoff.artifactCount).toBe(2);
    expect(handoff.checklistFingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(handoff.reviewFingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(handoff.checklistItemCount).toBe(185);
    expect(handoff.evidenceSourceCount).toBe(1);
    expect(handoff.evidenceSources).toEqual([evidenceSource()]);
    expect(handoff.pendingAreaCount).toBe(5);
    expect(handoff.readyAreaCount).toBe(1);
    expect(handoff.issueCount).toBe(0);
    expect(handoff.todo.artifactType).toBe('face_audit_review_todo');
    expect(handoff.areas.map((area) => area.area)).not.toContain('regularCards');

    const wildHandoff = handoff.areas.find((area) => area.area === 'wildCards');
    expect(wildHandoff).toBeDefined();
    if (!wildHandoff) {
      throw new Error('Missing wildCards handoff');
    }
    expect(wildHandoff.todo).toMatchObject({
      area: 'wildCards',
      nextStep: 'find_better_reference',
      remainingItemCount: 8,
    });
    expect(wildHandoff.reviewArtifact).toMatchObject({
      artifactType: 'face_audit_area_review',
      area: 'wildCards',
      areaItemCount: 8,
      evidenceSources: [evidenceSource()],
      completion: {
        status: 'needs_better_reference',
        reviewedItemCount: 1,
        needsReferenceItemCount: 1,
        unreviewedItemCount: 7,
        totalItemCount: 8,
      },
    });
    expect(wildHandoff.reviewArtifact.items[0]).toMatchObject({
      key: wildCards.items[0]!.key,
      reviewStatus: 'needs_better_reference',
      reviewer: 'Ben',
      evidenceRef: `official-component:photo-set#wildCards:${wildCards.items[0]!.id}`,
    });
    expect(wildHandoff.reviewArtifact.items.slice(1).every((item) => item.reviewStatus === 'unreviewed')).toBe(true);

    const industryHandoff = handoff.areas.find((area) => area.area === 'industryTiles');
    expect(industryHandoff).toBeDefined();
    if (!industryHandoff) {
      throw new Error('Missing industryTiles handoff');
    }
    expect(industryHandoff.reviewArtifact.completion).toMatchObject({
      status: 'not_started',
      unreviewedItemCount: 45,
      totalItemCount: 45,
    });
    expect(industryHandoff.reviewArtifact.evidenceSources).toEqual([evidenceSource()]);
    expect(industryHandoff.reviewArtifact.items).toEqual(buildFaceAuditAreaReviewTemplate('industryTiles').items);
  });

  it('builds reviewer instructions from the same status, plan, and handoff inputs', () => {
    const regularCards = buildFaceAuditAreaReviewTemplate('regularCards');
    const wildCards = buildFaceAuditAreaReviewTemplate('wildCards');
    const regularArtifact = {
      ...regularCards,
      evidenceSources: [evidenceSource()],
      items: regularCards.items.map((reviewItem) => ({
        ...reviewItem,
        reviewStatus: 'matches_official_face',
        reviewer: 'Ada',
        reviewedAt: '2026-07-10T00:00:00.000Z',
        evidenceRef: evidenceRefForArea(reviewItem.area),
      })),
    };
    const wildArtifact = {
      ...wildCards,
      evidenceSources: [evidenceSource()],
      items: wildCards.items.map((reviewItem, index) => index === 0
        ? {
            ...reviewItem,
            reviewStatus: 'needs_better_reference',
            reviewer: 'Ben',
            reviewedAt: '2026-07-10T01:00:00.000Z',
            evidenceRef: `official-component:photo-set#${reviewItem.area}:${reviewItem.id}`,
            notes: 'Official reference image is too low-resolution to confirm print details.',
          }
        : reviewItem),
    };
    const artifacts = [regularArtifact, wildArtifact];
    const status = summarizeFaceAuditReviewStatus(artifacts);
    const todo = buildFaceAuditReviewTodo(artifacts);
    const plan = buildFaceAuditReviewPlan(artifacts);
    const handoff = buildFaceAuditReviewerHandoff(artifacts);
    const instructions = buildFaceAuditReviewerInstructions({
      status,
      todo,
      plan,
      handoff,
      areaFiles: handoff.areas.map((area) => ({
        area: area.area,
        fileName: faceAuditAreaReviewArtifactFileName(area.area),
        todoSummaryFileName: faceAuditAreaReviewTodoSummaryArtifactFileName(area.area),
        reviewerInstructionsFileName: faceAuditAreaReviewerInstructionsArtifactFileName(area.area),
      })),
    });
    const wildArea = handoff.areas.find((area) => area.area === 'wildCards');
    if (!wildArea) {
      throw new Error('Missing wildCards handoff area');
    }
    const wildAreaInstructions = buildFaceAuditAreaReviewerInstructions({
      handoff,
      area: wildArea,
      reviewFileName: faceAuditAreaReviewArtifactFileName(wildArea.area),
      todoSummaryFileName: faceAuditAreaReviewTodoSummaryArtifactFileName(wildArea.area),
    });
    const wildAreaInstructionsReport = buildFaceAuditAreaReviewerInstructionsReport(artifacts, 'wildCards');
    const readyRegularCardsInstructionsReport =
      buildFaceAuditAreaReviewerInstructionsReport(artifacts, 'regularCards');

    expect(instructions).toContain('# Face Audit Reviewer Instructions');
    expect(instructions).toContain(`- Checklist fingerprint: \`${status.checklistFingerprint}\``);
    expect(instructions).toContain(`- Review fingerprint: \`${status.reviewFingerprint}\``);
    expect(instructions).toContain('- Progress: 65 / 185 reviewed; 120 unreviewed');
    expect(instructions).toContain('- Areas: 5 pending, 1 ready');
    expect(instructions).toContain('- Pending items in review plan: 121');
    expect(instructions).toContain('- Declared evidence sources in handoff: 1');
    expect(instructions).toContain('- `face-audit-review-sheet.tsv`: spreadsheet-friendly assignment and tracking view.');
    expect(instructions)
      .toContain('- `face-audit-area-<area>-review-sheet.tsv`: spreadsheet-friendly tracking view for one unfinished area.');
    expect(instructions)
      .toContain('- `face-audit-area-<area>-todo-summary.json`: counts-only progress for one unfinished area.');
    expect(instructions)
      .toContain('- `face-audit-area-<area>-reviewer-instructions.md`: area-specific reviewer workflow and focus keys.');
    expect(instructions)
      .toContain('- `wildCards`: 8 item(s), next step `find_better_reference`, file `face-audit-area-wildCards-review.json`, sheet `face-audit-area-wildCards-review-sheet.tsv`, summary `face-audit-area-wildCards-todo-summary.json`, instructions `face-audit-area-wildCards-reviewer-instructions.md`');
    expect(instructions).toContain('- Verify this handoff package: `npm run face-audit:verify-handoff -- .\\face-audit-reviewer-handoff.json`');
    expect(instructions.endsWith('\n')).toBe(false);
    expect(wildAreaInstructions).toContain('# Face Audit Area Reviewer Instructions: wildCards');
    expect(wildAreaInstructions).toContain('- Area: `wildCards`');
    expect(wildAreaInstructions).toContain(`- Review fingerprint: \`${handoff.reviewFingerprint}\``);
    expect(wildAreaInstructions).toContain('- Review artifact: `face-audit-area-wildCards-review.json`');
    expect(wildAreaInstructions).toContain('- Review sheet: `face-audit-area-wildCards-review-sheet.tsv`');
    expect(wildAreaInstructions).toContain('- Todo summary: `face-audit-area-wildCards-todo-summary.json`');
    expect(wildAreaInstructions).toContain('- Next step: `find_better_reference`');
    expect(wildAreaInstructions).toContain('- Remaining items: 8 / 8');
    expect(wildAreaInstructions).toContain('- Evidence source IDs already used: `photo-set`');
    expect(wildAreaInstructions).toContain(`- \`${wildArea.todo.nextItemKeys[0]}\``);
    expect(wildAreaInstructions)
      .toContain('- Summarize this area: `npm run face-audit:todo -- --summary --area wildCards .\\face-audit-area-wildCards-review.json`');
    expect(wildAreaInstructions.endsWith('\n')).toBe(false);
    expect(wildAreaInstructionsReport).toMatchObject({
      artifactType: 'face_audit_area_reviewer_instructions',
      version: 1,
      ok: true,
      area: 'wildCards',
      reviewFileName: 'face-audit-area-wildCards-review.json',
      reviewSheetFileName: 'face-audit-area-wildCards-review-sheet.tsv',
      todoSummaryFileName: 'face-audit-area-wildCards-todo-summary.json',
      issueCount: 0,
      issues: [],
    });
    expect(wildAreaInstructionsReport.markdown).toBe(wildAreaInstructions);
    expect(readyRegularCardsInstructionsReport).toMatchObject({
      artifactType: 'face_audit_area_reviewer_instructions',
      version: 1,
      ok: true,
      area: 'regularCards',
      issueCount: 0,
      issues: [],
    });
    expect(readyRegularCardsInstructionsReport.markdown)
      .toContain('# Face Audit Area Reviewer Instructions: regularCards');
    expect(readyRegularCardsInstructionsReport.markdown)
      .toContain('- Completion status: `ready_to_lock`');
    expect(readyRegularCardsInstructionsReport.markdown)
      .toContain('- No unfinished items remain for this area.');
  });

  it('validates reviewer handoff artifacts against the current checklist and embedded area artifacts', () => {
    const regularCards = buildFaceAuditAreaReviewTemplate('regularCards');
    const wildCards = buildFaceAuditAreaReviewTemplate('wildCards');
    const regularArtifact = {
      ...regularCards,
      evidenceSources: [evidenceSource()],
      items: regularCards.items.map((reviewItem) => ({
        ...reviewItem,
        reviewStatus: 'matches_official_face',
        reviewer: 'Ada',
        reviewedAt: '2026-07-10T00:00:00.000Z',
        evidenceRef: evidenceRefForArea(reviewItem.area),
      })),
    };
    const wildArtifact = {
      ...wildCards,
      evidenceSources: [evidenceSource()],
      items: wildCards.items.map((reviewItem, index) => index === 0
        ? {
            ...reviewItem,
            reviewStatus: 'needs_better_reference',
            reviewer: 'Ben',
            reviewedAt: '2026-07-10T01:00:00.000Z',
            evidenceRef: `official-component:photo-set#${reviewItem.area}:${reviewItem.id}`,
            notes: 'Official reference image is too low-resolution to confirm print details.',
          }
        : reviewItem),
    };
    const handoff = buildFaceAuditReviewerHandoff([regularArtifact, wildArtifact]);

    const validation = validateFaceAuditReviewerHandoffArtifact(handoff);

    expect(validation.ok).toBe(true);
    expect(validation.issues).toEqual([]);
    expect(validation.handoff).toMatchObject({
      artifactType: 'face_audit_reviewer_handoff',
      reviewFingerprint: handoff.reviewFingerprint,
      pendingAreaCount: 5,
      readyAreaCount: 1,
      issueCount: 0,
    });
    expect(validation.handoff?.areas).toHaveLength(handoff.pendingAreaCount);

    const staleFingerprintValidation = validateFaceAuditReviewerHandoffArtifact({
      ...handoff,
      checklistFingerprint: 'fnv1a32:00000000',
    });
    expect(staleFingerprintValidation.ok).toBe(false);
    expect(staleFingerprintValidation.issues).toContainEqual({
      field: 'checklistFingerprint',
      message: 'Face-audit reviewer handoff does not match the current checklist',
    });

    const tamperedTodoValidation = validateFaceAuditReviewerHandoffArtifact({
      ...handoff,
      areas: handoff.areas.map((area, index) => index === 0
        ? {
            ...area,
            todo: {
              ...area.todo,
              remainingItemCount: area.todo.remainingItemCount + 1,
            },
          }
        : area),
    });
    expect(tamperedTodoValidation.ok).toBe(false);
    expect(tamperedTodoValidation.issues.some((issue) =>
      issue.field === 'areas[0].todo' &&
      issue.message.includes('must match embedded todo area'),
    )).toBe(true);

    const tamperedAreaArtifactValidation = validateFaceAuditReviewerHandoffArtifact({
      ...handoff,
      areas: handoff.areas.map((area, index) => index === 0
        ? {
            ...area,
            reviewArtifact: {
              ...area.reviewArtifact,
              evidenceSources: [],
            },
          }
        : area),
    });
    expect(tamperedAreaArtifactValidation.ok).toBe(false);
    expect(tamperedAreaArtifactValidation.issues.some((issue) =>
      issue.field === 'areas[0].reviewArtifact.evidenceSources' &&
      issue.message === 'Face-audit reviewer handoff area evidence sources must match top-level evidenceSources',
    )).toBe(true);

    const embeddedIssueValidation = validateFaceAuditReviewerHandoffArtifact({
      ...handoff,
      ok: false,
      issueCount: 1,
      issues: [{field: 'artifacts', message: 'Injected stale issue'}],
      todo: {
        ...handoff.todo,
        ok: false,
        issueCount: 1,
        issues: [{field: 'artifacts', message: 'Injected stale issue'}],
      },
    });
    expect(embeddedIssueValidation.ok).toBe(false);
    expect(embeddedIssueValidation.issues).toEqual(expect.arrayContaining([
      {
        field: 'ok',
        message: 'Face-audit reviewer handoff must be ok before it can be verified',
      },
      {
        field: 'issues',
        message: 'Face-audit reviewer handoff must not contain embedded issues',
      },
    ]));
  });

  it('summarizes area artifacts returned for a reviewer handoff', () => {
    const regularCards = buildFaceAuditAreaReviewTemplate('regularCards');
    const regularArtifact = {
      ...regularCards,
      evidenceSources: [evidenceSource()],
      items: regularCards.items.map((reviewItem) => ({
        ...reviewItem,
        reviewStatus: 'matches_official_face',
        reviewer: 'Ada',
        reviewedAt: '2026-07-10T00:00:00.000Z',
        evidenceRef: evidenceRefForArea(reviewItem.area),
      })),
    };
    const handoff = buildFaceAuditReviewerHandoff([regularArtifact]);
    const industryHandoff = handoff.areas.find((area) => area.area === 'industryTiles');
    if (!industryHandoff) {
      throw new Error('Missing industryTiles handoff');
    }
    const industryResponse = {
      ...industryHandoff.reviewArtifact,
      items: industryHandoff.reviewArtifact.items.map((reviewItem, index) => ({
        ...reviewItem,
        reviewStatus: 'matches_official_face',
        reviewer: index % 2 === 0 ? 'Ada' : 'Ben',
        reviewedAt: new Date(Date.UTC(2026, 6, 10, 2, index)).toISOString(),
        evidenceRef: evidenceRefForArea(reviewItem.area),
      })),
    };

    const report = summarizeFaceAuditReviewerHandoffResponse(handoff, [industryResponse]);

    expect(report).toMatchObject({
      artifactType: 'face_audit_reviewer_handoff_response',
      version: 1,
      ok: true,
      checklistFingerprint: handoff.checklistFingerprint,
      handoffReviewFingerprint: handoff.reviewFingerprint,
      handoffPendingAreaCount: 5,
      responseArtifactCount: 1,
      acceptedAreaCount: 1,
      readyAreaCount: 1,
      unfinishedReturnedAreaCount: 0,
      missingAreaCount: 4,
      remainingAreaCount: 4,
      issueCount: 0,
      issues: [],
    });
    expect(report.areas).toEqual([expect.objectContaining({
      area: 'industryTiles',
      status: 'manifest_locked_face_audit_pending',
      completionStatus: 'ready_to_lock',
      itemCount: 45,
      reviewedItemCount: 45,
      matchingItemCount: 45,
      remainingItemCount: 0,
      evidenceRefCount: 1,
      areaLevelEvidenceRefCount: 1,
      itemSpecificEvidenceRefCount: 0,
      itemSpecificEvidenceItemCount: 0,
      evidenceSourceIds: ['photo-set'],
      reviewers: ['Ada', 'Ben'],
    })]);
    expect(Date.parse(report.areas[0]!.firstReviewedAt)).toBeLessThanOrEqual(
      Date.parse(report.areas[0]!.lastReviewedAt),
    );

    const duplicateReport = summarizeFaceAuditReviewerHandoffResponse(handoff, [
      industryResponse,
      industryResponse,
    ]);
    expect(duplicateReport.ok).toBe(false);
    expect(duplicateReport.issues).toContainEqual({
      field: 'artifacts[1].area',
      message: 'Face-audit handoff response area appears more than once',
    });

    const nonPendingReport = summarizeFaceAuditReviewerHandoffResponse(handoff, [regularArtifact]);
    expect(nonPendingReport.ok).toBe(false);
    expect(nonPendingReport.issues).toContainEqual({
      field: 'artifacts[0].area',
      message: 'Face-audit handoff response area is not part of the reviewer handoff pending areas',
    });

    const staleHandoffReport = summarizeFaceAuditReviewerHandoffResponse({
      ...handoff,
      checklistFingerprint: 'fnv1a32:00000000',
    }, [industryResponse]);
    expect(staleHandoffReport.ok).toBe(false);
    expect(staleHandoffReport.issues).toContainEqual({
      field: 'handoff.checklistFingerprint',
      message: 'Face-audit reviewer handoff does not match the current checklist',
    });
  });

  it('summarizes filled review items before audit status can be locked', () => {
    const template = buildFaceAuditReviewTemplate();
    const reviewedItems: FaceAuditReviewItem[] = template.items.map((reviewItem) => ({
      ...reviewItem,
      reviewStatus: 'matches_official_face',
    }));

    expect(FACE_AUDIT_REVIEW_STATUSES).toEqual([
      'unreviewed',
      'matches_official_face',
      'differs_from_official_face',
      'needs_better_reference',
    ]);
    expect(summarizeFaceAuditReviewCompletion(reviewedItems)).toEqual({
      status: 'ready_to_lock',
      reviewedItemCount: 185,
      matchingItemCount: 185,
      differenceItemCount: 0,
      needsReferenceItemCount: 0,
      unreviewedItemCount: 0,
      totalItemCount: 185,
    });

    expect(summarizeFaceAuditReviewCompletion([
      {...reviewedItems[0]!, reviewStatus: 'unreviewed'},
      ...reviewedItems.slice(1),
    ])).toMatchObject({status: 'in_progress', reviewedItemCount: 184});
    expect(summarizeFaceAuditReviewCompletion([
      {...reviewedItems[0]!, reviewStatus: 'needs_better_reference'},
      ...reviewedItems.slice(1),
    ])).toMatchObject({status: 'needs_better_reference', needsReferenceItemCount: 1});
    expect(summarizeFaceAuditReviewCompletion([
      {...reviewedItems[0]!, reviewStatus: 'differs_from_official_face'},
      {...reviewedItems[1]!, reviewStatus: 'needs_better_reference'},
      ...reviewedItems.slice(2),
    ])).toMatchObject({status: 'has_differences', differenceItemCount: 1, needsReferenceItemCount: 1});
  });

  it('validates a filled review artifact and recomputes stale summaries', () => {
    const template = buildFaceAuditReviewTemplate();
    const filledArtifact = {
      ...template,
      evidenceSources: [evidenceSource()],
      areas: [],
      completion: template.completion,
      items: template.items.map((reviewItem) => ({
        ...reviewItem,
        reviewStatus: 'matches_official_face',
        reviewer: 'Ada',
        reviewedAt: '2026-07-10T00:00:00.000Z',
        evidenceRef: evidenceRefForArea(reviewItem.area),
      })),
    };

    const validation = validateFaceAuditReviewArtifact(filledArtifact);

    expect(validation.ok).toBe(true);
    expect(validation.issues).toEqual([]);
    expect(validation.review.evidenceSources).toEqual([evidenceSource()]);
    expect(validation.review.completion).toEqual({
      status: 'ready_to_lock',
      reviewedItemCount: 185,
      matchingItemCount: 185,
      differenceItemCount: 0,
      needsReferenceItemCount: 0,
      unreviewedItemCount: 0,
      totalItemCount: 185,
    });
    expect(validation.review.areas).toHaveLength(FACE_AUDIT_AREAS.length);
    expect(validation.review.areas.find((area) => area.area === 'regularCards')?.reviewCounts)
      .toEqual({
        unreviewed: 0,
        matches_official_face: 64,
        differs_from_official_face: 0,
        needs_better_reference: 0,
      });
  });

  it('enforces a stricter ready gate before audit statuses can be locked', () => {
    const template = buildFaceAuditReviewTemplate();
    const filledArtifact = {
      ...template,
      evidenceSources: [evidenceSource()],
      items: template.items.map((reviewItem) => ({
        ...reviewItem,
        reviewStatus: 'matches_official_face',
        reviewer: 'Ada',
        reviewedAt: '2026-07-10T00:00:00.000Z',
        evidenceRef: evidenceRefForArea(reviewItem.area),
      })),
    };

    expect(validateFaceAuditReviewArtifact(template).ok).toBe(true);
    const unreviewedReadyValidation = validateFaceAuditReadyArtifact(template);
    expect(unreviewedReadyValidation.ok).toBe(false);
    expect(unreviewedReadyValidation.issues).toEqual(expect.arrayContaining([
      {
        field: 'completion.status',
        message: 'Face-audit review must be ready_to_lock before audit statuses can be locked',
      },
      {
        field: 'completion.unreviewedItemCount',
        message: 'Face-audit review still has 185 unreviewed item(s)',
      },
    ]));

    const differenceArtifact = {
      ...filledArtifact,
      items: filledArtifact.items.map((reviewItem, index) => index === 0
        ? {
            ...reviewItem,
            reviewStatus: 'differs_from_official_face',
            notes: 'Official face has a different printed value.',
          }
        : reviewItem),
    };
    const differenceReadyValidation = validateFaceAuditReadyArtifact(differenceArtifact);
    expect(differenceReadyValidation.ok).toBe(false);
    expect(differenceReadyValidation.review.completion.status).toBe('has_differences');
    expect(differenceReadyValidation.issues).toEqual(expect.arrayContaining([
      {
        field: 'completion.differenceItemCount',
        message: 'Face-audit review still has 1 item(s) that differ from official faces',
      },
    ]));

    const untraceableSource = {...evidenceSource()};
    delete untraceableSource.locator;
    delete untraceableSource.contentHash;
    const untraceableReadyValidation = validateFaceAuditReadyArtifact({
      ...filledArtifact,
      evidenceSources: [untraceableSource],
    });
    expect(untraceableReadyValidation.ok).toBe(false);
    expect(untraceableReadyValidation.issues).toContainEqual({
      field: 'evidenceSources',
      message: 'Face-audit ready review evidence source(s) must include locator or contentHash: photo-set',
    });

    const readyValidation = validateFaceAuditReadyArtifact(filledArtifact);
    expect(readyValidation.ok).toBe(true);
    expect(readyValidation.issues).toEqual([]);
    expect(readyValidation.review.completion.status).toBe('ready_to_lock');
  });

  it('builds an audit-status lock preview only after the ready gate passes', () => {
    const template = buildFaceAuditReviewTemplate();
    const notReadyPreview = buildFaceAuditLockPreview(template);

    expect(notReadyPreview.ok).toBe(false);
    expect(notReadyPreview.lockPreview).toBeUndefined();

    const readyArtifact = {
      ...template,
      evidenceSources: [evidenceSource()],
      items: template.items.map((reviewItem, index) => ({
        ...reviewItem,
        reviewStatus: 'matches_official_face',
        reviewer: index % 2 === 0 ? 'Ada' : 'Ben',
        reviewedAt: new Date(Date.UTC(2026, 6, 10, 0, index)).toISOString(),
        evidenceRef: evidenceRefForArea(reviewItem.area),
      })),
    };
    const readyPreview = buildFaceAuditLockPreview(readyArtifact);

    expect(readyPreview.ok).toBe(true);
    expect(readyPreview.issues).toEqual([]);
    expect(readyPreview.review.completion.status).toBe('ready_to_lock');
    expect(readyPreview.lockPreview).toBeDefined();
    expect(readyPreview.lockPreview).toMatchObject({
      version: 1,
      checklistFingerprint: template.checklistFingerprint,
      reviewFingerprint: faceAuditReviewFingerprint(readyPreview.review),
      checklistItemCount: template.checklistItemCount,
    });
    expect(readyPreview.lockPreview?.reviewFingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(readyPreview.lockPreview?.areas).toHaveLength(FACE_AUDIT_AREAS.length);

    const regularCardsPreview = readyPreview.lockPreview?.areas.find((area) => area.area === 'regularCards');
    expect(regularCardsPreview).toEqual(expect.objectContaining({
      currentStatus: 'manifest_locked_face_audit_pending',
      nextStatus: 'manifest_locked',
      itemCount: staticConfig.components.locationAndIndustryCardCount,
      reviewedItemCount: staticConfig.components.locationAndIndustryCardCount,
      reviewers: ['Ada', 'Ben'],
      evidenceRefs: [evidenceRefForArea('regularCards')],
      evidenceRefCount: 1,
      areaLevelEvidenceRefCount: 1,
      itemSpecificEvidenceRefCount: 0,
      itemSpecificEvidenceItemCount: 0,
    }));
    expect(Date.parse(regularCardsPreview?.firstReviewedAt ?? '')).toBeLessThanOrEqual(
      Date.parse(regularCardsPreview?.lastReviewedAt ?? ''),
    );

    expect(readyPreview.lockPreview?.areas.every((area) =>
      area.currentStatus === 'manifest_locked_face_audit_pending' &&
      area.nextStatus === 'manifest_locked' &&
      area.itemCount === area.reviewedItemCount &&
      area.reviewers.length > 0 &&
      area.evidenceRefs.length > 0 &&
      area.evidenceRefCount === area.evidenceRefs.length &&
      Date.parse(area.firstReviewedAt) <= Date.parse(area.lastReviewedAt),
    )).toBe(true);
  });

  it('fingerprints the normalized review evidence used by lock previews', () => {
    const template = buildFaceAuditReviewTemplate();
    const filledArtifact = {
      ...template,
      evidenceSources: [evidenceSource()],
      areas: [],
      completion: template.completion,
      items: template.items.map((reviewItem) => ({
        ...reviewItem,
        reviewStatus: 'matches_official_face',
        reviewer: 'Ada',
        reviewedAt: '2026-07-10T00:00:00.000Z',
        evidenceRef: evidenceRefForArea(reviewItem.area),
      })),
    };
    const validation = validateFaceAuditReviewArtifact(filledArtifact);
    const preview = buildFaceAuditLockPreview(filledArtifact);

    expect(validation.ok).toBe(true);
    expect(faceAuditReviewFingerprint(validation.review)).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(preview.lockPreview?.reviewFingerprint).toBe(faceAuditReviewFingerprint(validation.review));
    expect(faceAuditReviewFingerprint({
      ...validation.review,
      completion: {
        ...validation.review.completion,
        reviewedItemCount: validation.review.completion.reviewedItemCount + 1,
      },
    })).not.toBe(faceAuditReviewFingerprint(validation.review));
    expect(faceAuditReviewFingerprint({
      ...validation.review,
      evidenceSources: [{
        ...validation.review.evidenceSources[0]!,
        citation: `${validation.review.evidenceSources[0]!.citation}; alternate archive id`,
      }],
    })).not.toBe(faceAuditReviewFingerprint(validation.review));
    expect(faceAuditReviewFingerprint({
      ...validation.review,
      items: validation.review.items.map((item, index) => index === 0
        ? {...item, evidenceRef: `${item.evidenceRef}:alternate-photo`}
        : item),
    })).not.toBe(faceAuditReviewFingerprint(validation.review));
  });

  it('summarizes item-specific evidence coverage in lock previews', () => {
    const template = buildFaceAuditReviewTemplate();
    const readyArtifact = {
      ...template,
      evidenceSources: [evidenceSource()],
      items: template.items.map((reviewItem) => ({
        ...reviewItem,
        reviewStatus: 'matches_official_face',
        reviewer: 'Ada',
        reviewedAt: '2026-07-10T00:00:00.000Z',
        evidenceRef: `official-component:photo-set#${reviewItem.area}:${reviewItem.id}`,
      })),
    };

    const preview = buildFaceAuditLockPreview(readyArtifact);

    expect(preview.ok).toBe(true);
    expect(preview.lockPreview?.areas.find((area) => area.area === 'regularCards')).toMatchObject({
      evidenceRefCount: staticConfig.components.locationAndIndustryCardCount,
      areaLevelEvidenceRefCount: 0,
      itemSpecificEvidenceRefCount: staticConfig.components.locationAndIndustryCardCount,
      itemSpecificEvidenceItemCount: staticConfig.components.locationAndIndustryCardCount,
    });
  });

  it('builds a compact lock-evidence artifact for commit records', () => {
    const template = buildFaceAuditReviewTemplate();
    const notReadyArtifact = buildFaceAuditLockArtifact(template);

    expect(notReadyArtifact.ok).toBe(false);
    expect(notReadyArtifact.lockArtifact).toBeUndefined();

    const readyReviewArtifact = {
      ...template,
      evidenceSources: [evidenceSource()],
      items: template.items.map((reviewItem, index) => ({
        ...reviewItem,
        reviewStatus: 'matches_official_face',
        reviewer: index % 2 === 0 ? 'Ada' : 'Ben',
        reviewedAt: new Date(Date.UTC(2026, 6, 10, 0, index)).toISOString(),
        evidenceRef: evidenceRefForArea(reviewItem.area),
      })),
    };
    const unusedSourceReadyReviewArtifact = {
      ...readyReviewArtifact,
      evidenceSources: [
        evidenceSource(),
        {
          ...evidenceSource(),
          id: 'unused-photo-set',
          label: 'Unused official component photo set',
        },
      ],
    };
    const unusedSourceReadyValidation = validateFaceAuditReadyArtifact(unusedSourceReadyReviewArtifact);
    const unusedSourceLockArtifactResult = buildFaceAuditLockArtifact(unusedSourceReadyReviewArtifact);

    expect(unusedSourceReadyValidation.ok).toBe(false);
    expect(unusedSourceReadyValidation.issues).toContainEqual({
      field: 'evidenceSources',
      message: 'Face-audit ready review declares unused evidence source(s): unused-photo-set',
    });
    expect(unusedSourceLockArtifactResult.ok).toBe(false);
    expect(unusedSourceLockArtifactResult.lockArtifact).toBeUndefined();

    const lockArtifactResult = buildFaceAuditLockArtifact(readyReviewArtifact);

    expect(lockArtifactResult.ok).toBe(true);
    expect(lockArtifactResult.issues).toEqual([]);
    expect(lockArtifactResult.lockArtifact).toEqual({
      artifactType: 'face_audit_lock_evidence',
      version: 1,
      checklistFingerprint: template.checklistFingerprint,
      reviewFingerprint: faceAuditReviewFingerprint(lockArtifactResult.review),
      checklistItemCount: template.checklistItemCount,
      evidenceSources: [evidenceSource()],
      areas: expect.arrayContaining([
        expect.objectContaining({
          area: 'regularCards',
          currentStatus: 'manifest_locked_face_audit_pending',
          nextStatus: 'manifest_locked',
          itemCount: staticConfig.components.locationAndIndustryCardCount,
          reviewedItemCount: staticConfig.components.locationAndIndustryCardCount,
          reviewers: ['Ada', 'Ben'],
          evidenceRefs: [evidenceRefForArea('regularCards')],
          evidenceRefCount: 1,
          areaLevelEvidenceRefCount: 1,
          itemSpecificEvidenceRefCount: 0,
          itemSpecificEvidenceItemCount: 0,
        }),
      ]),
      completion: {
        status: 'ready_to_lock',
        reviewedItemCount: template.items.length,
        matchingItemCount: template.items.length,
        differenceItemCount: 0,
        needsReferenceItemCount: 0,
        unreviewedItemCount: 0,
        totalItemCount: template.items.length,
      },
    });
    expect(lockArtifactResult.lockArtifact?.areas).toHaveLength(FACE_AUDIT_AREAS.length);
    expect(JSON.stringify(lockArtifactResult.lockArtifact)).not.toContain('"items"');
    expect(JSON.stringify(lockArtifactResult.lockArtifact)).not.toContain('"review"');
    expect(JSON.stringify(lockArtifactResult.lockArtifact)).not.toContain('"issues"');
  });

  it('validates compact lock evidence against current and just-locked checklist states', () => {
    const template = buildFaceAuditReviewTemplate();
    const readyReviewArtifact = {
      ...template,
      evidenceSources: [evidenceSource()],
      items: template.items.map((reviewItem, index) => ({
        ...reviewItem,
        reviewStatus: 'matches_official_face',
        reviewer: index % 2 === 0 ? 'Ada' : 'Ben',
        reviewedAt: new Date(Date.UTC(2026, 6, 10, 0, index)).toISOString(),
        evidenceRef: evidenceRefForArea(reviewItem.area),
      })),
    };
    const lockArtifact = buildFaceAuditLockArtifact(readyReviewArtifact).lockArtifact;
    if (!lockArtifact) {
      throw new Error('Expected ready review to build lock evidence');
    }

    const validation = validateFaceAuditLockArtifact(lockArtifact);

    expect(validation.ok).toBe(true);
    expect(validation.issues).toEqual([]);
    expect(validation.lockArtifact).toEqual(lockArtifact);

    const unusedSourceValidation = validateFaceAuditLockArtifact({
      ...lockArtifact,
      evidenceSources: [
        ...lockArtifact.evidenceSources,
        {
          ...evidenceSource(),
          id: 'unused-photo-set',
          label: 'Unused official component photo set',
        },
      ],
    });
    expect(unusedSourceValidation.ok).toBe(false);
    expect(unusedSourceValidation.lockArtifact).toBeUndefined();
    expect(unusedSourceValidation.issues).toContainEqual({
      field: 'evidenceSources',
      message: 'Face-audit lock artifact declares unused evidence source(s): unused-photo-set',
    });

    const untraceableSourceValidation = validateFaceAuditLockArtifact({
      ...lockArtifact,
      evidenceSources: lockArtifact.evidenceSources.map((source) => {
        const nextSource = {...source};
        delete nextSource.locator;
        delete nextSource.contentHash;
        return nextSource;
      }),
    });
    expect(untraceableSourceValidation.ok).toBe(false);
    expect(untraceableSourceValidation.lockArtifact).toBeUndefined();
    expect(untraceableSourceValidation.issues).toContainEqual({
      field: 'evidenceSources',
      message: 'Face-audit lock artifact evidence source(s) must include locator or contentHash: photo-set',
    });

    const regularCardsIndex = lockArtifact.areas.findIndex((area) => area.area === 'regularCards');
    const regularCardsArea = lockArtifact.areas[regularCardsIndex]!;
    const mismatchedCoverageValidation = validateFaceAuditLockArtifact({
      ...lockArtifact,
      areas: lockArtifact.areas.map((area, index) => index === regularCardsIndex
        ? {
            ...area,
            evidenceRefCount: area.evidenceRefCount + 1,
          }
        : area),
    });
    expect(mismatchedCoverageValidation.ok).toBe(false);
    expect(mismatchedCoverageValidation.lockArtifact).toBeUndefined();
    expect(mismatchedCoverageValidation.issues).toContainEqual({
      field: `areas[${regularCardsIndex}].evidenceRefCount`,
      message: 'Face-audit lock artifact area evidence ref count must match its evidenceRefs',
    });

    const currentChecklist = buildFaceAuditChecklistExport();
    const lockedAreas = currentChecklist.areas.map((area) => ({
      ...area,
      status: 'manifest_locked' as const,
    }));
    const lockedChecklist = {
      ...currentChecklist,
      checklistFingerprint: faceAuditChecklistFingerprint({
        areas: lockedAreas,
        items: currentChecklist.items,
      }),
      areas: lockedAreas,
    };
    const justLockedValidation = validateFaceAuditLockArtifact(lockArtifact, lockedChecklist);

    expect(justLockedValidation.ok).toBe(true);
    expect(justLockedValidation.lockArtifact?.checklistFingerprint).toBe(lockArtifact.checklistFingerprint);

    const tamperedValidation = validateFaceAuditLockArtifact({
      ...lockArtifact,
      checklistFingerprint: 'fnv1a32:00000000',
      reviewFingerprint: 'not-a-fingerprint',
      completion: {
        ...lockArtifact.completion,
        status: 'in_progress',
        unreviewedItemCount: 1,
      },
      areas: lockArtifact.areas.map((area, index) => index === regularCardsIndex
        ? {
            ...area,
            itemCount: area.itemCount - 1,
            evidenceRefs: [],
            firstReviewedAt: regularCardsArea.lastReviewedAt,
            lastReviewedAt: regularCardsArea.firstReviewedAt,
          }
        : area),
    });

    expect(tamperedValidation.ok).toBe(false);
    expect(tamperedValidation.lockArtifact).toBeUndefined();
    expect(tamperedValidation.issues).toEqual(expect.arrayContaining([
      {
        field: 'reviewFingerprint',
        message: 'Face-audit lock artifact must include a normalized review fnv1a32 fingerprint',
      },
      {
        field: 'completion.status',
        message: 'Face-audit lock artifact completion must be ready_to_lock',
      },
      {
        field: 'completion.unreviewedItemCount',
        message: 'Face-audit lock artifact must not include unreviewed items',
      },
      {
        field: `areas[${regularCardsIndex}].itemCount`,
        message: 'Face-audit lock artifact area item count does not match the current checklist',
      },
      {
        field: `areas[${regularCardsIndex}].evidenceRefs`,
        message: 'Face-audit lock artifact area must include at least one official evidence reference',
      },
      {
        field: `areas[${regularCardsIndex}].firstReviewedAt`,
        message: 'Face-audit lock artifact area first review timestamp must not be after the last review timestamp',
      },
      {
        field: 'checklistFingerprint',
        message: 'Face-audit lock artifact does not match the current or lock-transition checklist fingerprint',
      },
    ]));
  });

  it('gates static audit locking on compact lock evidence', () => {
    const currentChecklist = buildFaceAuditChecklistExport();
    const currentGate = validateFaceAuditStaticLockGate(undefined, currentChecklist);

    expect(currentGate).toEqual({
      ok: true,
      pendingAreaCount: FACE_AUDIT_AREAS.length,
      lockedAreaCount: 0,
      issues: [],
    });

    const lockedAreas = currentChecklist.areas.map((area) => ({
      ...area,
      status: 'manifest_locked' as const,
    }));
    const lockedChecklist = {
      ...currentChecklist,
      checklistFingerprint: faceAuditChecklistFingerprint({
        areas: lockedAreas,
        items: currentChecklist.items,
      }),
      areas: lockedAreas,
    };
    const missingEvidenceGate = validateFaceAuditStaticLockGate(undefined, lockedChecklist);

    expect(missingEvidenceGate.ok).toBe(false);
    expect(missingEvidenceGate.pendingAreaCount).toBe(0);
    expect(missingEvidenceGate.lockedAreaCount).toBe(FACE_AUDIT_AREAS.length);
    expect(missingEvidenceGate.issues).toEqual([{
      field: 'lockArtifact',
      message: 'Locked face-audit static data requires a compact face_audit_lock_evidence artifact',
    }]);

    const readyReviewArtifact = {
      ...buildFaceAuditReviewTemplate(currentChecklist),
      evidenceSources: [evidenceSource()],
      items: buildFaceAuditReviewTemplate(currentChecklist).items.map((reviewItem) => ({
        ...reviewItem,
        reviewStatus: 'matches_official_face',
        reviewer: 'Ada',
        reviewedAt: '2026-07-10T00:00:00.000Z',
        evidenceRef: evidenceRefForArea(reviewItem.area),
      })),
    };
    const lockArtifact = buildFaceAuditLockArtifact(readyReviewArtifact, currentChecklist).lockArtifact;
    if (!lockArtifact) {
      throw new Error('Expected ready review to build lock evidence');
    }

    const lockedGate = validateFaceAuditStaticLockGate(lockArtifact, lockedChecklist);
    expect(lockedGate.ok).toBe(true);
    expect(lockedGate.pendingAreaCount).toBe(0);
    expect(lockedGate.lockedAreaCount).toBe(FACE_AUDIT_AREAS.length);
    expect(lockedGate.lockArtifactValidation?.ok).toBe(true);

    const partiallyLockedAreas = currentChecklist.areas.map((area, index) => ({
      ...area,
      status: index === 0 ? 'manifest_locked' as const : area.status,
    }));
    const partiallyLockedChecklist = {
      ...currentChecklist,
      checklistFingerprint: faceAuditChecklistFingerprint({
        areas: partiallyLockedAreas,
        items: currentChecklist.items,
      }),
      areas: partiallyLockedAreas,
    };
    const partialGate = validateFaceAuditStaticLockGate(lockArtifact, partiallyLockedChecklist);

    expect(partialGate.ok).toBe(false);
    expect(partialGate.pendingAreaCount).toBe(FACE_AUDIT_AREAS.length - 1);
    expect(partialGate.lockedAreaCount).toBe(1);
    expect(partialGate.issues).toEqual(expect.arrayContaining([{
      field: 'areas',
      message: 'Face-audit areas must be locked as one evidence-backed batch, not partially locked',
    }]));
  });

  it('rejects review artifacts with stale checklist metadata or weak evidence', () => {
    const template = buildFaceAuditReviewTemplate();
    const first = template.items[0]!;
    const second = template.items[1]!;
    const third = template.items[2]!;
    const tamperedItems = template.items.map((reviewItem, index) => {
      if (index === 0) {
        return {
          ...reviewItem,
          label: `${reviewItem.label} mutated`,
          reviewStatus: 'matches_official_face',
          reviewer: ' ',
          reviewedAt: 'not-a-date',
          evidenceRef: ' ',
        };
      }
      if (index === 1) {
        return {
          ...reviewItem,
          reviewStatus: 'differs_from_official_face',
          reviewer: 'Ada',
          reviewedAt: '2026-07-10',
          evidenceRef: 'official-photo',
          notes: ' ',
        };
      }
      return reviewItem;
    });

    const validation = validateFaceAuditReviewArtifact({
      ...template,
      version: 2,
      checklistFingerprint: 'fnv1a32:00000000',
      checklistItemCount: 999,
      items: [
        ...tamperedItems.slice(0, 3),
        {...third, key: first.key},
        {...third, key: 'unknownArea:unknownItem'},
        ...tamperedItems.slice(3),
      ],
    });

    expect(validation.ok).toBe(false);
    expect(validation.review.completion).toMatchObject({
      status: 'has_differences',
      reviewedItemCount: 2,
      differenceItemCount: 1,
    });
    expect(validation.issues).toEqual(expect.arrayContaining([
      {field: 'version', message: 'Face-audit review artifact must be version 1'},
      {field: 'checklistFingerprint', message: 'Face-audit review artifact does not match the current checklist'},
      {field: 'checklistItemCount', message: 'Face-audit review artifact item count does not match the current checklist'},
      {field: 'items', message: 'Face-audit review artifact must contain every current checklist item exactly once'},
      {itemKey: first.key, field: 'label', message: 'Review item label must match the current checklist'},
      {itemKey: first.key, field: 'reviewer', message: 'Reviewed items must include a reviewer'},
      {itemKey: first.key, field: 'reviewedAt', message: 'Reviewed items must include a valid review timestamp'},
      {itemKey: first.key, field: 'evidenceRef', message: 'Reviewed items must cite official-component evidence'},
      {
        itemKey: second.key,
        field: 'evidenceRef',
        message: 'Reviewed item evidenceRef must use official-component:<source>#<area> or official-component:<source>#<area>:<item-id>',
      },
      {itemKey: second.key, field: 'notes', message: 'Differences and missing references must include notes'},
      {itemKey: first.key, field: 'key', message: 'Face-audit review item key appears more than once'},
      {itemKey: 'unknownArea:unknownItem', field: 'key', message: 'Face-audit review item key is not in the current checklist'},
    ]));
  });

  it('rejects stale review metadata on unreviewed items before status summaries count evidence', () => {
    const template = buildFaceAuditReviewTemplate();
    const first = template.items[0]!;
    const artifact = {
      ...template,
      evidenceSources: [evidenceSource()],
      items: template.items.map((reviewItem, index) => index === 0
        ? {
            ...reviewItem,
            reviewer: 'Ada',
            reviewedAt: '2026-07-10T00:00:00.000Z',
            evidenceRef: evidenceRefForArea(reviewItem.area),
            notes: 'Started review, then reset to unreviewed.',
          }
        : reviewItem),
    };

    const validation = validateFaceAuditReviewArtifact(artifact);
    const status = summarizeFaceAuditReviewStatus([artifact]);

    expect(validation.ok).toBe(false);
    expect(validation.issues).toContainEqual({
      itemKey: first.key,
      field: 'reviewStatus',
      message: 'Unreviewed items must not include reviewer, reviewedAt, evidenceRef, or notes',
    });
    expect(validation.review.items[0]).toMatchObject({
      reviewStatus: 'unreviewed',
      reviewer: '',
      reviewedAt: '',
      evidenceRef: '',
      notes: '',
    });
    expect(validation.review.completion).toMatchObject({
      status: 'not_started',
      reviewedItemCount: 0,
    });
    expect(status.ok).toBe(false);
    expect(status.issues).toContainEqual({
      itemKey: first.key,
      field: 'artifacts[0].reviewStatus',
      message: 'Unreviewed items must not include reviewer, reviewedAt, evidenceRef, or notes',
    });
    expect(status.areaProgress.find((area) => area.area === first.area)).toMatchObject({
      evidenceRefCount: 0,
      areaLevelEvidenceRefCount: 0,
      itemSpecificEvidenceRefCount: 0,
      itemSpecificEvidenceItemCount: 0,
      evidenceRefs: [],
      reviewers: [],
      firstReviewedAt: '',
      lastReviewedAt: '',
    });
  });

  it('rejects evidence refs that point at the wrong area or item', () => {
    const template = buildFaceAuditReviewTemplate();
    const first = template.items[0]!;
    const second = template.items[1]!;
    const third = template.items[2]!;
    const artifact = {
      ...template,
      evidenceSources: [evidenceSource()],
      items: template.items.map((reviewItem, index) => ({
        ...reviewItem,
        reviewStatus: 'matches_official_face',
        reviewer: 'Ada',
        reviewedAt: '2026-07-10T00:00:00.000Z',
        evidenceRef: index === 0
          ? `official-component:photo-set#regularCards`
          : index === 1
            ? `official-component:photo-set#${second.area}:${first.id}`
            : `official-component:photo-set#${reviewItem.area}${index === 2 ? `:${third.id}` : ''}`,
      })),
    };

    const validation = validateFaceAuditReviewArtifact(artifact);

    expect(validation.ok).toBe(false);
    expect(validation.issues).toEqual(expect.arrayContaining([
      {itemKey: first.key, field: 'evidenceRef', message: 'Reviewed item evidenceRef area must match the checklist item'},
      {itemKey: second.key, field: 'evidenceRef', message: 'Reviewed item evidenceRef item id must match the checklist item'},
    ]));
  });

  it('rejects reviewed evidence refs that use undeclared evidence sources', () => {
    const template = buildFaceAuditReviewTemplate();
    const first = template.items[0]!;
    const artifact = {
      ...template,
      items: template.items.map((reviewItem) => ({
        ...reviewItem,
        reviewStatus: 'matches_official_face',
        reviewer: 'Ada',
        reviewedAt: '2026-07-10T00:00:00.000Z',
        evidenceRef: evidenceRefForArea(reviewItem.area),
      })),
    };

    const validation = validateFaceAuditReviewArtifact(artifact);

    expect(FACE_AUDIT_EVIDENCE_SOURCE_TYPES).toEqual([
      'official_physical_component',
      'official_high_res_component_image',
    ]);
    expect(validation.ok).toBe(false);
    expect(validation.issues).toContainEqual({
      itemKey: first.key,
      field: 'evidenceRef',
      message: 'Reviewed item evidenceRef source id must be declared in evidenceSources',
    });
  });

  it('reports missing review artifact items against the current checklist', () => {
    const template = buildFaceAuditReviewTemplate();
    const missingKey = template.items[0]!.key;
    const validation = validateFaceAuditReviewArtifact({
      ...template,
      items: template.items.slice(1),
    });

    expect(validation.ok).toBe(false);
    expect(validation.issues).toEqual(expect.arrayContaining([
      {field: 'items', message: 'Face-audit review artifact must contain every current checklist item exactly once'},
      {itemKey: missingKey, field: 'items', message: 'Face-audit review artifact is missing a current checklist item'},
    ]));
    expect(validation.review.items[0]).toEqual(template.items[0]);
  });
});
