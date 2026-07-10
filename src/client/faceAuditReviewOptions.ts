import {
  FACE_AUDIT_AREAS,
  FACE_AUDIT_EVIDENCE_SOURCE_TYPES,
  FACE_AUDIT_REVIEW_STATUSES,
  faceAuditAreaReviewArtifactFileName,
  faceAuditAreaReviewTodoSummaryArtifactFileName,
  faceAuditEvidenceRefTemplateArtifactFileName,
  faceAuditEvidenceSourceTemplateArtifactFileName,
  faceAuditReviewPlanArtifactFileName,
  faceAuditReviewArtifactFileName,
  faceAuditSourceIdsByAreaArtifactFileName,
  faceAuditReviewTodoArtifactFileName,
  faceAuditReviewTodoSummaryArtifactFileName,
  type FaceAuditArea,
  type FaceAuditEvidenceRefMode,
  type FaceAuditEvidenceSourceType,
  type FaceAuditLockArtifact,
  type FaceAuditAreaReviewTodoSummaryNextStep,
  type FaceAuditReviewAreaCompletionCounts,
  type FaceAuditReviewCompletionStatus,
  type FaceAuditReviewStatus,
  type FaceAuditReviewTodoNextStep,
} from '../common/faceAudit';
import type {StaticDataAuditStatus} from '../common/types';

export type FaceAuditReviewCompletionView = {
  status: FaceAuditReviewCompletionStatus;
  reviewedItemCount: number;
  matchingItemCount: number;
  differenceItemCount: number;
  needsReferenceItemCount: number;
  unreviewedItemCount: number;
  totalItemCount: number;
};

export type FaceAuditReviewIssueView = {
  itemKey?: string;
  field: string;
  message: string;
};

export type FaceAuditLockPreviewView = {
  reviewFingerprint: string;
  areaCount: number;
  totalReviewedItemCount: number;
  evidenceRefCount: number;
  areaLevelEvidenceRefCount: number;
  itemSpecificEvidenceRefCount: number;
  itemSpecificEvidenceItemCount: number;
  evidenceSourceCount: number;
};

export type FaceAuditLockArtifactView = {
  artifactType: FaceAuditLockArtifact['artifactType'];
  checklistFingerprint: string;
  reviewFingerprint: string;
  checklistItemCount: number;
  completion: FaceAuditReviewCompletionView;
  areaCount: number;
  totalReviewedItemCount: number;
  evidenceRefCount: number;
  areaLevelEvidenceRefCount: number;
  itemSpecificEvidenceRefCount: number;
  itemSpecificEvidenceItemCount: number;
  evidenceSourceCount: number;
};

export type FaceAuditReviewValidationView = {
  ok: boolean;
  evidenceSourceCount?: number;
  completion?: FaceAuditReviewCompletionView;
  lockPreview?: FaceAuditLockPreviewView;
  lockArtifact?: FaceAuditLockArtifactView;
  issueCount: number;
  issues: FaceAuditReviewIssueView[];
};

export type FaceAuditReviewStatusAreaView = {
  area: FaceAuditArea;
  itemCount: number;
  reviewedItemCount: number;
  matchingItemCount: number;
  differenceItemCount: number;
  needsReferenceItemCount: number;
  unreviewedItemCount: number;
  evidenceRefCount: number;
  areaLevelEvidenceRefCount: number;
  itemSpecificEvidenceRefCount: number;
  itemSpecificEvidenceItemCount: number;
  evidenceSourceIds: string[];
  evidenceRefs: string[];
  reviewers: string[];
  firstReviewedAt: string;
  lastReviewedAt: string;
  differenceItemKeys: string[];
  needsReferenceItemKeys: string[];
  unreviewedItemKeys: string[];
  completionStatus: FaceAuditReviewCompletionStatus;
};

export type FaceAuditReviewAreaCompletionCountsView = FaceAuditReviewAreaCompletionCounts;

export type FaceAuditReviewStatusView = {
  artifactType?: 'face_audit_review_status';
  version?: 1;
  ok: boolean;
  artifactCount: number;
  fullReviewArtifactCount: number;
  areaReviewArtifactCount: number;
  unknownArtifactCount: number;
  checklistFingerprint?: string;
  reviewFingerprint?: string;
  checklistItemCount?: number;
  evidenceSourceCount?: number;
  usedEvidenceSourceCount: number;
  usedEvidenceSourceIds: string[];
  unusedEvidenceSourceCount: number;
  unusedEvidenceSourceIds: string[];
  completion?: FaceAuditReviewCompletionView;
  areaCompletionCounts: FaceAuditReviewAreaCompletionCountsView;
  areaProgress: FaceAuditReviewStatusAreaView[];
  issueCount: number;
  issues: FaceAuditReviewIssueView[];
};

export type FaceAuditReviewTodoAreaCommandsView = {
  blankTemplate: string;
  blankTemplateWithSources: string;
  areaMatchTemplate: string;
  areaMatchTemplateWithItemRefs: string;
};

export type FaceAuditReviewTodoCommandsView = {
  blankTemplate: string;
  blankTemplateWithSources: string;
  sourceIdsByAreaTemplate: string;
  reviewMatchTemplate: string;
  reviewMatchTemplateWithItemRefs: string;
  reviewMatchTemplateByArea: string;
  reviewMatchTemplateByAreaWithItemRefs: string;
};

export type FaceAuditReviewTodoAreaView = {
  area: FaceAuditArea;
  status: StaticDataAuditStatus;
  completionStatus: FaceAuditReviewCompletionStatus;
  nextStep: FaceAuditReviewTodoNextStep;
  itemCount: number;
  reviewedItemCount: number;
  matchingItemCount: number;
  differenceItemCount: number;
  needsReferenceItemCount: number;
  unreviewedItemCount: number;
  remainingItemCount: number;
  evidenceRefCount: number;
  areaLevelEvidenceRefCount: number;
  itemSpecificEvidenceRefCount: number;
  itemSpecificEvidenceItemCount: number;
  evidenceSourceIds: string[];
  nextItemKeys: string[];
  remainingItemKeyCount: number;
  commands: FaceAuditReviewTodoAreaCommandsView;
};

export type FaceAuditReviewTodoView = {
  artifactType?: 'face_audit_review_todo';
  version?: 1;
  ok: boolean;
  artifactCount: number;
  checklistFingerprint?: string;
  reviewFingerprint?: string;
  checklistItemCount?: number;
  completion?: FaceAuditReviewCompletionView;
  pendingAreaCount: number;
  readyAreaCount: number;
  issueCount: number;
  commands?: FaceAuditReviewTodoCommandsView;
  areas: FaceAuditReviewTodoAreaView[];
  issues: FaceAuditReviewIssueView[];
};

export type FaceAuditReviewTodoSummaryAreaView = {
  area: FaceAuditArea;
  completionStatus: FaceAuditReviewCompletionStatus;
  nextStep: FaceAuditReviewTodoNextStep;
  remainingItemCount: number;
};

export type FaceAuditReviewTodoSummaryView = {
  artifactType?: 'face_audit_review_todo_summary';
  version?: 1;
  ok: boolean;
  artifactCount: number;
  checklistFingerprint?: string;
  reviewFingerprint?: string;
  checklistItemCount?: number;
  completion?: FaceAuditReviewCompletionView;
  pendingAreaCount: number;
  readyAreaCount: number;
  pendingItemCount: number;
  unfinishedAreas: FaceAuditReviewTodoSummaryAreaView[];
  issueCount: number;
  issues: FaceAuditReviewIssueView[];
};

export type FaceAuditAreaReviewTodoSummaryView = {
  artifactType?: 'face_audit_area_review_todo_summary';
  version?: 1;
  ok: boolean;
  artifactCount: number;
  area?: FaceAuditArea;
  status?: StaticDataAuditStatus;
  checklistFingerprint?: string;
  reviewFingerprint?: string;
  checklistItemCount?: number;
  itemCount: number;
  completionStatus?: FaceAuditReviewCompletionStatus;
  nextStep?: FaceAuditAreaReviewTodoSummaryNextStep;
  pendingItemCount: number;
  remainingItemCount: number;
  reviewedItemCount: number;
  matchingItemCount: number;
  differenceItemCount: number;
  needsReferenceItemCount: number;
  unreviewedItemCount: number;
  evidenceRefCount: number;
  areaLevelEvidenceRefCount: number;
  itemSpecificEvidenceRefCount: number;
  itemSpecificEvidenceItemCount: number;
  evidenceSourceIds: string[];
  issueCount: number;
  issues: FaceAuditReviewIssueView[];
};

export type FaceAuditReviewPlanItemView = {
  key: string;
  id: string;
  label: string;
  expectedFields: string[];
  reviewStatus: FaceAuditReviewStatus;
  nextStep: FaceAuditReviewTodoNextStep;
  evidenceRef: string;
  notes: string;
};

export type FaceAuditReviewPlanAreaView = FaceAuditReviewTodoAreaView & {
  items: FaceAuditReviewPlanItemView[];
};

export type FaceAuditReviewPlanView = {
  artifactType?: 'face_audit_review_plan';
  version?: 1;
  ok: boolean;
  artifactCount: number;
  checklistFingerprint?: string;
  reviewFingerprint?: string;
  checklistItemCount?: number;
  completion?: FaceAuditReviewCompletionView;
  pendingAreaCount: number;
  readyAreaCount: number;
  pendingItemCount: number;
  issueCount: number;
  commands?: FaceAuditReviewTodoCommandsView;
  areas: FaceAuditReviewPlanAreaView[];
  issues: FaceAuditReviewIssueView[];
};

export type FaceAuditReviewerHandoffAreaView = {
  area: FaceAuditArea;
  todo: FaceAuditReviewTodoAreaView;
  reviewArtifact: FaceAuditAreaReviewTemplateView;
  reviewArtifactPayload: Record<string, unknown>;
};

export type FaceAuditReviewerHandoffView = {
  artifactType?: 'face_audit_reviewer_handoff';
  version?: 1;
  ok: boolean;
  artifactCount: number;
  checklistFingerprint?: string;
  reviewFingerprint?: string;
  checklistItemCount?: number;
  evidenceSourceCount?: number;
  completion?: FaceAuditReviewCompletionView;
  pendingAreaCount: number;
  readyAreaCount: number;
  issueCount: number;
  todo: FaceAuditReviewTodoView;
  areas: FaceAuditReviewerHandoffAreaView[];
  issues: FaceAuditReviewIssueView[];
};

export type FaceAuditReviewerHandoffValidationView = {
  ok: boolean;
  handoff?: FaceAuditReviewerHandoffView;
  issueCount: number;
  issues: FaceAuditReviewIssueView[];
};

export type FaceAuditReviewerHandoffResponseAreaView = {
  area: FaceAuditArea;
  status: StaticDataAuditStatus;
  completionStatus: FaceAuditReviewCompletionStatus;
  itemCount: number;
  reviewedItemCount: number;
  matchingItemCount: number;
  differenceItemCount: number;
  needsReferenceItemCount: number;
  unreviewedItemCount: number;
  remainingItemCount: number;
  evidenceRefCount: number;
  areaLevelEvidenceRefCount: number;
  itemSpecificEvidenceRefCount: number;
  itemSpecificEvidenceItemCount: number;
  evidenceSourceIds: string[];
  reviewers: string[];
  firstReviewedAt: string;
  lastReviewedAt: string;
};

export type FaceAuditReviewerHandoffResponseView = {
  artifactType?: 'face_audit_reviewer_handoff_response';
  version?: 1;
  ok: boolean;
  checklistFingerprint?: string;
  handoffReviewFingerprint?: string;
  handoffPendingAreaCount: number;
  responseArtifactCount: number;
  acceptedAreaCount: number;
  readyAreaCount: number;
  unfinishedReturnedAreaCount: number;
  missingAreaCount: number;
  remainingAreaCount: number;
  areas: FaceAuditReviewerHandoffResponseAreaView[];
  issueCount: number;
  issues: FaceAuditReviewIssueView[];
};

export type FaceAuditLockArtifactValidationView = {
  ok: boolean;
  lockArtifact?: FaceAuditLockArtifactView;
  issueCount: number;
  issues: FaceAuditReviewIssueView[];
};

export type FaceAuditStaticLockGateView = {
  ok: boolean;
  pendingAreaCount: number;
  lockedAreaCount: number;
  lockArtifactValidation?: FaceAuditLockArtifactValidationView;
  issueCount: number;
  issues: FaceAuditReviewIssueView[];
};

export type FaceAuditReviewTemplateView = {
  version: 1;
  checklistFingerprint: string;
  checklistItemCount: number;
  evidenceSourceCount: number;
};

export type FaceAuditAreaReviewTemplateView = FaceAuditReviewTemplateView & {
  artifactType: 'face_audit_area_review';
  area: FaceAuditArea;
  areaItemCount: number;
};

export type FaceAuditEvidenceRefTemplateItemView = {
  key: string;
  id: string;
  label: string;
  evidenceRef: string;
};

export type FaceAuditEvidenceRefTemplateView = {
  artifactType?: 'face_audit_evidence_ref_template';
  version?: 1;
  sourceId?: string;
  area?: FaceAuditArea;
  mode?: FaceAuditEvidenceRefMode;
  evidenceRefCount: number;
  evidenceRefs: string[];
  items: FaceAuditEvidenceRefTemplateItemView[];
};

export type FaceAuditEvidenceSourceTemplateFileView = {
  locator: string;
  contentHash: string;
  label?: string;
};

export type FaceAuditEvidenceSourceView = {
  id: string;
  label: string;
  sourceType: FaceAuditEvidenceSourceType;
  citation: string;
  locator?: string;
  contentHash?: string;
  notes: string;
};

export type FaceAuditSourceIdsByAreaView = Partial<Record<FaceAuditArea, string>>;

export type FaceAuditEvidenceSourceTemplateSourceView = FaceAuditEvidenceSourceView & {
  locator: string;
  contentHash: string;
};

export type FaceAuditEvidenceSourceTemplateView = {
  artifactType: 'face_audit_evidence_source_template';
  version: 1;
  sourceType: FaceAuditEvidenceSourceType;
  sourceCount: number;
  evidenceSources: FaceAuditEvidenceSourceTemplateSourceView[];
};

export type FaceAuditAreaReviewFillOptions = {
  reviewer: string;
  reviewedAt: string;
  evidenceRefScope?: 'area' | 'item';
  evidenceSourceId: string;
  evidenceSourceLabel: string;
  evidenceSourceType: FaceAuditEvidenceSourceType;
  evidenceSourceCitation: string;
  evidenceSourceLocator?: string;
  evidenceSourceContentHash?: string;
  evidenceSourceNotes: string;
  reviewStatus: Exclude<FaceAuditReviewStatus, 'unreviewed'>;
  itemNotes: string;
};

export type FaceAuditAreaReviewFillResult =
  | {ok: true; artifact: Record<string, unknown>; area: FaceAuditArea; itemCount: number}
  | {ok: false; error: string};

export type FaceAuditReviewArtifactRequestOptions =
  | {method: 'GET'}
  | {method: 'POST'; headers: {'content-type': 'application/json'}; body: string};

export type FaceAuditEvidenceSourceTemplateResult =
  | {ok: true; artifact: FaceAuditEvidenceSourceTemplateView}
  | {ok: false; error: string};

export const FACE_AUDIT_REVIEW_SUBMISSION_TYPES = ['validate', 'ready', 'lock-preview', 'lock-artifact'] as const;

export type FaceAuditReviewSubmissionType = typeof FACE_AUDIT_REVIEW_SUBMISSION_TYPES[number];

const FACE_AUDIT_REVIEW_SHEET_FILE_NAME = 'face-audit-review-sheet.tsv';
const FACE_AUDIT_AREA_REVIEW_SHEET_FILE_SUFFIX = '-review-sheet.tsv';
const FACE_AUDIT_REVIEW_FROM_SHEET_FILE_NAME = 'face-audit-review-from-sheet.json';
const FACE_AUDIT_REVIEWER_INSTRUCTIONS_FILE_NAME = 'face-audit-reviewer-instructions.md';
const FACE_AUDIT_REVIEWER_HANDOFF_FILE_NAME = 'face-audit-reviewer-handoff.json';
const FACE_AUDIT_AREA_REVIEWER_INSTRUCTIONS_FILE_SUFFIX = '-reviewer-instructions.md';
const faceAuditAreaSet = new Set<FaceAuditArea>(FACE_AUDIT_AREAS);
const reviewStatusSet = new Set<FaceAuditReviewStatus>(FACE_AUDIT_REVIEW_STATUSES);
const evidenceSourceTypeSet = new Set<FaceAuditEvidenceSourceType>(FACE_AUDIT_EVIDENCE_SOURCE_TYPES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || undefined;
}

function stringFromPayload(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function nonNegativeIntegerFromHeader(value: string | null | undefined): number | undefined {
  if (value === undefined || value === null || value.trim() === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function evidenceSourceId(value: string): string | undefined {
  const trimmed = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(trimmed) ? trimmed : undefined;
}

function evidenceSourceTypeFromPayload(value: unknown): FaceAuditEvidenceSourceType | undefined {
  const sourceType = nonEmptyString(value) as FaceAuditEvidenceSourceType | undefined;
  return sourceType && evidenceSourceTypeSet.has(sourceType) ? sourceType : undefined;
}

function fileNameFromLocator(locator: string): string {
  return locator.trim().split(/[\\/]/).filter(Boolean).at(-1) ?? locator.trim();
}

function fileNameWithoutFinalExtension(locator: string): string {
  const fileName = fileNameFromLocator(locator);
  const extensionIndex = fileName.lastIndexOf('.');
  return extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
}

function sourceIdFromLocator(locator: string, usedIds: Set<string>): string {
  const normalized = fileNameWithoutFinalExtension(locator)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[^a-z0-9._/-]+$/, '');
  const base = normalized || 'evidence-source';
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix++;
  }
  usedIds.add(candidate);
  return candidate;
}

function validEvidenceSourceContentHash(value: string): boolean {
  return /^(sha256:[0-9a-f]{64}|sha1:[0-9a-f]{40}|md5:[0-9a-f]{32})$/.test(value);
}

function evidenceSourceFromPayload(
  value: unknown,
  usedIds: Set<string>,
): FaceAuditEvidenceSourceView | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = typeof value.id === 'string' ? evidenceSourceId(value.id) : undefined;
  const label = nonEmptyString(value.label);
  const sourceType = evidenceSourceTypeFromPayload(value.sourceType);
  const citation = nonEmptyString(value.citation);
  const locator = nonEmptyString(value.locator);
  const contentHash = typeof value.contentHash === 'string'
    ? value.contentHash.trim().toLowerCase()
    : '';
  const notes = typeof value.notes === 'string' ? value.notes.trim() : '';
  if (
    id === undefined ||
    usedIds.has(id) ||
    label === undefined ||
    sourceType === undefined ||
    citation === undefined ||
    (contentHash.length > 0 && !validEvidenceSourceContentHash(contentHash))
  ) {
    return undefined;
  }
  usedIds.add(id);
  return {
    id,
    label,
    sourceType,
    citation,
    ...(locator === undefined ? {} : {locator}),
    ...(contentHash.length === 0 ? {} : {contentHash}),
    notes,
  };
}

function evidenceSourceCountFromPayload(value: unknown): number | undefined {
  return Array.isArray(value) && value.every(isRecord) ? value.length : undefined;
}

function reviewCompletionStatus(value: unknown): FaceAuditReviewCompletionStatus | undefined {
  return value === 'not_started' ||
    value === 'in_progress' ||
    value === 'ready_to_lock' ||
    value === 'has_differences' ||
    value === 'needs_better_reference'
    ? value
    : undefined;
}

function faceAuditStaticDataAuditStatus(value: unknown): StaticDataAuditStatus | undefined {
  return value === 'manifest_locked' || value === 'manifest_locked_face_audit_pending'
    ? value
    : undefined;
}

function faceAuditReviewTodoNextStep(value: unknown): FaceAuditReviewTodoNextStep | undefined {
  return value === 'review_unreviewed_items' ||
    value === 'resolve_differences' ||
    value === 'find_better_reference'
    ? value
    : undefined;
}

function faceAuditAreaReviewTodoSummaryNextStep(
  value: unknown,
): FaceAuditAreaReviewTodoSummaryNextStep | undefined {
  return value === 'none' ? 'none' : faceAuditReviewTodoNextStep(value);
}

function faceAuditEvidenceRefMode(value: unknown): FaceAuditEvidenceRefMode | undefined {
  return value === 'area' || value === 'items' ? value : undefined;
}

function reviewCompletionFromPayload(value: unknown): FaceAuditReviewCompletionView | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const status = reviewCompletionStatus(value.status);
  const reviewedItemCount = nonNegativeInteger(value.reviewedItemCount);
  const matchingItemCount = nonNegativeInteger(value.matchingItemCount);
  const differenceItemCount = nonNegativeInteger(value.differenceItemCount);
  const needsReferenceItemCount = nonNegativeInteger(value.needsReferenceItemCount);
  const unreviewedItemCount = nonNegativeInteger(value.unreviewedItemCount);
  const totalItemCount = nonNegativeInteger(value.totalItemCount);
  if (
    status === undefined ||
    reviewedItemCount === undefined ||
    matchingItemCount === undefined ||
    differenceItemCount === undefined ||
    needsReferenceItemCount === undefined ||
    unreviewedItemCount === undefined ||
    totalItemCount === undefined
  ) {
    return undefined;
  }
  return {
    status,
    reviewedItemCount,
    matchingItemCount,
    differenceItemCount,
    needsReferenceItemCount,
    unreviewedItemCount,
    totalItemCount,
  };
}

function reviewIssueFromPayload(value: unknown): FaceAuditReviewIssueView | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const field = nonEmptyString(value.field);
  const message = nonEmptyString(value.message);
  const itemKey = nonEmptyString(value.itemKey);
  if (field === undefined || message === undefined) {
    return undefined;
  }
  return itemKey === undefined ? {field, message} : {itemKey, field, message};
}

function stringListFromPayload(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = value.map(nonEmptyString);
  return values.every((item): item is string => item !== undefined) ? values : undefined;
}

export function faceAuditReviewArtifactRequestOptions(
  artifactText: string,
  inputLabel: string,
): FaceAuditReviewArtifactRequestOptions {
  if (artifactText.trim().length === 0) {
    return {method: 'GET'};
  }
  let artifactPayload: unknown;
  try {
    artifactPayload = JSON.parse(artifactText) as unknown;
  } catch {
    throw new Error(`${inputLabel} artifact input must be valid JSON`);
  }
  return {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(artifactPayload),
  };
}

function uniqueSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function evidenceRefTarget(value: string): {area: string; itemId?: string} | undefined {
  const match = /^official-component:[A-Za-z0-9][A-Za-z0-9._/-]*#([A-Za-z0-9_-]+)(?::([A-Za-z0-9._-]+))?$/.exec(value);
  if (!match) {
    return undefined;
  }
  return match[2] === undefined ? {area: match[1]!} : {area: match[1]!, itemId: match[2]};
}

function evidenceCoverageFromRefs(
  area: FaceAuditArea,
  evidenceRefs: readonly string[],
): Pick<
  FaceAuditReviewStatusAreaView,
  'evidenceRefCount' | 'areaLevelEvidenceRefCount' | 'itemSpecificEvidenceRefCount' | 'itemSpecificEvidenceItemCount'
> {
  const targets = evidenceRefs
    .map(evidenceRefTarget)
    .filter((target): target is {area: string; itemId?: string} => target !== undefined && target.area === area);
  const itemIds = uniqueSortedStrings(targets
    .map((target) => target.itemId)
    .filter((itemId): itemId is string => itemId !== undefined));
  return {
    evidenceRefCount: targets.length,
    areaLevelEvidenceRefCount: targets.filter((target) => target.itemId === undefined).length,
    itemSpecificEvidenceRefCount: targets.filter((target) => target.itemId !== undefined).length,
    itemSpecificEvidenceItemCount: itemIds.length,
  };
}

function reviewStatusAreaFromPayload(value: unknown): FaceAuditReviewStatusAreaView | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const area = faceAuditReviewAreaName(value.area);
  const itemCount = nonNegativeInteger(value.itemCount);
  const reviewedItemCount = nonNegativeInteger(value.reviewedItemCount);
  const matchingItemCount = nonNegativeInteger(value.matchingItemCount);
  const differenceItemCount = nonNegativeInteger(value.differenceItemCount);
  const needsReferenceItemCount = nonNegativeInteger(value.needsReferenceItemCount);
  const unreviewedItemCount = nonNegativeInteger(value.unreviewedItemCount);
  const evidenceRefCount = nonNegativeInteger(value.evidenceRefCount);
  const areaLevelEvidenceRefCount = nonNegativeInteger(value.areaLevelEvidenceRefCount);
  const itemSpecificEvidenceRefCount = nonNegativeInteger(value.itemSpecificEvidenceRefCount);
  const itemSpecificEvidenceItemCount = nonNegativeInteger(value.itemSpecificEvidenceItemCount);
  const evidenceSourceIds = stringListFromPayload(value.evidenceSourceIds);
  const evidenceRefs = stringListFromPayload(value.evidenceRefs);
  const reviewers = stringListFromPayload(value.reviewers);
  const firstReviewedAt = stringFromPayload(value.firstReviewedAt);
  const lastReviewedAt = stringFromPayload(value.lastReviewedAt);
  const differenceItemKeys = stringListFromPayload(value.differenceItemKeys);
  const needsReferenceItemKeys = stringListFromPayload(value.needsReferenceItemKeys);
  const unreviewedItemKeys = stringListFromPayload(value.unreviewedItemKeys);
  const completionStatus = reviewCompletionStatus(value.completionStatus);
  if (
    area === undefined ||
    itemCount === undefined ||
    reviewedItemCount === undefined ||
    matchingItemCount === undefined ||
    differenceItemCount === undefined ||
    needsReferenceItemCount === undefined ||
    unreviewedItemCount === undefined ||
    evidenceRefCount === undefined ||
    evidenceSourceIds === undefined ||
    evidenceRefs === undefined ||
    reviewers === undefined ||
    firstReviewedAt === undefined ||
    lastReviewedAt === undefined ||
    differenceItemKeys === undefined ||
    needsReferenceItemKeys === undefined ||
    unreviewedItemKeys === undefined ||
    completionStatus === undefined
  ) {
    return undefined;
  }
  const fallbackCoverage = evidenceCoverageFromRefs(area, evidenceRefs);
  return {
    area,
    itemCount,
    reviewedItemCount,
    matchingItemCount,
    differenceItemCount,
    needsReferenceItemCount,
    unreviewedItemCount,
    evidenceRefCount,
    areaLevelEvidenceRefCount: areaLevelEvidenceRefCount ?? fallbackCoverage.areaLevelEvidenceRefCount,
    itemSpecificEvidenceRefCount: itemSpecificEvidenceRefCount ?? fallbackCoverage.itemSpecificEvidenceRefCount,
    itemSpecificEvidenceItemCount: itemSpecificEvidenceItemCount ?? fallbackCoverage.itemSpecificEvidenceItemCount,
    evidenceSourceIds,
    evidenceRefs,
    reviewers,
    firstReviewedAt,
    lastReviewedAt,
    differenceItemKeys,
    needsReferenceItemKeys,
    unreviewedItemKeys,
    completionStatus,
  };
}

function reviewTodoAreaCommandsFromPayload(value: unknown): FaceAuditReviewTodoAreaCommandsView | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const blankTemplate = nonEmptyString(value.blankTemplate);
  const blankTemplateWithSources = nonEmptyString(value.blankTemplateWithSources);
  const areaMatchTemplate = nonEmptyString(value.areaMatchTemplate);
  const areaMatchTemplateWithItemRefs = nonEmptyString(value.areaMatchTemplateWithItemRefs);
  if (
    blankTemplate === undefined ||
    blankTemplateWithSources === undefined ||
    areaMatchTemplate === undefined ||
    areaMatchTemplateWithItemRefs === undefined
  ) {
    return undefined;
  }
  return {
    blankTemplate,
    blankTemplateWithSources,
    areaMatchTemplate,
    areaMatchTemplateWithItemRefs,
  };
}

function reviewTodoCommandsFromPayload(value: unknown): FaceAuditReviewTodoCommandsView | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const blankTemplate = nonEmptyString(value.blankTemplate);
  const blankTemplateWithSources = nonEmptyString(value.blankTemplateWithSources);
  const sourceIdsByAreaTemplate = nonEmptyString(value.sourceIdsByAreaTemplate);
  const reviewMatchTemplate = nonEmptyString(value.reviewMatchTemplate);
  const reviewMatchTemplateWithItemRefs = nonEmptyString(value.reviewMatchTemplateWithItemRefs);
  const reviewMatchTemplateByArea = nonEmptyString(value.reviewMatchTemplateByArea);
  const reviewMatchTemplateByAreaWithItemRefs = nonEmptyString(value.reviewMatchTemplateByAreaWithItemRefs);
  if (
    blankTemplate === undefined ||
    blankTemplateWithSources === undefined ||
    sourceIdsByAreaTemplate === undefined ||
    reviewMatchTemplate === undefined ||
    reviewMatchTemplateWithItemRefs === undefined ||
    reviewMatchTemplateByArea === undefined ||
    reviewMatchTemplateByAreaWithItemRefs === undefined
  ) {
    return undefined;
  }
  return {
    blankTemplate,
    blankTemplateWithSources,
    sourceIdsByAreaTemplate,
    reviewMatchTemplate,
    reviewMatchTemplateWithItemRefs,
    reviewMatchTemplateByArea,
    reviewMatchTemplateByAreaWithItemRefs,
  };
}

function reviewTodoAreaFromPayload(value: unknown): FaceAuditReviewTodoAreaView | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const area = faceAuditReviewAreaName(value.area);
  const status = faceAuditStaticDataAuditStatus(value.status);
  const completionStatus = reviewCompletionStatus(value.completionStatus);
  const nextStep = faceAuditReviewTodoNextStep(value.nextStep);
  const itemCount = nonNegativeInteger(value.itemCount);
  const reviewedItemCount = nonNegativeInteger(value.reviewedItemCount);
  const matchingItemCount = nonNegativeInteger(value.matchingItemCount);
  const differenceItemCount = nonNegativeInteger(value.differenceItemCount);
  const needsReferenceItemCount = nonNegativeInteger(value.needsReferenceItemCount);
  const unreviewedItemCount = nonNegativeInteger(value.unreviewedItemCount);
  const remainingItemCount = nonNegativeInteger(value.remainingItemCount);
  const evidenceRefCount = nonNegativeInteger(value.evidenceRefCount);
  const areaLevelEvidenceRefCount = nonNegativeInteger(value.areaLevelEvidenceRefCount);
  const itemSpecificEvidenceRefCount = nonNegativeInteger(value.itemSpecificEvidenceRefCount);
  const itemSpecificEvidenceItemCount = nonNegativeInteger(value.itemSpecificEvidenceItemCount);
  const evidenceSourceIds = stringListFromPayload(value.evidenceSourceIds);
  const nextItemKeys = stringListFromPayload(value.nextItemKeys);
  const remainingItemKeyCount = nonNegativeInteger(value.remainingItemKeyCount);
  const commands = reviewTodoAreaCommandsFromPayload(value.commands);
  if (
    area === undefined ||
    status === undefined ||
    completionStatus === undefined ||
    nextStep === undefined ||
    itemCount === undefined ||
    reviewedItemCount === undefined ||
    matchingItemCount === undefined ||
    differenceItemCount === undefined ||
    needsReferenceItemCount === undefined ||
    unreviewedItemCount === undefined ||
    remainingItemCount === undefined ||
    evidenceRefCount === undefined ||
    areaLevelEvidenceRefCount === undefined ||
    itemSpecificEvidenceRefCount === undefined ||
    itemSpecificEvidenceItemCount === undefined ||
    evidenceSourceIds === undefined ||
    nextItemKeys === undefined ||
    remainingItemKeyCount === undefined ||
    commands === undefined
  ) {
    return undefined;
  }
  return {
    area,
    status,
    completionStatus,
    nextStep,
    itemCount,
    reviewedItemCount,
    matchingItemCount,
    differenceItemCount,
    needsReferenceItemCount,
    unreviewedItemCount,
    remainingItemCount,
    evidenceRefCount,
    areaLevelEvidenceRefCount,
    itemSpecificEvidenceRefCount,
    itemSpecificEvidenceItemCount,
    evidenceSourceIds,
    nextItemKeys,
    remainingItemKeyCount,
    commands,
  };
}

function reviewPlanItemFromPayload(value: unknown): FaceAuditReviewPlanItemView | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const key = nonEmptyString(value.key);
  const id = nonEmptyString(value.id);
  const label = nonEmptyString(value.label);
  const expectedFields = stringListFromPayload(value.expectedFields);
  const reviewStatus = faceAuditReviewStatusName(value.reviewStatus);
  const nextStep = faceAuditReviewTodoNextStep(value.nextStep);
  const evidenceRef = stringFromPayload(value.evidenceRef);
  const notes = stringFromPayload(value.notes);
  if (
    key === undefined ||
    id === undefined ||
    label === undefined ||
    expectedFields === undefined ||
    reviewStatus === undefined ||
    nextStep === undefined ||
    evidenceRef === undefined ||
    notes === undefined
  ) {
    return undefined;
  }
  return {
    key,
    id,
    label,
    expectedFields,
    reviewStatus,
    nextStep,
    evidenceRef,
    notes,
  };
}

function reviewTodoSummaryAreaFromPayload(value: unknown): FaceAuditReviewTodoSummaryAreaView | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const area = faceAuditReviewAreaName(value.area);
  const completionStatus = reviewCompletionStatus(value.completionStatus);
  const nextStep = faceAuditReviewTodoNextStep(value.nextStep);
  const remainingItemCount = nonNegativeInteger(value.remainingItemCount);
  if (!area || !completionStatus || !nextStep || remainingItemCount === undefined) {
    return undefined;
  }
  return {
    area,
    completionStatus,
    nextStep,
    remainingItemCount,
  };
}

function reviewPlanAreaFromPayload(value: unknown): FaceAuditReviewPlanAreaView | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const area = reviewTodoAreaFromPayload(value);
  const items = Array.isArray(value.items)
    ? value.items
      .map(reviewPlanItemFromPayload)
      .filter((item): item is FaceAuditReviewPlanItemView => item !== undefined)
    : undefined;
  if (area === undefined || items === undefined) {
    return undefined;
  }
  return {
    ...area,
    items,
  };
}

function reviewerHandoffAreaFromPayload(value: unknown): FaceAuditReviewerHandoffAreaView | undefined {
  if (!isRecord(value) || !isRecord(value.reviewArtifact)) {
    return undefined;
  }
  const area = faceAuditReviewAreaName(value.area);
  const todo = reviewTodoAreaFromPayload(value.todo);
  const reviewArtifact = areaReviewTemplateFromPayload(value.reviewArtifact);
  if (
    area === undefined ||
    todo === undefined ||
    reviewArtifact === undefined ||
    todo.area !== area ||
    reviewArtifact.area !== area
  ) {
    return undefined;
  }
  return {
    area,
    todo,
    reviewArtifact,
    reviewArtifactPayload: value.reviewArtifact,
  };
}

function reviewerHandoffResponseAreaFromPayload(
  value: unknown,
): FaceAuditReviewerHandoffResponseAreaView | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const area = faceAuditReviewAreaName(value.area);
  const status = faceAuditStaticDataAuditStatus(value.status);
  const completionStatus = reviewCompletionStatus(value.completionStatus);
  const itemCount = nonNegativeInteger(value.itemCount);
  const reviewedItemCount = nonNegativeInteger(value.reviewedItemCount);
  const matchingItemCount = nonNegativeInteger(value.matchingItemCount);
  const differenceItemCount = nonNegativeInteger(value.differenceItemCount);
  const needsReferenceItemCount = nonNegativeInteger(value.needsReferenceItemCount);
  const unreviewedItemCount = nonNegativeInteger(value.unreviewedItemCount);
  const remainingItemCount = nonNegativeInteger(value.remainingItemCount);
  const evidenceRefCount = nonNegativeInteger(value.evidenceRefCount);
  const areaLevelEvidenceRefCount = nonNegativeInteger(value.areaLevelEvidenceRefCount);
  const itemSpecificEvidenceRefCount = nonNegativeInteger(value.itemSpecificEvidenceRefCount);
  const itemSpecificEvidenceItemCount = nonNegativeInteger(value.itemSpecificEvidenceItemCount);
  const evidenceSourceIds = stringListFromPayload(value.evidenceSourceIds);
  const reviewers = stringListFromPayload(value.reviewers);
  if (
    area === undefined ||
    status === undefined ||
    completionStatus === undefined ||
    itemCount === undefined ||
    reviewedItemCount === undefined ||
    matchingItemCount === undefined ||
    differenceItemCount === undefined ||
    needsReferenceItemCount === undefined ||
    unreviewedItemCount === undefined ||
    remainingItemCount === undefined ||
    evidenceRefCount === undefined ||
    areaLevelEvidenceRefCount === undefined ||
    itemSpecificEvidenceRefCount === undefined ||
    itemSpecificEvidenceItemCount === undefined ||
    evidenceSourceIds === undefined ||
    reviewers === undefined
  ) {
    return undefined;
  }
  return {
    area,
    status,
    completionStatus,
    itemCount,
    reviewedItemCount,
    matchingItemCount,
    differenceItemCount,
    needsReferenceItemCount,
    unreviewedItemCount,
    remainingItemCount,
    evidenceRefCount,
    areaLevelEvidenceRefCount,
    itemSpecificEvidenceRefCount,
    itemSpecificEvidenceItemCount,
    evidenceSourceIds,
    reviewers,
    firstReviewedAt: stringFromPayload(value.firstReviewedAt) ?? '',
    lastReviewedAt: stringFromPayload(value.lastReviewedAt) ?? '',
  };
}

function emptyAreaCompletionCounts(): FaceAuditReviewAreaCompletionCountsView {
  return {
    not_started: 0,
    in_progress: 0,
    ready_to_lock: 0,
    has_differences: 0,
    needs_better_reference: 0,
  };
}

function areaCompletionCountsFromProgress(
  areaProgress: readonly Pick<FaceAuditReviewStatusAreaView, 'completionStatus'>[],
): FaceAuditReviewAreaCompletionCountsView {
  const counts = emptyAreaCompletionCounts();
  for (const area of areaProgress) {
    counts[area.completionStatus] += 1;
  }
  return counts;
}

function areaCompletionCountsFromPayload(
  value: unknown,
  areaProgress: readonly Pick<FaceAuditReviewStatusAreaView, 'completionStatus'>[],
): FaceAuditReviewAreaCompletionCountsView {
  if (!isRecord(value)) {
    return areaCompletionCountsFromProgress(areaProgress);
  }
  const notStarted = nonNegativeInteger(value.not_started);
  const inProgress = nonNegativeInteger(value.in_progress);
  const readyToLock = nonNegativeInteger(value.ready_to_lock);
  const hasDifferences = nonNegativeInteger(value.has_differences);
  const needsBetterReference = nonNegativeInteger(value.needs_better_reference);
  if (
    notStarted === undefined ||
    inProgress === undefined ||
    readyToLock === undefined ||
    hasDifferences === undefined ||
    needsBetterReference === undefined
  ) {
    return areaCompletionCountsFromProgress(areaProgress);
  }
  return {
    not_started: notStarted,
    in_progress: inProgress,
    ready_to_lock: readyToLock,
    has_differences: hasDifferences,
    needs_better_reference: needsBetterReference,
  };
}

function lockPreviewFromPayload(value: unknown): FaceAuditLockPreviewView | undefined {
  if (!isRecord(value) || !Array.isArray(value.areas)) {
    return undefined;
  }
  const reviewFingerprint = nonEmptyString(value.reviewFingerprint);
  const evidenceSourceCount = evidenceSourceCountFromPayload(value.evidenceSources);
  if (reviewFingerprint === undefined) {
    return undefined;
  }
  let totalReviewedItemCount = 0;
  let evidenceRefCount = 0;
  let areaLevelEvidenceRefCount = 0;
  let itemSpecificEvidenceRefCount = 0;
  let itemSpecificEvidenceItemCount = 0;
  for (const rawArea of value.areas) {
    if (!isRecord(rawArea)) {
      return undefined;
    }
    const area = faceAuditReviewAreaName(rawArea.area);
    const reviewedItemCount = nonNegativeInteger(rawArea.reviewedItemCount);
    const evidenceRefs = stringListFromPayload(rawArea.evidenceRefs);
    if (area === undefined || reviewedItemCount === undefined || evidenceRefs === undefined) {
      return undefined;
    }
    const fallbackCoverage = evidenceCoverageFromRefs(area, evidenceRefs);
    totalReviewedItemCount += reviewedItemCount;
    evidenceRefCount += nonNegativeInteger(rawArea.evidenceRefCount) ?? fallbackCoverage.evidenceRefCount;
    areaLevelEvidenceRefCount += nonNegativeInteger(rawArea.areaLevelEvidenceRefCount) ?? fallbackCoverage.areaLevelEvidenceRefCount;
    itemSpecificEvidenceRefCount += nonNegativeInteger(rawArea.itemSpecificEvidenceRefCount) ?? fallbackCoverage.itemSpecificEvidenceRefCount;
    itemSpecificEvidenceItemCount += nonNegativeInteger(rawArea.itemSpecificEvidenceItemCount) ?? fallbackCoverage.itemSpecificEvidenceItemCount;
  }
  return {
    reviewFingerprint,
    areaCount: value.areas.length,
    totalReviewedItemCount,
    evidenceRefCount,
    areaLevelEvidenceRefCount,
    itemSpecificEvidenceRefCount,
    itemSpecificEvidenceItemCount,
    evidenceSourceCount: evidenceSourceCount ?? 0,
  };
}

function lockArtifactFromPayloadValue(value: unknown): FaceAuditLockArtifactView | undefined {
  if (!isRecord(value) || !Array.isArray(value.areas)) {
    return undefined;
  }
  const checklistFingerprint = nonEmptyString(value.checklistFingerprint);
  const reviewFingerprint = nonEmptyString(value.reviewFingerprint);
  const checklistItemCount = nonNegativeInteger(value.checklistItemCount);
  const evidenceSourceCount = evidenceSourceCountFromPayload(value.evidenceSources);
  const completion = reviewCompletionFromPayload(value.completion);
  if (
    value.artifactType !== 'face_audit_lock_evidence' ||
    value.version !== 1 ||
    checklistFingerprint === undefined ||
    reviewFingerprint === undefined ||
    checklistItemCount === undefined ||
    evidenceSourceCount === undefined ||
    completion === undefined
  ) {
    return undefined;
  }
  let totalReviewedItemCount = 0;
  let evidenceRefCount = 0;
  let areaLevelEvidenceRefCount = 0;
  let itemSpecificEvidenceRefCount = 0;
  let itemSpecificEvidenceItemCount = 0;
  for (const rawArea of value.areas) {
    if (!isRecord(rawArea)) {
      return undefined;
    }
    const area = faceAuditReviewAreaName(rawArea.area);
    const reviewedItemCount = nonNegativeInteger(rawArea.reviewedItemCount);
    const evidenceRefs = stringListFromPayload(rawArea.evidenceRefs);
    if (area === undefined || reviewedItemCount === undefined || evidenceRefs === undefined) {
      return undefined;
    }
    const fallbackCoverage = evidenceCoverageFromRefs(area, evidenceRefs);
    totalReviewedItemCount += reviewedItemCount;
    evidenceRefCount += nonNegativeInteger(rawArea.evidenceRefCount) ?? fallbackCoverage.evidenceRefCount;
    areaLevelEvidenceRefCount += nonNegativeInteger(rawArea.areaLevelEvidenceRefCount) ?? fallbackCoverage.areaLevelEvidenceRefCount;
    itemSpecificEvidenceRefCount += nonNegativeInteger(rawArea.itemSpecificEvidenceRefCount) ?? fallbackCoverage.itemSpecificEvidenceRefCount;
    itemSpecificEvidenceItemCount += nonNegativeInteger(rawArea.itemSpecificEvidenceItemCount) ?? fallbackCoverage.itemSpecificEvidenceItemCount;
  }
  return {
    artifactType: 'face_audit_lock_evidence',
    checklistFingerprint,
    reviewFingerprint,
    checklistItemCount,
    completion,
    areaCount: value.areas.length,
    totalReviewedItemCount,
    evidenceRefCount,
    areaLevelEvidenceRefCount,
    itemSpecificEvidenceRefCount,
    itemSpecificEvidenceItemCount,
    evidenceSourceCount,
  };
}

function reviewTemplateFromPayload(value: unknown): FaceAuditReviewTemplateView | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const checklistFingerprint = nonEmptyString(value.checklistFingerprint);
  const checklistItemCount = nonNegativeInteger(value.checklistItemCount);
  const evidenceSourceCount = evidenceSourceCountFromPayload(value.evidenceSources);
  if (
    value.version !== 1 ||
    checklistFingerprint === undefined ||
    checklistItemCount === undefined ||
    evidenceSourceCount === undefined
  ) {
    return undefined;
  }
  return {version: 1, checklistFingerprint, checklistItemCount, evidenceSourceCount};
}

function areaReviewTemplateFromPayload(value: unknown): FaceAuditAreaReviewTemplateView | undefined {
  const template = reviewTemplateFromPayload(value);
  if (!template || !isRecord(value)) {
    return undefined;
  }
  const area = faceAuditReviewAreaName(value.area);
  const areaItemCount = nonNegativeInteger(value.areaItemCount);
  if (
    value.artifactType !== 'face_audit_area_review' ||
    area === undefined ||
    areaItemCount === undefined
  ) {
    return undefined;
  }
  return {
    ...template,
    artifactType: 'face_audit_area_review',
    area,
    areaItemCount,
  };
}

function evidenceRefTemplateItemFromPayload(value: unknown): FaceAuditEvidenceRefTemplateItemView | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const key = nonEmptyString(value.key);
  const id = nonEmptyString(value.id);
  const label = nonEmptyString(value.label);
  const evidenceRef = nonEmptyString(value.evidenceRef);
  if (key === undefined || id === undefined || label === undefined || evidenceRef === undefined) {
    return undefined;
  }
  return {key, id, label, evidenceRef};
}

export function faceAuditEvidenceRefTemplateFromPayload(payload: unknown): FaceAuditEvidenceRefTemplateView {
  const root = isRecord(payload) ? payload.faceAuditEvidenceRefTemplate : undefined;
  const source = isRecord(root) ? root : {};
  const sourceId = nonEmptyString(source.sourceId);
  const area = faceAuditReviewAreaName(source.area);
  const mode = faceAuditEvidenceRefMode(source.mode);
  const evidenceRefs = stringListFromPayload(source.evidenceRefs) ?? [];
  const items = Array.isArray(source.items)
    ? source.items
      .map(evidenceRefTemplateItemFromPayload)
      .filter((item): item is FaceAuditEvidenceRefTemplateItemView => item !== undefined)
    : [];
  return {
    artifactType: source.artifactType === 'face_audit_evidence_ref_template'
      ? 'face_audit_evidence_ref_template'
      : undefined,
    version: source.version === 1 ? 1 : undefined,
    sourceId,
    area,
    mode,
    evidenceRefCount: nonNegativeInteger(source.evidenceRefCount) ?? evidenceRefs.length,
    evidenceRefs,
    items,
  };
}

export function faceAuditReviewTemplateFromPayload(payload: unknown): FaceAuditReviewTemplateView | undefined {
  const root = isRecord(payload) ? payload.faceAuditReview : undefined;
  return reviewTemplateFromPayload(root);
}

export function faceAuditAreaReviewTemplateFromPayload(payload: unknown): FaceAuditAreaReviewTemplateView | undefined {
  const root = isRecord(payload) ? payload.faceAuditAreaReview : undefined;
  return areaReviewTemplateFromPayload(root);
}

export function faceAuditReviewTemplateFileName(): string {
  return faceAuditReviewArtifactFileName();
}

export function faceAuditAreaReviewTemplateFileName(area: FaceAuditArea): string {
  return faceAuditAreaReviewArtifactFileName(area);
}

export function faceAuditReviewTemplateDownloadLabel(template: FaceAuditReviewTemplateView): string {
  return `Face-audit review template downloaded: ${template.checklistItemCount} item(s), ` +
    `checklist ${template.checklistFingerprint}`;
}

export function faceAuditAreaReviewTemplateDownloadLabel(template: FaceAuditAreaReviewTemplateView): string {
  return `Face-audit ${template.area} review template downloaded: ${template.areaItemCount} item(s), ` +
    `checklist ${template.checklistFingerprint}`;
}

export function faceAuditMergedReviewArtifactFromPayload(payload: unknown): unknown | undefined {
  const root = isRecord(payload) ? payload.faceAuditReviewValidation : undefined;
  return isRecord(root) ? root.review : undefined;
}

export function faceAuditLockArtifactFromPayload(payload: unknown): FaceAuditLockArtifactView | undefined {
  const root = isRecord(payload) ? payload.faceAuditLockArtifact : undefined;
  return lockArtifactFromPayloadValue(root);
}

export function faceAuditReviewValidationFromPayload(payload: unknown): FaceAuditReviewValidationView {
  const root = isRecord(payload) ? payload.faceAuditReviewValidation : undefined;
  const source = isRecord(root) ? root : {};
  const review = isRecord(source.review) ? source.review : {};
  const issues = Array.isArray(source.issues)
    ? source.issues.map(reviewIssueFromPayload).filter((issue): issue is FaceAuditReviewIssueView => issue !== undefined)
    : [];
  return {
    ok: source.ok === true,
    evidenceSourceCount: evidenceSourceCountFromPayload(review.evidenceSources),
    completion: reviewCompletionFromPayload(review.completion),
    lockPreview: lockPreviewFromPayload(source.lockPreview),
    lockArtifact: lockArtifactFromPayloadValue(source.lockArtifact),
    issueCount: issues.length,
    issues,
  };
}

export function faceAuditReviewStatusFromPayload(payload: unknown): FaceAuditReviewStatusView {
  const root = isRecord(payload) ? payload.faceAuditReviewStatus : undefined;
  const source = isRecord(root) ? root : {};
  const artifactCounts = isRecord(source.artifactCounts) ? source.artifactCounts : {};
  const issues = Array.isArray(source.issues)
    ? source.issues.map(reviewIssueFromPayload).filter((issue): issue is FaceAuditReviewIssueView => issue !== undefined)
    : [];
  const areaProgress = Array.isArray(source.areaProgress)
    ? source.areaProgress
      .map(reviewStatusAreaFromPayload)
      .filter((area): area is FaceAuditReviewStatusAreaView => area !== undefined)
    : [];
  const fallbackUsedEvidenceSourceIds = uniqueSortedStrings(areaProgress.flatMap((area) => area.evidenceSourceIds));
  const usedEvidenceSourceIds = stringListFromPayload(source.usedEvidenceSourceIds) ?? fallbackUsedEvidenceSourceIds;
  const unusedEvidenceSourceIds = stringListFromPayload(source.unusedEvidenceSourceIds) ?? [];
  const areaCompletionCounts = areaCompletionCountsFromPayload(source.areaCompletionCounts, areaProgress);
  return {
    artifactType: source.artifactType === 'face_audit_review_status' ? 'face_audit_review_status' : undefined,
    version: source.version === 1 ? 1 : undefined,
    ok: source.ok === true,
    artifactCount: nonNegativeInteger(source.artifactCount) ?? 0,
    fullReviewArtifactCount: nonNegativeInteger(artifactCounts.fullReviewArtifactCount) ?? 0,
    areaReviewArtifactCount: nonNegativeInteger(artifactCounts.areaReviewArtifactCount) ?? 0,
    unknownArtifactCount: nonNegativeInteger(artifactCounts.unknownArtifactCount) ?? 0,
    checklistFingerprint: nonEmptyString(source.checklistFingerprint),
    reviewFingerprint: nonEmptyString(source.reviewFingerprint),
    checklistItemCount: nonNegativeInteger(source.checklistItemCount),
    evidenceSourceCount: nonNegativeInteger(source.evidenceSourceCount),
    usedEvidenceSourceCount: nonNegativeInteger(source.usedEvidenceSourceCount) ?? usedEvidenceSourceIds.length,
    usedEvidenceSourceIds,
    unusedEvidenceSourceCount: nonNegativeInteger(source.unusedEvidenceSourceCount) ?? unusedEvidenceSourceIds.length,
    unusedEvidenceSourceIds,
    completion: reviewCompletionFromPayload(source.completion),
    areaCompletionCounts,
    areaProgress,
    issueCount: issues.length,
    issues,
  };
}

export function faceAuditReviewTodoFromPayload(payload: unknown): FaceAuditReviewTodoView {
  const root = isRecord(payload) ? payload.faceAuditReviewTodo : undefined;
  const source = isRecord(root) ? root : {};
  const issues = Array.isArray(source.issues)
    ? source.issues.map(reviewIssueFromPayload).filter((issue): issue is FaceAuditReviewIssueView => issue !== undefined)
    : [];
  const areas = Array.isArray(source.areas)
    ? source.areas
      .map(reviewTodoAreaFromPayload)
      .filter((area): area is FaceAuditReviewTodoAreaView => area !== undefined)
    : [];
  const commands = reviewTodoCommandsFromPayload(source.commands);
  return {
    artifactType: source.artifactType === 'face_audit_review_todo' ? 'face_audit_review_todo' : undefined,
    version: source.version === 1 ? 1 : undefined,
    ok: source.ok === true,
    artifactCount: nonNegativeInteger(source.artifactCount) ?? 0,
    checklistFingerprint: nonEmptyString(source.checklistFingerprint),
    reviewFingerprint: nonEmptyString(source.reviewFingerprint),
    checklistItemCount: nonNegativeInteger(source.checklistItemCount),
    completion: reviewCompletionFromPayload(source.completion),
    pendingAreaCount: nonNegativeInteger(source.pendingAreaCount) ?? areas.length,
    readyAreaCount: nonNegativeInteger(source.readyAreaCount) ?? 0,
    issueCount: issues.length,
    ...(commands === undefined ? {} : {commands}),
    areas,
    issues,
  };
}

export function faceAuditReviewTodoSummaryFromPayload(payload: unknown): FaceAuditReviewTodoSummaryView {
  const root = isRecord(payload) ? payload.faceAuditReviewTodoSummary : undefined;
  const source = isRecord(root) ? root : {};
  const issues = Array.isArray(source.issues)
    ? source.issues.map(reviewIssueFromPayload).filter((issue): issue is FaceAuditReviewIssueView => issue !== undefined)
    : [];
  const unfinishedAreas = Array.isArray(source.unfinishedAreas)
    ? source.unfinishedAreas
      .map(reviewTodoSummaryAreaFromPayload)
      .filter((area): area is FaceAuditReviewTodoSummaryAreaView => area !== undefined)
    : [];
  const fallbackPendingItemCount = unfinishedAreas.reduce((total, area) => total + area.remainingItemCount, 0);
  return {
    artifactType: source.artifactType === 'face_audit_review_todo_summary' ? 'face_audit_review_todo_summary' : undefined,
    version: source.version === 1 ? 1 : undefined,
    ok: source.ok === true,
    artifactCount: nonNegativeInteger(source.artifactCount) ?? 0,
    checklistFingerprint: nonEmptyString(source.checklistFingerprint),
    reviewFingerprint: nonEmptyString(source.reviewFingerprint),
    checklistItemCount: nonNegativeInteger(source.checklistItemCount),
    completion: reviewCompletionFromPayload(source.completion),
    pendingAreaCount: nonNegativeInteger(source.pendingAreaCount) ?? unfinishedAreas.length,
    readyAreaCount: nonNegativeInteger(source.readyAreaCount) ?? 0,
    pendingItemCount: nonNegativeInteger(source.pendingItemCount) ?? fallbackPendingItemCount,
    unfinishedAreas,
    issueCount: issues.length,
    issues,
  };
}

export function faceAuditAreaReviewTodoSummaryFromPayload(payload: unknown): FaceAuditAreaReviewTodoSummaryView {
  const root = isRecord(payload) ? payload.faceAuditAreaReviewTodoSummary : undefined;
  const source = isRecord(root) ? root : {};
  const issues = Array.isArray(source.issues)
    ? source.issues.map(reviewIssueFromPayload).filter((issue): issue is FaceAuditReviewIssueView => issue !== undefined)
    : [];
  const evidenceSourceIds = stringListFromPayload(source.evidenceSourceIds) ?? [];
  return {
    artifactType: source.artifactType === 'face_audit_area_review_todo_summary'
      ? 'face_audit_area_review_todo_summary'
      : undefined,
    version: source.version === 1 ? 1 : undefined,
    ok: source.ok === true,
    artifactCount: nonNegativeInteger(source.artifactCount) ?? 0,
    area: faceAuditReviewAreaName(source.area),
    status: faceAuditStaticDataAuditStatus(source.status),
    checklistFingerprint: nonEmptyString(source.checklistFingerprint),
    reviewFingerprint: nonEmptyString(source.reviewFingerprint),
    checklistItemCount: nonNegativeInteger(source.checklistItemCount),
    itemCount: nonNegativeInteger(source.itemCount) ?? 0,
    completionStatus: reviewCompletionStatus(source.completionStatus),
    nextStep: faceAuditAreaReviewTodoSummaryNextStep(source.nextStep),
    pendingItemCount: nonNegativeInteger(source.pendingItemCount) ?? 0,
    remainingItemCount: nonNegativeInteger(source.remainingItemCount) ?? 0,
    reviewedItemCount: nonNegativeInteger(source.reviewedItemCount) ?? 0,
    matchingItemCount: nonNegativeInteger(source.matchingItemCount) ?? 0,
    differenceItemCount: nonNegativeInteger(source.differenceItemCount) ?? 0,
    needsReferenceItemCount: nonNegativeInteger(source.needsReferenceItemCount) ?? 0,
    unreviewedItemCount: nonNegativeInteger(source.unreviewedItemCount) ?? 0,
    evidenceRefCount: nonNegativeInteger(source.evidenceRefCount) ?? 0,
    areaLevelEvidenceRefCount: nonNegativeInteger(source.areaLevelEvidenceRefCount) ?? 0,
    itemSpecificEvidenceRefCount: nonNegativeInteger(source.itemSpecificEvidenceRefCount) ?? 0,
    itemSpecificEvidenceItemCount: nonNegativeInteger(source.itemSpecificEvidenceItemCount) ?? 0,
    evidenceSourceIds,
    issueCount: issues.length,
    issues,
  };
}

export function faceAuditReviewPlanFromPayload(payload: unknown): FaceAuditReviewPlanView {
  const root = isRecord(payload) ? payload.faceAuditReviewPlan : undefined;
  const source = isRecord(root) ? root : {};
  const issues = Array.isArray(source.issues)
    ? source.issues.map(reviewIssueFromPayload).filter((issue): issue is FaceAuditReviewIssueView => issue !== undefined)
    : [];
  const areas = Array.isArray(source.areas)
    ? source.areas
      .map(reviewPlanAreaFromPayload)
      .filter((area): area is FaceAuditReviewPlanAreaView => area !== undefined)
    : [];
  const commands = reviewTodoCommandsFromPayload(source.commands);
  const fallbackPendingItemCount = areas.reduce((total, area) => total + area.items.length, 0);
  return {
    artifactType: source.artifactType === 'face_audit_review_plan' ? 'face_audit_review_plan' : undefined,
    version: source.version === 1 ? 1 : undefined,
    ok: source.ok === true,
    artifactCount: nonNegativeInteger(source.artifactCount) ?? 0,
    checklistFingerprint: nonEmptyString(source.checklistFingerprint),
    reviewFingerprint: nonEmptyString(source.reviewFingerprint),
    checklistItemCount: nonNegativeInteger(source.checklistItemCount),
    completion: reviewCompletionFromPayload(source.completion),
    pendingAreaCount: nonNegativeInteger(source.pendingAreaCount) ?? areas.length,
    readyAreaCount: nonNegativeInteger(source.readyAreaCount) ?? 0,
    pendingItemCount: nonNegativeInteger(source.pendingItemCount) ?? fallbackPendingItemCount,
    issueCount: issues.length,
    ...(commands === undefined ? {} : {commands}),
    areas,
    issues,
  };
}

export function faceAuditReviewerHandoffFromPayload(payload: unknown): FaceAuditReviewerHandoffView {
  const root = isRecord(payload) ? payload.faceAuditReviewerHandoff : undefined;
  const source = isRecord(root) ? root : {};
  const issues = Array.isArray(source.issues)
    ? source.issues.map(reviewIssueFromPayload).filter((issue): issue is FaceAuditReviewIssueView => issue !== undefined)
    : [];
  const areas = Array.isArray(source.areas)
    ? source.areas
      .map(reviewerHandoffAreaFromPayload)
      .filter((area): area is FaceAuditReviewerHandoffAreaView => area !== undefined)
    : [];
  const todo = faceAuditReviewTodoFromPayload({faceAuditReviewTodo: source.todo});
  return {
    artifactType: source.artifactType === 'face_audit_reviewer_handoff' ? 'face_audit_reviewer_handoff' : undefined,
    version: source.version === 1 ? 1 : undefined,
    ok: source.ok === true,
    artifactCount: nonNegativeInteger(source.artifactCount) ?? 0,
    checklistFingerprint: nonEmptyString(source.checklistFingerprint),
    reviewFingerprint: nonEmptyString(source.reviewFingerprint),
    checklistItemCount: nonNegativeInteger(source.checklistItemCount),
    evidenceSourceCount: nonNegativeInteger(source.evidenceSourceCount),
    completion: reviewCompletionFromPayload(source.completion),
    pendingAreaCount: nonNegativeInteger(source.pendingAreaCount) ?? areas.length,
    readyAreaCount: nonNegativeInteger(source.readyAreaCount) ?? 0,
    issueCount: issues.length,
    todo,
    areas,
    issues,
  };
}

export function faceAuditReviewerHandoffValidationFromPayload(payload: unknown): FaceAuditReviewerHandoffValidationView {
  const root = isRecord(payload) ? payload.faceAuditReviewerHandoffValidation : undefined;
  const source = isRecord(root) ? root : {};
  const issues = Array.isArray(source.issues)
    ? source.issues.map(reviewIssueFromPayload).filter((issue): issue is FaceAuditReviewIssueView => issue !== undefined)
    : [];
  return {
    ok: source.ok === true,
    handoff: isRecord(source.handoff)
      ? faceAuditReviewerHandoffFromPayload({faceAuditReviewerHandoff: source.handoff})
      : undefined,
    issueCount: issues.length,
    issues,
  };
}

export function faceAuditReviewerHandoffResponseFromPayload(payload: unknown): FaceAuditReviewerHandoffResponseView {
  const root = isRecord(payload) ? payload.faceAuditReviewerHandoffResponse : undefined;
  const source = isRecord(root) ? root : {};
  const issues = Array.isArray(source.issues)
    ? source.issues.map(reviewIssueFromPayload).filter((issue): issue is FaceAuditReviewIssueView => issue !== undefined)
    : [];
  const areas = Array.isArray(source.areas)
    ? source.areas
      .map(reviewerHandoffResponseAreaFromPayload)
      .filter((area): area is FaceAuditReviewerHandoffResponseAreaView => area !== undefined)
    : [];
  return {
    artifactType: source.artifactType === 'face_audit_reviewer_handoff_response'
      ? 'face_audit_reviewer_handoff_response'
      : undefined,
    version: source.version === 1 ? 1 : undefined,
    ok: source.ok === true,
    checklistFingerprint: nonEmptyString(source.checklistFingerprint),
    handoffReviewFingerprint: nonEmptyString(source.handoffReviewFingerprint),
    handoffPendingAreaCount: nonNegativeInteger(source.handoffPendingAreaCount) ?? 0,
    responseArtifactCount: nonNegativeInteger(source.responseArtifactCount) ?? 0,
    acceptedAreaCount: nonNegativeInteger(source.acceptedAreaCount) ?? areas.length,
    readyAreaCount: nonNegativeInteger(source.readyAreaCount) ?? 0,
    unfinishedReturnedAreaCount: nonNegativeInteger(source.unfinishedReturnedAreaCount) ?? 0,
    missingAreaCount: nonNegativeInteger(source.missingAreaCount) ?? 0,
    remainingAreaCount: nonNegativeInteger(source.remainingAreaCount) ?? 0,
    areas,
    issueCount: issues.length,
    issues,
  };
}

export function faceAuditLockArtifactValidationFromPayload(payload: unknown): FaceAuditLockArtifactValidationView {
  const root = isRecord(payload) ? payload.faceAuditLockArtifactValidation : undefined;
  const source = isRecord(root) ? root : {};
  const issues = Array.isArray(source.issues)
    ? source.issues.map(reviewIssueFromPayload).filter((issue): issue is FaceAuditReviewIssueView => issue !== undefined)
    : [];
  return {
    ok: source.ok === true,
    lockArtifact: lockArtifactFromPayloadValue(source.lockArtifact),
    issueCount: issues.length,
    issues,
  };
}

export function faceAuditStaticLockGateFromPayload(payload: unknown): FaceAuditStaticLockGateView {
  const root = isRecord(payload) ? payload.faceAuditStaticLockGate : undefined;
  const source = isRecord(root) ? root : {};
  const issues = Array.isArray(source.issues)
    ? source.issues.map(reviewIssueFromPayload).filter((issue): issue is FaceAuditReviewIssueView => issue !== undefined)
    : [];
  return {
    ok: source.ok === true,
    pendingAreaCount: nonNegativeInteger(source.pendingAreaCount) ?? 0,
    lockedAreaCount: nonNegativeInteger(source.lockedAreaCount) ?? 0,
    lockArtifactValidation: isRecord(source.lockArtifactValidation)
      ? faceAuditLockArtifactValidationFromPayload({faceAuditLockArtifactValidation: source.lockArtifactValidation})
      : undefined,
    issueCount: issues.length,
    issues,
  };
}

export function faceAuditReviewCompletionLabel(completion: FaceAuditReviewCompletionView | undefined): string {
  if (completion === undefined) {
    return 'No review summary available';
  }
  return `${completion.status}: ${completion.reviewedItemCount} / ${completion.totalItemCount} reviewed, ` +
    `${completion.matchingItemCount} matched, ${completion.differenceItemCount} differences, ` +
    `${completion.needsReferenceItemCount} need better reference`;
}

export function faceAuditReviewIssueLabel(issue: FaceAuditReviewIssueView): string {
  return issue.itemKey === undefined
    ? `${issue.field}: ${issue.message}`
    : `${issue.itemKey} ${issue.field}: ${issue.message}`;
}

export function faceAuditReviewValidationLabel(validation: FaceAuditReviewValidationView): string {
  const sourceLabel = validation.evidenceSourceCount === undefined
    ? ''
    : `, ${validation.evidenceSourceCount} evidence source(s)`;
  return validation.ok
    ? `Review artifact is valid. ${faceAuditReviewCompletionLabel(validation.completion)}${sourceLabel}`
    : `Review artifact has ${validation.issueCount} issue(s). ${faceAuditReviewCompletionLabel(validation.completion)}${sourceLabel}`;
}

export function faceAuditReviewStatusLabel(status: FaceAuditReviewStatusView): string {
  const sourceLabel = status.evidenceSourceCount === undefined
    ? ''
    : `, ${status.usedEvidenceSourceCount} used / ${status.evidenceSourceCount} declared evidence source(s)`;
  const fingerprintLabel = status.reviewFingerprint === undefined ? '' : `, review ${status.reviewFingerprint}`;
  const areaLabel = `, areas ${faceAuditAreaCompletionCountsLabel(status.areaCompletionCounts)}`;
  const unusedSourceLabel = status.unusedEvidenceSourceIds.length === 0
    ? ''
    : `, unused sources ${status.unusedEvidenceSourceIds.join(', ')}`;
  const artifactLabel = `${status.artifactCount} artifact(s): ` +
    `${status.fullReviewArtifactCount} full, ${status.areaReviewArtifactCount} area, ${status.unknownArtifactCount} unknown`;
  return status.ok
    ? `Review status is valid for ${artifactLabel}. ${faceAuditReviewCompletionLabel(status.completion)}${sourceLabel}${fingerprintLabel}${areaLabel}${unusedSourceLabel}`
    : `Review status has ${status.issueCount} issue(s) for ${artifactLabel}. ${faceAuditReviewCompletionLabel(status.completion)}${sourceLabel}${fingerprintLabel}${areaLabel}${unusedSourceLabel}`;
}

export function faceAuditReviewTodoLabel(todo: FaceAuditReviewTodoView): string {
  const fingerprintLabel = todo.reviewFingerprint === undefined ? '' : `, review ${todo.reviewFingerprint}`;
  const artifactLabel = `${todo.artifactCount} artifact(s)`;
  return todo.ok
    ? `Review todo is valid for ${artifactLabel}. ${faceAuditReviewCompletionLabel(todo.completion)}, ` +
      `${todo.pendingAreaCount} unfinished area(s), ${todo.readyAreaCount} ready area(s)${fingerprintLabel}`
    : `Review todo has ${todo.issueCount} issue(s) for ${artifactLabel}. ${faceAuditReviewCompletionLabel(todo.completion)}, ` +
      `${todo.pendingAreaCount} unfinished area(s), ${todo.readyAreaCount} ready area(s)${fingerprintLabel}`;
}

export function faceAuditReviewTodoSummaryLabel(summary: FaceAuditReviewTodoSummaryView): string {
  const fingerprintLabel = summary.reviewFingerprint === undefined ? '' : `, review ${summary.reviewFingerprint}`;
  const artifactLabel = `${summary.artifactCount} artifact(s)`;
  return summary.ok
    ? `Review todo summary is valid for ${artifactLabel}. ${faceAuditReviewCompletionLabel(summary.completion)}, ` +
      `${summary.pendingAreaCount} unfinished area(s), ${summary.pendingItemCount} item(s), ` +
      `${summary.readyAreaCount} ready area(s)${fingerprintLabel}`
    : `Review todo summary has ${summary.issueCount} issue(s) for ${artifactLabel}. ${faceAuditReviewCompletionLabel(summary.completion)}, ` +
      `${summary.pendingAreaCount} unfinished area(s), ${summary.pendingItemCount} item(s), ` +
      `${summary.readyAreaCount} ready area(s)${fingerprintLabel}`;
}

export function faceAuditAreaReviewTodoSummaryLabel(summary: FaceAuditAreaReviewTodoSummaryView): string {
  const areaLabel = summary.area ?? 'unknown area';
  const statusLabel = summary.completionStatus ?? 'unknown';
  const nextStepLabel = summary.nextStep ?? 'unknown next step';
  const fingerprintLabel = summary.reviewFingerprint === undefined ? '' : `, review ${summary.reviewFingerprint}`;
  const detailLabel = `${statusLabel}: ${summary.remainingItemCount} remaining, ` +
    `${summary.reviewedItemCount} / ${summary.itemCount} reviewed, ` +
    `${summary.evidenceRefCount} evidence ref(s), next ${nextStepLabel}`;
  return summary.ok
    ? `Area todo summary is valid for ${areaLabel}. ${detailLabel}${fingerprintLabel}`
    : `Area todo summary has ${summary.issueCount} issue(s) for ${areaLabel}. ${detailLabel}${fingerprintLabel}`;
}

export function faceAuditReviewPlanLabel(plan: FaceAuditReviewPlanView): string {
  const fingerprintLabel = plan.reviewFingerprint === undefined ? '' : `, review ${plan.reviewFingerprint}`;
  const artifactLabel = `${plan.artifactCount} artifact(s)`;
  return plan.ok
    ? `Review plan is valid for ${artifactLabel}. ${faceAuditReviewCompletionLabel(plan.completion)}, ` +
      `${plan.pendingAreaCount} unfinished area(s), ${plan.pendingItemCount} item(s), ` +
      `${plan.readyAreaCount} ready area(s)${fingerprintLabel}`
    : `Review plan has ${plan.issueCount} issue(s) for ${artifactLabel}. ${faceAuditReviewCompletionLabel(plan.completion)}, ` +
      `${plan.pendingAreaCount} unfinished area(s), ${plan.pendingItemCount} item(s), ` +
      `${plan.readyAreaCount} ready area(s)${fingerprintLabel}`;
}

export function faceAuditReviewPlanAreaLabel(area: FaceAuditReviewPlanAreaView): string {
  return `${area.area}: ${area.items.length} item(s) to assign; ${faceAuditReviewTodoAreaLabel(area)}`;
}

export function faceAuditReviewTodoAreaLabel(area: FaceAuditReviewTodoAreaView): string {
  return `${area.area}: ${area.nextStep}; ${area.remainingItemCount} remaining, ` +
    `${area.reviewedItemCount} / ${area.itemCount} reviewed, ${area.evidenceRefCount} evidence ref(s)`;
}

export function faceAuditReviewerHandoffLabel(handoff: FaceAuditReviewerHandoffView): string {
  const fingerprintLabel = handoff.reviewFingerprint === undefined ? '' : `, review ${handoff.reviewFingerprint}`;
  const sourceLabel = handoff.evidenceSourceCount === undefined
    ? ''
    : `, ${handoff.evidenceSourceCount} evidence source(s)`;
  const artifactLabel = `${handoff.artifactCount} artifact(s)`;
  return handoff.ok
    ? `Reviewer handoff is valid for ${artifactLabel}. ${faceAuditReviewCompletionLabel(handoff.completion)}, ` +
      `${handoff.pendingAreaCount} unfinished area(s), ${handoff.readyAreaCount} ready area(s)${sourceLabel}${fingerprintLabel}`
    : `Reviewer handoff has ${handoff.issueCount} issue(s) for ${artifactLabel}. ${faceAuditReviewCompletionLabel(handoff.completion)}, ` +
      `${handoff.pendingAreaCount} unfinished area(s), ${handoff.readyAreaCount} ready area(s)${sourceLabel}${fingerprintLabel}`;
}

export function faceAuditReviewerHandoffValidationLabel(validation: FaceAuditReviewerHandoffValidationView): string {
  return validation.ok && validation.handoff
    ? `Reviewer handoff is valid. ${faceAuditReviewerHandoffLabel(validation.handoff)}`
    : `Reviewer handoff has ${validation.issueCount} issue(s).`;
}

export function faceAuditReviewerHandoffResponseLabel(response: FaceAuditReviewerHandoffResponseView): string {
  const fingerprintLabel = response.handoffReviewFingerprint === undefined
    ? ''
    : `, review ${response.handoffReviewFingerprint}`;
  const returnedLabel = `${response.acceptedAreaCount} / ${response.handoffPendingAreaCount} returned area(s)`;
  const progressLabel = `${response.readyAreaCount} ready, ` +
    `${response.unfinishedReturnedAreaCount} unfinished returned, ${response.missingAreaCount} missing, ` +
    `${response.remainingAreaCount} remaining`;
  return response.ok
    ? `Reviewer handoff response is valid for ${response.responseArtifactCount} artifact(s). ${returnedLabel}; ${progressLabel}${fingerprintLabel}`
    : `Reviewer handoff response has ${response.issueCount} issue(s) for ${response.responseArtifactCount} artifact(s). ${returnedLabel}; ${progressLabel}${fingerprintLabel}`;
}

export function faceAuditEvidenceCoverageLabel(area: FaceAuditReviewStatusAreaView): string {
  return `${area.evidenceRefCount} evidence ref(s): ${area.areaLevelEvidenceRefCount} area-level, ` +
    `${area.itemSpecificEvidenceRefCount} item-specific covering ${area.itemSpecificEvidenceItemCount} item(s)`;
}

function faceAuditLockEvidenceCoverageLabel(
  coverage: Pick<
    FaceAuditLockPreviewView,
    'evidenceRefCount' | 'areaLevelEvidenceRefCount' | 'itemSpecificEvidenceRefCount' | 'itemSpecificEvidenceItemCount'
  >,
): string {
  return `${coverage.evidenceRefCount} evidence ref(s), ${coverage.areaLevelEvidenceRefCount} area-level, ` +
    `${coverage.itemSpecificEvidenceRefCount} item-specific covering ${coverage.itemSpecificEvidenceItemCount} item(s)`;
}

export function faceAuditAreaCompletionCountsLabel(counts: FaceAuditReviewAreaCompletionCountsView): string {
  return `${counts.ready_to_lock} ready, ${counts.in_progress} in progress, ` +
    `${counts.not_started} not started, ${counts.has_differences} with differences, ` +
    `${counts.needs_better_reference} need better reference`;
}

export function faceAuditEvidenceRefTemplateLabel(template: FaceAuditEvidenceRefTemplateView): string {
  const areaLabel = template.area === undefined ? 'unknown area' : template.area;
  const sourceLabel = template.sourceId === undefined ? 'unknown source' : template.sourceId;
  const modeLabel = template.mode === undefined ? 'unknown mode' : template.mode;
  return `${template.evidenceRefCount} evidence ref(s) for ${areaLabel} from ${sourceLabel} (${modeLabel})`;
}

export function faceAuditEvidenceRefTemplateFileName(template: FaceAuditEvidenceRefTemplateView): string {
  const area = template.area ?? 'unknown';
  const mode = template.mode ?? 'unknown';
  return area === 'unknown' || mode === 'unknown'
    ? 'face-audit-evidence-refs.json'
    : faceAuditEvidenceRefTemplateArtifactFileName(area, mode);
}

export function faceAuditEvidenceRefTemplateDownloadLabel(template: FaceAuditEvidenceRefTemplateView): string {
  return `Face-audit evidence refs downloaded: ${faceAuditEvidenceRefTemplateLabel(template)}`;
}

export function faceAuditEvidenceSourceTemplateLabel(template: FaceAuditEvidenceSourceTemplateView): string {
  return `${template.sourceCount} ${template.sourceType} evidence source(s)`;
}

export function faceAuditEvidenceSourceTemplateFileName(): string {
  return faceAuditEvidenceSourceTemplateArtifactFileName();
}

export function faceAuditEvidenceSourceTemplateDownloadLabel(template: FaceAuditEvidenceSourceTemplateView): string {
  return `Face-audit evidence sources downloaded: ${faceAuditEvidenceSourceTemplateLabel(template)}`;
}

export function faceAuditEvidenceSourceLabel(source: FaceAuditEvidenceSourceView): string {
  const locatorLabel = source.locator === undefined ? '' : `, ${source.locator}`;
  const hashLabel = source.contentHash === undefined
    ? ''
    : `, ${source.contentHash.slice(0, source.contentHash.indexOf(':'))}`;
  return `${source.id}: ${source.label} (${source.sourceType}${locatorLabel}${hashLabel})`;
}

export function faceAuditEvidenceSourcesFromPayload(payload: unknown): FaceAuditEvidenceSourceView[] | undefined {
  const root = isRecord(payload) && isRecord(payload.faceAuditEvidenceSourceTemplate)
    ? payload.faceAuditEvidenceSourceTemplate
    : payload;
  if (!isRecord(root) || !Array.isArray(root.evidenceSources)) {
    return undefined;
  }
  const usedIds = new Set<string>();
  const evidenceSources: FaceAuditEvidenceSourceView[] = [];
  for (const source of root.evidenceSources) {
    const evidenceSource = evidenceSourceFromPayload(source, usedIds);
    if (evidenceSource === undefined) {
      return undefined;
    }
    evidenceSources.push(evidenceSource);
  }
  return evidenceSources;
}

export function faceAuditEvidenceSourceFromPayload(
  payload: unknown,
  preferredSourceId?: string,
): FaceAuditEvidenceSourceView | undefined {
  const evidenceSources = faceAuditEvidenceSourcesFromPayload(payload);
  if (evidenceSources === undefined || evidenceSources.length === 0) {
    return undefined;
  }
  const sourceId = nonEmptyString(preferredSourceId);
  return evidenceSources.find((source) => source.id === sourceId) ?? evidenceSources[0];
}

export function faceAuditSourceIdsByAreaPayload(
  sourceIdsByArea: FaceAuditSourceIdsByAreaView,
  fallbackSourceId: string,
): Record<FaceAuditArea, string> | undefined {
  const fallback = nonEmptyString(fallbackSourceId);
  if (fallback === undefined) {
    return undefined;
  }
  const payload = {} as Record<FaceAuditArea, string>;
  for (const area of FACE_AUDIT_AREAS) {
    payload[area] = nonEmptyString(sourceIdsByArea[area]) ?? fallback;
  }
  return payload;
}

export function faceAuditSourceIdsByAreaFromPayload(payload: unknown): Record<FaceAuditArea, string> | undefined {
  const root = isRecord(payload) && isRecord(payload.faceAuditSourceIdsByArea)
    ? payload.faceAuditSourceIdsByArea
    : payload;
  if (!isRecord(root)) {
    return undefined;
  }
  const sourceIdsByArea = {} as Record<FaceAuditArea, string>;
  for (const area of FACE_AUDIT_AREAS) {
    const sourceId = nonEmptyString(root[area]);
    if (sourceId === undefined) {
      return undefined;
    }
    sourceIdsByArea[area] = sourceId;
  }
  return sourceIdsByArea;
}

export function faceAuditEvidenceSourceTemplateFromPayload(
  payload: unknown,
): FaceAuditEvidenceSourceTemplateView | undefined {
  const root = isRecord(payload) && isRecord(payload.faceAuditEvidenceSourceTemplate)
    ? payload.faceAuditEvidenceSourceTemplate
    : payload;
  if (!isRecord(root) || root.artifactType !== 'face_audit_evidence_source_template' || root.version !== 1) {
    return undefined;
  }
  const sourceType = evidenceSourceTypeFromPayload(root.sourceType);
  const sourceCount = nonNegativeInteger(root.sourceCount);
  const evidenceSources = faceAuditEvidenceSourcesFromPayload(root);
  if (
    sourceType === undefined ||
    sourceCount === undefined ||
    evidenceSources === undefined ||
    evidenceSources.length !== sourceCount ||
    evidenceSources.some((source) =>
      source.sourceType !== sourceType ||
      source.locator === undefined ||
      source.contentHash === undefined)
  ) {
    return undefined;
  }
  return {
    artifactType: 'face_audit_evidence_source_template',
    version: 1,
    sourceType,
    sourceCount,
    evidenceSources: evidenceSources.map((source) => ({
      ...source,
      locator: source.locator!,
      contentHash: source.contentHash!,
    })),
  };
}

export function buildFaceAuditEvidenceSourceTemplateArtifact(
  sourceType: FaceAuditEvidenceSourceType,
  files: readonly FaceAuditEvidenceSourceTemplateFileView[],
): FaceAuditEvidenceSourceTemplateResult {
  if (!evidenceSourceTypeSet.has(sourceType)) {
    return {ok: false, error: 'Evidence source type must be official_physical_component or official_high_res_component_image'};
  }
  if (files.length === 0) {
    return {ok: false, error: 'Select at least one official component evidence file'};
  }

  const usedIds = new Set<string>();
  const evidenceSources = [];
  for (const [index, file] of files.entries()) {
    const locator = file.locator.trim();
    const contentHash = file.contentHash.trim().toLowerCase();
    const label = file.label?.trim() || fileNameFromLocator(locator);
    if (!locator) {
      return {ok: false, error: `Evidence file ${index + 1} must include a locator`};
    }
    if (!validEvidenceSourceContentHash(contentHash)) {
      return {
        ok: false,
        error: `Evidence file ${index + 1} content hash must use sha256:<64 hex>, sha1:<40 hex>, or md5:<32 hex>`,
      };
    }
    evidenceSources.push({
      id: sourceIdFromLocator(locator, usedIds),
      label,
      sourceType,
      citation: `Official Brass: Birmingham component evidence: ${locator}`,
      locator,
      contentHash,
      notes: '',
    });
  }

  return {
    ok: true,
    artifact: {
      artifactType: 'face_audit_evidence_source_template',
      version: 1,
      sourceType,
      sourceCount: evidenceSources.length,
      evidenceSources,
    },
  };
}

export function faceAuditEvidenceRefTemplatePath(): string {
  return '/api/face-audit-evidence-ref-template';
}

export function faceAuditSourceIdsByAreaTemplatePath(): string {
  return '/api/face-audit-source-ids-by-area-template';
}

export function faceAuditSourceIdsByAreaFileName(): string {
  return faceAuditSourceIdsByAreaArtifactFileName();
}

export function faceAuditSourceIdsByAreaDownloadLabel(sourceIdsByArea: Record<FaceAuditArea, string>): string {
  const mappedAreaCount = FACE_AUDIT_AREAS.filter((area) =>
    nonEmptyString(sourceIdsByArea[area]) !== undefined).length;
  const sourceIdCount = new Set(FACE_AUDIT_AREAS
    .map((area) => nonEmptyString(sourceIdsByArea[area]))
    .filter((sourceId): sourceId is string => sourceId !== undefined)).size;
  return `Face-audit source ids by area downloaded: ${mappedAreaCount} area(s), ${sourceIdCount} source id(s)`;
}

export function faceAuditReviewSubmissionPath(type: FaceAuditReviewSubmissionType): string {
  return `/api/face-audit-review-template/${type}`;
}

export function faceAuditReviewMatchPath(area?: FaceAuditArea): string {
  return area === undefined
    ? '/api/face-audit-review-template/match'
    : `/api/face-audit-review-template/${area}/match`;
}

export function faceAuditAreaReviewTemplatePath(area: FaceAuditArea): string {
  return `/api/face-audit-review-template/${area}`;
}

export function faceAuditReviewMergePath(): string {
  return '/api/face-audit-review-template/merge';
}

export function faceAuditReviewStatusPath(): string {
  return '/api/face-audit-review-template/status';
}

export function faceAuditReviewTodoPath(): string {
  return '/api/face-audit-review-template/todo';
}

export function faceAuditReviewTodoFileName(): string {
  return faceAuditReviewTodoArtifactFileName();
}

export function faceAuditReviewTodoDownloadLabel(todo: FaceAuditReviewTodoView): string {
  const reviewFingerprint = todo.reviewFingerprint ?? 'unknown review';
  const pendingItemCount = todo.areas.reduce((total, area) => total + area.remainingItemCount, 0);
  return `Face-audit review todo downloaded: ${todo.pendingAreaCount} unfinished area(s), ` +
    `${pendingItemCount} pending item(s), ${todo.readyAreaCount} ready area(s), review ${reviewFingerprint}`;
}

export function faceAuditReviewTodoSummaryPath(): string {
  return '/api/face-audit-review-template/todo-summary';
}

export function faceAuditReviewTodoSummaryFileName(): string {
  return faceAuditReviewTodoSummaryArtifactFileName();
}

export function faceAuditReviewTodoSummaryDownloadLabel(summary: FaceAuditReviewTodoSummaryView): string {
  const reviewFingerprint = summary.reviewFingerprint ?? 'unknown review';
  return `Face-audit review todo summary downloaded: ${summary.pendingAreaCount} unfinished area(s), ` +
    `${summary.pendingItemCount} pending item(s), ${summary.readyAreaCount} ready area(s), review ${reviewFingerprint}`;
}

export function faceAuditAreaReviewTodoSummaryPath(area: FaceAuditArea): string {
  return `/api/face-audit-review-template/${area}/todo-summary`;
}

export function faceAuditAreaReviewTodoSummaryFileName(area: FaceAuditArea): string {
  return faceAuditAreaReviewTodoSummaryArtifactFileName(area);
}

export function faceAuditAreaReviewTodoSummaryDownloadLabel(summary: FaceAuditAreaReviewTodoSummaryView): string {
  const area = summary.area ?? 'unknown area';
  const reviewFingerprint = summary.reviewFingerprint ?? 'unknown review';
  return `Face-audit area todo summary downloaded: ${area}, ${summary.remainingItemCount} remaining item(s), ` +
    `${summary.evidenceRefCount} evidence ref(s), review ${reviewFingerprint}`;
}

export function faceAuditReviewPlanPath(): string {
  return '/api/face-audit-review-template/review-plan';
}

export function faceAuditReviewPlanFileName(): string {
  return faceAuditReviewPlanArtifactFileName();
}

export function faceAuditReviewPlanDownloadLabel(plan: FaceAuditReviewPlanView): string {
  const reviewFingerprint = plan.reviewFingerprint ?? 'unknown review';
  return `Face-audit review plan downloaded: ${plan.pendingAreaCount} unfinished area(s), ` +
    `${plan.pendingItemCount} pending item(s), ${plan.readyAreaCount} ready area(s), review ${reviewFingerprint}`;
}

export function faceAuditReviewSheetPath(): string {
  return '/api/face-audit-review-template/review-sheet';
}

export function faceAuditAreaReviewSheetPath(area: FaceAuditArea): string {
  return `/api/face-audit-review-template/${area}/review-sheet`;
}

export function faceAuditReviewSheetFileName(): string {
  return FACE_AUDIT_REVIEW_SHEET_FILE_NAME;
}

export function faceAuditAreaReviewSheetFileName(area: FaceAuditArea): string {
  return `face-audit-area-${area}${FACE_AUDIT_AREA_REVIEW_SHEET_FILE_SUFFIX}`;
}

export function faceAuditReviewSheetImportPath(): string {
  return '/api/face-audit-review-template/apply-review-sheet';
}

export function faceAuditReviewFromSheetFileName(): string {
  return FACE_AUDIT_REVIEW_FROM_SHEET_FILE_NAME;
}

export function faceAuditReviewSheetDownloadLabel(
  rowCountHeader: string | null | undefined,
  reviewFingerprintHeader: string | null | undefined,
): string {
  const rowCount = nonNegativeIntegerFromHeader(rowCountHeader);
  const rowCountLabel = rowCount === undefined ? 'unknown row count' : `${rowCount} row(s)`;
  const reviewFingerprint = nonEmptyString(reviewFingerprintHeader);
  return reviewFingerprint === undefined
    ? `Face-audit review sheet downloaded: ${rowCountLabel}`
    : `Face-audit review sheet downloaded: ${rowCountLabel}, review ${reviewFingerprint}`;
}

export function faceAuditAreaReviewSheetDownloadLabel(
  area: FaceAuditArea,
  rowCountHeader: string | null | undefined,
  reviewFingerprintHeader: string | null | undefined,
): string {
  const rowCount = nonNegativeIntegerFromHeader(rowCountHeader);
  const rowCountLabel = rowCount === undefined ? 'unknown row count' : `${rowCount} row(s)`;
  const reviewFingerprint = nonEmptyString(reviewFingerprintHeader);
  return reviewFingerprint === undefined
    ? `Face-audit ${area} review sheet downloaded: ${rowCountLabel}`
    : `Face-audit ${area} review sheet downloaded: ${rowCountLabel}, review ${reviewFingerprint}`;
}

export function faceAuditReviewSheetImportDownloadLabel(
  appliedItemCount: number | undefined,
  reviewFingerprintValue: string | null | undefined,
): string {
  const appliedItemLabel = appliedItemCount === undefined ? 'unknown item count' : `${appliedItemCount} item(s) applied`;
  const reviewFingerprint = nonEmptyString(reviewFingerprintValue);
  return reviewFingerprint === undefined
    ? `Face-audit review sheet applied: ${appliedItemLabel}`
    : `Face-audit review sheet applied: ${appliedItemLabel}, review ${reviewFingerprint}`;
}

export function faceAuditReviewerInstructionsPath(): string {
  return '/api/face-audit-review-template/reviewer-instructions';
}

export function faceAuditAreaReviewerInstructionsPath(area: FaceAuditArea): string {
  return `/api/face-audit-review-template/${area}/reviewer-instructions`;
}

export function faceAuditReviewerInstructionsFileName(): string {
  return FACE_AUDIT_REVIEWER_INSTRUCTIONS_FILE_NAME;
}

export function faceAuditAreaReviewerInstructionsFileName(area: FaceAuditArea): string {
  return `face-audit-area-${area}${FACE_AUDIT_AREA_REVIEWER_INSTRUCTIONS_FILE_SUFFIX}`;
}

export function faceAuditReviewerInstructionsDownloadLabel(
  reviewFingerprintHeader: string | null | undefined,
): string {
  const reviewFingerprint = nonEmptyString(reviewFingerprintHeader);
  return reviewFingerprint === undefined
    ? 'Face-audit reviewer instructions downloaded'
    : `Face-audit reviewer instructions downloaded: review ${reviewFingerprint}`;
}

export function faceAuditAreaReviewerInstructionsDownloadLabel(
  area: FaceAuditArea,
  reviewFingerprintHeader: string | null | undefined,
): string {
  const reviewFingerprint = nonEmptyString(reviewFingerprintHeader);
  return reviewFingerprint === undefined
    ? `Face-audit ${area} reviewer instructions downloaded`
    : `Face-audit ${area} reviewer instructions downloaded: review ${reviewFingerprint}`;
}

export function faceAuditReviewerHandoffPath(): string {
  return '/api/face-audit-review-template/handoff';
}

export function faceAuditReviewerHandoffFileName(): string {
  return FACE_AUDIT_REVIEWER_HANDOFF_FILE_NAME;
}

export function faceAuditReviewerHandoffAreaFileName(area: FaceAuditArea): string {
  return faceAuditAreaReviewArtifactFileName(area);
}

export function faceAuditReviewerHandoffDownloadLabel(handoff: FaceAuditReviewerHandoffView): string {
  const reviewFingerprint = handoff.reviewFingerprint ?? 'unknown review';
  const evidenceSourceCount = handoff.evidenceSourceCount ?? 0;
  return `Face-audit reviewer handoff downloaded: ${handoff.pendingAreaCount} pending area(s), ` +
    `${handoff.readyAreaCount} ready area(s), ${evidenceSourceCount} evidence source(s), review ${reviewFingerprint}`;
}

export function faceAuditReviewerHandoffAreaDownloadLabel(area: FaceAuditReviewerHandoffAreaView): string {
  return `Face-audit area review artifact downloaded: ${area.area}, ${area.reviewArtifact.areaItemCount} item(s), ` +
    `${area.todo.remainingItemCount} remaining, ${area.reviewArtifact.evidenceSourceCount} evidence source(s)`;
}

export function faceAuditReviewerHandoffVerifyPath(): string {
  return '/api/face-audit-reviewer-handoff/verify';
}

export function faceAuditReviewerHandoffResponsePath(): string {
  return '/api/face-audit-reviewer-handoff/response';
}

export function faceAuditLockArtifactVerifyPath(): string {
  return '/api/face-audit-lock-artifact/verify';
}

export function faceAuditReleaseGatePath(): string {
  return '/api/face-audit-release-gate';
}

function faceAuditLockPreviewLabel(validation: FaceAuditReviewValidationView): string {
  if (!validation.lockPreview) {
    return '';
  }
  return `; review ${validation.lockPreview.reviewFingerprint}; ` +
    `${validation.lockPreview.areaCount} audit areas, ` +
    `${validation.lockPreview.totalReviewedItemCount} reviewed items, ` +
    `${faceAuditLockEvidenceCoverageLabel(validation.lockPreview)}, ` +
    `${validation.lockPreview.evidenceSourceCount} evidence source(s) ready to lock`;
}

export function faceAuditLockArtifactLabel(lockArtifact: FaceAuditLockArtifactView): string {
  return `${lockArtifact.artifactType}: ${lockArtifact.completion.status}; review ${lockArtifact.reviewFingerprint}; ` +
    `${lockArtifact.areaCount} audit areas, ${lockArtifact.totalReviewedItemCount} reviewed items, ` +
    `${faceAuditLockEvidenceCoverageLabel(lockArtifact)}, ` +
    `${lockArtifact.evidenceSourceCount} evidence source(s)`;
}

export function faceAuditLockArtifactValidationLabel(validation: FaceAuditLockArtifactValidationView): string {
  return validation.ok && validation.lockArtifact
    ? `Lock artifact is valid. ${faceAuditLockArtifactLabel(validation.lockArtifact)}`
    : `Lock artifact has ${validation.issueCount} issue(s).`;
}

export function faceAuditStaticLockGateLabel(gate: FaceAuditStaticLockGateView): string {
  const statusLabel = `${gate.pendingAreaCount} pending area(s), ${gate.lockedAreaCount} locked area(s)`;
  const lockArtifactLabel = gate.lockArtifactValidation === undefined
    ? ''
    : `; ${faceAuditLockArtifactValidationLabel(gate.lockArtifactValidation)}`;
  return gate.ok
    ? `Release gate is open. ${statusLabel}${lockArtifactLabel}`
    : `Release gate has ${gate.issueCount} issue(s). ${statusLabel}${lockArtifactLabel}`;
}

function faceAuditLockArtifactResultLabel(validation: FaceAuditReviewValidationView): string {
  if (!validation.lockArtifact) {
    return '';
  }
  return `; ${faceAuditLockArtifactLabel(validation.lockArtifact)}`;
}

export function faceAuditReviewSubmissionLabel(
  type: FaceAuditReviewSubmissionType,
  validation: FaceAuditReviewValidationView,
): string {
  const prefix = type === 'lock-preview'
    ? 'Lock preview'
    : type === 'lock-artifact'
      ? 'Lock artifact'
    : type === 'ready'
      ? 'Ready check'
      : 'Review validation';
  return `${prefix}: ${faceAuditReviewValidationLabel(validation)}` +
    `${faceAuditLockPreviewLabel(validation)}${faceAuditLockArtifactResultLabel(validation)}`;
}

export function faceAuditReviewMergeLabel(validation: FaceAuditReviewValidationView): string {
  return `Merge review artifacts: ${faceAuditReviewValidationLabel(validation)}`;
}

export function fillFaceAuditAreaReviewArtifact(
  artifact: unknown,
  options: FaceAuditAreaReviewFillOptions,
): FaceAuditAreaReviewFillResult {
  if (!isRecord(artifact)) {
    return {ok: false, error: 'Area review artifact must be a JSON object'};
  }
  if (artifact.artifactType !== 'face_audit_area_review') {
    return {ok: false, error: 'Area review artifact must have artifactType face_audit_area_review'};
  }
  const area = faceAuditReviewAreaName(artifact.area);
  if (!area) {
    return {ok: false, error: 'Area review artifact must include a known area'};
  }
  if (!Array.isArray(artifact.items)) {
    return {ok: false, error: 'Area review artifact items must be an array'};
  }

  const reviewer = options.reviewer.trim();
  const reviewedAt = options.reviewedAt.trim();
  const sourceId = evidenceSourceId(options.evidenceSourceId);
  const sourceLabel = options.evidenceSourceLabel.trim();
  const sourceCitation = options.evidenceSourceCitation.trim();
  const sourceLocator = options.evidenceSourceLocator?.trim() ?? '';
  const sourceContentHash = options.evidenceSourceContentHash?.trim().toLowerCase() ?? '';
  const sourceNotes = options.evidenceSourceNotes.trim();
  const reviewStatus = faceAuditReviewStatusName(options.reviewStatus);
  const evidenceRefScope = options.evidenceRefScope ?? 'area';

  if (!reviewer) {
    return {ok: false, error: 'Reviewer is required'};
  }
  if (!reviewedAt || !Number.isFinite(Date.parse(reviewedAt))) {
    return {ok: false, error: 'Reviewed at must be a valid timestamp'};
  }
  if (!sourceId) {
    return {ok: false, error: 'Evidence source id must match the evidenceRef source id format'};
  }
  if (!sourceLabel) {
    return {ok: false, error: 'Evidence source label is required'};
  }
  if (!evidenceSourceTypeSet.has(options.evidenceSourceType)) {
    return {ok: false, error: 'Evidence source type must be official_physical_component or official_high_res_component_image'};
  }
  if (!sourceCitation) {
    return {ok: false, error: 'Evidence source citation is required'};
  }
  if (sourceContentHash && !validEvidenceSourceContentHash(sourceContentHash)) {
    return {ok: false, error: 'Evidence source content hash must use sha256:<64 hex>, sha1:<40 hex>, or md5:<32 hex>'};
  }
  if (reviewStatus === undefined || reviewStatus === 'unreviewed') {
    return {ok: false, error: 'Review status must be a completed face-audit status'};
  }
  if (evidenceRefScope !== 'area' && evidenceRefScope !== 'item') {
    return {ok: false, error: 'Evidence ref scope must be area or item'};
  }

  const evidenceSource: {
    id: string;
    label: string;
    sourceType: FaceAuditEvidenceSourceType;
    citation: string;
    locator?: string;
    contentHash?: string;
    notes: string;
  } = {
    id: sourceId,
    label: sourceLabel,
    sourceType: options.evidenceSourceType,
    citation: sourceCitation,
    notes: sourceNotes,
  };
  if (sourceLocator) {
    evidenceSource.locator = sourceLocator;
  }
  if (sourceContentHash) {
    evidenceSource.contentHash = sourceContentHash;
  }
  const existingEvidenceSources = Array.isArray(artifact.evidenceSources)
    ? artifact.evidenceSources.filter(isRecord)
    : [];
  const evidenceSources = [];
  let sourceWasPresent = false;
  for (const existingSource of existingEvidenceSources) {
    if (existingSource.id === sourceId) {
      sourceWasPresent = true;
      const existingLocator = typeof existingSource.locator === 'string' ? existingSource.locator.trim() : '';
      const existingContentHash = typeof existingSource.contentHash === 'string'
        ? existingSource.contentHash.trim().toLowerCase()
        : '';
      const sameSource =
        existingSource.label === evidenceSource.label &&
        existingSource.sourceType === evidenceSource.sourceType &&
        existingSource.citation === evidenceSource.citation &&
        existingLocator === (evidenceSource.locator ?? '') &&
        existingContentHash === (evidenceSource.contentHash ?? '') &&
        (typeof existingSource.notes === 'string' ? existingSource.notes : '') === evidenceSource.notes;
      if (!sameSource) {
        return {ok: false, error: `Evidence source ${sourceId} conflicts with the loaded artifact`};
      }
    }
    evidenceSources.push({...existingSource});
  }
  if (!sourceWasPresent) {
    evidenceSources.push(evidenceSource);
  }

  const items = [];
  for (const [index, item] of artifact.items.entries()) {
    if (!isRecord(item)) {
      return {ok: false, error: `Area review item ${index + 1} must be a JSON object`};
    }
    if (item.area !== area) {
      return {ok: false, error: `Area review item ${index + 1} must match the artifact area`};
    }
    const itemId = nonEmptyString(item.id);
    if (evidenceRefScope === 'item' && itemId === undefined) {
      return {ok: false, error: `Area review item ${index + 1} must include an id for item-specific evidence refs`};
    }
    items.push({
      ...item,
      reviewStatus,
      reviewer,
      reviewedAt,
      evidenceRef: evidenceRefScope === 'item'
        ? `official-component:${sourceId}#${area}:${itemId}`
        : `official-component:${sourceId}#${area}`,
      notes: options.itemNotes.trim(),
    });
  }

  return {
    ok: true,
    artifact: {
      ...artifact,
      evidenceSources,
      items,
    },
    area,
    itemCount: items.length,
  };
}

export function faceAuditReviewAreaName(value: unknown): FaceAuditArea | undefined {
  const area = nonEmptyString(value) as FaceAuditArea | undefined;
  return area && faceAuditAreaSet.has(area) ? area : undefined;
}

export function faceAuditReviewStatusName(value: unknown): FaceAuditReviewStatus | undefined {
  const status = nonEmptyString(value) as FaceAuditReviewStatus | undefined;
  return status && reviewStatusSet.has(status) ? status : undefined;
}
