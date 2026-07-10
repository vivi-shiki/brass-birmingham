import {FACE_AUDIT_AREAS, type FaceAuditArea} from '../common/faceAudit';
import type {StaticDataAuditStatus} from '../common/types';

export type FaceAuditAreaSummaryView = {
  area: FaceAuditArea;
  status: StaticDataAuditStatus;
  rulebookPages: number[];
  sourceRefs: string[];
  coveredByTests: string[];
  itemCount: number;
  expectedFieldNames: string[];
};

export type FaceAuditChecklistItemView = {
  area: FaceAuditArea;
  id: string;
  label: string;
  expectedFields: string[];
};

export type FaceAuditChecklistView = {
  version?: 1;
  checklistFingerprint?: string;
  checklistItemCount?: number;
  areas: FaceAuditAreaSummaryView[];
  items: FaceAuditChecklistItemView[];
};

const faceAuditAreaSet = new Set<FaceAuditArea>(FACE_AUDIT_AREAS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.map(nonEmptyString);
  return strings.every((item): item is string => item !== undefined) ? strings : undefined;
}

function positiveIntegerArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.every((item): item is number =>
    typeof item === 'number' &&
    Number.isInteger(item) &&
    item > 0
  )
    ? [...value]
    : undefined;
}

function normalizedArea(value: unknown): FaceAuditArea | undefined {
  const area = nonEmptyString(value) as FaceAuditArea | undefined;
  return area && faceAuditAreaSet.has(area) ? area : undefined;
}

function normalizedStatus(value: unknown): StaticDataAuditStatus | undefined {
  return value === 'manifest_locked' || value === 'manifest_locked_face_audit_pending' ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function normalizedChecklistVersion(value: unknown): 1 | undefined {
  return value === 1 ? 1 : undefined;
}

function areaSummaryFromPayload(value: unknown): FaceAuditAreaSummaryView | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const area = normalizedArea(value.area);
  const status = normalizedStatus(value.status);
  const rulebookPages = positiveIntegerArray(value.rulebookPages);
  const sourceRefs = stringArray(value.sourceRefs);
  const coveredByTests = stringArray(value.coveredByTests);
  const itemCount = nonNegativeInteger(value.itemCount);
  const expectedFieldNames = stringArray(value.expectedFieldNames);
  if (
    area === undefined ||
    status === undefined ||
    rulebookPages === undefined ||
    sourceRefs === undefined ||
    coveredByTests === undefined ||
    itemCount === undefined ||
    expectedFieldNames === undefined ||
    expectedFieldNames.length === 0
  ) {
    return undefined;
  }
  return {area, status, rulebookPages, sourceRefs, coveredByTests, itemCount, expectedFieldNames};
}

function checklistItemFromPayload(value: unknown): FaceAuditChecklistItemView | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const area = normalizedArea(value.area);
  const id = nonEmptyString(value.id);
  const label = nonEmptyString(value.label);
  const expectedFields = stringArray(value.expectedFields);
  if (area === undefined || id === undefined || label === undefined || expectedFields === undefined || expectedFields.length === 0) {
    return undefined;
  }
  return {area, id, label, expectedFields};
}

export function faceAuditChecklistFromPayload(payload: unknown): FaceAuditChecklistView {
  const root = isRecord(payload) ? payload.faceAudit : undefined;
  const source = isRecord(root) ? root : {};
  const version = normalizedChecklistVersion(source.version);
  const checklistFingerprint = nonEmptyString(source.checklistFingerprint);
  const checklistItemCount = nonNegativeInteger(source.checklistItemCount);
  const areas = Array.isArray(source.areas)
    ? source.areas.map(areaSummaryFromPayload).filter((area): area is FaceAuditAreaSummaryView => area !== undefined)
    : [];
  const items = Array.isArray(source.items)
    ? source.items.map(checklistItemFromPayload).filter((item): item is FaceAuditChecklistItemView => item !== undefined)
    : [];
  return {version, checklistFingerprint, checklistItemCount, areas, items};
}

export function faceAuditAreaSummaryLabel(summary: FaceAuditAreaSummaryView): string {
  return `${summary.area}: ${summary.itemCount} items, ${summary.status}`;
}

export function faceAuditItemsForArea(
  checklist: FaceAuditChecklistView,
  area: FaceAuditArea,
): FaceAuditChecklistItemView[] {
  return checklist.items.filter((item) => item.area === area);
}

export function faceAuditFieldSummary(fields: string[]): string {
  return fields.join(', ');
}

export function faceAuditChecklistIdentityLabel(checklist: FaceAuditChecklistView): string {
  if (checklist.version === undefined || checklist.checklistFingerprint === undefined) {
    return 'Checklist identity unavailable';
  }
  return `Checklist v${checklist.version}: ${checklist.checklistFingerprint}`;
}
