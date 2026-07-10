import {describe, expect, it} from 'vitest';
import {buildFaceAuditChecklistExport} from '../src/common/faceAudit';
import {
  faceAuditAreaSummaryLabel,
  faceAuditChecklistIdentityLabel,
  faceAuditChecklistFromPayload,
  faceAuditFieldSummary,
  faceAuditItemsForArea,
} from '../src/client/faceAuditViewOptions';

describe('client face-audit view options', () => {
  it('parses the public checklist export payload for display', () => {
    const source = buildFaceAuditChecklistExport();
    const parsed = faceAuditChecklistFromPayload({faceAudit: source});

    expect(parsed.areas).toEqual(source.areas);
    expect(parsed.items).toEqual(source.items);
    expect(parsed.version).toBe(1);
    expect(parsed.checklistFingerprint).toBe(source.checklistFingerprint);
    expect(parsed.checklistItemCount).toBe(source.checklistItemCount);
    expect(faceAuditChecklistIdentityLabel(parsed)).toBe(`Checklist v1: ${source.checklistFingerprint}`);
    expect(faceAuditAreaSummaryLabel(parsed.areas.find((area) => area.area === 'regularCards')!))
      .toBe('regularCards: 64 items, manifest_locked_face_audit_pending');
    expect(faceAuditItemsForArea(parsed, 'linkLines').map((item) => item.id))
      .toContain('kidderminster-worcester');
  });

  it('filters malformed area summaries and checklist items from dirty payloads', () => {
    const parsed = faceAuditChecklistFromPayload({
      faceAudit: {
        areas: [
          {
            area: 'locationsAndSlots',
            status: 'manifest_locked_face_audit_pending',
            rulebookPages: [4, 5],
            sourceRefs: ['official board face audit pending'],
            coveredByTests: ['tests/faceAudit.spec.ts'],
            itemCount: 20,
            expectedFieldNames: ['name', 'slots'],
            sessions: [{token: 'secret-token'}],
          },
          {
            area: 'secretArea',
            status: 'manifest_locked_face_audit_pending',
            rulebookPages: [1],
            sourceRefs: ['source'],
            coveredByTests: ['tests/faceAudit.spec.ts'],
            itemCount: 1,
            expectedFieldNames: ['field'],
          },
          {
            area: 'regularCards',
            status: 'bad-status',
            rulebookPages: [1],
            sourceRefs: ['source'],
            coveredByTests: ['tests/faceAudit.spec.ts'],
            itemCount: 64,
            expectedFieldNames: ['type'],
          },
          {
            area: 'wildCards',
            status: 'manifest_locked_face_audit_pending',
            rulebookPages: [0],
            sourceRefs: ['source'],
            coveredByTests: ['tests/faceAudit.spec.ts'],
            itemCount: 8,
            expectedFieldNames: ['type'],
          },
        ],
        items: [
          {
            area: 'locationsAndSlots',
            id: ' birmingham ',
            label: ' Birmingham ',
            expectedFields: [' name=Birmingham ', 'slots=birmingham-0:manufacturer'],
            players: {p1: {handCardIds: ['secret-card']}},
          },
          {
            area: 'secretArea',
            id: 'secret-item',
            label: 'Secret',
            expectedFields: ['secret=true'],
          },
          {
            area: 'locationsAndSlots',
            id: 'blank-fields',
            label: 'Blank Fields',
            expectedFields: [],
          },
          null,
        ],
      },
    });

    expect(parsed.areas).toEqual([{
      area: 'locationsAndSlots',
      status: 'manifest_locked_face_audit_pending',
      rulebookPages: [4, 5],
      sourceRefs: ['official board face audit pending'],
      coveredByTests: ['tests/faceAudit.spec.ts'],
      itemCount: 20,
      expectedFieldNames: ['name', 'slots'],
    }]);
    expect(parsed.items).toEqual([{
      area: 'locationsAndSlots',
      id: 'birmingham',
      label: 'Birmingham',
      expectedFields: ['name=Birmingham', 'slots=birmingham-0:manufacturer'],
    }]);
    expect(JSON.stringify(parsed)).not.toContain('secret');
  });

  it('returns an empty checklist for non-object or missing payloads', () => {
    expect(faceAuditChecklistFromPayload(null)).toEqual({
      version: undefined,
      checklistFingerprint: undefined,
      checklistItemCount: undefined,
      areas: [],
      items: [],
    });
    expect(faceAuditChecklistFromPayload({})).toEqual({
      version: undefined,
      checklistFingerprint: undefined,
      checklistItemCount: undefined,
      areas: [],
      items: [],
    });
    expect(faceAuditChecklistFromPayload({faceAudit: []})).toEqual({
      version: undefined,
      checklistFingerprint: undefined,
      checklistItemCount: undefined,
      areas: [],
      items: [],
    });
    expect(faceAuditChecklistIdentityLabel(faceAuditChecklistFromPayload({}))).toBe('Checklist identity unavailable');
  });

  it('formats field summaries in the same order as the checklist fields', () => {
    expect(faceAuditFieldSummary(['type=location', 'locationId=birmingham', 'representedBy=4-player regular deck']))
      .toBe('type=location, locationId=birmingham, representedBy=4-player regular deck');
  });
});
