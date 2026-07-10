import {describe, expect, it} from 'vitest';
import {
  FACE_AUDIT_AREAS,
  buildFaceAuditAreaReviewTodoSummary,
  buildFaceAuditAreaReviewTemplate,
  buildFaceAuditEvidenceRefTemplate,
  buildFaceAuditLockArtifact,
  buildFaceAuditLockPreview,
  buildFaceAuditReviewerHandoff,
  buildFaceAuditReviewPlan,
  buildFaceAuditReviewTemplate,
  buildFaceAuditReviewTodo,
  buildFaceAuditReviewTodoSummary,
  mergeFaceAuditReviewArtifacts,
  summarizeFaceAuditReviewerHandoffResponse,
  summarizeFaceAuditReviewStatus,
  validateFaceAuditAreaReviewArtifact,
  validateFaceAuditLockArtifact,
  validateFaceAuditReviewArtifact,
  validateFaceAuditStaticLockGate,
} from '../src/common/faceAudit';
import {
  buildFaceAuditEvidenceSourceTemplateArtifact,
  fillFaceAuditAreaReviewArtifact,
  faceAuditAreaReviewTemplateFromPayload,
  faceAuditAreaReviewTemplatePath,
  faceAuditAreaReviewTodoSummaryFromPayload,
  faceAuditAreaReviewTodoSummaryLabel,
  faceAuditAreaReviewTodoSummaryPath,
  faceAuditEvidenceCoverageLabel,
  faceAuditEvidenceRefTemplateFromPayload,
  faceAuditEvidenceRefTemplateLabel,
  faceAuditEvidenceRefTemplatePath,
  faceAuditEvidenceSourceLabel,
  faceAuditEvidenceSourceFromPayload,
  faceAuditEvidenceSourcesFromPayload,
  faceAuditEvidenceSourceTemplateFromPayload,
  faceAuditEvidenceSourceTemplateLabel,
  faceAuditLockArtifactFromPayload,
  faceAuditLockArtifactLabel,
  faceAuditLockArtifactValidationFromPayload,
  faceAuditLockArtifactValidationLabel,
  faceAuditLockArtifactVerifyPath,
  faceAuditReleaseGatePath,
  faceAuditMergedReviewArtifactFromPayload,
  faceAuditReviewAreaName,
  faceAuditReviewArtifactRequestOptions,
  faceAuditReviewMatchPath,
  faceAuditAreaReviewerInstructionsDownloadLabel,
  faceAuditAreaReviewerInstructionsFileName,
  faceAuditAreaReviewerInstructionsPath,
  faceAuditReviewerInstructionsDownloadLabel,
  faceAuditReviewerInstructionsFileName,
  faceAuditReviewerInstructionsPath,
  faceAuditReviewerHandoffAreaDownloadLabel,
  faceAuditReviewerHandoffAreaFileName,
  faceAuditReviewerHandoffDownloadLabel,
  faceAuditReviewerHandoffFileName,
  faceAuditReviewerHandoffFromPayload,
  faceAuditReviewerHandoffLabel,
  faceAuditReviewerHandoffPath,
  faceAuditReviewerHandoffResponseFromPayload,
  faceAuditReviewerHandoffResponseLabel,
  faceAuditReviewerHandoffResponsePath,
  faceAuditReviewerHandoffValidationFromPayload,
  faceAuditReviewerHandoffValidationLabel,
  faceAuditReviewerHandoffVerifyPath,
  faceAuditReviewCompletionLabel,
  faceAuditReviewIssueLabel,
  faceAuditReviewMergeLabel,
  faceAuditReviewMergePath,
  faceAuditReviewPlanAreaLabel,
  faceAuditReviewPlanFromPayload,
  faceAuditReviewPlanLabel,
  faceAuditReviewPlanPath,
  faceAuditAreaReviewSheetDownloadLabel,
  faceAuditAreaReviewSheetFileName,
  faceAuditAreaReviewSheetPath,
  faceAuditReviewFromSheetFileName,
  faceAuditReviewSheetDownloadLabel,
  faceAuditReviewSheetFileName,
  faceAuditReviewSheetImportDownloadLabel,
  faceAuditReviewSheetImportPath,
  faceAuditReviewSheetPath,
  faceAuditReviewStatusName,
  faceAuditReviewStatusFromPayload,
  faceAuditReviewStatusLabel,
  faceAuditReviewStatusPath,
  faceAuditReviewSubmissionLabel,
  faceAuditReviewSubmissionPath,
  faceAuditSourceIdsByAreaFromPayload,
  faceAuditSourceIdsByAreaPayload,
  faceAuditSourceIdsByAreaTemplatePath,
  faceAuditStaticLockGateFromPayload,
  faceAuditStaticLockGateLabel,
  faceAuditReviewTemplateFromPayload,
  faceAuditReviewTodoAreaLabel,
  faceAuditReviewTodoFromPayload,
  faceAuditReviewTodoLabel,
  faceAuditReviewTodoPath,
  faceAuditReviewTodoSummaryFromPayload,
  faceAuditReviewTodoSummaryLabel,
  faceAuditReviewTodoSummaryPath,
  faceAuditReviewValidationFromPayload,
  faceAuditReviewValidationLabel,
} from '../src/client/faceAuditReviewOptions';

describe('client face-audit review options', () => {
  it('builds GET baseline or POST artifact request options from optional review artifact text', () => {
    expect(faceAuditReviewArtifactRequestOptions('', 'Review status')).toEqual({method: 'GET'});
    expect(faceAuditReviewArtifactRequestOptions('   \n  ', 'Review status')).toEqual({method: 'GET'});
    expect(faceAuditReviewArtifactRequestOptions('{"artifacts":[]}', 'Review status')).toEqual({
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: '{"artifacts":[]}',
    });
    expect(() => faceAuditReviewArtifactRequestOptions('{', 'Review status'))
      .toThrow('Review status artifact input must be valid JSON');
  });

  it('parses public review template metadata for display', () => {
    const template = buildFaceAuditReviewTemplate();

    expect(faceAuditReviewTemplateFromPayload({faceAuditReview: template})).toEqual({
      version: 1,
      checklistFingerprint: template.checklistFingerprint,
      checklistItemCount: template.checklistItemCount,
      evidenceSourceCount: 0,
    });
  });

  it('returns undefined for malformed review template payloads', () => {
    expect(faceAuditReviewTemplateFromPayload(null)).toBeUndefined();
    expect(faceAuditReviewTemplateFromPayload({})).toBeUndefined();
    expect(faceAuditReviewTemplateFromPayload({
      faceAuditReview: {
        version: 2,
        checklistFingerprint: 'fnv1a32:12345678',
        checklistItemCount: 185,
        evidenceSources: [],
      },
    })).toBeUndefined();
    expect(faceAuditReviewTemplateFromPayload({
      faceAuditReview: {
        version: 1,
        checklistFingerprint: ' ',
        checklistItemCount: 185,
        evidenceSources: [],
      },
    })).toBeUndefined();
    expect(faceAuditReviewTemplateFromPayload({
      faceAuditReview: {
        version: 1,
        checklistFingerprint: 'fnv1a32:12345678',
        checklistItemCount: 185,
      },
    })).toBeUndefined();
  });

  it('parses public area review template metadata for display', () => {
    const template = buildFaceAuditAreaReviewTemplate('regularCards');

    expect(faceAuditAreaReviewTemplateFromPayload({faceAuditAreaReview: template})).toEqual({
      artifactType: 'face_audit_area_review',
      version: 1,
      area: 'regularCards',
      checklistFingerprint: template.checklistFingerprint,
      checklistItemCount: template.checklistItemCount,
      areaItemCount: 64,
      evidenceSourceCount: 0,
    });
    expect(faceAuditAreaReviewTemplatePath('regularCards')).toBe('/api/face-audit-review-template/regularCards');
  });

  it('returns undefined for malformed area review template payloads', () => {
    expect(faceAuditAreaReviewTemplateFromPayload({})).toBeUndefined();
    expect(faceAuditAreaReviewTemplateFromPayload({
      faceAuditAreaReview: {
        artifactType: 'face_audit_review',
        version: 1,
        area: 'regularCards',
        checklistFingerprint: 'fnv1a32:12345678',
        checklistItemCount: 185,
        areaItemCount: 64,
        evidenceSources: [],
      },
    })).toBeUndefined();
    expect(faceAuditAreaReviewTemplateFromPayload({
      faceAuditAreaReview: {
        artifactType: 'face_audit_area_review',
        version: 1,
        area: 'secretArea',
        checklistFingerprint: 'fnv1a32:12345678',
        checklistItemCount: 185,
        areaItemCount: 64,
        evidenceSources: [],
      },
    })).toBeUndefined();
  });

  it('parses evidence ref template metadata and paths', () => {
    const template = buildFaceAuditEvidenceRefTemplate('photo-set', 'wildCards', 'items');
    const parsed = faceAuditEvidenceRefTemplateFromPayload({faceAuditEvidenceRefTemplate: template});

    expect(parsed).toEqual({
      artifactType: 'face_audit_evidence_ref_template',
      version: 1,
      sourceId: 'photo-set',
      area: 'wildCards',
      mode: 'items',
      evidenceRefCount: 8,
      evidenceRefs: template.evidenceRefs,
      items: template.items,
    });
    expect(faceAuditEvidenceRefTemplateLabel(parsed))
      .toBe('8 evidence ref(s) for wildCards from photo-set (items)');
    expect(faceAuditEvidenceRefTemplatePath()).toBe('/api/face-audit-evidence-ref-template');
    expect(faceAuditReviewMatchPath()).toBe('/api/face-audit-review-template/match');
    expect(faceAuditReviewMatchPath('regularCards')).toBe('/api/face-audit-review-template/regularCards/match');

    expect(faceAuditEvidenceRefTemplateFromPayload({})).toEqual({
      artifactType: undefined,
      version: undefined,
      sourceId: undefined,
      area: undefined,
      mode: undefined,
      evidenceRefCount: 0,
      evidenceRefs: [],
      items: [],
    });
  });

  it('builds full match source-id payloads by face-audit area', () => {
    expect(faceAuditSourceIdsByAreaPayload({}, '   ')).toBeUndefined();

    const fallbackPayload = faceAuditSourceIdsByAreaPayload({}, ' photo-set ');
    if (fallbackPayload === undefined) {
      throw new Error('Expected fallback source id payload');
    }
    expect(fallbackPayload).toEqual(Object.fromEntries(FACE_AUDIT_AREAS.map((area) => [
      area,
      'photo-set',
    ])));

    expect(faceAuditSourceIdsByAreaPayload({
      regularCards: ' card-photos ',
      wildCards: '',
      industryTiles: 'tile-photos',
    }, 'photo-set')).toEqual({
      ...fallbackPayload,
      regularCards: 'card-photos',
      industryTiles: 'tile-photos',
    });

    const parsed = faceAuditSourceIdsByAreaFromPayload({
      faceAuditSourceIdsByArea: {
        ...fallbackPayload,
        linkLines: 'board-photo',
      },
    });
    expect(parsed).toEqual({
      ...fallbackPayload,
      linkLines: 'board-photo',
    });
    expect(faceAuditSourceIdsByAreaFromPayload({
      faceAuditSourceIdsByArea: {
        regularCards: 'photo-set',
      },
    })).toBeUndefined();
    expect(faceAuditSourceIdsByAreaTemplatePath()).toBe('/api/face-audit-source-ids-by-area-template');
  });

  it('builds browser evidence source template artifacts from hashed files', () => {
    const firstHash = `sha256:${'a'.repeat(64)}`;
    const secondHash = `sha256:${'B'.repeat(64)}`;
    const result = buildFaceAuditEvidenceSourceTemplateArtifact('official_high_res_component_image', [
      {
        locator: 'official/Regular Cards.zip',
        label: 'Regular Cards.zip',
        contentHash: firstHash,
      },
      {
        locator: 'official/Regular Cards.png',
        contentHash: secondHash,
      },
      {
        locator: '///',
        label: 'Root archive',
        contentHash: firstHash,
      },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.artifact).toEqual({
      artifactType: 'face_audit_evidence_source_template',
      version: 1,
      sourceType: 'official_high_res_component_image',
      sourceCount: 3,
      evidenceSources: [
        {
          id: 'regular-cards',
          label: 'Regular Cards.zip',
          sourceType: 'official_high_res_component_image',
          citation: 'Official Brass: Birmingham component evidence: official/Regular Cards.zip',
          locator: 'official/Regular Cards.zip',
          contentHash: firstHash,
          notes: '',
        },
        {
          id: 'regular-cards-2',
          label: 'Regular Cards.png',
          sourceType: 'official_high_res_component_image',
          citation: 'Official Brass: Birmingham component evidence: official/Regular Cards.png',
          locator: 'official/Regular Cards.png',
          contentHash: secondHash.toLowerCase(),
          notes: '',
        },
        {
          id: 'evidence-source',
          label: 'Root archive',
          sourceType: 'official_high_res_component_image',
          citation: 'Official Brass: Birmingham component evidence: ///',
          locator: '///',
          contentHash: firstHash,
          notes: '',
        },
      ],
    });
    expect(faceAuditEvidenceSourceTemplateLabel(result.artifact))
      .toBe('3 official_high_res_component_image evidence source(s)');

    expect(buildFaceAuditEvidenceSourceTemplateArtifact('community_scan' as 'official_physical_component', [
      {locator: 'board.png', contentHash: firstHash},
    ])).toEqual({
      ok: false,
      error: 'Evidence source type must be official_physical_component or official_high_res_component_image',
    });
    expect(buildFaceAuditEvidenceSourceTemplateArtifact('official_physical_component', []))
      .toEqual({ok: false, error: 'Select at least one official component evidence file'});
    expect(buildFaceAuditEvidenceSourceTemplateArtifact('official_physical_component', [
      {locator: ' ', contentHash: firstHash},
    ])).toEqual({ok: false, error: 'Evidence file 1 must include a locator'});
    expect(buildFaceAuditEvidenceSourceTemplateArtifact('official_physical_component', [
      {locator: 'board.png', contentHash: 'sha256:not-hex'},
    ])).toEqual({
      ok: false,
      error: 'Evidence file 1 content hash must use sha256:<64 hex>, sha1:<40 hex>, or md5:<32 hex>',
    });
  });

  it('parses evidence source artifacts for browser reuse and match generation', () => {
    const contentHash = `SHA256:${'A'.repeat(64)}`;
    const sourceTemplate = {
      artifactType: 'face_audit_evidence_source_template',
      version: 1,
      sourceType: 'official_physical_component',
      sourceCount: 1,
      evidenceSources: [{
        id: ' photo-set ',
        label: ' Official component photo set ',
        sourceType: ' official_physical_component ',
        citation: ' Reviewer-owned official Brass: Birmingham component photos ',
        locator: ' reviewer-photos/official-component-set.zip ',
        contentHash,
        notes: ' archival note ',
      }],
    };

    expect(faceAuditEvidenceSourceTemplateFromPayload(sourceTemplate)).toEqual({
      artifactType: 'face_audit_evidence_source_template',
      version: 1,
      sourceType: 'official_physical_component',
      sourceCount: 1,
      evidenceSources: [{
        id: 'photo-set',
        label: 'Official component photo set',
        sourceType: 'official_physical_component',
        citation: 'Reviewer-owned official Brass: Birmingham component photos',
        locator: 'reviewer-photos/official-component-set.zip',
        contentHash: contentHash.toLowerCase(),
        notes: 'archival note',
      }],
    });
    expect(faceAuditEvidenceSourcesFromPayload({faceAuditEvidenceSourceTemplate: sourceTemplate}))
      .toEqual(faceAuditEvidenceSourceTemplateFromPayload(sourceTemplate)?.evidenceSources);
    expect(faceAuditEvidenceSourceLabel(faceAuditEvidenceSourceTemplateFromPayload(sourceTemplate)!.evidenceSources[0]!))
      .toBe('photo-set: Official component photo set (official_physical_component, reviewer-photos/official-component-set.zip, sha256)');

    const reviewArtifact = {
      ...buildFaceAuditAreaReviewTemplate('regularCards'),
      evidenceSources: [
        {
          id: 'photo-set',
          label: 'Official component photo set',
          sourceType: 'official_high_res_component_image',
          citation: 'Reviewer-owned official Brass: Birmingham card scans',
          notes: '',
        },
        {
          id: 'board-photo',
          label: 'Official board photo',
          sourceType: 'official_physical_component',
          citation: 'Reviewer-owned official Brass: Birmingham board photo',
          locator: 'reviewer-photos/board.png',
          notes: 'board face',
        },
      ],
    };
    const reviewSources = faceAuditEvidenceSourcesFromPayload(reviewArtifact);
    expect(reviewSources).toEqual([
      {
        id: 'photo-set',
        label: 'Official component photo set',
        sourceType: 'official_high_res_component_image',
        citation: 'Reviewer-owned official Brass: Birmingham card scans',
        notes: '',
      },
      {
        id: 'board-photo',
        label: 'Official board photo',
        sourceType: 'official_physical_component',
        citation: 'Reviewer-owned official Brass: Birmingham board photo',
        locator: 'reviewer-photos/board.png',
        notes: 'board face',
      },
    ]);
    expect(faceAuditEvidenceSourceLabel(reviewSources![1]!))
      .toBe('board-photo: Official board photo (official_physical_component, reviewer-photos/board.png)');
    expect(faceAuditEvidenceSourceFromPayload(reviewArtifact, ' board-photo ')).toEqual(reviewSources![1]);
    expect(faceAuditEvidenceSourceFromPayload(reviewArtifact, 'missing-source')).toEqual(reviewSources![0]);
    expect(faceAuditEvidenceSourceFromPayload({evidenceSources: []})).toBeUndefined();

    expect(faceAuditEvidenceSourceTemplateFromPayload({
      ...sourceTemplate,
      sourceCount: 2,
    })).toBeUndefined();
    expect(faceAuditEvidenceSourceTemplateFromPayload({
      ...sourceTemplate,
      evidenceSources: sourceTemplate.evidenceSources.map((source) => ({
        ...source,
        sourceType: 'official_high_res_component_image',
      })),
    })).toBeUndefined();
    expect(faceAuditEvidenceSourcesFromPayload({
      evidenceSources: [
        {...reviewArtifact.evidenceSources[0], contentHash: 'sha256:not-hex'},
      ],
    })).toBeUndefined();
    expect(faceAuditEvidenceSourcesFromPayload({
      evidenceSources: [
        reviewArtifact.evidenceSources[0],
        reviewArtifact.evidenceSources[0],
      ],
    })).toBeUndefined();
  });

  it('fills loaded area review artifacts with reviewer and evidence metadata', () => {
    const template = buildFaceAuditAreaReviewTemplate('regularCards');

    const fillResult = fillFaceAuditAreaReviewArtifact(template, {
      reviewer: ' Ada ',
      reviewedAt: '2026-07-10T00:00:00.000Z',
      evidenceSourceId: ' official-set ',
      evidenceSourceLabel: ' Official component set ',
      evidenceSourceType: 'official_physical_component',
      evidenceSourceCitation: 'Reviewer-owned official Brass: Birmingham component photos',
      evidenceSourceLocator: ' reviewer-photos/regular-cards-fronts.zip ',
      evidenceSourceContentHash: ` SHA256:${'A'.repeat(64)} `,
      evidenceSourceNotes: ' archival note ',
      reviewStatus: 'matches_official_face',
      itemNotes: 'checked against official face',
    });

    expect(fillResult.ok).toBe(true);
    if (!fillResult.ok) {
      throw new Error(fillResult.error);
    }
    expect(fillResult.area).toBe('regularCards');
    expect(fillResult.itemCount).toBe(64);
    expect(fillResult.artifact.evidenceSources).toEqual([{
      id: 'official-set',
      label: 'Official component set',
      sourceType: 'official_physical_component',
      citation: 'Reviewer-owned official Brass: Birmingham component photos',
      locator: 'reviewer-photos/regular-cards-fronts.zip',
      contentHash: `sha256:${'a'.repeat(64)}`,
      notes: 'archival note',
    }]);
    expect(fillResult.artifact.items).toEqual(template.items.map((item) => ({
      ...item,
      reviewStatus: 'matches_official_face',
      reviewer: 'Ada',
      reviewedAt: '2026-07-10T00:00:00.000Z',
      evidenceRef: 'official-component:official-set#regularCards',
      notes: 'checked against official face',
    })));

    const validation = validateFaceAuditAreaReviewArtifact(fillResult.artifact, 'regularCards');
    expect(validation.ok).toBe(true);
    expect(validation.review.completion).toMatchObject({
      status: 'ready_to_lock',
      reviewedItemCount: 64,
      matchingItemCount: 64,
      unreviewedItemCount: 0,
    });
  });

  it('fills loaded area review artifacts with item-specific evidence refs', () => {
    const template = buildFaceAuditAreaReviewTemplate('wildCards');

    const fillResult = fillFaceAuditAreaReviewArtifact(template, {
      reviewer: 'Ada',
      reviewedAt: '2026-07-10T00:00:00.000Z',
      evidenceRefScope: 'item',
      evidenceSourceId: 'official-set',
      evidenceSourceLabel: 'Official component set',
      evidenceSourceType: 'official_high_res_component_image',
      evidenceSourceCitation: 'Reviewer-owned official Brass: Birmingham card scans',
      evidenceSourceLocator: 'reviewer-photos/wild-card-fronts.zip',
      evidenceSourceNotes: '',
      reviewStatus: 'matches_official_face',
      itemNotes: '',
    });

    expect(fillResult.ok).toBe(true);
    if (!fillResult.ok) {
      throw new Error(fillResult.error);
    }
    expect(fillResult.artifact.items).toEqual(template.items.map((item) => ({
      ...item,
      reviewStatus: 'matches_official_face',
      reviewer: 'Ada',
      reviewedAt: '2026-07-10T00:00:00.000Z',
      evidenceRef: `official-component:official-set#wildCards:${item.id}`,
      notes: '',
    })));

    const validation = validateFaceAuditAreaReviewArtifact(fillResult.artifact, 'wildCards');
    expect(validation.ok).toBe(true);
    const status = summarizeFaceAuditReviewStatus([fillResult.artifact]);
    expect(status.areaProgress.find((area) => area.area === 'wildCards')).toMatchObject({
      evidenceRefCount: 8,
      areaLevelEvidenceRefCount: 0,
      itemSpecificEvidenceRefCount: 8,
      itemSpecificEvidenceItemCount: 8,
    });
  });

  it('rejects area review fill inputs that would create invalid evidence', () => {
    const template = buildFaceAuditAreaReviewTemplate('regularCards');

    expect(fillFaceAuditAreaReviewArtifact(template, {
      reviewer: '',
      reviewedAt: '2026-07-10T00:00:00.000Z',
      evidenceSourceId: 'official-set',
      evidenceSourceLabel: 'Official component set',
      evidenceSourceType: 'official_physical_component',
      evidenceSourceCitation: 'Reviewer-owned official Brass: Birmingham component photos',
      evidenceSourceNotes: '',
      reviewStatus: 'matches_official_face',
      itemNotes: '',
    })).toEqual({ok: false, error: 'Reviewer is required'});

    expect(fillFaceAuditAreaReviewArtifact({
      ...template,
      evidenceSources: [{
        id: 'official-set',
        label: 'Different source label',
        sourceType: 'official_physical_component',
        citation: 'Reviewer-owned official Brass: Birmingham component photos',
        notes: '',
      }],
    }, {
      reviewer: 'Ada',
      reviewedAt: '2026-07-10T00:00:00.000Z',
      evidenceSourceId: 'official-set',
      evidenceSourceLabel: 'Official component set',
      evidenceSourceType: 'official_physical_component',
      evidenceSourceCitation: 'Reviewer-owned official Brass: Birmingham component photos',
      evidenceSourceContentHash: 'sha256:not-a-real-hash',
      evidenceSourceNotes: '',
      reviewStatus: 'matches_official_face',
      itemNotes: '',
    })).toEqual({
      ok: false,
      error: 'Evidence source content hash must use sha256:<64 hex>, sha1:<40 hex>, or md5:<32 hex>',
    });

    expect(fillFaceAuditAreaReviewArtifact({
      ...template,
      evidenceSources: [{
        id: 'official-set',
        label: 'Different source label',
        sourceType: 'official_physical_component',
        citation: 'Reviewer-owned official Brass: Birmingham component photos',
        notes: '',
      }],
    }, {
      reviewer: 'Ada',
      reviewedAt: '2026-07-10T00:00:00.000Z',
      evidenceSourceId: 'official-set',
      evidenceSourceLabel: 'Official component set',
      evidenceSourceType: 'official_physical_component',
      evidenceSourceCitation: 'Reviewer-owned official Brass: Birmingham component photos',
      evidenceSourceNotes: '',
      reviewStatus: 'matches_official_face',
      itemNotes: '',
    })).toEqual({ok: false, error: 'Evidence source official-set conflicts with the loaded artifact'});

    expect(fillFaceAuditAreaReviewArtifact({
      ...template,
      items: template.items.map((item, index) => index === 0 ? {...item, id: ''} : item),
    }, {
      reviewer: 'Ada',
      reviewedAt: '2026-07-10T00:00:00.000Z',
      evidenceRefScope: 'item',
      evidenceSourceId: 'official-set',
      evidenceSourceLabel: 'Official component set',
      evidenceSourceType: 'official_physical_component',
      evidenceSourceCitation: 'Reviewer-owned official Brass: Birmingham component photos',
      evidenceSourceNotes: '',
      reviewStatus: 'matches_official_face',
      itemNotes: '',
    })).toEqual({
      ok: false,
      error: 'Area review item 1 must include an id for item-specific evidence refs',
    });
  });

  it('parses merge responses and endpoint paths', () => {
    const regularCards = buildFaceAuditAreaReviewTemplate('regularCards');
    const wildCards = buildFaceAuditAreaReviewTemplate('wildCards');
    const evidenceSources = [{
      id: 'photo-set',
      label: 'Official component photo set',
      sourceType: 'official_physical_component',
      citation: 'Reviewer-owned official Brass: Birmingham component photos',
      locator: 'reviewer-photos/official-component-set.zip',
      notes: '',
    }];
    const merge = mergeFaceAuditReviewArtifacts([
      {
        ...regularCards,
        evidenceSources,
        items: regularCards.items.map((item) => ({
          ...item,
          reviewStatus: 'matches_official_face',
          reviewer: 'Ada',
          reviewedAt: '2026-07-10T00:00:00.000Z',
          evidenceRef: `official-component:photo-set#${item.area}`,
        })),
      },
      {
        ...wildCards,
        evidenceSources,
        items: wildCards.items.map((item) => ({
          ...item,
          reviewStatus: 'matches_official_face',
          reviewer: 'Ada',
          reviewedAt: '2026-07-10T00:00:00.000Z',
          evidenceRef: `official-component:photo-set#${item.area}`,
        })),
      },
    ]);
    const payload = {faceAuditReviewValidation: merge};
    const parsed = faceAuditReviewValidationFromPayload(payload);

    expect(faceAuditReviewMergePath()).toBe('/api/face-audit-review-template/merge');
    expect(faceAuditMergedReviewArtifactFromPayload(payload)).toEqual(merge.review);
    expect(parsed.ok).toBe(true);
    expect(parsed.completion).toMatchObject({
      status: 'in_progress',
      reviewedItemCount: 72,
      unreviewedItemCount: 113,
    });
    expect(faceAuditReviewMergeLabel(parsed))
      .toBe('Merge review artifacts: Review artifact is valid. in_progress: 72 / 185 reviewed, 72 matched, 0 differences, 0 need better reference, 1 evidence source(s)');
  });

  it('parses review status reports and endpoint paths', () => {
    const regularCards = buildFaceAuditAreaReviewTemplate('regularCards');
    const evidenceSources = [{
      id: 'photo-set',
      label: 'Official component photo set',
      sourceType: 'official_physical_component' as const,
      citation: 'Reviewer-owned official Brass: Birmingham component photos',
      locator: 'reviewer-photos/official-component-set.zip',
      notes: '',
    }];
    const report = summarizeFaceAuditReviewStatus([{
      ...regularCards,
      evidenceSources,
      items: regularCards.items.map((item) => ({
        ...item,
        reviewStatus: 'matches_official_face',
        reviewer: 'Ada',
        reviewedAt: '2026-07-10T00:00:00.000Z',
        evidenceRef: `official-component:photo-set#${item.area}`,
      })),
    }]);
    const parsed = faceAuditReviewStatusFromPayload({
      faceAuditReviewStatus: {
        ...report,
        areaProgress: [
          ...report.areaProgress,
          {area: 'secretArea', itemCount: 1},
        ],
        issues: [
          ...report.issues,
          {field: ' ', message: 'blank field should be dropped'},
          null,
        ],
      },
    });

    expect(faceAuditReviewStatusPath()).toBe('/api/face-audit-review-template/status');
    expect(parsed.artifactType).toBe('face_audit_review_status');
    expect(parsed.version).toBe(1);
    expect(parsed.ok).toBe(true);
    expect(parsed.artifactCount).toBe(1);
    expect(parsed.checklistFingerprint).toBe(report.checklistFingerprint);
    expect(parsed.reviewFingerprint).toBe(report.reviewFingerprint);
    expect(parsed.fullReviewArtifactCount).toBe(0);
    expect(parsed.areaReviewArtifactCount).toBe(1);
    expect(parsed.unknownArtifactCount).toBe(0);
    expect(parsed.evidenceSourceCount).toBe(1);
    expect(parsed.usedEvidenceSourceCount).toBe(1);
    expect(parsed.usedEvidenceSourceIds).toEqual(['photo-set']);
    expect(parsed.unusedEvidenceSourceCount).toBe(0);
    expect(parsed.unusedEvidenceSourceIds).toEqual([]);
    expect(parsed.completion).toMatchObject({
      status: 'in_progress',
      reviewedItemCount: 64,
      unreviewedItemCount: 121,
    });
    expect(parsed.areaCompletionCounts).toEqual({
      not_started: 5,
      in_progress: 0,
      ready_to_lock: 1,
      has_differences: 0,
      needs_better_reference: 0,
    });
    expect(parsed.areaProgress).toHaveLength(6);
    expect(parsed.areaProgress.find((area) => area.area === 'regularCards')).toEqual({
      area: 'regularCards',
      itemCount: 64,
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
      evidenceRefs: ['official-component:photo-set#regularCards'],
      reviewers: ['Ada'],
      firstReviewedAt: '2026-07-10T00:00:00.000Z',
      lastReviewedAt: '2026-07-10T00:00:00.000Z',
      differenceItemKeys: [],
      needsReferenceItemKeys: [],
      unreviewedItemKeys: [],
      completionStatus: 'ready_to_lock',
    });
    expect(parsed.issueCount).toBe(0);
    expect(faceAuditEvidenceCoverageLabel(parsed.areaProgress.find((area) => area.area === 'regularCards')!))
      .toBe('1 evidence ref(s): 1 area-level, 0 item-specific covering 0 item(s)');
    expect(faceAuditReviewStatusLabel(parsed))
      .toBe(`Review status is valid for 1 artifact(s): 0 full, 1 area, 0 unknown. in_progress: 64 / 185 reviewed, 64 matched, 0 differences, 0 need better reference, 1 used / 1 declared evidence source(s), review ${report.reviewFingerprint}, areas 1 ready, 0 in progress, 5 not started, 0 with differences, 0 need better reference`);
  });

  it('derives review status evidence coverage for legacy status payloads', () => {
    const parsed = faceAuditReviewStatusFromPayload({
      faceAuditReviewStatus: {
        ok: true,
        artifactCount: 1,
        artifactCounts: {
          fullReviewArtifactCount: 0,
          areaReviewArtifactCount: 1,
          unknownArtifactCount: 0,
        },
        usedEvidenceSourceIds: ['photo-set'],
        unusedEvidenceSourceIds: [],
        areaProgress: [{
          area: 'wildCards',
          itemCount: 8,
          reviewedItemCount: 2,
          matchingItemCount: 2,
          differenceItemCount: 0,
          needsReferenceItemCount: 0,
          unreviewedItemCount: 6,
          evidenceRefCount: 3,
          evidenceSourceIds: ['photo-set'],
          evidenceRefs: [
            'official-component:photo-set#wildCards',
            'official-component:photo-set#wildCards:wild-location-1',
            'official-component:photo-set#wildCards:wild-location-2',
          ],
          reviewers: ['Ada'],
          firstReviewedAt: '2026-07-10T00:00:00.000Z',
          lastReviewedAt: '2026-07-10T00:00:00.000Z',
          differenceItemKeys: [],
          needsReferenceItemKeys: [],
          unreviewedItemKeys: ['wildCards:wild-industry-1'],
          completionStatus: 'in_progress',
        }],
        issues: [],
      },
    });

    expect(parsed.areaProgress).toHaveLength(1);
    expect(parsed.areaProgress[0]).toMatchObject({
      areaLevelEvidenceRefCount: 1,
      itemSpecificEvidenceRefCount: 2,
      itemSpecificEvidenceItemCount: 2,
    });
    expect(faceAuditEvidenceCoverageLabel(parsed.areaProgress[0]!))
      .toBe('3 evidence ref(s): 1 area-level, 2 item-specific covering 2 item(s)');
  });

  it('parses review todo reports and endpoint paths', () => {
    const regularCards = buildFaceAuditAreaReviewTemplate('regularCards');
    const evidenceSources = [{
      id: 'photo-set',
      label: 'Official component photo set',
      sourceType: 'official_physical_component' as const,
      citation: 'Reviewer-owned official Brass: Birmingham component photos',
      locator: 'reviewer-photos/official-component-set.zip',
      notes: '',
    }];
    const report = buildFaceAuditReviewTodo([{
      ...regularCards,
      evidenceSources,
      items: regularCards.items.map((item) => ({
        ...item,
        reviewStatus: 'matches_official_face',
        reviewer: 'Ada',
        reviewedAt: '2026-07-10T00:00:00.000Z',
        evidenceRef: `official-component:photo-set#${item.area}`,
      })),
    }]);
    const parsed = faceAuditReviewTodoFromPayload({
      faceAuditReviewTodo: {
        ...report,
        areas: [
          ...report.areas,
          {area: 'secretArea', itemCount: 1},
        ],
        issues: [
          ...report.issues,
          {field: ' ', message: 'blank field should be dropped'},
          null,
        ],
      },
    });

    expect(faceAuditReviewTodoPath()).toBe('/api/face-audit-review-template/todo');
    expect(parsed.artifactType).toBe('face_audit_review_todo');
    expect(parsed.version).toBe(1);
    expect(parsed.ok).toBe(true);
    expect(parsed.artifactCount).toBe(1);
    expect(parsed.checklistFingerprint).toBe(report.checklistFingerprint);
    expect(parsed.reviewFingerprint).toBe(report.reviewFingerprint);
    expect(parsed.checklistItemCount).toBe(report.checklistItemCount);
    expect(parsed.pendingAreaCount).toBe(5);
    expect(parsed.readyAreaCount).toBe(1);
    expect(parsed.commands).toEqual({
      blankTemplate: 'npm run face-audit:template',
      blankTemplateWithSources: 'npm run face-audit:template-with-sources -- .\\path\\to\\evidence-sources.json',
      sourceIdsByAreaTemplate: 'npm run face-audit:source-ids-by-area-template -- .\\path\\to\\evidence-sources.json <default-source-id> [area=source-id...]',
      reviewMatchTemplate: 'npm run face-audit:review-match-template -- .\\path\\to\\evidence-sources.json <source-id> <reviewer> <reviewed-at>',
      reviewMatchTemplateWithItemRefs: 'npm run face-audit:review-match-template -- .\\path\\to\\evidence-sources.json <source-id> <reviewer> <reviewed-at> items',
      reviewMatchTemplateByArea: 'npm run face-audit:review-match-template-by-area -- .\\path\\to\\evidence-sources.json .\\path\\to\\source-ids-by-area.json <reviewer> <reviewed-at>',
      reviewMatchTemplateByAreaWithItemRefs: 'npm run face-audit:review-match-template-by-area -- .\\path\\to\\evidence-sources.json .\\path\\to\\source-ids-by-area.json <reviewer> <reviewed-at> items',
    });
    expect(parsed.completion).toMatchObject({
      status: 'in_progress',
      reviewedItemCount: 64,
      unreviewedItemCount: 121,
    });
    expect(parsed.areas).toHaveLength(5);
    expect(parsed.areas.map((area) => area.area)).not.toContain('regularCards');
    expect(parsed.areas.find((area) => area.area === 'industryTiles')).toMatchObject({
      area: 'industryTiles',
      status: 'manifest_locked_face_audit_pending',
      completionStatus: 'not_started',
      nextStep: 'review_unreviewed_items',
      itemCount: 45,
      reviewedItemCount: 0,
      matchingItemCount: 0,
      differenceItemCount: 0,
      needsReferenceItemCount: 0,
      unreviewedItemCount: 45,
      remainingItemCount: 45,
      evidenceRefCount: 0,
      areaLevelEvidenceRefCount: 0,
      itemSpecificEvidenceRefCount: 0,
      itemSpecificEvidenceItemCount: 0,
      evidenceSourceIds: [],
      remainingItemKeyCount: 45,
      commands: {
        blankTemplate: 'npm run face-audit:area-template -- industryTiles',
        blankTemplateWithSources: 'npm run face-audit:area-template-with-sources -- industryTiles .\\path\\to\\evidence-sources.json',
        areaMatchTemplate: 'npm run face-audit:area-match-template -- industryTiles .\\path\\to\\evidence-sources.json <source-id> <reviewer> <reviewed-at>',
        areaMatchTemplateWithItemRefs: 'npm run face-audit:area-match-template -- industryTiles .\\path\\to\\evidence-sources.json <source-id> <reviewer> <reviewed-at> items',
      },
    });
    expect(parsed.areas.find((area) => area.area === 'industryTiles')?.nextItemKeys).toHaveLength(10);
    expect(parsed.issueCount).toBe(0);
    expect(faceAuditReviewTodoAreaLabel(parsed.areas.find((area) => area.area === 'industryTiles')!))
      .toBe('industryTiles: review_unreviewed_items; 45 remaining, 0 / 45 reviewed, 0 evidence ref(s)');
    expect(faceAuditReviewTodoLabel(parsed))
      .toBe(`Review todo is valid for 1 artifact(s). in_progress: 64 / 185 reviewed, 64 matched, 0 differences, 0 need better reference, 5 unfinished area(s), 1 ready area(s), review ${report.reviewFingerprint}`);
  });

  it('parses review todo summary reports and endpoint paths', () => {
    const regularCards = buildFaceAuditAreaReviewTemplate('regularCards');
    const evidenceSources = [{
      id: 'photo-set',
      label: 'Official component photo set',
      sourceType: 'official_physical_component' as const,
      citation: 'Reviewer-owned official Brass: Birmingham component photos',
      locator: 'reviewer-photos/official-component-set.zip',
      notes: '',
    }];
    const report = buildFaceAuditReviewTodo([{
      ...regularCards,
      evidenceSources,
      items: regularCards.items.map((item) => ({
        ...item,
        reviewStatus: 'matches_official_face',
        reviewer: 'Ada',
        reviewedAt: '2026-07-10T00:00:00.000Z',
        evidenceRef: `official-component:photo-set#${item.area}`,
      })),
    }]);
    const summary = buildFaceAuditReviewTodoSummary(report);
    const parsed = faceAuditReviewTodoSummaryFromPayload({
      faceAuditReviewTodoSummary: {
        ...summary,
        pendingItemCount: undefined,
        unfinishedAreas: [
          ...summary.unfinishedAreas,
          {area: 'secretArea', remainingItemCount: 1},
        ],
        issues: [
          ...summary.issues,
          {field: ' ', message: 'blank field should be dropped'},
          null,
        ],
      },
    });

    expect(faceAuditReviewTodoSummaryPath()).toBe('/api/face-audit-review-template/todo-summary');
    expect(parsed.artifactType).toBe('face_audit_review_todo_summary');
    expect(parsed.version).toBe(1);
    expect(parsed.ok).toBe(true);
    expect(parsed.artifactCount).toBe(1);
    expect(parsed.checklistFingerprint).toBe(summary.checklistFingerprint);
    expect(parsed.reviewFingerprint).toBe(summary.reviewFingerprint);
    expect(parsed.checklistItemCount).toBe(summary.checklistItemCount);
    expect(parsed.pendingAreaCount).toBe(5);
    expect(parsed.readyAreaCount).toBe(1);
    expect(parsed.pendingItemCount).toBe(121);
    expect(parsed.unfinishedAreas).toEqual(summary.unfinishedAreas);
    expect(parsed.issueCount).toBe(0);
    expect(parsed.completion).toMatchObject({
      status: 'in_progress',
      reviewedItemCount: 64,
      unreviewedItemCount: 121,
    });
    expect(faceAuditReviewTodoSummaryLabel(parsed))
      .toBe(`Review todo summary is valid for 1 artifact(s). in_progress: 64 / 185 reviewed, 64 matched, 0 differences, 0 need better reference, 5 unfinished area(s), 121 item(s), 1 ready area(s), review ${summary.reviewFingerprint}`);
  });

  it('parses area review todo summary reports and endpoint paths', () => {
    const wildCards = buildFaceAuditAreaReviewTemplate('wildCards');
    const evidenceSources = [{
      id: 'photo-set',
      label: 'Official component photo set',
      sourceType: 'official_physical_component' as const,
      citation: 'Reviewer-owned official Brass: Birmingham component photos',
      locator: 'reviewer-photos/official-component-set.zip',
      notes: '',
    }];
    const report = buildFaceAuditAreaReviewTodoSummary([{
      ...wildCards,
      evidenceSources,
      items: wildCards.items.map((item, index) => index === 0
        ? {
            ...item,
            reviewStatus: 'needs_better_reference',
            reviewer: 'Ada',
            reviewedAt: '2026-07-10T00:00:00.000Z',
            evidenceRef: `official-component:photo-set#wildCards:${item.id}`,
            notes: 'Official reference image is too low-resolution to confirm print details.',
          }
        : item),
    }], 'wildCards');
    const parsed = faceAuditAreaReviewTodoSummaryFromPayload({
      faceAuditAreaReviewTodoSummary: {
        ...report,
        issues: [
          ...report.issues,
          {field: ' ', message: 'blank field should be dropped'},
          null,
        ],
      },
    });

    expect(faceAuditAreaReviewTodoSummaryPath('wildCards'))
      .toBe('/api/face-audit-review-template/wildCards/todo-summary');
    expect(parsed.artifactType).toBe('face_audit_area_review_todo_summary');
    expect(parsed.version).toBe(1);
    expect(parsed.ok).toBe(true);
    expect(parsed.artifactCount).toBe(1);
    expect(parsed.area).toBe('wildCards');
    expect(parsed.status).toBe('manifest_locked_face_audit_pending');
    expect(parsed.checklistFingerprint).toBe(report.checklistFingerprint);
    expect(parsed.reviewFingerprint).toBe(report.reviewFingerprint);
    expect(parsed.checklistItemCount).toBe(report.checklistItemCount);
    expect(parsed.itemCount).toBe(8);
    expect(parsed.completionStatus).toBe('needs_better_reference');
    expect(parsed.nextStep).toBe('find_better_reference');
    expect(parsed.pendingItemCount).toBe(8);
    expect(parsed.remainingItemCount).toBe(8);
    expect(parsed.reviewedItemCount).toBe(1);
    expect(parsed.matchingItemCount).toBe(0);
    expect(parsed.differenceItemCount).toBe(0);
    expect(parsed.needsReferenceItemCount).toBe(1);
    expect(parsed.unreviewedItemCount).toBe(7);
    expect(parsed.evidenceRefCount).toBe(1);
    expect(parsed.areaLevelEvidenceRefCount).toBe(0);
    expect(parsed.itemSpecificEvidenceRefCount).toBe(1);
    expect(parsed.itemSpecificEvidenceItemCount).toBe(1);
    expect(parsed.evidenceSourceIds).toEqual(['photo-set']);
    expect(parsed.issueCount).toBe(0);
    expect(parsed.issues).toEqual([]);
    expect(faceAuditAreaReviewTodoSummaryLabel(parsed))
      .toBe(`Area todo summary is valid for wildCards. needs_better_reference: 8 remaining, 1 / 8 reviewed, 1 evidence ref(s), next find_better_reference, review ${report.reviewFingerprint}`);

    const readyReport = buildFaceAuditAreaReviewTodoSummary([{
      ...wildCards,
      evidenceSources,
      items: wildCards.items.map((item) => ({
        ...item,
        reviewStatus: 'matches_official_face',
        reviewer: 'Ada',
        reviewedAt: '2026-07-10T00:00:00.000Z',
        evidenceRef: 'official-component:photo-set#wildCards',
      })),
    }], 'wildCards');
    expect(faceAuditAreaReviewTodoSummaryFromPayload({
      faceAuditAreaReviewTodoSummary: readyReport,
    })).toMatchObject({
      artifactType: 'face_audit_area_review_todo_summary',
      area: 'wildCards',
      completionStatus: 'ready_to_lock',
      nextStep: 'none',
      pendingItemCount: 0,
      remainingItemCount: 0,
      reviewedItemCount: 8,
      matchingItemCount: 8,
    });
  });

  it('parses review plan reports and endpoint paths', () => {
    const regularCards = buildFaceAuditAreaReviewTemplate('regularCards');
    const evidenceSources = [{
      id: 'photo-set',
      label: 'Official component photo set',
      sourceType: 'official_physical_component' as const,
      citation: 'Reviewer-owned official Brass: Birmingham component photos',
      locator: 'reviewer-photos/official-component-set.zip',
      notes: '',
    }];
    const report = buildFaceAuditReviewPlan([{
      ...regularCards,
      evidenceSources,
      items: regularCards.items.map((item) => ({
        ...item,
        reviewStatus: 'matches_official_face',
        reviewer: 'Ada',
        reviewedAt: '2026-07-10T00:00:00.000Z',
        evidenceRef: `official-component:photo-set#${item.area}`,
      })),
    }]);
    const parsed = faceAuditReviewPlanFromPayload({
      faceAuditReviewPlan: {
        ...report,
        areas: [
          ...report.areas.map((area, index) => index === 0
            ? {
                ...area,
                items: [
                  ...area.items,
                  {key: 'bad-item', reviewStatus: 'unreviewed'},
                ],
              }
            : area),
          {
            ...report.areas[0],
            area: 'secretArea',
          },
        ],
        issues: [
          ...report.issues,
          {field: ' ', message: 'blank field should be dropped'},
          null,
        ],
      },
    });

    expect(faceAuditReviewPlanPath()).toBe('/api/face-audit-review-template/review-plan');
    expect(faceAuditReviewSheetPath()).toBe('/api/face-audit-review-template/review-sheet');
    expect(faceAuditAreaReviewSheetPath('industryTiles'))
      .toBe('/api/face-audit-review-template/industryTiles/review-sheet');
    expect(faceAuditReviewSheetFileName()).toBe('face-audit-review-sheet.tsv');
    expect(faceAuditAreaReviewSheetFileName('industryTiles'))
      .toBe('face-audit-area-industryTiles-review-sheet.tsv');
    expect(faceAuditReviewSheetImportPath()).toBe('/api/face-audit-review-template/apply-review-sheet');
    expect(faceAuditReviewFromSheetFileName()).toBe('face-audit-review-from-sheet.json');
    expect(faceAuditReviewSheetDownloadLabel('185', 'fnv1a32:abcdef12'))
      .toBe('Face-audit review sheet downloaded: 185 row(s), review fnv1a32:abcdef12');
    expect(faceAuditReviewSheetDownloadLabel(null, ' '))
      .toBe('Face-audit review sheet downloaded: unknown row count');
    expect(faceAuditReviewSheetDownloadLabel('-1', undefined))
      .toBe('Face-audit review sheet downloaded: unknown row count');
    expect(faceAuditAreaReviewSheetDownloadLabel('industryTiles', '45', 'fnv1a32:abcdef12'))
      .toBe('Face-audit industryTiles review sheet downloaded: 45 row(s), review fnv1a32:abcdef12');
    expect(faceAuditAreaReviewSheetDownloadLabel('industryTiles', '-1', ' '))
      .toBe('Face-audit industryTiles review sheet downloaded: unknown row count');
    expect(faceAuditReviewSheetImportDownloadLabel(185, 'fnv1a32:abcdef12'))
      .toBe('Face-audit review sheet applied: 185 item(s) applied, review fnv1a32:abcdef12');
    expect(faceAuditReviewSheetImportDownloadLabel(undefined, ' '))
      .toBe('Face-audit review sheet applied: unknown item count');
    expect(faceAuditReviewerInstructionsPath()).toBe('/api/face-audit-review-template/reviewer-instructions');
    expect(faceAuditAreaReviewerInstructionsPath('industryTiles'))
      .toBe('/api/face-audit-review-template/industryTiles/reviewer-instructions');
    expect(faceAuditReviewerInstructionsFileName()).toBe('face-audit-reviewer-instructions.md');
    expect(faceAuditAreaReviewerInstructionsFileName('industryTiles'))
      .toBe('face-audit-area-industryTiles-reviewer-instructions.md');
    expect(faceAuditReviewerInstructionsDownloadLabel('fnv1a32:abcdef12'))
      .toBe('Face-audit reviewer instructions downloaded: review fnv1a32:abcdef12');
    expect(faceAuditReviewerInstructionsDownloadLabel(' '))
      .toBe('Face-audit reviewer instructions downloaded');
    expect(faceAuditAreaReviewerInstructionsDownloadLabel('industryTiles', 'fnv1a32:abcdef12'))
      .toBe('Face-audit industryTiles reviewer instructions downloaded: review fnv1a32:abcdef12');
    expect(faceAuditAreaReviewerInstructionsDownloadLabel('industryTiles', ' '))
      .toBe('Face-audit industryTiles reviewer instructions downloaded');
    expect(parsed.artifactType).toBe('face_audit_review_plan');
    expect(parsed.version).toBe(1);
    expect(parsed.ok).toBe(true);
    expect(parsed.artifactCount).toBe(1);
    expect(parsed.checklistFingerprint).toBe(report.checklistFingerprint);
    expect(parsed.reviewFingerprint).toBe(report.reviewFingerprint);
    expect(parsed.checklistItemCount).toBe(report.checklistItemCount);
    expect(parsed.pendingAreaCount).toBe(5);
    expect(parsed.readyAreaCount).toBe(1);
    expect(parsed.pendingItemCount).toBe(121);
    expect(parsed.commands).toEqual(report.commands);
    expect(parsed.completion).toMatchObject({
      status: 'in_progress',
      reviewedItemCount: 64,
      unreviewedItemCount: 121,
    });
    expect(parsed.areas).toHaveLength(5);
    expect(parsed.areas.map((area) => area.area)).not.toContain('regularCards');
    const industryPlan = parsed.areas.find((area) => area.area === 'industryTiles');
    expect(industryPlan).toBeDefined();
    if (!industryPlan) {
      throw new Error('Missing industry plan');
    }
    expect(industryPlan).toMatchObject({
      area: 'industryTiles',
      status: 'manifest_locked_face_audit_pending',
      completionStatus: 'not_started',
      nextStep: 'review_unreviewed_items',
      itemCount: 45,
      remainingItemCount: 45,
    });
    expect(industryPlan.items).toHaveLength(45);
    expect(industryPlan.items[0]).toEqual({
      key: 'industryTiles:brewery-1-1',
      id: 'brewery-1-1',
      label: 'brewery level 1',
      expectedFields: [
        'industryType=brewery',
        'level=1',
        'buildableEras=canal',
        'cost=5/0/1',
        'beerRequiredToSell=0',
        'flip=resource_depleted:4/4/2',
        'resourcesWhenBuilt=canal:1',
        'canDevelop=true',
        'special=none',
      ],
      reviewStatus: 'unreviewed',
      nextStep: 'review_unreviewed_items',
      evidenceRef: '',
      notes: '',
    });
    expect(faceAuditReviewPlanAreaLabel(industryPlan))
      .toBe('industryTiles: 45 item(s) to assign; industryTiles: review_unreviewed_items; 45 remaining, 0 / 45 reviewed, 0 evidence ref(s)');
    expect(faceAuditReviewPlanLabel(parsed))
      .toBe(`Review plan is valid for 1 artifact(s). in_progress: 64 / 185 reviewed, 64 matched, 0 differences, 0 need better reference, 5 unfinished area(s), 121 item(s), 1 ready area(s), review ${report.reviewFingerprint}`);

    expect(faceAuditReviewPlanFromPayload({})).toEqual({
      artifactType: undefined,
      version: undefined,
      ok: false,
      artifactCount: 0,
      checklistFingerprint: undefined,
      reviewFingerprint: undefined,
      checklistItemCount: undefined,
      completion: undefined,
      pendingAreaCount: 0,
      readyAreaCount: 0,
      pendingItemCount: 0,
      issueCount: 0,
      areas: [],
      issues: [],
    });
  });

  it('parses reviewer handoff reports and endpoint paths', () => {
    const regularCards = buildFaceAuditAreaReviewTemplate('regularCards');
    const evidenceSources = [{
      id: 'photo-set',
      label: 'Official component photo set',
      sourceType: 'official_physical_component' as const,
      citation: 'Reviewer-owned official Brass: Birmingham component photos',
      locator: 'reviewer-photos/official-component-set.zip',
      notes: '',
    }];
    const report = buildFaceAuditReviewerHandoff([{
      ...regularCards,
      evidenceSources,
      items: regularCards.items.map((item) => ({
        ...item,
        reviewStatus: 'matches_official_face',
        reviewer: 'Ada',
        reviewedAt: '2026-07-10T00:00:00.000Z',
        evidenceRef: `official-component:photo-set#${item.area}`,
      })),
    }]);
    const industryReport = report.areas.find((area) => area.area === 'industryTiles');
    if (!industryReport) {
      throw new Error('Missing industry handoff fixture');
    }
    const parsed = faceAuditReviewerHandoffFromPayload({
      faceAuditReviewerHandoff: {
        ...report,
        areas: [
          ...report.areas,
          {
            area: 'industryTiles',
            todo: industryReport.todo,
            reviewArtifact: {
              ...industryReport.reviewArtifact,
              area: 'wildCards',
            },
          },
          {area: 'secretArea', todo: {}, reviewArtifact: {}},
        ],
        issues: [
          ...report.issues,
          {field: ' ', message: 'blank field should be dropped'},
          null,
        ],
      },
    });

    expect(faceAuditReviewerHandoffPath()).toBe('/api/face-audit-review-template/handoff');
    expect(faceAuditReviewerHandoffFileName()).toBe('face-audit-reviewer-handoff.json');
    expect(faceAuditReviewerHandoffVerifyPath()).toBe('/api/face-audit-reviewer-handoff/verify');
    expect(parsed.artifactType).toBe('face_audit_reviewer_handoff');
    expect(parsed.version).toBe(1);
    expect(parsed.ok).toBe(true);
    expect(parsed.artifactCount).toBe(1);
    expect(parsed.checklistFingerprint).toBe(report.checklistFingerprint);
    expect(parsed.reviewFingerprint).toBe(report.reviewFingerprint);
    expect(parsed.checklistItemCount).toBe(report.checklistItemCount);
    expect(parsed.evidenceSourceCount).toBe(1);
    expect(parsed.pendingAreaCount).toBe(5);
    expect(parsed.readyAreaCount).toBe(1);
    expect(parsed.completion).toMatchObject({
      status: 'in_progress',
      reviewedItemCount: 64,
      unreviewedItemCount: 121,
    });
    expect(parsed.todo.artifactType).toBe('face_audit_review_todo');
    expect(parsed.todo.pendingAreaCount).toBe(5);
    expect(parsed.areas).toHaveLength(5);
    expect(parsed.areas.map((area) => area.area)).not.toContain('regularCards');
    const industryHandoff = parsed.areas.find((area) => area.area === 'industryTiles');
    expect(industryHandoff).toBeDefined();
    if (!industryHandoff) {
      throw new Error('Missing industry handoff');
    }
    expect(industryHandoff.todo).toMatchObject({
      area: 'industryTiles',
      nextStep: 'review_unreviewed_items',
      remainingItemCount: 45,
    });
    expect(industryHandoff.reviewArtifact).toMatchObject({
      artifactType: 'face_audit_area_review',
      area: 'industryTiles',
      areaItemCount: 45,
      evidenceSourceCount: 1,
    });
    expect(industryHandoff.reviewArtifactPayload).toMatchObject({
      artifactType: 'face_audit_area_review',
      area: 'industryTiles',
      evidenceSources,
      completion: {
        status: 'not_started',
        unreviewedItemCount: 45,
      },
    });
    expect(parsed.issueCount).toBe(0);
    expect(faceAuditReviewerHandoffAreaFileName(industryHandoff.area))
      .toBe('face-audit-area-industryTiles-review.json');
    expect(faceAuditReviewerHandoffAreaDownloadLabel(industryHandoff))
      .toBe('Face-audit area review artifact downloaded: industryTiles, 45 item(s), 45 remaining, 1 evidence source(s)');
    expect(faceAuditReviewerHandoffDownloadLabel(parsed))
      .toBe(`Face-audit reviewer handoff downloaded: 5 pending area(s), 1 ready area(s), 1 evidence source(s), review ${report.reviewFingerprint}`);
    expect(faceAuditReviewerHandoffLabel(parsed))
      .toBe(`Reviewer handoff is valid for 1 artifact(s). in_progress: 64 / 185 reviewed, 64 matched, 0 differences, 0 need better reference, 5 unfinished area(s), 1 ready area(s), 1 evidence source(s), review ${report.reviewFingerprint}`);

    const validHandoffValidation = faceAuditReviewerHandoffValidationFromPayload({
      faceAuditReviewerHandoffValidation: {
        ok: true,
        handoff: report,
        issues: [],
      },
    });
    expect(validHandoffValidation.ok).toBe(true);
    expect(validHandoffValidation.issueCount).toBe(0);
    expect(validHandoffValidation.handoff?.reviewFingerprint).toBe(report.reviewFingerprint);
    expect(faceAuditReviewerHandoffValidationLabel(validHandoffValidation))
      .toBe(`Reviewer handoff is valid. Reviewer handoff is valid for 1 artifact(s). in_progress: 64 / 185 reviewed, 64 matched, 0 differences, 0 need better reference, 5 unfinished area(s), 1 ready area(s), 1 evidence source(s), review ${report.reviewFingerprint}`);

    const industryResponseArtifact = {
      ...industryReport.reviewArtifact,
      items: industryReport.reviewArtifact.items.map((item) => ({
        ...item,
        reviewStatus: 'matches_official_face',
        reviewer: 'Ben',
        reviewedAt: '2026-07-10T01:00:00.000Z',
        evidenceRef: `official-component:photo-set#${item.area}`,
      })),
    };
    const responseReport = summarizeFaceAuditReviewerHandoffResponse(report, [industryResponseArtifact]);
    const parsedResponse = faceAuditReviewerHandoffResponseFromPayload({
      faceAuditReviewerHandoffResponse: {
        ...responseReport,
        areas: [
          ...responseReport.areas,
          {
            area: 'secretArea',
            status: 'manifest_locked_face_audit_pending',
            completionStatus: 'ready_to_lock',
            itemCount: 1,
          },
        ],
        issues: [
          ...responseReport.issues,
          {field: ' ', message: 'blank field should be dropped'},
          null,
        ],
      },
    });
    expect(faceAuditReviewerHandoffResponsePath()).toBe('/api/face-audit-reviewer-handoff/response');
    expect(parsedResponse).toMatchObject({
      artifactType: 'face_audit_reviewer_handoff_response',
      version: 1,
      ok: true,
      checklistFingerprint: report.checklistFingerprint,
      handoffReviewFingerprint: report.reviewFingerprint,
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
    expect(parsedResponse.areas).toEqual([expect.objectContaining({
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
      reviewers: ['Ben'],
      firstReviewedAt: '2026-07-10T01:00:00.000Z',
      lastReviewedAt: '2026-07-10T01:00:00.000Z',
    })]);
    expect(faceAuditReviewerHandoffResponseLabel(parsedResponse))
      .toBe(`Reviewer handoff response is valid for 1 artifact(s). 1 / 5 returned area(s); 1 ready, 0 unfinished returned, 4 missing, 4 remaining, review ${report.reviewFingerprint}`);
  });

  it('parses validation responses and filters malformed issues', () => {
    const template = buildFaceAuditReviewTemplate();
    const validation = validateFaceAuditReviewArtifact({
      ...template,
      checklistFingerprint: 'fnv1a32:00000000',
      items: template.items.map((item, index) => index === 0
        ? {
            ...item,
            reviewStatus: 'matches_official_face',
            reviewer: '',
            reviewedAt: 'not-a-date',
            evidenceRef: '',
          }
        : item),
    });
    const parsed = faceAuditReviewValidationFromPayload({
      faceAuditReviewValidation: {
        ...validation,
        issues: [
          ...validation.issues,
          {field: ' ', message: 'blank field should be dropped'},
          null,
        ],
      },
    });

    expect(parsed.ok).toBe(false);
    expect(parsed.evidenceSourceCount).toBe(0);
    expect(parsed.completion).toEqual(validation.review.completion);
    expect(parsed.issueCount).toBe(validation.issues.length);
    expect(parsed.issues).toEqual(validation.issues);
    expect(faceAuditReviewValidationLabel(parsed))
      .toContain(`Review artifact has ${validation.issues.length} issue(s).`);

    const handoffValidation = faceAuditReviewerHandoffValidationFromPayload({
      faceAuditReviewerHandoffValidation: {
        ok: false,
        issues: [
          {field: 'checklistFingerprint', message: 'stale checklist'},
          {field: ' ', message: 'blank field should be dropped'},
          null,
        ],
      },
    });
    expect(handoffValidation.ok).toBe(false);
    expect(handoffValidation.handoff).toBeUndefined();
    expect(handoffValidation.issueCount).toBe(1);
    expect(handoffValidation.issues).toEqual([
      {field: 'checklistFingerprint', message: 'stale checklist'},
    ]);
    expect(faceAuditReviewerHandoffValidationLabel(handoffValidation))
      .toBe('Reviewer handoff has 1 issue(s).');
    expect(faceAuditReviewerHandoffValidationFromPayload({})).toEqual({
      ok: false,
      handoff: undefined,
      issueCount: 0,
      issues: [],
    });

    const handoffResponse = faceAuditReviewerHandoffResponseFromPayload({
      faceAuditReviewerHandoffResponse: {
        ok: false,
        responseArtifactCount: 1,
        handoffPendingAreaCount: 5,
        acceptedAreaCount: 0,
        readyAreaCount: 0,
        unfinishedReturnedAreaCount: 0,
        missingAreaCount: 5,
        remainingAreaCount: 5,
        issues: [
          {field: 'artifacts[0].area', message: 'not in handoff'},
          {field: ' ', message: 'blank field should be dropped'},
          null,
        ],
      },
    });
    expect(handoffResponse.ok).toBe(false);
    expect(handoffResponse.issueCount).toBe(1);
    expect(handoffResponse.issues).toEqual([
      {field: 'artifacts[0].area', message: 'not in handoff'},
    ]);
    expect(faceAuditReviewerHandoffResponseLabel(handoffResponse))
      .toBe('Reviewer handoff response has 1 issue(s) for 1 artifact(s). 0 / 5 returned area(s); 0 ready, 0 unfinished returned, 5 missing, 5 remaining');
    expect(faceAuditReviewerHandoffResponseFromPayload({})).toEqual({
      artifactType: undefined,
      version: undefined,
      ok: false,
      checklistFingerprint: undefined,
      handoffReviewFingerprint: undefined,
      handoffPendingAreaCount: 0,
      responseArtifactCount: 0,
      acceptedAreaCount: 0,
      readyAreaCount: 0,
      unfinishedReturnedAreaCount: 0,
      missingAreaCount: 0,
      remainingAreaCount: 0,
      areas: [],
      issueCount: 0,
      issues: [],
    });
  });

  it('formats valid review validation summaries', () => {
    const template = buildFaceAuditReviewTemplate();
    const valid = validateFaceAuditReviewArtifact({
      ...template,
      evidenceSources: [{
        id: 'photo-set',
        label: 'Official component photo set',
        sourceType: 'official_physical_component',
        citation: 'Reviewer-owned official Brass: Birmingham component photos',
        locator: 'reviewer-photos/official-component-set.zip',
        notes: '',
      }],
      items: template.items.map((item) => ({
        ...item,
        reviewStatus: 'matches_official_face',
        reviewer: 'Ada',
        reviewedAt: '2026-07-10T00:00:00.000Z',
        evidenceRef: `official-component:photo-set#${item.area}`,
      })),
    });
    const parsed = faceAuditReviewValidationFromPayload({faceAuditReviewValidation: valid});

    expect(parsed.ok).toBe(true);
    expect(parsed.evidenceSourceCount).toBe(1);
    expect(faceAuditReviewCompletionLabel(parsed.completion))
      .toBe('ready_to_lock: 185 / 185 reviewed, 185 matched, 0 differences, 0 need better reference');
    expect(faceAuditReviewValidationLabel(parsed))
      .toBe('Review artifact is valid. ready_to_lock: 185 / 185 reviewed, 185 matched, 0 differences, 0 need better reference, 1 evidence source(s)');
  });

  it('formats review submission labels and endpoint paths for validate and ready checks', () => {
    const failedValidation = faceAuditReviewValidationFromPayload({});
    const template = buildFaceAuditReviewTemplate();
    const readyArtifact = {
      ...template,
      evidenceSources: [{
        id: 'photo-set',
        label: 'Official component photo set',
        sourceType: 'official_physical_component',
        citation: 'Reviewer-owned official Brass: Birmingham component photos',
        locator: 'reviewer-photos/official-component-set.zip',
        notes: '',
      }],
      items: template.items.map((item) => ({
        ...item,
        reviewStatus: 'matches_official_face',
        reviewer: 'Ada',
        reviewedAt: '2026-07-10T00:00:00.000Z',
        evidenceRef: `official-component:photo-set#${item.area}`,
      })),
    };
    const readyValidation = faceAuditReviewValidationFromPayload({
      faceAuditReviewValidation: validateFaceAuditReviewArtifact(readyArtifact),
    });
    const lockPreviewValidation = faceAuditReviewValidationFromPayload({
      faceAuditReviewValidation: buildFaceAuditLockPreview(readyArtifact),
    });

    expect(faceAuditReviewSubmissionPath('validate')).toBe('/api/face-audit-review-template/validate');
    expect(faceAuditReviewSubmissionPath('ready')).toBe('/api/face-audit-review-template/ready');
    expect(faceAuditReviewSubmissionPath('lock-preview')).toBe('/api/face-audit-review-template/lock-preview');
    expect(faceAuditReviewSubmissionPath('lock-artifact')).toBe('/api/face-audit-review-template/lock-artifact');
    expect(faceAuditLockArtifactVerifyPath()).toBe('/api/face-audit-lock-artifact/verify');
    expect(faceAuditReviewSubmissionLabel('validate', failedValidation))
      .toBe('Review validation: Review artifact has 0 issue(s). No review summary available');
    expect(faceAuditReviewSubmissionLabel('ready', readyValidation))
      .toBe('Ready check: Review artifact is valid. ready_to_lock: 185 / 185 reviewed, 185 matched, 0 differences, 0 need better reference, 1 evidence source(s)');
    expect(lockPreviewValidation.lockPreview).toEqual({
      reviewFingerprint: expect.stringMatching(/^fnv1a32:[0-9a-f]{8}$/),
      areaCount: 6,
      totalReviewedItemCount: 185,
      evidenceRefCount: 6,
      areaLevelEvidenceRefCount: 6,
      itemSpecificEvidenceRefCount: 0,
      itemSpecificEvidenceItemCount: 0,
      evidenceSourceCount: 1,
    });
    expect(faceAuditReviewSubmissionLabel('lock-preview', lockPreviewValidation))
      .toMatch(/^Lock preview: Review artifact is valid\. ready_to_lock: 185 \/ 185 reviewed, 185 matched, 0 differences, 0 need better reference, 1 evidence source\(s\); review fnv1a32:[0-9a-f]{8}; 6 audit areas, 185 reviewed items, 6 evidence ref\(s\), 6 area-level, 0 item-specific covering 0 item\(s\), 1 evidence source\(s\) ready to lock$/);
  });

  it('parses compact lock artifacts and verification responses', () => {
    const template = buildFaceAuditReviewTemplate();
    const readyArtifact = {
      ...template,
      evidenceSources: [{
        id: 'photo-set',
        label: 'Official component photo set',
        sourceType: 'official_physical_component',
        citation: 'Reviewer-owned official Brass: Birmingham component photos',
        locator: 'reviewer-photos/official-component-set.zip',
        notes: '',
      }],
      items: template.items.map((item) => ({
        ...item,
        reviewStatus: 'matches_official_face',
        reviewer: 'Ada',
        reviewedAt: '2026-07-10T00:00:00.000Z',
        evidenceRef: `official-component:photo-set#${item.area}`,
      })),
    };
    const lockArtifact = buildFaceAuditLockArtifact(readyArtifact).lockArtifact;
    if (!lockArtifact) {
      throw new Error('Expected ready review to build lock artifact');
    }
    const parsedArtifact = faceAuditLockArtifactFromPayload({faceAuditLockArtifact: lockArtifact});
    const verification = faceAuditLockArtifactValidationFromPayload({
      faceAuditLockArtifactValidation: validateFaceAuditLockArtifact(lockArtifact),
    });

    expect(parsedArtifact).toEqual({
      artifactType: 'face_audit_lock_evidence',
      checklistFingerprint: lockArtifact.checklistFingerprint,
      reviewFingerprint: expect.stringMatching(/^fnv1a32:[0-9a-f]{8}$/),
      checklistItemCount: 185,
      completion: lockArtifact.completion,
      areaCount: 6,
      totalReviewedItemCount: 185,
      evidenceRefCount: 6,
      areaLevelEvidenceRefCount: 6,
      itemSpecificEvidenceRefCount: 0,
      itemSpecificEvidenceItemCount: 0,
      evidenceSourceCount: 1,
    });
    expect(faceAuditLockArtifactLabel(parsedArtifact!))
      .toMatch(/^face_audit_lock_evidence: ready_to_lock; review fnv1a32:[0-9a-f]{8}; 6 audit areas, 185 reviewed items, 6 evidence ref\(s\), 6 area-level, 0 item-specific covering 0 item\(s\), 1 evidence source\(s\)$/);
    expect(verification.ok).toBe(true);
    expect(verification.issueCount).toBe(0);
    expect(verification.lockArtifact).toEqual(parsedArtifact);
    expect(faceAuditLockArtifactValidationLabel(verification))
      .toMatch(/^Lock artifact is valid\. face_audit_lock_evidence: ready_to_lock; review fnv1a32:[0-9a-f]{8}; 6 audit areas, 185 reviewed items, 6 evidence ref\(s\), 6 area-level, 0 item-specific covering 0 item\(s\), 1 evidence source\(s\)$/);
    const releaseGate = faceAuditStaticLockGateFromPayload({
      faceAuditStaticLockGate: validateFaceAuditStaticLockGate(lockArtifact),
    });

    expect(faceAuditReleaseGatePath()).toBe('/api/face-audit-release-gate');
    expect(releaseGate.ok).toBe(true);
    expect(releaseGate.pendingAreaCount).toBe(6);
    expect(releaseGate.lockedAreaCount).toBe(0);
    expect(releaseGate.issueCount).toBe(0);
    expect(releaseGate.issues).toEqual([]);
    expect(releaseGate.lockArtifactValidation).toEqual(verification);
    expect(faceAuditStaticLockGateLabel(releaseGate))
      .toMatch(/^Release gate is open\. 6 pending area\(s\), 0 locked area\(s\); Lock artifact is valid\. face_audit_lock_evidence: ready_to_lock; review fnv1a32:[0-9a-f]{8}; 6 audit areas, 185 reviewed items, 6 evidence ref\(s\), 6 area-level, 0 item-specific covering 0 item\(s\), 1 evidence source\(s\)$/);

    const invalidVerification = faceAuditLockArtifactValidationFromPayload({
      faceAuditLockArtifactValidation: validateFaceAuditLockArtifact({
        ...lockArtifact,
        checklistFingerprint: 'fnv1a32:00000000',
      }),
    });

    expect(invalidVerification.ok).toBe(false);
    expect(invalidVerification.lockArtifact).toBeUndefined();
    expect(invalidVerification.issueCount).toBe(1);
    expect(invalidVerification.issues).toEqual([{
      field: 'checklistFingerprint',
      message: 'Face-audit lock artifact does not match the current or lock-transition checklist fingerprint',
    }]);
    expect(faceAuditLockArtifactValidationLabel(invalidVerification))
      .toBe('Lock artifact has 1 issue(s).');
    const invalidReleaseGate = faceAuditStaticLockGateFromPayload({
      faceAuditStaticLockGate: validateFaceAuditStaticLockGate({
        ...lockArtifact,
        checklistFingerprint: 'fnv1a32:00000000',
      }),
    });

    expect(invalidReleaseGate.ok).toBe(false);
    expect(invalidReleaseGate.pendingAreaCount).toBe(6);
    expect(invalidReleaseGate.lockedAreaCount).toBe(0);
    expect(invalidReleaseGate.issueCount).toBe(1);
    expect(invalidReleaseGate.lockArtifactValidation).toEqual(invalidVerification);
    expect(faceAuditStaticLockGateLabel(invalidReleaseGate))
      .toBe('Release gate has 1 issue(s). 6 pending area(s), 0 locked area(s); Lock artifact has 1 issue(s).');
    expect(faceAuditLockArtifactFromPayload({faceAuditLockArtifact: {...lockArtifact, artifactType: 'wrong'}}))
      .toBeUndefined();
  });

  it('formats issue labels with and without item keys', () => {
    expect(faceAuditReviewIssueLabel({
      field: 'version',
      message: 'must be version 1',
    })).toBe('version: must be version 1');
    expect(faceAuditReviewIssueLabel({
      itemKey: 'regularCards:p4-location-derby-1',
      field: 'evidenceRef',
      message: 'Reviewed items must cite official-component evidence',
    })).toBe('regularCards:p4-location-derby-1 evidenceRef: Reviewed items must cite official-component evidence');
  });

  it('normalizes area and review status option names', () => {
    expect(faceAuditReviewAreaName(' regularCards ')).toBe('regularCards');
    expect(faceAuditReviewAreaName('secretArea')).toBeUndefined();
    expect(faceAuditReviewStatusName(' matches_official_face ')).toBe('matches_official_face');
    expect(faceAuditReviewStatusName('bad-status')).toBeUndefined();
  });

  it('returns an empty failed validation for missing payloads', () => {
    expect(faceAuditReviewValidationFromPayload({})).toEqual({
      ok: false,
      evidenceSourceCount: undefined,
      completion: undefined,
      lockPreview: undefined,
      lockArtifact: undefined,
      issueCount: 0,
      issues: [],
    });
    expect(faceAuditLockArtifactValidationFromPayload({})).toEqual({
      ok: false,
      lockArtifact: undefined,
      issueCount: 0,
      issues: [],
    });
    expect(faceAuditStaticLockGateFromPayload({})).toEqual({
      ok: false,
      pendingAreaCount: 0,
      lockedAreaCount: 0,
      lockArtifactValidation: undefined,
      issueCount: 0,
      issues: [],
    });
    expect(faceAuditReviewTodoFromPayload({})).toEqual({
      artifactType: undefined,
      version: undefined,
      ok: false,
      artifactCount: 0,
      checklistFingerprint: undefined,
      reviewFingerprint: undefined,
      checklistItemCount: undefined,
      completion: undefined,
      pendingAreaCount: 0,
      readyAreaCount: 0,
      issueCount: 0,
      areas: [],
      issues: [],
    });
    expect(faceAuditReviewTodoSummaryFromPayload({})).toEqual({
      artifactType: undefined,
      version: undefined,
      ok: false,
      artifactCount: 0,
      checklistFingerprint: undefined,
      reviewFingerprint: undefined,
      checklistItemCount: undefined,
      completion: undefined,
      pendingAreaCount: 0,
      readyAreaCount: 0,
      pendingItemCount: 0,
      unfinishedAreas: [],
      issueCount: 0,
      issues: [],
    });
    expect(faceAuditAreaReviewTodoSummaryFromPayload({})).toEqual({
      artifactType: undefined,
      version: undefined,
      ok: false,
      artifactCount: 0,
      area: undefined,
      status: undefined,
      checklistFingerprint: undefined,
      reviewFingerprint: undefined,
      checklistItemCount: undefined,
      itemCount: 0,
      completionStatus: undefined,
      nextStep: undefined,
      pendingItemCount: 0,
      remainingItemCount: 0,
      reviewedItemCount: 0,
      matchingItemCount: 0,
      differenceItemCount: 0,
      needsReferenceItemCount: 0,
      unreviewedItemCount: 0,
      evidenceRefCount: 0,
      areaLevelEvidenceRefCount: 0,
      itemSpecificEvidenceRefCount: 0,
      itemSpecificEvidenceItemCount: 0,
      evidenceSourceIds: [],
      issueCount: 0,
      issues: [],
    });
    expect(faceAuditReviewerHandoffFromPayload({})).toEqual({
      artifactType: undefined,
      version: undefined,
      ok: false,
      artifactCount: 0,
      checklistFingerprint: undefined,
      reviewFingerprint: undefined,
      checklistItemCount: undefined,
      evidenceSourceCount: undefined,
      completion: undefined,
      pendingAreaCount: 0,
      readyAreaCount: 0,
      issueCount: 0,
      todo: {
        artifactType: undefined,
        version: undefined,
        ok: false,
        artifactCount: 0,
        checklistFingerprint: undefined,
        reviewFingerprint: undefined,
        checklistItemCount: undefined,
        completion: undefined,
        pendingAreaCount: 0,
        readyAreaCount: 0,
        issueCount: 0,
        areas: [],
        issues: [],
      },
      areas: [],
      issues: [],
    });
    expect(faceAuditReviewCompletionLabel(undefined)).toBe('No review summary available');
  });
});
