import {
  getCardIdsForPlayerCount,
  getWildIndustryCardIds,
  getWildLocationCardIds,
  staticConfig,
} from './staticData';
import type {
  CardSpec,
  CitySpec,
  IndustryTileSpec,
  LinkLineSpec,
  MerchantBonus,
  MerchantTileSpec,
  StaticDataAuditStatus,
} from './types';

export const FACE_AUDIT_AREAS = [
  'industryTiles',
  'linkLines',
  'locationsAndSlots',
  'merchantTiles',
  'regularCards',
  'wildCards',
] as const;

export type FaceAuditArea = typeof FACE_AUDIT_AREAS[number];

export const FACE_AUDIT_REVIEW_STATUSES = [
  'unreviewed',
  'matches_official_face',
  'differs_from_official_face',
  'needs_better_reference',
] as const;

export type FaceAuditReviewStatus = typeof FACE_AUDIT_REVIEW_STATUSES[number];

export const FACE_AUDIT_EVIDENCE_SOURCE_TYPES = [
  'official_physical_component',
  'official_high_res_component_image',
] as const;

export type FaceAuditEvidenceSourceType = typeof FACE_AUDIT_EVIDENCE_SOURCE_TYPES[number];

export type FaceAuditEvidenceRefMode = 'area' | 'items';

export type FaceAuditSourceIdsByArea = Partial<Record<FaceAuditArea, string>>;
export type FaceAuditSourceIdsByAreaMap = Record<FaceAuditArea, string>;

export interface FaceAuditEvidenceSource {
  id: string;
  label: string;
  sourceType: FaceAuditEvidenceSourceType;
  citation: string;
  locator?: string;
  contentHash?: string;
  notes: string;
}

export interface FaceAuditChecklistItem {
  area: FaceAuditArea;
  id: string;
  label: string;
  expectedFields: string[];
}

export interface FaceAuditAreaSummary {
  area: FaceAuditArea;
  status: StaticDataAuditStatus;
  rulebookPages: number[];
  sourceRefs: string[];
  coveredByTests: string[];
  itemCount: number;
  expectedFieldNames: string[];
}

export interface FaceAuditChecklistExport {
  version: 1;
  checklistFingerprint: string;
  checklistItemCount: number;
  areas: FaceAuditAreaSummary[];
  items: FaceAuditChecklistItem[];
}

export interface FaceAuditEvidenceRefTemplateItem {
  key: string;
  id: string;
  label: string;
  evidenceRef: string;
}

export interface FaceAuditEvidenceRefTemplateExport {
  artifactType: 'face_audit_evidence_ref_template';
  version: 1;
  sourceId: string;
  area: FaceAuditArea;
  mode: FaceAuditEvidenceRefMode;
  evidenceRefCount: number;
  evidenceRefs: string[];
  items: FaceAuditEvidenceRefTemplateItem[];
}

export type FaceAuditChecklistFingerprintSource = {
  areas: readonly Pick<
    FaceAuditAreaSummary,
    'area' | 'status' | 'itemCount' | 'rulebookPages' | 'sourceRefs' | 'coveredByTests' | 'expectedFieldNames'
  >[];
  items: readonly Pick<FaceAuditChecklistItem, 'area' | 'id' | 'label' | 'expectedFields'>[];
};

export type FaceAuditReviewCounts = Record<FaceAuditReviewStatus, number>;

export interface FaceAuditReviewItem extends FaceAuditChecklistItem {
  key: string;
  reviewStatus: FaceAuditReviewStatus;
  reviewer: string;
  reviewedAt: string;
  evidenceRef: string;
  notes: string;
}

export interface FaceAuditReviewAreaSummary extends FaceAuditAreaSummary {
  reviewCounts: FaceAuditReviewCounts;
}

export type FaceAuditReviewCompletionStatus =
  | 'not_started'
  | 'in_progress'
  | 'ready_to_lock'
  | 'has_differences'
  | 'needs_better_reference';

export interface FaceAuditReviewCompletionSummary {
  status: FaceAuditReviewCompletionStatus;
  reviewedItemCount: number;
  matchingItemCount: number;
  differenceItemCount: number;
  needsReferenceItemCount: number;
  unreviewedItemCount: number;
  totalItemCount: number;
}

export interface FaceAuditReviewTemplateExport {
  version: 1;
  checklistFingerprint: string;
  checklistItemCount: number;
  evidenceSources: FaceAuditEvidenceSource[];
  areas: FaceAuditReviewAreaSummary[];
  items: FaceAuditReviewItem[];
  completion: FaceAuditReviewCompletionSummary;
}

export interface FaceAuditAreaReviewTemplateExport {
  artifactType: 'face_audit_area_review';
  version: 1;
  area: FaceAuditArea;
  checklistFingerprint: string;
  checklistItemCount: number;
  areaItemCount: number;
  evidenceSources: FaceAuditEvidenceSource[];
  areaSummary: FaceAuditReviewAreaSummary;
  items: FaceAuditReviewItem[];
  completion: FaceAuditReviewCompletionSummary;
}

export interface FaceAuditReviewValidationIssue {
  itemKey?: string;
  field: string;
  message: string;
}

export interface FaceAuditSourceIdsByAreaTemplateResult {
  ok: boolean;
  sourceIdsByArea?: FaceAuditSourceIdsByAreaMap;
  issueCount: number;
  issues: FaceAuditReviewValidationIssue[];
}

export interface FaceAuditReviewValidationResult {
  ok: boolean;
  review: FaceAuditReviewTemplateExport;
  issues: FaceAuditReviewValidationIssue[];
}

export interface FaceAuditAreaReviewValidationResult {
  ok: boolean;
  review: FaceAuditAreaReviewTemplateExport;
  issues: FaceAuditReviewValidationIssue[];
}

export interface FaceAuditReviewStatusAreaReport {
  area: FaceAuditArea;
  status: StaticDataAuditStatus;
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
  reviewCounts: FaceAuditReviewCounts;
}

export interface FaceAuditReviewStatusArtifactCounts {
  fullReviewArtifactCount: number;
  areaReviewArtifactCount: number;
  unknownArtifactCount: number;
}

export type FaceAuditReviewAreaCompletionCounts = Record<FaceAuditReviewCompletionStatus, number>;

export interface FaceAuditReviewStatusReport {
  artifactType: 'face_audit_review_status';
  version: 1;
  ok: boolean;
  artifactCount: number;
  artifactCounts: FaceAuditReviewStatusArtifactCounts;
  checklistFingerprint: string;
  reviewFingerprint: string;
  checklistItemCount: number;
  evidenceSourceCount: number;
  usedEvidenceSourceCount: number;
  usedEvidenceSourceIds: string[];
  unusedEvidenceSourceCount: number;
  unusedEvidenceSourceIds: string[];
  completion: FaceAuditReviewCompletionSummary;
  areaCompletionCounts: FaceAuditReviewAreaCompletionCounts;
  areaProgress: FaceAuditReviewStatusAreaReport[];
  issueCount: number;
  issues: FaceAuditReviewValidationIssue[];
}

export type FaceAuditReviewTodoNextStep =
  | 'review_unreviewed_items'
  | 'resolve_differences'
  | 'find_better_reference';

export interface FaceAuditReviewTodoAreaCommands {
  blankTemplate: string;
  blankTemplateWithSources: string;
  areaMatchTemplate: string;
  areaMatchTemplateWithItemRefs: string;
}

export interface FaceAuditReviewTodoCommands {
  blankTemplate: string;
  blankTemplateWithSources: string;
  sourceIdsByAreaTemplate: string;
  reviewMatchTemplate: string;
  reviewMatchTemplateWithItemRefs: string;
  reviewMatchTemplateByArea: string;
  reviewMatchTemplateByAreaWithItemRefs: string;
}

export interface FaceAuditReviewTodoArea {
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
  commands: FaceAuditReviewTodoAreaCommands;
}

export interface FaceAuditReviewTodoReport {
  artifactType: 'face_audit_review_todo';
  version: 1;
  ok: boolean;
  artifactCount: number;
  checklistFingerprint: string;
  reviewFingerprint: string;
  checklistItemCount: number;
  completion: FaceAuditReviewCompletionSummary;
  pendingAreaCount: number;
  readyAreaCount: number;
  issueCount: number;
  commands: FaceAuditReviewTodoCommands;
  areas: FaceAuditReviewTodoArea[];
  issues: FaceAuditReviewValidationIssue[];
}

export interface FaceAuditReviewTodoSummaryArea {
  area: FaceAuditArea;
  completionStatus: FaceAuditReviewCompletionStatus;
  nextStep: FaceAuditReviewTodoNextStep;
  remainingItemCount: number;
}

export interface FaceAuditReviewTodoSummaryReport {
  artifactType: 'face_audit_review_todo_summary';
  version: 1;
  ok: boolean;
  artifactCount: number;
  checklistFingerprint: string;
  reviewFingerprint: string;
  checklistItemCount: number;
  completion: FaceAuditReviewCompletionSummary;
  pendingAreaCount: number;
  readyAreaCount: number;
  pendingItemCount: number;
  unfinishedAreas: FaceAuditReviewTodoSummaryArea[];
  issueCount: number;
  issues: FaceAuditReviewValidationIssue[];
}

export type FaceAuditAreaReviewTodoSummaryNextStep = FaceAuditReviewTodoNextStep | 'none';

export interface FaceAuditAreaReviewTodoSummaryReport {
  artifactType: 'face_audit_area_review_todo_summary';
  version: 1;
  ok: boolean;
  artifactCount: number;
  area: FaceAuditArea;
  status: StaticDataAuditStatus;
  checklistFingerprint: string;
  reviewFingerprint: string;
  checklistItemCount: number;
  itemCount: number;
  completionStatus: FaceAuditReviewCompletionStatus;
  nextStep: FaceAuditAreaReviewTodoSummaryNextStep;
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
  issues: FaceAuditReviewValidationIssue[];
}

export interface FaceAuditReviewPlanItem {
  key: string;
  id: string;
  label: string;
  expectedFields: string[];
  reviewStatus: FaceAuditReviewStatus;
  nextStep: FaceAuditReviewTodoNextStep;
  evidenceRef: string;
  notes: string;
}

export interface FaceAuditReviewPlanArea extends FaceAuditReviewTodoArea {
  items: FaceAuditReviewPlanItem[];
}

export interface FaceAuditReviewPlanReport {
  artifactType: 'face_audit_review_plan';
  version: 1;
  ok: boolean;
  artifactCount: number;
  checklistFingerprint: string;
  reviewFingerprint: string;
  checklistItemCount: number;
  completion: FaceAuditReviewCompletionSummary;
  pendingAreaCount: number;
  readyAreaCount: number;
  pendingItemCount: number;
  issueCount: number;
  commands: FaceAuditReviewTodoCommands;
  areas: FaceAuditReviewPlanArea[];
  issues: FaceAuditReviewValidationIssue[];
}

export interface FaceAuditReviewSheetResult {
  ok: boolean;
  checklistFingerprint: string;
  reviewFingerprint: string;
  rowCount: number;
  tsv: string;
  issueCount: number;
  issues: FaceAuditReviewValidationIssue[];
}

export interface FaceAuditAreaReviewSheetResult extends FaceAuditReviewSheetResult {
  area: FaceAuditArea;
  areaItemCount: number;
}

export interface FaceAuditReviewSheetImportResult {
  artifactType: 'face_audit_review_sheet_import';
  version: 1;
  ok: boolean;
  checklistFingerprint: string;
  baseReviewFingerprint: string;
  reviewFingerprint: string;
  rowCount: number;
  appliedItemCount: number;
  review: FaceAuditReviewTemplateExport;
  issueCount: number;
  issues: FaceAuditReviewValidationIssue[];
}

export interface FaceAuditReviewerHandoffArea {
  area: FaceAuditArea;
  todo: FaceAuditReviewTodoArea;
  reviewArtifact: FaceAuditAreaReviewTemplateExport;
}

export interface FaceAuditReviewerHandoffReport {
  artifactType: 'face_audit_reviewer_handoff';
  version: 1;
  ok: boolean;
  artifactCount: number;
  checklistFingerprint: string;
  reviewFingerprint: string;
  checklistItemCount: number;
  evidenceSourceCount: number;
  evidenceSources: FaceAuditEvidenceSource[];
  completion: FaceAuditReviewCompletionSummary;
  pendingAreaCount: number;
  readyAreaCount: number;
  issueCount: number;
  todo: FaceAuditReviewTodoReport;
  areas: FaceAuditReviewerHandoffArea[];
  issues: FaceAuditReviewValidationIssue[];
}

export interface FaceAuditReviewerInstructionAreaFile {
  area: FaceAuditArea;
  fileName: string;
  todoSummaryFileName?: string;
  reviewSheetFileName?: string;
  reviewerInstructionsFileName?: string;
}

export interface FaceAuditReviewerInstructionsInput {
  status: FaceAuditReviewStatusReport;
  todo: FaceAuditReviewTodoReport;
  plan: FaceAuditReviewPlanReport;
  handoff: FaceAuditReviewerHandoffReport;
  areaFiles: FaceAuditReviewerInstructionAreaFile[];
}

export interface FaceAuditAreaReviewerInstructionsInput {
  handoff: FaceAuditReviewerHandoffReport;
  area: FaceAuditReviewerHandoffArea;
  reviewFileName: string;
  todoSummaryFileName: string;
  reviewSheetFileName?: string;
}

export interface FaceAuditAreaReviewerInstructionsReport {
  artifactType: 'face_audit_area_reviewer_instructions';
  version: 1;
  ok: boolean;
  area: FaceAuditArea;
  checklistFingerprint: string;
  reviewFingerprint: string;
  reviewFileName: string;
  todoSummaryFileName: string;
  reviewSheetFileName: string;
  markdown: string;
  issueCount: number;
  issues: FaceAuditReviewValidationIssue[];
}

export interface FaceAuditReviewerHandoffValidationResult {
  ok: boolean;
  handoff?: FaceAuditReviewerHandoffReport;
  issues: FaceAuditReviewValidationIssue[];
}

export interface FaceAuditReviewerHandoffResponseAreaReport {
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
}

export interface FaceAuditReviewerHandoffResponseReport {
  artifactType: 'face_audit_reviewer_handoff_response';
  version: 1;
  ok: boolean;
  checklistFingerprint: string;
  handoffReviewFingerprint?: string;
  handoffPendingAreaCount: number;
  responseArtifactCount: number;
  acceptedAreaCount: number;
  readyAreaCount: number;
  unfinishedReturnedAreaCount: number;
  missingAreaCount: number;
  remainingAreaCount: number;
  areas: FaceAuditReviewerHandoffResponseAreaReport[];
  issueCount: number;
  issues: FaceAuditReviewValidationIssue[];
}

export interface FaceAuditLockPreviewArea {
  area: FaceAuditArea;
  currentStatus: StaticDataAuditStatus;
  nextStatus: Extract<StaticDataAuditStatus, 'manifest_locked'>;
  itemCount: number;
  reviewedItemCount: number;
  reviewers: string[];
  evidenceRefs: string[];
  evidenceRefCount: number;
  areaLevelEvidenceRefCount: number;
  itemSpecificEvidenceRefCount: number;
  itemSpecificEvidenceItemCount: number;
  firstReviewedAt: string;
  lastReviewedAt: string;
}

export interface FaceAuditLockPreview {
  version: 1;
  checklistFingerprint: string;
  reviewFingerprint: string;
  checklistItemCount: number;
  evidenceSources: FaceAuditEvidenceSource[];
  areas: FaceAuditLockPreviewArea[];
}

export interface FaceAuditLockPreviewResult extends FaceAuditReviewValidationResult {
  lockPreview?: FaceAuditLockPreview;
}

export interface FaceAuditLockArtifact extends FaceAuditLockPreview {
  artifactType: 'face_audit_lock_evidence';
  completion: FaceAuditReviewCompletionSummary;
}

export interface FaceAuditLockArtifactResult extends FaceAuditReviewValidationResult {
  lockArtifact?: FaceAuditLockArtifact;
}

export interface FaceAuditLockArtifactValidationResult {
  ok: boolean;
  lockArtifact?: FaceAuditLockArtifact;
  issues: FaceAuditReviewValidationIssue[];
}

export interface FaceAuditStaticLockGateResult {
  ok: boolean;
  pendingAreaCount: number;
  lockedAreaCount: number;
  lockArtifactValidation?: FaceAuditLockArtifactValidationResult;
  issues: FaceAuditReviewValidationIssue[];
}

function compareIds(left: FaceAuditChecklistItem, right: FaceAuditChecklistItem): number {
  return left.id.localeCompare(right.id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || undefined;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = value.map(nonEmptyString);
  return values.every((item): item is string => item !== undefined) ? values : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function faceAuditItemKey(item: Pick<FaceAuditChecklistItem, 'area' | 'id'>): string {
  return `${item.area}:${item.id}`;
}

export function faceAuditChecklistFingerprint(
  checklist: FaceAuditChecklistFingerprintSource = buildFaceAuditChecklistFingerprintSource(),
): string {
  return stableHash(JSON.stringify({
    areas: checklist.areas.map((area) => ({
      area: area.area,
      status: area.status,
      itemCount: area.itemCount,
      rulebookPages: area.rulebookPages,
      sourceRefs: area.sourceRefs,
      coveredByTests: area.coveredByTests,
      expectedFieldNames: area.expectedFieldNames,
    })),
    items: checklist.items.map((item) => ({
      area: item.area,
      id: item.id,
      label: item.label,
      expectedFields: item.expectedFields,
    })),
  }));
}

export function faceAuditReviewFingerprint(review: FaceAuditReviewTemplateExport): string {
  return stableHash(JSON.stringify({
    version: review.version,
    checklistFingerprint: review.checklistFingerprint,
    checklistItemCount: review.checklistItemCount,
    evidenceSources: review.evidenceSources.map((source) => ({
      id: source.id,
      label: source.label,
      sourceType: source.sourceType,
      citation: source.citation,
      locator: source.locator ?? '',
      contentHash: source.contentHash ?? '',
      notes: source.notes,
    })),
    completion: review.completion,
    items: review.items.map((item) => ({
      key: item.key,
      area: item.area,
      id: item.id,
      label: item.label,
      expectedFields: item.expectedFields,
      reviewStatus: item.reviewStatus,
      reviewer: item.reviewer,
      reviewedAt: item.reviewedAt,
      evidenceRef: item.evidenceRef,
      notes: item.notes,
    })),
  }));
}

function emptyReviewCounts(): FaceAuditReviewCounts {
  return Object.fromEntries(FACE_AUDIT_REVIEW_STATUSES.map((status) => [status, 0])) as FaceAuditReviewCounts;
}

function reviewStatus(value: unknown): FaceAuditReviewStatus | undefined {
  return typeof value === 'string' && (FACE_AUDIT_REVIEW_STATUSES as readonly string[]).includes(value)
    ? value as FaceAuditReviewStatus
    : undefined;
}

function faceAuditArea(value: unknown): FaceAuditArea | undefined {
  return typeof value === 'string' && (FACE_AUDIT_AREAS as readonly string[]).includes(value)
    ? value as FaceAuditArea
    : undefined;
}

export function parseFaceAuditArea(value: unknown): FaceAuditArea | undefined {
  return faceAuditArea(value);
}

export function parseFaceAuditEvidenceRefMode(value: unknown): FaceAuditEvidenceRefMode | undefined {
  return value === 'area' || value === 'items' ? value : undefined;
}

export function validFaceAuditEvidenceSourceId(value: unknown): value is string {
  return typeof value === 'string' && validEvidenceSourceId(value.trim());
}

export function faceAuditEvidenceRefForSource(
  sourceId: string,
  area: FaceAuditArea,
  itemId?: string,
): string {
  return itemId === undefined
    ? `official-component:${sourceId}#${area}`
    : `official-component:${sourceId}#${area}:${itemId}`;
}

function staticDataAuditStatus(value: unknown): StaticDataAuditStatus | undefined {
  return value === 'manifest_locked' || value === 'manifest_locked_face_audit_pending'
    ? value
    : undefined;
}

function validFingerprint(value: string): boolean {
  return /^fnv1a32:[0-9a-f]{8}$/.test(value);
}

function validReviewTimestamp(value: string): boolean {
  return value.length > 0 && Number.isFinite(Date.parse(value));
}

function validEvidenceSourceId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value);
}

function validEvidenceSourceContentHash(value: string): boolean {
  return /^(sha256:[0-9a-f]{64}|sha1:[0-9a-f]{40}|md5:[0-9a-f]{32})$/.test(value);
}

function evidenceSourceType(value: unknown): FaceAuditEvidenceSourceType | undefined {
  return typeof value === 'string' && (FACE_AUDIT_EVIDENCE_SOURCE_TYPES as readonly string[]).includes(value)
    ? value as FaceAuditEvidenceSourceType
    : undefined;
}

type FaceAuditEvidenceRefTarget = {
  sourceId: string;
  area: string;
  itemId?: string;
};

function parseFaceAuditEvidenceRef(value: string): FaceAuditEvidenceRefTarget | undefined {
  const match = /^official-component:([A-Za-z0-9][A-Za-z0-9._/-]*)#([A-Za-z0-9_-]+)(?::([A-Za-z0-9._-]+))?$/.exec(value);
  if (!match) {
    return undefined;
  }
  return match[3] === undefined
    ? {sourceId: match[1]!, area: match[2]!}
    : {sourceId: match[1]!, area: match[2]!, itemId: match[3]};
}

function reviewCountsForItems(items: readonly Pick<FaceAuditReviewItem, 'reviewStatus'>[]): FaceAuditReviewCounts {
  const counts = emptyReviewCounts();
  for (const item of items) {
    counts[item.reviewStatus] += 1;
  }
  return counts;
}

function expectedFieldName(field: string): string {
  const separatorIndex = field.indexOf('=');
  return separatorIndex < 0 ? field : field.slice(0, separatorIndex);
}

function joinedValues(values: readonly string[] | undefined): string {
  return values && values.length > 0 ? values.join(',') : 'none';
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function dateSorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => Date.parse(left) - Date.parse(right));
}

function usedEvidenceSourceIdsFromRefs(evidenceRefs: readonly string[]): string[] {
  return uniqueSorted(evidenceRefs
    .map((ref) => parseFaceAuditEvidenceRef(ref)?.sourceId)
    .filter((sourceId): sourceId is string => sourceId !== undefined));
}

type FaceAuditEvidenceCoverage = Pick<
  FaceAuditLockPreviewArea,
  'evidenceRefCount' | 'areaLevelEvidenceRefCount' | 'itemSpecificEvidenceRefCount' | 'itemSpecificEvidenceItemCount'
>;

function evidenceCoverageForArea(area: FaceAuditArea, evidenceRefs: readonly string[]): FaceAuditEvidenceCoverage {
  const evidenceTargets = evidenceRefs
    .map(parseFaceAuditEvidenceRef)
    .filter((target): target is FaceAuditEvidenceRefTarget =>
      target !== undefined && target.area === area);
  const itemSpecificEvidenceItemIds = uniqueSorted(evidenceTargets
    .map((target) => target.itemId)
    .filter((itemId): itemId is string => itemId !== undefined));
  return {
    evidenceRefCount: evidenceRefs.length,
    areaLevelEvidenceRefCount: evidenceTargets.filter((target) => target.itemId === undefined).length,
    itemSpecificEvidenceRefCount: evidenceTargets.filter((target) => target.itemId !== undefined).length,
    itemSpecificEvidenceItemCount: itemSpecificEvidenceItemIds.length,
  };
}

function unusedEvidenceSourceIdsForReview(review: FaceAuditReviewTemplateExport): string[] {
  const usedSourceIds = new Set(usedEvidenceSourceIdsFromRefs(review.items.map((item) => item.evidenceRef)));
  return uniqueSorted(review.evidenceSources
    .map((source) => source.id)
    .filter((sourceId) => !usedSourceIds.has(sourceId)));
}

function evidenceSourceHasTraceability(source: FaceAuditEvidenceSource): boolean {
  return (source.locator?.length ?? 0) > 0 || (source.contentHash?.length ?? 0) > 0;
}

function untraceableEvidenceSourceIds(sources: readonly FaceAuditEvidenceSource[]): string[] {
  return uniqueSorted(sources
    .filter((source) => !evidenceSourceHasTraceability(source))
    .map((source) => source.id));
}

function currentStatusCanProveLockArtifact(
  artifactStatus: StaticDataAuditStatus,
  checklistStatus: StaticDataAuditStatus,
): boolean {
  return artifactStatus === checklistStatus ||
    (artifactStatus === 'manifest_locked_face_audit_pending' && checklistStatus === 'manifest_locked');
}

function projectedChecklistFingerprintForLockArtifact(
  checklist: FaceAuditChecklistExport,
  artifactAreas: readonly FaceAuditLockPreviewArea[],
): string {
  const artifactStatusByArea = new Map(artifactAreas.map((area) => [area.area, area.currentStatus]));
  return faceAuditChecklistFingerprint({
    areas: checklist.areas.map((area) => ({
      ...area,
      status: artifactStatusByArea.get(area.area) ?? area.status,
    })),
    items: checklist.items,
  });
}

function merchantBonusField(bonus: MerchantBonus | undefined): string {
  if (bonus === undefined) {
    return 'merchantBonus=none';
  }
  switch (bonus.type) {
    case 'cash':
      return `merchantBonus=cash:${bonus.cash}`;
    case 'develop':
      return `merchantBonus=develop:${bonus.count}`;
    case 'income_spaces':
      return `merchantBonus=income_spaces:${bonus.spaces}`;
    case 'victory_points':
      return `merchantBonus=victory_points:${bonus.points}`;
  }
}

function cardIdentity(card: CardSpec): string {
  if (card.type === 'location') {
    return `locationId=${card.locationId ?? 'missing'}`;
  }
  if (card.type === 'industry') {
    return `industryType=${card.industryType ?? 'missing'}`;
  }
  return 'wild=true';
}

function regularCardItems(): FaceAuditChecklistItem[] {
  // The 4-player generated deck contains the full 64-card regular deck; lower
  // player counts are filtered generated projections of that same physical set.
  return getCardIdsForPlayerCount(4)
    .map((cardId) => staticConfig.cardSpecs[cardId])
    .map((card) => ({
      area: 'regularCards' as const,
      id: card.id,
      label: card.name,
      expectedFields: [
        `type=${card.type}`,
        cardIdentity(card),
        'representedBy=4-player regular deck',
      ],
    }))
    .sort(compareIds);
}

function wildCardItems(): FaceAuditChecklistItem[] {
  return [...getWildLocationCardIds(), ...getWildIndustryCardIds()]
    .map((cardId) => staticConfig.cardSpecs[cardId])
    .map((card) => ({
      area: 'wildCards' as const,
      id: card.id,
      label: card.name,
      expectedFields: [
        `type=${card.type}`,
        'wild=true',
      ],
    }))
    .sort(compareIds);
}

function cityFields(city: CitySpec): string[] {
  return [
    `name=${city.name}`,
    `region=${city.region}`,
    `printedLinkIcons=${city.printedLinkIcons}`,
    `slots=${city.slots.map((slot) => `${slot.id}:${slot.allowedIndustryTypes.join('+')}`).join(';')}`,
  ];
}

function locationAndSlotItems(): FaceAuditChecklistItem[] {
  return Object.values(staticConfig.locations)
    .filter((location): location is CitySpec => location.kind === 'city')
    .map((city) => ({
      area: 'locationsAndSlots' as const,
      id: city.id,
      label: city.name,
      expectedFields: cityFields(city),
    }))
    .sort(compareIds);
}

function linkLineFields(linkLine: LinkLineSpec): string[] {
  return [
    `endpointA=${linkLine.endpointA}`,
    `endpointB=${linkLine.endpointB}`,
    `allowedLinkTypes=${linkLine.allowedLinkTypes.join(',')}`,
    `viaFarmBreweryId=${linkLine.viaFarmBreweryId ?? 'none'}`,
  ];
}

function linkLineItems(): FaceAuditChecklistItem[] {
  return Object.values(staticConfig.linkLines)
    .map((linkLine) => ({
      area: 'linkLines' as const,
      id: linkLine.id,
      label: `${linkLine.endpointA} - ${linkLine.endpointB}`,
      expectedFields: linkLineFields(linkLine),
    }))
    .sort(compareIds);
}

function industryResourcesField(spec: IndustryTileSpec): string {
  const resources = spec.resourcesWhenBuilt;
  if (resources === undefined) {
    return 'resourcesWhenBuilt=none';
  }
  return `resourcesWhenBuilt=${Object.entries(resources)
    .map(([era, count]) => `${era}:${count}`)
    .join(',')}`;
}

function industryTileFields(spec: IndustryTileSpec): string[] {
  return [
    `industryType=${spec.industryType}`,
    `level=${spec.level}`,
    `buildableEras=${spec.buildableEras.join(',')}`,
    `cost=${spec.cost.cash}/${spec.cost.coal}/${spec.cost.iron}`,
    `beerRequiredToSell=${spec.beerRequiredToSell ?? 0}`,
    `flip=${spec.flip.trigger}:${spec.flip.incomeSpaces}/${spec.flip.victoryPoints}/${spec.flip.linkIcons}`,
    industryResourcesField(spec),
    `canDevelop=${spec.canDevelop}`,
    `special=${spec.special?.lightbulbPottery ? 'lightbulbPottery' : 'none'}`,
  ];
}

function industryTileItems(): FaceAuditChecklistItem[] {
  return Object.values(staticConfig.industryStackSpecIds)
    .flat()
    .map((specId) => staticConfig.industryTileSpecs[specId])
    .map((spec) => ({
      area: 'industryTiles' as const,
      id: spec.id,
      label: `${spec.industryType} level ${spec.level}`,
      expectedFields: industryTileFields(spec),
    }));
}

function merchantLocationBonus(tile: MerchantTileSpec): MerchantBonus | undefined {
  if (tile.blank) {
    return undefined;
  }
  const merchantId = tile.id.split('-')[0];
  const merchant = staticConfig.locations[merchantId];
  return merchant?.kind === 'merchant' ? merchant.bonus : undefined;
}

function merchantTileFields(tile: MerchantTileSpec): string[] {
  return [
    `minPlayers=${tile.minPlayers}`,
    `blank=${tile.blank}`,
    `acceptedIndustryTypes=${joinedValues(tile.acceptedIndustryTypes)}`,
    merchantBonusField(merchantLocationBonus(tile)),
  ];
}

function merchantTileItems(): FaceAuditChecklistItem[] {
  return Object.values(staticConfig.merchantTileSpecs)
    .map((tile) => ({
      area: 'merchantTiles' as const,
      id: tile.id,
      label: tile.blank ? `${tile.id} blank merchant tile` : `${tile.id} merchant tile`,
      expectedFields: merchantTileFields(tile),
    }))
    .sort(compareIds);
}

export function buildFaceAuditChecklist(): FaceAuditChecklistItem[] {
  return [
    ...industryTileItems(),
    ...linkLineItems(),
    ...locationAndSlotItems(),
    ...merchantTileItems(),
    ...regularCardItems(),
    ...wildCardItems(),
  ];
}

export function summarizeFaceAuditChecklist(
  items: FaceAuditChecklistItem[] = buildFaceAuditChecklist(),
): FaceAuditAreaSummary[] {
  return FACE_AUDIT_AREAS.map((area) => {
    const areaItems = items.filter((item) => item.area === area);
    const audit = staticConfig.audit[area];
    return {
      area,
      status: audit.status,
      rulebookPages: [...audit.rulebookPages],
      sourceRefs: [...audit.sourceRefs],
      coveredByTests: [...audit.coveredByTests],
      itemCount: areaItems.length,
      expectedFieldNames: [...new Set(areaItems.flatMap((item) =>
        item.expectedFields.map((field) => expectedFieldName(field)),
      ))].sort(),
    };
  });
}

function buildFaceAuditChecklistFingerprintSource(): Pick<FaceAuditChecklistExport, 'areas' | 'items'> {
  const items = buildFaceAuditChecklist();
  return {
    areas: summarizeFaceAuditChecklist(items),
    items,
  };
}

export function buildFaceAuditChecklistExport(): FaceAuditChecklistExport {
  const source = buildFaceAuditChecklistFingerprintSource();
  return {
    version: 1,
    checklistFingerprint: faceAuditChecklistFingerprint(source),
    checklistItemCount: source.items.length,
    areas: source.areas,
    items: source.items,
  };
}

export function summarizeFaceAuditReviewAreas(
  checklistAreas: readonly FaceAuditAreaSummary[],
  reviewItems: readonly Pick<FaceAuditReviewItem, 'area' | 'reviewStatus'>[],
): FaceAuditReviewAreaSummary[] {
  return checklistAreas.map((areaSummary) => {
    const reviewCounts = reviewCountsForItems(reviewItems.filter((item) => item.area === areaSummary.area));
    return {
      ...areaSummary,
      rulebookPages: [...areaSummary.rulebookPages],
      sourceRefs: [...areaSummary.sourceRefs],
      coveredByTests: [...areaSummary.coveredByTests],
      expectedFieldNames: [...areaSummary.expectedFieldNames],
      reviewCounts,
    };
  });
}

export function summarizeFaceAuditReviewCompletion(
  reviewItems: readonly Pick<FaceAuditReviewItem, 'reviewStatus'>[],
): FaceAuditReviewCompletionSummary {
  const counts = reviewCountsForItems(reviewItems);
  const unreviewedItemCount = counts.unreviewed;
  const matchingItemCount = counts.matches_official_face;
  const differenceItemCount = counts.differs_from_official_face;
  const needsReferenceItemCount = counts.needs_better_reference;
  const totalItemCount = reviewItems.length;
  let status: FaceAuditReviewCompletionStatus = 'not_started';
  if (differenceItemCount > 0) {
    status = 'has_differences';
  } else if (needsReferenceItemCount > 0) {
    status = 'needs_better_reference';
  } else if (unreviewedItemCount === 0 && totalItemCount > 0) {
    status = 'ready_to_lock';
  } else if (unreviewedItemCount < totalItemCount) {
    status = 'in_progress';
  }
  return {
    status,
    reviewedItemCount: totalItemCount - unreviewedItemCount,
    matchingItemCount,
    differenceItemCount,
    needsReferenceItemCount,
    unreviewedItemCount,
    totalItemCount,
  };
}

export function buildFaceAuditReviewTemplate(
  checklist: FaceAuditChecklistExport = buildFaceAuditChecklistExport(),
): FaceAuditReviewTemplateExport {
  const items = checklist.items.map((item) => ({
    ...item,
    expectedFields: [...item.expectedFields],
    key: faceAuditItemKey(item),
    reviewStatus: 'unreviewed' as const,
    reviewer: '',
    reviewedAt: '',
    evidenceRef: '',
    notes: '',
  }));
  return {
    version: 1,
    checklistFingerprint: faceAuditChecklistFingerprint(checklist),
    checklistItemCount: checklist.items.length,
    evidenceSources: [],
    areas: summarizeFaceAuditReviewAreas(checklist.areas, items),
    items,
    completion: summarizeFaceAuditReviewCompletion(items),
  };
}

export function buildFaceAuditAreaReviewTemplate(
  area: FaceAuditArea,
  checklist: FaceAuditChecklistExport = buildFaceAuditChecklistExport(),
): FaceAuditAreaReviewTemplateExport {
  const fullTemplate = buildFaceAuditReviewTemplate(checklist);
  const items = fullTemplate.items
    .filter((item) => item.area === area)
    .map((item) => ({
      ...item,
      expectedFields: [...item.expectedFields],
    }));
  const areaSummary = summarizeFaceAuditReviewAreas(checklist.areas, items)
    .find((summary) => summary.area === area);
  if (!areaSummary) {
    throw new Error(`Unknown face-audit area ${area}`);
  }

  return {
    artifactType: 'face_audit_area_review',
    version: 1,
    area,
    checklistFingerprint: fullTemplate.checklistFingerprint,
    checklistItemCount: fullTemplate.checklistItemCount,
    areaItemCount: items.length,
    evidenceSources: [],
    areaSummary,
    items,
    completion: summarizeFaceAuditReviewCompletion(items),
  };
}

export function buildFaceAuditEvidenceRefTemplate(
  sourceId: string,
  area: FaceAuditArea,
  mode: FaceAuditEvidenceRefMode = 'area',
  checklist: FaceAuditChecklistExport = buildFaceAuditChecklistExport(),
): FaceAuditEvidenceRefTemplateExport {
  if (mode === 'area') {
    return {
      artifactType: 'face_audit_evidence_ref_template',
      version: 1,
      sourceId,
      area,
      mode,
      evidenceRefCount: 1,
      evidenceRefs: [faceAuditEvidenceRefForSource(sourceId, area)],
      items: [],
    };
  }

  const items = buildFaceAuditAreaReviewTemplate(area, checklist).items.map((item) => ({
    key: item.key,
    id: item.id,
    label: item.label,
    evidenceRef: faceAuditEvidenceRefForSource(sourceId, area, item.id),
  }));
  return {
    artifactType: 'face_audit_evidence_ref_template',
    version: 1,
    sourceId,
    area,
    mode,
    evidenceRefCount: items.length,
    evidenceRefs: items.map((item) => item.evidenceRef),
    items,
  };
}

function completedReviewNeedsEvidence(status: FaceAuditReviewStatus): boolean {
  return status !== 'unreviewed';
}

function completedReviewNeedsNotes(status: FaceAuditReviewStatus): boolean {
  return status === 'differs_from_official_face' || status === 'needs_better_reference';
}

function hasReviewMetadata(
  item: Pick<FaceAuditReviewItem, 'reviewer' | 'reviewedAt' | 'evidenceRef' | 'notes'>,
): boolean {
  return item.reviewer.length > 0 ||
    item.reviewedAt.length > 0 ||
    item.evidenceRef.length > 0 ||
    item.notes.length > 0;
}

function evidenceSourcesFromPayload(
  value: unknown,
  issues: FaceAuditReviewValidationIssue[],
): FaceAuditEvidenceSource[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    issues.push({field: 'evidenceSources', message: 'Face-audit review evidenceSources must be an array'});
    return [];
  }

  const sources: FaceAuditEvidenceSource[] = [];
  const seenIds = new Set<string>();
  for (const [index, rawSource] of value.entries()) {
    if (!isRecord(rawSource)) {
      issues.push({field: `evidenceSources[${index}]`, message: 'Face-audit evidence source must be an object'});
      continue;
    }

    const id = stringValue(rawSource.id);
    const label = stringValue(rawSource.label);
    const sourceType = evidenceSourceType(rawSource.sourceType);
    const citation = stringValue(rawSource.citation);
    const locator = stringValue(rawSource.locator);
    const contentHash = stringValue(rawSource.contentHash).toLowerCase();
    const notes = stringValue(rawSource.notes);

    if (!id || !validEvidenceSourceId(id)) {
      issues.push({field: `evidenceSources[${index}].id`, message: 'Face-audit evidence source id must match the evidenceRef source id format'});
    } else if (seenIds.has(id)) {
      issues.push({field: `evidenceSources[${index}].id`, message: 'Face-audit evidence source id appears more than once'});
    } else {
      seenIds.add(id);
    }
    if (!label) {
      issues.push({field: `evidenceSources[${index}].label`, message: 'Face-audit evidence source must include a label'});
    }
    if (sourceType === undefined) {
      issues.push({field: `evidenceSources[${index}].sourceType`, message: 'Face-audit evidence source type must be official_physical_component or official_high_res_component_image'});
    }
    if (!citation) {
      issues.push({field: `evidenceSources[${index}].citation`, message: 'Face-audit evidence source must include a citation'});
    }
    if (contentHash && !validEvidenceSourceContentHash(contentHash)) {
      issues.push({
        field: `evidenceSources[${index}].contentHash`,
        message: 'Face-audit evidence source contentHash must use sha256:<64 hex>, sha1:<40 hex>, or md5:<32 hex>',
      });
    }

    if (id && validEvidenceSourceId(id) && sourceType !== undefined) {
      const source: FaceAuditEvidenceSource = {id, label, sourceType, citation, notes};
      if (locator) {
        source.locator = locator;
      }
      if (contentHash && validEvidenceSourceContentHash(contentHash)) {
        source.contentHash = contentHash;
      }
      sources.push(source);
    }
  }

  return sources;
}

function completedReviewItemFromPayload(
  rawItem: Record<string, unknown>,
  expectedItem: FaceAuditReviewItem,
  evidenceSourceIds: ReadonlySet<string>,
  issues: FaceAuditReviewValidationIssue[],
): FaceAuditReviewItem {
  const status = reviewStatus(rawItem.reviewStatus);
  const reviewStatusValue = status ?? 'unreviewed';
  const itemKey = expectedItem.key;
  const rawExpectedFields = stringArray(rawItem.expectedFields);
  const reviewer = stringValue(rawItem.reviewer);
  const reviewedAt = stringValue(rawItem.reviewedAt);
  const evidenceRef = stringValue(rawItem.evidenceRef);
  const notes = stringValue(rawItem.notes);

  if (rawItem.area !== expectedItem.area) {
    issues.push({itemKey, field: 'area', message: 'Review item area must match the current checklist'});
  }
  if (rawItem.id !== expectedItem.id) {
    issues.push({itemKey, field: 'id', message: 'Review item id must match the current checklist'});
  }
  if (rawItem.label !== expectedItem.label) {
    issues.push({itemKey, field: 'label', message: 'Review item label must match the current checklist'});
  }
  if (rawExpectedFields === undefined || !sameStringArray(rawExpectedFields, expectedItem.expectedFields)) {
    issues.push({itemKey, field: 'expectedFields', message: 'Review item expected fields must match the current checklist'});
  }
  if (status === undefined) {
    issues.push({itemKey, field: 'reviewStatus', message: 'Review item status must be a known face-audit review status'});
  }
  if (completedReviewNeedsEvidence(reviewStatusValue)) {
    if (!reviewer) {
      issues.push({itemKey, field: 'reviewer', message: 'Reviewed items must include a reviewer'});
    }
    if (!validReviewTimestamp(reviewedAt)) {
      issues.push({itemKey, field: 'reviewedAt', message: 'Reviewed items must include a valid review timestamp'});
    }
    if (!evidenceRef) {
      issues.push({itemKey, field: 'evidenceRef', message: 'Reviewed items must cite official-component evidence'});
    } else {
      const evidenceTarget = parseFaceAuditEvidenceRef(evidenceRef);
      if (!evidenceTarget) {
        issues.push({
          itemKey,
          field: 'evidenceRef',
          message: 'Reviewed item evidenceRef must use official-component:<source>#<area> or official-component:<source>#<area>:<item-id>',
        });
      } else if (evidenceTarget.area !== expectedItem.area) {
        issues.push({itemKey, field: 'evidenceRef', message: 'Reviewed item evidenceRef area must match the checklist item'});
      } else if (evidenceTarget.itemId !== undefined && evidenceTarget.itemId !== expectedItem.id) {
        issues.push({itemKey, field: 'evidenceRef', message: 'Reviewed item evidenceRef item id must match the checklist item'});
      } else if (!evidenceSourceIds.has(evidenceTarget.sourceId)) {
        issues.push({itemKey, field: 'evidenceRef', message: 'Reviewed item evidenceRef source id must be declared in evidenceSources'});
      }
    }
  } else if (hasReviewMetadata({reviewer, reviewedAt, evidenceRef, notes})) {
    issues.push({
      itemKey,
      field: 'reviewStatus',
      message: 'Unreviewed items must not include reviewer, reviewedAt, evidenceRef, or notes',
    });
  }
  if (completedReviewNeedsNotes(reviewStatusValue) && !notes) {
    issues.push({itemKey, field: 'notes', message: 'Differences and missing references must include notes'});
  }
  const normalizedMetadata = reviewStatusValue === 'unreviewed'
    ? {reviewer: '', reviewedAt: '', evidenceRef: '', notes: ''}
    : {reviewer, reviewedAt, evidenceRef, notes};

  return {
    ...expectedItem,
    expectedFields: [...expectedItem.expectedFields],
    reviewStatus: reviewStatusValue,
    ...normalizedMetadata,
  };
}

export function validateFaceAuditReviewArtifact(
  artifact: unknown,
  checklist: FaceAuditChecklistExport = buildFaceAuditChecklistExport(),
): FaceAuditReviewValidationResult {
  const template = buildFaceAuditReviewTemplate(checklist);
  const issues: FaceAuditReviewValidationIssue[] = [];
  const expectedByKey = new Map(template.items.map((item) => [item.key, item]));
  const itemByKey = new Map<string, FaceAuditReviewItem>();
  const seenKeys = new Set<string>();

  if (!isRecord(artifact)) {
    return {
      ok: false,
      review: template,
      issues: [{field: 'artifact', message: 'Face-audit review artifact must be an object'}],
    };
  }

  if (artifact.version !== template.version) {
    issues.push({field: 'version', message: 'Face-audit review artifact must be version 1'});
  }
  if (artifact.checklistFingerprint !== template.checklistFingerprint) {
    issues.push({field: 'checklistFingerprint', message: 'Face-audit review artifact does not match the current checklist'});
  }
  if (artifact.checklistItemCount !== template.checklistItemCount) {
    issues.push({field: 'checklistItemCount', message: 'Face-audit review artifact item count does not match the current checklist'});
  }

  const evidenceSources = evidenceSourcesFromPayload(artifact.evidenceSources, issues);
  const evidenceSourceIds = new Set(evidenceSources.map((source) => source.id));

  if (!Array.isArray(artifact.items)) {
    issues.push({field: 'items', message: 'Face-audit review artifact items must be an array'});
  } else {
    if (artifact.items.length !== template.items.length) {
      issues.push({field: 'items', message: 'Face-audit review artifact must contain every current checklist item exactly once'});
    }
    for (const [index, rawItem] of artifact.items.entries()) {
      if (!isRecord(rawItem)) {
        issues.push({field: `items[${index}]`, message: 'Face-audit review item must be an object'});
        continue;
      }
      const key = nonEmptyString(rawItem.key);
      if (!key) {
        issues.push({field: `items[${index}].key`, message: 'Face-audit review item must include a stable key'});
        continue;
      }
      const expectedItem = expectedByKey.get(key);
      if (!expectedItem) {
        issues.push({itemKey: key, field: 'key', message: 'Face-audit review item key is not in the current checklist'});
        continue;
      }
      if (seenKeys.has(key)) {
        issues.push({itemKey: key, field: 'key', message: 'Face-audit review item key appears more than once'});
        continue;
      }
      seenKeys.add(key);
      itemByKey.set(key, completedReviewItemFromPayload(rawItem, expectedItem, evidenceSourceIds, issues));
    }
  }

  const items = template.items.map((expectedItem) => {
    const item = itemByKey.get(expectedItem.key);
    if (item) {
      return item;
    }
    if (Array.isArray(artifact.items)) {
      issues.push({
        itemKey: expectedItem.key,
        field: 'items',
        message: 'Face-audit review artifact is missing a current checklist item',
      });
    }
    return expectedItem;
  });
  const review: FaceAuditReviewTemplateExport = {
    version: template.version,
    checklistFingerprint: template.checklistFingerprint,
    checklistItemCount: template.checklistItemCount,
    evidenceSources,
    areas: summarizeFaceAuditReviewAreas(checklist.areas, items),
    items,
    completion: summarizeFaceAuditReviewCompletion(items),
  };

  return {
    ok: issues.length === 0,
    review,
    issues,
  };
}

export function validateFaceAuditAreaReviewArtifact(
  artifact: unknown,
  expectedArea?: FaceAuditArea,
  checklist: FaceAuditChecklistExport = buildFaceAuditChecklistExport(),
): FaceAuditAreaReviewValidationResult {
  const fallbackArea = expectedArea ?? FACE_AUDIT_AREAS[0];
  const fallbackTemplate = buildFaceAuditAreaReviewTemplate(fallbackArea, checklist);
  const issues: FaceAuditReviewValidationIssue[] = [];

  if (!isRecord(artifact)) {
    return {
      ok: false,
      review: fallbackTemplate,
      issues: [{field: 'artifact', message: 'Face-audit area review artifact must be an object'}],
    };
  }

  const area = faceAuditArea(artifact.area);
  if (!area) {
    issues.push({field: 'area', message: 'Face-audit area review artifact must include a known area'});
  } else if (expectedArea && area !== expectedArea) {
    issues.push({field: 'area', message: 'Face-audit area review artifact area does not match the requested area'});
  }

  const reviewArea = area ?? fallbackArea;
  const template = buildFaceAuditAreaReviewTemplate(reviewArea, checklist);
  const expectedByKey = new Map(template.items.map((item) => [item.key, item]));
  const itemByKey = new Map<string, FaceAuditReviewItem>();
  const seenKeys = new Set<string>();

  if (artifact.artifactType !== 'face_audit_area_review') {
    issues.push({field: 'artifactType', message: 'Face-audit area review artifact type must be face_audit_area_review'});
  }
  if (artifact.version !== template.version) {
    issues.push({field: 'version', message: 'Face-audit area review artifact must be version 1'});
  }
  if (artifact.checklistFingerprint !== template.checklistFingerprint) {
    issues.push({field: 'checklistFingerprint', message: 'Face-audit area review artifact does not match the current checklist'});
  }
  if (artifact.checklistItemCount !== template.checklistItemCount) {
    issues.push({field: 'checklistItemCount', message: 'Face-audit area review artifact checklist item count does not match the current checklist'});
  }
  if (artifact.areaItemCount !== template.areaItemCount) {
    issues.push({field: 'areaItemCount', message: 'Face-audit area review artifact item count does not match the current area checklist'});
  }

  const evidenceSources = evidenceSourcesFromPayload(artifact.evidenceSources, issues);
  const evidenceSourceIds = new Set(evidenceSources.map((source) => source.id));

  if (!Array.isArray(artifact.items)) {
    issues.push({field: 'items', message: 'Face-audit area review artifact items must be an array'});
  } else {
    if (artifact.items.length !== template.items.length) {
      issues.push({field: 'items', message: 'Face-audit area review artifact must contain every current item for its area exactly once'});
    }
    for (const [index, rawItem] of artifact.items.entries()) {
      if (!isRecord(rawItem)) {
        issues.push({field: `items[${index}]`, message: 'Face-audit area review item must be an object'});
        continue;
      }
      const key = nonEmptyString(rawItem.key);
      if (!key) {
        issues.push({field: `items[${index}].key`, message: 'Face-audit area review item must include a stable key'});
        continue;
      }
      const expectedItem = expectedByKey.get(key);
      if (!expectedItem) {
        issues.push({itemKey: key, field: 'key', message: 'Face-audit area review item key is not in the current area checklist'});
        continue;
      }
      if (seenKeys.has(key)) {
        issues.push({itemKey: key, field: 'key', message: 'Face-audit area review item key appears more than once'});
        continue;
      }
      seenKeys.add(key);
      itemByKey.set(key, completedReviewItemFromPayload(rawItem, expectedItem, evidenceSourceIds, issues));
    }
  }

  const items = template.items.map((expectedItem) => {
    const item = itemByKey.get(expectedItem.key);
    if (item) {
      return item;
    }
    if (Array.isArray(artifact.items)) {
      issues.push({
        itemKey: expectedItem.key,
        field: 'items',
        message: 'Face-audit area review artifact is missing a current area checklist item',
      });
    }
    return expectedItem;
  });
  const areaSummary = summarizeFaceAuditReviewAreas(checklist.areas, items)
    .find((summary) => summary.area === reviewArea) ?? template.areaSummary;
  const review: FaceAuditAreaReviewTemplateExport = {
    artifactType: 'face_audit_area_review',
    version: template.version,
    area: reviewArea,
    checklistFingerprint: template.checklistFingerprint,
    checklistItemCount: template.checklistItemCount,
    areaItemCount: template.areaItemCount,
    evidenceSources,
    areaSummary,
    items,
    completion: summarizeFaceAuditReviewCompletion(items),
  };

  return {
    ok: issues.length === 0,
    review,
    issues,
  };
}

function selectedEvidenceSourceFromArtifact(
  sourceArtifact: unknown,
  sourceId: string,
  issues: FaceAuditReviewValidationIssue[],
): FaceAuditEvidenceSource | undefined {
  if (!isRecord(sourceArtifact) || !Array.isArray(sourceArtifact.evidenceSources)) {
    issues.push({
      field: 'sourceArtifact.evidenceSources',
      message: 'Face-audit match template source artifact must include an evidenceSources array',
    });
    return undefined;
  }

  const rawEvidenceSource = sourceArtifact.evidenceSources.find((source) =>
    isRecord(source) && stringValue(source.id) === sourceId);
  if (rawEvidenceSource === undefined) {
    issues.push({
      field: 'sourceId',
      message: `Face-audit match template source id is not declared in the source artifact: ${sourceId}`,
    });
    return undefined;
  }

  const sourceIssues: FaceAuditReviewValidationIssue[] = [];
  const [evidenceSource] = evidenceSourcesFromPayload([rawEvidenceSource], sourceIssues);
  issues.push(...sourceIssues.map((issue) => ({
    ...issue,
    field: `sourceArtifact.${issue.field}`,
  })));
  return evidenceSource;
}

function evidenceSourcesFromSourceArtifact(
  sourceArtifact: unknown,
  issues: FaceAuditReviewValidationIssue[],
): FaceAuditEvidenceSource[] | undefined {
  if (!isRecord(sourceArtifact) || !Array.isArray(sourceArtifact.evidenceSources)) {
    issues.push({
      field: 'sourceArtifact.evidenceSources',
      message: 'Face-audit match template source artifact must include an evidenceSources array',
    });
    return undefined;
  }

  const sourceIssues: FaceAuditReviewValidationIssue[] = [];
  const evidenceSources = evidenceSourcesFromPayload(sourceArtifact.evidenceSources, sourceIssues);
  issues.push(...sourceIssues.map((issue) => ({
    ...issue,
    field: `sourceArtifact.${issue.field}`,
  })));
  return evidenceSources;
}

function declaredEvidenceSourceIdsFromSourceArtifact(
  sourceArtifact: unknown,
  issues: FaceAuditReviewValidationIssue[],
): Set<string> | undefined {
  if (!isRecord(sourceArtifact) || !Array.isArray(sourceArtifact.evidenceSources)) {
    issues.push({
      field: 'sourceArtifact.evidenceSources',
      message: 'Face-audit source ids by area template source artifact must include an evidenceSources array',
    });
    return undefined;
  }

  const sourceIds = new Set<string>();
  for (const source of sourceArtifact.evidenceSources) {
    if (!isRecord(source)) {
      continue;
    }
    const sourceId = nonEmptyString(source.id);
    if (sourceId !== undefined) {
      sourceIds.add(sourceId);
    }
  }
  return sourceIds;
}

export function buildFaceAuditSourceIdsByAreaTemplate(
  sourceArtifact: unknown,
  defaultSourceId: string,
  sourceIdsByAreaOverrides: unknown = {},
): FaceAuditSourceIdsByAreaTemplateResult {
  const issues: FaceAuditReviewValidationIssue[] = [];
  const normalizedDefaultSourceId = defaultSourceId.trim();
  const defaultSourceIdIsValid = validEvidenceSourceId(normalizedDefaultSourceId);
  if (!defaultSourceIdIsValid) {
    issues.push({
      field: 'defaultSourceId',
      message: 'Face-audit source ids by area template default source id must match the evidenceRef source id format',
    });
  }

  const declaredSourceIds = declaredEvidenceSourceIdsFromSourceArtifact(sourceArtifact, issues);
  if (declaredSourceIds !== undefined && defaultSourceIdIsValid && !declaredSourceIds.has(normalizedDefaultSourceId)) {
    issues.push({
      field: 'defaultSourceId',
      message: `Face-audit source ids by area template default source id is not declared in the source artifact: ${normalizedDefaultSourceId}`,
    });
  }

  const sourceIdsByArea = Object.fromEntries(FACE_AUDIT_AREAS.map((area) => [
    area,
    normalizedDefaultSourceId,
  ])) as FaceAuditSourceIdsByAreaMap;

  if (!isRecord(sourceIdsByAreaOverrides)) {
    issues.push({
      field: 'sourceIdsByAreaOverrides',
      message: 'Face-audit source ids by area template overrides must map face-audit areas to source ids',
    });
  } else {
    for (const [rawArea, rawSourceId] of Object.entries(sourceIdsByAreaOverrides)) {
      const area = parseFaceAuditArea(rawArea);
      if (area === undefined) {
        issues.push({
          field: `sourceIdsByAreaOverrides.${rawArea}`,
          message: `Face-audit source ids by area template area is not known: ${rawArea}`,
        });
        continue;
      }
      const sourceId = stringValue(rawSourceId);
      if (!validEvidenceSourceId(sourceId)) {
        issues.push({
          field: `sourceIdsByAreaOverrides.${area}`,
          message: `Face-audit source ids by area template source id for ${area} must match the evidenceRef source id format`,
        });
        continue;
      }
      if (declaredSourceIds !== undefined && !declaredSourceIds.has(sourceId)) {
        issues.push({
          field: `sourceIdsByAreaOverrides.${area}`,
          message: `Face-audit source ids by area template source id for ${area} is not declared in the source artifact: ${sourceId}`,
        });
        continue;
      }
      sourceIdsByArea[area] = sourceId;
    }
  }

  if (issues.length > 0) {
    return {
      ok: false,
      issueCount: issues.length,
      issues,
    };
  }
  return {
    ok: true,
    sourceIdsByArea,
    issueCount: 0,
    issues: [],
  };
}

function faceAuditMatchTemplateInputIssues(
  sourceId: string,
  reviewer: string,
  reviewedAt: string,
  mode: FaceAuditEvidenceRefMode,
): FaceAuditReviewValidationIssue[] {
  const issues: FaceAuditReviewValidationIssue[] = [];
  if (!validEvidenceSourceId(sourceId)) {
    issues.push({
      field: 'sourceId',
      message: 'Face-audit match template source id must match the evidenceRef source id format',
    });
  }
  if (!reviewer) {
    issues.push({
      field: 'reviewer',
      message: 'Face-audit match template reviewer is required',
    });
  }
  if (!validReviewTimestamp(reviewedAt)) {
    issues.push({
      field: 'reviewedAt',
      message: 'Face-audit match template reviewedAt must be a valid review timestamp',
    });
  }
  if (parseFaceAuditEvidenceRefMode(mode) === undefined) {
    issues.push({
      field: 'mode',
      message: 'Face-audit match template mode must be area or items',
    });
  }
  return issues;
}

export function buildFaceAuditAreaMatchReviewArtifact(
  area: FaceAuditArea,
  sourceArtifact: unknown,
  sourceId: string,
  reviewer: string,
  reviewedAt: string,
  mode: FaceAuditEvidenceRefMode = 'area',
  checklist: FaceAuditChecklistExport = buildFaceAuditChecklistExport(),
): FaceAuditAreaReviewValidationResult {
  const template = buildFaceAuditAreaReviewTemplate(area, checklist);
  const normalizedSourceId = sourceId.trim();
  const normalizedReviewer = reviewer.trim();
  const normalizedReviewedAt = reviewedAt.trim();
  const issues = faceAuditMatchTemplateInputIssues(
    normalizedSourceId,
    normalizedReviewer,
    normalizedReviewedAt,
    mode,
  );
  const evidenceSource = selectedEvidenceSourceFromArtifact(sourceArtifact, normalizedSourceId, issues);
  if (issues.length > 0 || evidenceSource === undefined) {
    return {
      ok: false,
      review: template,
      issues,
    };
  }

  const artifact = {
    ...template,
    evidenceSources: [evidenceSource],
    items: template.items.map((item) => ({
      ...item,
      reviewStatus: 'matches_official_face',
      reviewer: normalizedReviewer,
      reviewedAt: normalizedReviewedAt,
      evidenceRef: faceAuditEvidenceRefForSource(
        normalizedSourceId,
        area,
        mode === 'items' ? item.id : undefined,
      ),
      notes: '',
    })),
  };
  return validateFaceAuditAreaReviewArtifact(artifact, area, checklist);
}

export function buildFaceAuditMatchReviewArtifact(
  sourceArtifact: unknown,
  sourceId: string,
  reviewer: string,
  reviewedAt: string,
  mode: FaceAuditEvidenceRefMode = 'area',
  checklist: FaceAuditChecklistExport = buildFaceAuditChecklistExport(),
): FaceAuditReviewValidationResult {
  const template = buildFaceAuditReviewTemplate(checklist);
  const normalizedSourceId = sourceId.trim();
  const normalizedReviewer = reviewer.trim();
  const normalizedReviewedAt = reviewedAt.trim();
  const issues = faceAuditMatchTemplateInputIssues(
    normalizedSourceId,
    normalizedReviewer,
    normalizedReviewedAt,
    mode,
  );
  const evidenceSource = selectedEvidenceSourceFromArtifact(sourceArtifact, normalizedSourceId, issues);
  if (issues.length > 0 || evidenceSource === undefined) {
    return {
      ok: false,
      review: template,
      issues,
    };
  }

  const artifact = {
    ...template,
    evidenceSources: [evidenceSource],
    items: template.items.map((item) => ({
      ...item,
      reviewStatus: 'matches_official_face',
      reviewer: normalizedReviewer,
      reviewedAt: normalizedReviewedAt,
      evidenceRef: faceAuditEvidenceRefForSource(
        normalizedSourceId,
        item.area,
        mode === 'items' ? item.id : undefined,
      ),
      notes: '',
    })),
  };
  return validateFaceAuditReviewArtifact(artifact, checklist);
}

export function buildFaceAuditMappedMatchReviewArtifact(
  sourceArtifact: unknown,
  sourceIdsByArea: unknown,
  reviewer: string,
  reviewedAt: string,
  mode: FaceAuditEvidenceRefMode = 'area',
  checklist: FaceAuditChecklistExport = buildFaceAuditChecklistExport(),
): FaceAuditReviewValidationResult {
  const template = buildFaceAuditReviewTemplate(checklist);
  const normalizedReviewer = reviewer.trim();
  const normalizedReviewedAt = reviewedAt.trim();
  const issues = faceAuditMatchTemplateInputIssues(
    'placeholder-source-id',
    normalizedReviewer,
    normalizedReviewedAt,
    mode,
  ).filter((issue) => issue.field !== 'sourceId');

  if (!isRecord(sourceIdsByArea)) {
    issues.push({
      field: 'sourceIdsByArea',
      message: 'Face-audit match template sourceIdsByArea must map every face-audit area to a source id',
    });
  }

  const evidenceSources = evidenceSourcesFromSourceArtifact(sourceArtifact, issues);
  const evidenceSourceById = new Map((evidenceSources ?? []).map((source) => [source.id, source]));
  const sourceIdByArea = new Map<FaceAuditArea, string>();
  const selectedSourceIds: string[] = [];

  if (isRecord(sourceIdsByArea)) {
    for (const area of FACE_AUDIT_AREAS) {
      const sourceId = stringValue(sourceIdsByArea[area]);
      if (!validEvidenceSourceId(sourceId)) {
        issues.push({
          field: `sourceIdsByArea.${area}`,
          message: `Face-audit match template source id for ${area} must match the evidenceRef source id format`,
        });
        continue;
      }
      if (!evidenceSourceById.has(sourceId)) {
        issues.push({
          field: `sourceIdsByArea.${area}`,
          message: `Face-audit match template source id for ${area} is not declared in the source artifact: ${sourceId}`,
        });
        continue;
      }
      sourceIdByArea.set(area, sourceId);
      if (!selectedSourceIds.includes(sourceId)) {
        selectedSourceIds.push(sourceId);
      }
    }
  }

  if (issues.length > 0 || sourceIdByArea.size !== FACE_AUDIT_AREAS.length) {
    return {
      ok: false,
      review: template,
      issues,
    };
  }

  const artifact = {
    ...template,
    evidenceSources: selectedSourceIds.map((sourceId) => evidenceSourceById.get(sourceId)!),
    items: template.items.map((item) => {
      const sourceId = sourceIdByArea.get(item.area)!;
      return {
        ...item,
        reviewStatus: 'matches_official_face',
        reviewer: normalizedReviewer,
        reviewedAt: normalizedReviewedAt,
        evidenceRef: faceAuditEvidenceRefForSource(
          sourceId,
          item.area,
          mode === 'items' ? item.id : undefined,
        ),
        notes: '',
      };
    }),
  };
  return validateFaceAuditReviewArtifact(artifact, checklist);
}

function prefixedArtifactIssue(
  artifactIndex: number,
  issue: FaceAuditReviewValidationIssue,
): FaceAuditReviewValidationIssue {
  return {
    ...issue,
    field: `artifacts[${artifactIndex}].${issue.field}`,
  };
}

function evidenceSourceFingerprint(source: FaceAuditEvidenceSource): string {
  return JSON.stringify({
    id: source.id,
    label: source.label,
    sourceType: source.sourceType,
    citation: source.citation,
    locator: source.locator ?? '',
    contentHash: source.contentHash ?? '',
    notes: source.notes,
  });
}

function reviewedItemFingerprint(item: FaceAuditReviewItem): string {
  return JSON.stringify({
    key: item.key,
    reviewStatus: item.reviewStatus,
    reviewer: item.reviewer,
    reviewedAt: item.reviewedAt,
    evidenceRef: item.evidenceRef,
    notes: item.notes,
  });
}

export function mergeFaceAuditReviewArtifacts(
  artifacts: readonly unknown[],
  checklist: FaceAuditChecklistExport = buildFaceAuditChecklistExport(),
): FaceAuditReviewValidationResult {
  const template = buildFaceAuditReviewTemplate(checklist);
  const issues: FaceAuditReviewValidationIssue[] = [];
  const evidenceSources: FaceAuditEvidenceSource[] = [];
  const evidenceSourceById = new Map<string, FaceAuditEvidenceSource>();
  const reviewedItemByKey = new Map<string, FaceAuditReviewItem>();

  for (const [artifactIndex, artifact] of artifacts.entries()) {
    const isAreaArtifact = isRecord(artifact) && artifact.artifactType === 'face_audit_area_review';
    const validation = isAreaArtifact
      ? validateFaceAuditAreaReviewArtifact(artifact, undefined, checklist)
      : validateFaceAuditReviewArtifact(artifact, checklist);

    if (!validation.ok) {
      issues.push(...validation.issues.map((issue) => prefixedArtifactIssue(artifactIndex, issue)));
      continue;
    }

    for (const source of validation.review.evidenceSources) {
      const existing = evidenceSourceById.get(source.id);
      if (!existing) {
        const normalized = {...source};
        evidenceSourceById.set(normalized.id, normalized);
        evidenceSources.push(normalized);
      } else if (evidenceSourceFingerprint(existing) !== evidenceSourceFingerprint(source)) {
        issues.push({
          field: `artifacts[${artifactIndex}].evidenceSources`,
          message: `Face-audit evidence source ${source.id} conflicts with an earlier artifact`,
        });
      }
    }

    for (const item of validation.review.items) {
      if (item.reviewStatus === 'unreviewed') {
        continue;
      }
      const existing = reviewedItemByKey.get(item.key);
      if (!existing) {
        reviewedItemByKey.set(item.key, {
          ...item,
          expectedFields: [...item.expectedFields],
        });
      } else if (reviewedItemFingerprint(existing) !== reviewedItemFingerprint(item)) {
        issues.push({
          itemKey: item.key,
          field: `artifacts[${artifactIndex}].items`,
          message: 'Face-audit reviewed item conflicts with an earlier artifact',
        });
      }
    }
  }

  const mergedArtifact: FaceAuditReviewTemplateExport = {
    ...template,
    evidenceSources,
    items: template.items.map((item) => reviewedItemByKey.get(item.key) ?? item),
  };
  const validation = validateFaceAuditReviewArtifact(mergedArtifact, checklist);

  return {
    ok: issues.length === 0 && validation.ok,
    review: validation.review,
    issues: [...issues, ...validation.issues],
  };
}

function faceAuditReviewStatusArtifactCounts(
  artifacts: readonly unknown[],
): FaceAuditReviewStatusArtifactCounts {
  let fullReviewArtifactCount = 0;
  let areaReviewArtifactCount = 0;
  let unknownArtifactCount = 0;

  for (const artifact of artifacts) {
    if (!isRecord(artifact)) {
      unknownArtifactCount += 1;
    } else if (artifact.artifactType === 'face_audit_area_review') {
      areaReviewArtifactCount += 1;
    } else if (artifact.artifactType === undefined && artifact.version === 1) {
      fullReviewArtifactCount += 1;
    } else {
      unknownArtifactCount += 1;
    }
  }

  return {
    fullReviewArtifactCount,
    areaReviewArtifactCount,
    unknownArtifactCount,
  };
}

function emptyAreaCompletionCounts(): FaceAuditReviewAreaCompletionCounts {
  return {
    not_started: 0,
    in_progress: 0,
    ready_to_lock: 0,
    has_differences: 0,
    needs_better_reference: 0,
  };
}

function faceAuditAreaCompletionCounts(
  areaProgress: readonly Pick<FaceAuditReviewStatusAreaReport, 'completionStatus'>[],
): FaceAuditReviewAreaCompletionCounts {
  const counts = emptyAreaCompletionCounts();
  for (const area of areaProgress) {
    counts[area.completionStatus] += 1;
  }
  return counts;
}

export function summarizeFaceAuditReviewStatus(
  artifacts: readonly unknown[],
  checklist: FaceAuditChecklistExport = buildFaceAuditChecklistExport(),
): FaceAuditReviewStatusReport {
  const validation = mergeFaceAuditReviewArtifacts(artifacts, checklist);
  const review = validation.review;
  const areaProgress: FaceAuditReviewStatusAreaReport[] = review.areas.map((areaSummary) => {
    const areaItems = review.items.filter((item) => item.area === areaSummary.area);
    const completion = summarizeFaceAuditReviewCompletion(areaItems);
    const evidenceRefs = uniqueSorted(areaItems
      .map((item) => item.evidenceRef)
      .filter((ref) => ref.length > 0));
    const evidenceCoverage = evidenceCoverageForArea(areaSummary.area, evidenceRefs);
    const evidenceSourceIds = uniqueSorted(evidenceRefs
      .map((ref) => parseFaceAuditEvidenceRef(ref)?.sourceId)
      .filter((sourceId): sourceId is string => sourceId !== undefined));
    const reviewedItems = areaItems.filter((item) => item.reviewStatus !== 'unreviewed');
    const reviewedAtValues = dateSorted(reviewedItems
      .map((item) => item.reviewedAt)
      .filter(validReviewTimestamp));
    return {
      area: areaSummary.area,
      status: areaSummary.status,
      itemCount: areaSummary.itemCount,
      reviewedItemCount: completion.reviewedItemCount,
      matchingItemCount: completion.matchingItemCount,
      differenceItemCount: completion.differenceItemCount,
      needsReferenceItemCount: completion.needsReferenceItemCount,
      unreviewedItemCount: completion.unreviewedItemCount,
      ...evidenceCoverage,
      evidenceSourceIds,
      evidenceRefs,
      reviewers: uniqueSorted(reviewedItems
        .map((item) => item.reviewer)
        .filter((reviewer) => reviewer.length > 0)),
      firstReviewedAt: reviewedAtValues[0] ?? '',
      lastReviewedAt: reviewedAtValues[reviewedAtValues.length - 1] ?? '',
      differenceItemKeys: areaItems
        .filter((item) => item.reviewStatus === 'differs_from_official_face')
        .map((item) => item.key),
      needsReferenceItemKeys: areaItems
        .filter((item) => item.reviewStatus === 'needs_better_reference')
        .map((item) => item.key),
      unreviewedItemKeys: areaItems
        .filter((item) => item.reviewStatus === 'unreviewed')
        .map((item) => item.key),
      completionStatus: completion.status,
      reviewCounts: {...areaSummary.reviewCounts},
    };
  });
  const usedEvidenceSourceIds = uniqueSorted(areaProgress.flatMap((area) => area.evidenceSourceIds));
  const usedEvidenceSourceIdSet = new Set(usedEvidenceSourceIds);
  const unusedEvidenceSourceIds = uniqueSorted(review.evidenceSources
    .map((source) => source.id)
    .filter((sourceId) => !usedEvidenceSourceIdSet.has(sourceId)));
  return {
    artifactType: 'face_audit_review_status',
    version: 1,
    ok: validation.ok,
    artifactCount: artifacts.length,
    artifactCounts: faceAuditReviewStatusArtifactCounts(artifacts),
    checklistFingerprint: review.checklistFingerprint,
    reviewFingerprint: faceAuditReviewFingerprint(review),
    checklistItemCount: review.checklistItemCount,
    evidenceSourceCount: review.evidenceSources.length,
    usedEvidenceSourceCount: usedEvidenceSourceIds.length,
    usedEvidenceSourceIds,
    unusedEvidenceSourceCount: unusedEvidenceSourceIds.length,
    unusedEvidenceSourceIds,
    completion: {...review.completion},
    areaCompletionCounts: faceAuditAreaCompletionCounts(areaProgress),
    areaProgress,
    issueCount: validation.issues.length,
    issues: validation.issues.map((issue) => ({...issue})),
  };
}

function faceAuditTodoNextStep(area: FaceAuditReviewStatusAreaReport): FaceAuditReviewTodoNextStep {
  if (area.differenceItemCount > 0) {
    return 'resolve_differences';
  }
  if (area.needsReferenceItemCount > 0) {
    return 'find_better_reference';
  }
  return 'review_unreviewed_items';
}

function faceAuditTodoAreaCommands(area: FaceAuditArea): FaceAuditReviewTodoAreaCommands {
  return {
    blankTemplate: `npm run face-audit:area-template -- ${area}`,
    blankTemplateWithSources: `npm run face-audit:area-template-with-sources -- ${area} .\\path\\to\\evidence-sources.json`,
    areaMatchTemplate: `npm run face-audit:area-match-template -- ${area} .\\path\\to\\evidence-sources.json <source-id> <reviewer> <reviewed-at>`,
    areaMatchTemplateWithItemRefs: `npm run face-audit:area-match-template -- ${area} .\\path\\to\\evidence-sources.json <source-id> <reviewer> <reviewed-at> items`,
  };
}

function faceAuditTodoCommands(): FaceAuditReviewTodoCommands {
  return {
    blankTemplate: 'npm run face-audit:template',
    blankTemplateWithSources: 'npm run face-audit:template-with-sources -- .\\path\\to\\evidence-sources.json',
    sourceIdsByAreaTemplate: 'npm run face-audit:source-ids-by-area-template -- .\\path\\to\\evidence-sources.json <default-source-id> [area=source-id...]',
    reviewMatchTemplate: 'npm run face-audit:review-match-template -- .\\path\\to\\evidence-sources.json <source-id> <reviewer> <reviewed-at>',
    reviewMatchTemplateWithItemRefs: 'npm run face-audit:review-match-template -- .\\path\\to\\evidence-sources.json <source-id> <reviewer> <reviewed-at> items',
    reviewMatchTemplateByArea: 'npm run face-audit:review-match-template-by-area -- .\\path\\to\\evidence-sources.json .\\path\\to\\source-ids-by-area.json <reviewer> <reviewed-at>',
    reviewMatchTemplateByAreaWithItemRefs: 'npm run face-audit:review-match-template-by-area -- .\\path\\to\\evidence-sources.json .\\path\\to\\source-ids-by-area.json <reviewer> <reviewed-at> items',
  };
}

function faceAuditTodoItemKeys(area: FaceAuditReviewStatusAreaReport): string[] {
  return [
    ...area.differenceItemKeys,
    ...area.needsReferenceItemKeys,
    ...area.unreviewedItemKeys,
  ];
}

export function buildFaceAuditReviewTodo(
  artifacts: readonly unknown[],
  checklist: FaceAuditChecklistExport = buildFaceAuditChecklistExport(),
): FaceAuditReviewTodoReport {
  const status = summarizeFaceAuditReviewStatus(artifacts, checklist);
  const areas = status.areaProgress
    .filter((area) => area.completionStatus !== 'ready_to_lock')
    .map((area) => {
      const remainingItemKeys = faceAuditTodoItemKeys(area);
      return {
        area: area.area,
        status: area.status,
        completionStatus: area.completionStatus,
        nextStep: faceAuditTodoNextStep(area),
        itemCount: area.itemCount,
        reviewedItemCount: area.reviewedItemCount,
        matchingItemCount: area.matchingItemCount,
        differenceItemCount: area.differenceItemCount,
        needsReferenceItemCount: area.needsReferenceItemCount,
        unreviewedItemCount: area.unreviewedItemCount,
        remainingItemCount: area.differenceItemCount + area.needsReferenceItemCount + area.unreviewedItemCount,
        evidenceRefCount: area.evidenceRefCount,
        areaLevelEvidenceRefCount: area.areaLevelEvidenceRefCount,
        itemSpecificEvidenceRefCount: area.itemSpecificEvidenceRefCount,
        itemSpecificEvidenceItemCount: area.itemSpecificEvidenceItemCount,
        evidenceSourceIds: [...area.evidenceSourceIds],
        nextItemKeys: remainingItemKeys.slice(0, 10),
        remainingItemKeyCount: remainingItemKeys.length,
        commands: faceAuditTodoAreaCommands(area.area),
      };
    });

  return {
    artifactType: 'face_audit_review_todo',
    version: 1,
    ok: status.ok,
    artifactCount: status.artifactCount,
    checklistFingerprint: status.checklistFingerprint,
    reviewFingerprint: status.reviewFingerprint,
    checklistItemCount: status.checklistItemCount,
    completion: {...status.completion},
    pendingAreaCount: areas.length,
    readyAreaCount: status.areaCompletionCounts.ready_to_lock,
    issueCount: status.issueCount,
    commands: faceAuditTodoCommands(),
    areas,
    issues: status.issues.map((issue) => ({...issue})),
  };
}

export function buildFaceAuditReviewTodoSummary(todo: FaceAuditReviewTodoReport): FaceAuditReviewTodoSummaryReport {
  return {
    artifactType: 'face_audit_review_todo_summary',
    version: 1,
    ok: todo.ok,
    artifactCount: todo.artifactCount,
    checklistFingerprint: todo.checklistFingerprint,
    reviewFingerprint: todo.reviewFingerprint,
    checklistItemCount: todo.checklistItemCount,
    completion: {...todo.completion},
    pendingAreaCount: todo.pendingAreaCount,
    readyAreaCount: todo.readyAreaCount,
    pendingItemCount: todo.areas.reduce((total, area) => total + area.remainingItemCount, 0),
    unfinishedAreas: todo.areas.map((area) => ({
      area: area.area,
      completionStatus: area.completionStatus,
      nextStep: area.nextStep,
      remainingItemCount: area.remainingItemCount,
    })),
    issueCount: todo.issueCount,
    issues: todo.issues.map((issue) => ({...issue})),
  };
}

export function buildFaceAuditAreaReviewTodoSummary(
  artifacts: readonly unknown[],
  area: FaceAuditArea,
  checklist: FaceAuditChecklistExport = buildFaceAuditChecklistExport(),
): FaceAuditAreaReviewTodoSummaryReport {
  const status = summarizeFaceAuditReviewStatus(artifacts, checklist);
  const areaProgress = status.areaProgress.find((candidate) => candidate.area === area);
  if (!areaProgress) {
    throw new Error(`Unknown face-audit area ${area}`);
  }
  const remainingItemCount =
    areaProgress.differenceItemCount +
    areaProgress.needsReferenceItemCount +
    areaProgress.unreviewedItemCount;
  return {
    artifactType: 'face_audit_area_review_todo_summary',
    version: 1,
    ok: status.ok,
    artifactCount: status.artifactCount,
    area,
    status: areaProgress.status,
    checklistFingerprint: status.checklistFingerprint,
    reviewFingerprint: status.reviewFingerprint,
    checklistItemCount: status.checklistItemCount,
    itemCount: areaProgress.itemCount,
    completionStatus: areaProgress.completionStatus,
    nextStep: areaProgress.completionStatus === 'ready_to_lock' ? 'none' : faceAuditTodoNextStep(areaProgress),
    pendingItemCount: remainingItemCount,
    remainingItemCount,
    reviewedItemCount: areaProgress.reviewedItemCount,
    matchingItemCount: areaProgress.matchingItemCount,
    differenceItemCount: areaProgress.differenceItemCount,
    needsReferenceItemCount: areaProgress.needsReferenceItemCount,
    unreviewedItemCount: areaProgress.unreviewedItemCount,
    evidenceRefCount: areaProgress.evidenceRefCount,
    areaLevelEvidenceRefCount: areaProgress.areaLevelEvidenceRefCount,
    itemSpecificEvidenceRefCount: areaProgress.itemSpecificEvidenceRefCount,
    itemSpecificEvidenceItemCount: areaProgress.itemSpecificEvidenceItemCount,
    evidenceSourceIds: [...areaProgress.evidenceSourceIds],
    issueCount: status.issueCount,
    issues: status.issues.map((issue) => ({...issue})),
  };
}

function faceAuditPlanItemNextStep(item: Pick<FaceAuditReviewItem, 'reviewStatus'>): FaceAuditReviewTodoNextStep {
  if (item.reviewStatus === 'differs_from_official_face') {
    return 'resolve_differences';
  }
  if (item.reviewStatus === 'needs_better_reference') {
    return 'find_better_reference';
  }
  return 'review_unreviewed_items';
}

export function buildFaceAuditReviewPlan(
  artifacts: readonly unknown[],
  checklist: FaceAuditChecklistExport = buildFaceAuditChecklistExport(),
): FaceAuditReviewPlanReport {
  const handoff = buildFaceAuditReviewerHandoff(artifacts, checklist);
  const areas = handoff.areas.map((areaHandoff) => {
    const items = areaHandoff.reviewArtifact.items
      .filter((item) => item.reviewStatus !== 'matches_official_face')
      .map((item) => ({
        key: item.key,
        id: item.id,
        label: item.label,
        expectedFields: [...item.expectedFields],
        reviewStatus: item.reviewStatus,
        nextStep: faceAuditPlanItemNextStep(item),
        evidenceRef: item.evidenceRef,
        notes: item.notes,
      }));
    return {
      ...areaHandoff.todo,
      evidenceSourceIds: [...areaHandoff.todo.evidenceSourceIds],
      nextItemKeys: [...areaHandoff.todo.nextItemKeys],
      commands: {...areaHandoff.todo.commands},
      items,
    };
  });

  return {
    artifactType: 'face_audit_review_plan',
    version: 1,
    ok: handoff.ok,
    artifactCount: handoff.artifactCount,
    checklistFingerprint: handoff.checklistFingerprint,
    reviewFingerprint: handoff.reviewFingerprint,
    checklistItemCount: handoff.checklistItemCount,
    completion: {...handoff.completion},
    pendingAreaCount: handoff.pendingAreaCount,
    readyAreaCount: handoff.readyAreaCount,
    pendingItemCount: areas.reduce((total, area) => total + area.items.length, 0),
    issueCount: handoff.issueCount,
    commands: {...handoff.todo.commands},
    areas,
    issues: handoff.issues.map((issue) => ({...issue})),
  };
}

const FACE_AUDIT_REVIEW_SHEET_COLUMNS = [
  'area',
  'itemId',
  'itemKey',
  'label',
  'expectedFields',
  'reviewStatus',
  'nextStep',
  'reviewer',
  'reviewedAt',
  'evidenceRef',
  'notes',
] as const;

function faceAuditReviewSheetCell(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => faceAuditReviewSheetCell(entry)).join('; ');
  }
  return String(value ?? '').replace(/[\t\r\n]+/g, ' ');
}

function faceAuditReviewSheetLine(cells: readonly unknown[]): string {
  return cells.map((cell) => faceAuditReviewSheetCell(cell)).join('\t');
}

function faceAuditReviewSheetRows(items: readonly FaceAuditReviewItem[]): string[] {
  return items.map((item) => faceAuditReviewSheetLine([
    item.area,
    item.id,
    item.key,
    item.label,
    item.expectedFields,
    item.reviewStatus,
    item.reviewStatus === 'matches_official_face' ? '' : faceAuditPlanItemNextStep(item),
    item.reviewer,
    item.reviewedAt,
    item.evidenceRef,
    item.notes,
  ]));
}

function faceAuditReviewSheetText(rows: readonly string[]): string {
  const tsv = [
    faceAuditReviewSheetLine(FACE_AUDIT_REVIEW_SHEET_COLUMNS),
    ...rows,
  ].join('\n');
  return `${tsv}\n`;
}

export function buildFaceAuditReviewSheet(
  artifacts: readonly unknown[],
  checklist: FaceAuditChecklistExport = buildFaceAuditChecklistExport(),
): FaceAuditReviewSheetResult {
  const validation = mergeFaceAuditReviewArtifacts(artifacts, checklist);
  const rows = faceAuditReviewSheetRows(validation.review.items);

  return {
    ok: validation.ok,
    checklistFingerprint: validation.review.checklistFingerprint,
    reviewFingerprint: faceAuditReviewFingerprint(validation.review),
    rowCount: rows.length,
    tsv: faceAuditReviewSheetText(rows),
    issueCount: validation.issues.length,
    issues: validation.issues.map((issue) => ({...issue})),
  };
}

export function buildFaceAuditAreaReviewSheet(
  artifacts: readonly unknown[],
  area: FaceAuditArea,
  checklist: FaceAuditChecklistExport = buildFaceAuditChecklistExport(),
): FaceAuditAreaReviewSheetResult {
  const validation = mergeFaceAuditReviewArtifacts(artifacts, checklist);
  const areaItems = validation.review.items.filter((item) => item.area === area);
  const rows = faceAuditReviewSheetRows(areaItems);

  return {
    ok: validation.ok,
    area,
    areaItemCount: checklist.items.filter((item) => item.area === area).length,
    checklistFingerprint: validation.review.checklistFingerprint,
    reviewFingerprint: faceAuditReviewFingerprint(validation.review),
    rowCount: rows.length,
    tsv: faceAuditReviewSheetText(rows),
    issueCount: validation.issues.length,
    issues: validation.issues.map((issue) => ({...issue})),
  };
}

function faceAuditReviewSheetLines(tsv: string): string[] {
  const lines = tsv.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

export function applyFaceAuditReviewSheet(
  artifacts: readonly unknown[],
  reviewSheetTsv: string,
  checklist: FaceAuditChecklistExport = buildFaceAuditChecklistExport(),
): FaceAuditReviewSheetImportResult {
  const baseValidation = mergeFaceAuditReviewArtifacts(artifacts, checklist);
  const baseReviewFingerprint = faceAuditReviewFingerprint(baseValidation.review);
  const issues: FaceAuditReviewValidationIssue[] = [...baseValidation.issues];
  const lines = faceAuditReviewSheetLines(reviewSheetTsv);
  const expectedHeader = faceAuditReviewSheetLine(FACE_AUDIT_REVIEW_SHEET_COLUMNS);
  const rowsByKey = new Map<string, Record<string, unknown>>();
  const seenKeys = new Set<string>();

  if (lines.length === 0) {
    issues.push({
      field: 'reviewSheet',
      message: 'Face-audit review sheet TSV must include a header row',
    });
  } else if (lines[0] !== expectedHeader) {
    issues.push({
      field: 'reviewSheet.header',
      message: 'Face-audit review sheet header must match the exported TSV columns',
    });
  } else {
    const itemByKey = new Map(baseValidation.review.items.map((item) => [item.key, item]));
    for (const [lineIndex, line] of lines.slice(1).entries()) {
      const rowNumber = lineIndex + 2;
      const cells = line.split('\t');
      if (cells.length !== FACE_AUDIT_REVIEW_SHEET_COLUMNS.length) {
        issues.push({
          field: `reviewSheet.rows[${lineIndex}]`,
          message: `Face-audit review sheet row ${rowNumber} must contain ${FACE_AUDIT_REVIEW_SHEET_COLUMNS.length} TSV cells`,
        });
        continue;
      }

      const area = cells[0] ?? '';
      const itemId = cells[1] ?? '';
      const itemKey = cells[2] ?? '';
      const label = cells[3] ?? '';
      const expectedFields = cells[4] ?? '';
      const reviewStatusValue = cells[5] ?? '';
      const reviewer = cells[7] ?? '';
      const reviewedAt = cells[8] ?? '';
      const evidenceRef = cells[9] ?? '';
      const notes = cells[10] ?? '';
      const expectedItem = itemByKey.get(itemKey);
      if (!expectedItem) {
        issues.push({
          itemKey,
          field: `reviewSheet.rows[${lineIndex}].itemKey`,
          message: 'Face-audit review sheet item key is not in the current checklist',
        });
        continue;
      }
      if (seenKeys.has(itemKey)) {
        issues.push({
          itemKey,
          field: `reviewSheet.rows[${lineIndex}].itemKey`,
          message: 'Face-audit review sheet item key appears more than once',
        });
        continue;
      }

      const identityIssues: FaceAuditReviewValidationIssue[] = [];
      if (area !== expectedItem.area) {
        identityIssues.push({itemKey, field: `reviewSheet.rows[${lineIndex}].area`, message: 'Face-audit review sheet area must match the current checklist'});
      }
      if (itemId !== expectedItem.id) {
        identityIssues.push({itemKey, field: `reviewSheet.rows[${lineIndex}].itemId`, message: 'Face-audit review sheet item id must match the current checklist'});
      }
      if (label !== expectedItem.label) {
        identityIssues.push({itemKey, field: `reviewSheet.rows[${lineIndex}].label`, message: 'Face-audit review sheet label must match the current checklist'});
      }
      if (expectedFields !== expectedItem.expectedFields.join('; ')) {
        identityIssues.push({itemKey, field: `reviewSheet.rows[${lineIndex}].expectedFields`, message: 'Face-audit review sheet expected fields must match the current checklist'});
      }
      if (identityIssues.length > 0) {
        issues.push(...identityIssues);
        continue;
      }

      seenKeys.add(itemKey);
      rowsByKey.set(itemKey, {
        reviewStatus: reviewStatusValue.trim(),
        reviewer: reviewer.trim(),
        reviewedAt: reviewedAt.trim(),
        evidenceRef: evidenceRef.trim(),
        notes: notes.trim(),
      });
    }
  }

  const candidateArtifact = {
    ...baseValidation.review,
    items: baseValidation.review.items.map((item) => {
      const row = rowsByKey.get(item.key);
      return row === undefined
        ? item
        : {
            ...item,
            reviewStatus: row.reviewStatus,
            reviewer: row.reviewer,
            reviewedAt: row.reviewedAt,
            evidenceRef: row.evidenceRef,
            notes: row.notes,
          };
    }),
  };
  const validation = validateFaceAuditReviewArtifact(candidateArtifact, checklist);
  const allIssues = [...issues, ...validation.issues];

  return {
    artifactType: 'face_audit_review_sheet_import',
    version: 1,
    ok: baseValidation.ok && issues.length === 0 && validation.ok,
    checklistFingerprint: validation.review.checklistFingerprint,
    baseReviewFingerprint,
    reviewFingerprint: faceAuditReviewFingerprint(validation.review),
    rowCount: Math.max(0, lines.length - 1),
    appliedItemCount: rowsByKey.size,
    review: validation.review,
    issueCount: allIssues.length,
    issues: allIssues,
  };
}

export function faceAuditAreaReviewArtifactFileName(area: FaceAuditArea): string {
  return `face-audit-area-${area}-review.json`;
}

export function faceAuditAreaReviewTodoSummaryArtifactFileName(area: FaceAuditArea): string {
  return `face-audit-area-${area}-todo-summary.json`;
}

export function faceAuditAreaReviewSheetArtifactFileName(area: FaceAuditArea): string {
  return `face-audit-area-${area}-review-sheet.tsv`;
}

export function faceAuditAreaReviewerInstructionsArtifactFileName(area: FaceAuditArea): string {
  return `face-audit-area-${area}-reviewer-instructions.md`;
}

export function buildFaceAuditAreaReviewerInstructions(options: FaceAuditAreaReviewerInstructionsInput): string {
  const todo = options.area.todo;
  const reviewSheetFileName = options.reviewSheetFileName ?? faceAuditAreaReviewSheetArtifactFileName(todo.area);
  const nextItemLines = todo.nextItemKeys.length === 0
    ? ['- No remaining item keys.']
    : todo.nextItemKeys.map((itemKey) => `- \`${itemKey}\``);
  const extraItemCount = Math.max(0, todo.remainingItemKeyCount - todo.nextItemKeys.length);
  const evidenceSourceIds = todo.evidenceSourceIds.length === 0
    ? 'none'
    : todo.evidenceSourceIds.map((sourceId) => `\`${sourceId}\``).join(', ');

  return [
    `# Face Audit Area Reviewer Instructions: ${todo.area}`,
    '',
    '## Assignment',
    `- Area: \`${todo.area}\``,
    `- Checklist fingerprint: \`${options.handoff.checklistFingerprint}\``,
    `- Review fingerprint: \`${options.handoff.reviewFingerprint}\``,
    `- Review artifact: \`${options.reviewFileName}\``,
    `- Review sheet: \`${reviewSheetFileName}\``,
    `- Todo summary: \`${options.todoSummaryFileName}\``,
    `- Completion status: \`${todo.completionStatus}\``,
    `- Next step: \`${todo.nextStep}\``,
    `- Remaining items: ${todo.remainingItemCount} / ${todo.itemCount}`,
    `- Already reviewed: ${todo.reviewedItemCount}`,
    `- Evidence source IDs already used: ${evidenceSourceIds}`,
    '',
    '## Focus Item Keys',
    ...nextItemLines,
    ...(extraItemCount === 0
      ? []
      : [`- ${extraItemCount} additional item key(s) are listed in \`${options.reviewFileName}\`.`]),
    '',
    '## Reviewer Workflow',
    `1. Open \`${options.reviewFileName}\` and edit only the \`${todo.area}\` area artifact.`,
    `2. Use \`${reviewSheetFileName}\` when spreadsheet assignment or offline row tracking is easier.`,
    '3. Compare each remaining item against official Brass: Birmingham component evidence.',
    '4. For checked items, set `reviewStatus`, `reviewer`, `reviewedAt`, and `evidenceRef`.',
    '5. Leave unchecked items as `unreviewed` with blank reviewer, timestamp, evidence, and notes.',
    `6. Return the edited \`${options.reviewFileName}\` for merge and handoff-response verification.`,
    '',
    '## Useful Commands',
    `- Summarize this area: \`npm run face-audit:todo -- --summary --area ${todo.area} .\\${options.reviewFileName}\``,
    `- Merge this area: \`npm run face-audit:merge -- .\\${options.reviewFileName}\``,
    `- Verify the full handoff: \`npm run face-audit:handoff-response -- .\\face-audit-reviewer-handoff.json .\\${options.reviewFileName}\``,
  ].join('\n');
}

export function buildFaceAuditAreaReviewerInstructionsReport(
  artifacts: readonly unknown[],
  area: FaceAuditArea,
  checklist: FaceAuditChecklistExport = buildFaceAuditChecklistExport(),
): FaceAuditAreaReviewerInstructionsReport {
  const handoff = buildFaceAuditReviewerHandoff(artifacts, checklist);
  const summary = buildFaceAuditAreaReviewTodoSummary(artifacts, area, checklist);
  const reviewFileName = faceAuditAreaReviewArtifactFileName(area);
  const todoSummaryFileName = faceAuditAreaReviewTodoSummaryArtifactFileName(area);
  const reviewSheetFileName = faceAuditAreaReviewSheetArtifactFileName(area);
  const areaHandoff = handoff.areas.find((candidate) => candidate.area === area);
  const markdown = areaHandoff === undefined
    ? [
        `# Face Audit Area Reviewer Instructions: ${area}`,
        '',
        '## Assignment',
        `- Area: \`${area}\``,
        `- Checklist fingerprint: \`${summary.checklistFingerprint}\``,
    `- Review fingerprint: \`${summary.reviewFingerprint}\``,
    `- Completion status: \`${summary.completionStatus}\``,
        `- Next step: \`${summary.nextStep}\``,
        `- Remaining items: ${summary.remainingItemCount} / ${summary.itemCount}`,
        '',
        '## Reviewer Workflow',
        '- No unfinished items remain for this area.',
      ].join('\n')
    : buildFaceAuditAreaReviewerInstructions({
        handoff,
        area: areaHandoff,
        reviewFileName,
        todoSummaryFileName,
        reviewSheetFileName,
      });
  const issues = [
    ...summary.issues.map((issue) => ({...issue})),
    ...handoff.issues.map((issue) => ({...issue})),
    ...(areaHandoff === undefined && summary.completionStatus !== 'ready_to_lock'
      ? [{
          field: 'area',
          message: 'Face-audit area reviewer instructions area is not part of the unfinished reviewer handoff',
        }]
      : []),
  ];

  return {
    artifactType: 'face_audit_area_reviewer_instructions',
    version: 1,
    ok: summary.ok && (areaHandoff !== undefined ? handoff.ok : summary.completionStatus === 'ready_to_lock') && issues.length === 0,
    area,
    checklistFingerprint: summary.checklistFingerprint,
    reviewFingerprint: summary.reviewFingerprint,
    reviewFileName,
    todoSummaryFileName,
    reviewSheetFileName,
    markdown,
    issueCount: issues.length,
    issues,
  };
}

export function buildFaceAuditReviewerInstructions(options: FaceAuditReviewerInstructionsInput): string {
  const fileNameByArea = new Map(options.areaFiles.map((areaFile) => [areaFile.area, areaFile.fileName]));
  const todoSummaryFileNameByArea = new Map(options.areaFiles.map((areaFile) => [
    areaFile.area,
    areaFile.todoSummaryFileName ?? faceAuditAreaReviewTodoSummaryArtifactFileName(areaFile.area),
  ]));
  const reviewSheetFileNameByArea = new Map(options.areaFiles.map((areaFile) => [
    areaFile.area,
    areaFile.reviewSheetFileName ?? faceAuditAreaReviewSheetArtifactFileName(areaFile.area),
  ]));
  const reviewerInstructionsFileNameByArea = new Map(options.areaFiles.map((areaFile) => [
    areaFile.area,
    areaFile.reviewerInstructionsFileName ?? faceAuditAreaReviewerInstructionsArtifactFileName(areaFile.area),
  ]));
  const totalItemCount = options.status.completion.reviewedItemCount + options.status.completion.unreviewedItemCount;
  const unfinishedAreaLines = options.plan.areas.length === 0
    ? ['- No unfinished areas.']
    : options.plan.areas.map((area) => {
        const fileName = fileNameByArea.get(area.area) ?? faceAuditAreaReviewArtifactFileName(area.area);
        const todoSummaryFileName =
          todoSummaryFileNameByArea.get(area.area) ?? faceAuditAreaReviewTodoSummaryArtifactFileName(area.area);
        const reviewSheetFileName =
          reviewSheetFileNameByArea.get(area.area) ?? faceAuditAreaReviewSheetArtifactFileName(area.area);
        const reviewerInstructionsFileName =
          reviewerInstructionsFileNameByArea.get(area.area) ?? faceAuditAreaReviewerInstructionsArtifactFileName(area.area);
        return `- \`${area.area}\`: ${area.remainingItemCount} item(s), next step \`${area.nextStep}\`, ` +
          `file \`${fileName}\`, sheet \`${reviewSheetFileName}\`, summary \`${todoSummaryFileName}\`, ` +
          `instructions \`${reviewerInstructionsFileName}\``;
      });

  return [
    '# Face Audit Reviewer Instructions',
    '',
    '## Snapshot',
    `- Checklist fingerprint: \`${options.status.checklistFingerprint}\``,
    `- Review fingerprint: \`${options.status.reviewFingerprint}\``,
    `- Progress: ${options.status.completion.reviewedItemCount} / ${totalItemCount} reviewed; ${options.status.completion.unreviewedItemCount} unreviewed`,
    `- Areas: ${options.todo.pendingAreaCount} pending, ${options.todo.readyAreaCount} ready`,
    `- Pending items in review plan: ${options.plan.pendingItemCount}`,
    `- Declared evidence sources in handoff: ${options.handoff.evidenceSourceCount}`,
    '',
    '## Core Files',
    '- `face-audit-review-status.json`: aggregate progress and evidence coverage.',
    '- `face-audit-review.json`: merged full review artifact used to rebuild derived exports.',
    '- `face-audit-review-todo.json`: compact unfinished-area handoff.',
    '- `face-audit-review-plan.json`: every unfinished item grouped by area.',
    '- `face-audit-review-sheet.tsv`: spreadsheet-friendly assignment and tracking view.',
    '- `face-audit-reviewer-handoff.json`: todo plus editable area artifacts for unfinished areas.',
    '- `face-audit-area-<area>-review.json`: one ready-to-fill artifact per unfinished area.',
    '- `face-audit-area-<area>-review-sheet.tsv`: spreadsheet-friendly tracking view for one unfinished area.',
    '- `face-audit-area-<area>-todo-summary.json`: counts-only progress for one unfinished area.',
    '- `face-audit-area-<area>-reviewer-instructions.md`: area-specific reviewer workflow and focus keys.',
    '',
    '## Unfinished Areas',
    ...unfinishedAreaLines,
    '',
    '## Reviewer Workflow',
    '1. Open the assigned `face-audit-area-<area>-review.json` file.',
    '2. Compare each listed item against official Brass: Birmingham component evidence.',
    '3. Set `reviewStatus`, `reviewer`, `reviewedAt`, and `evidenceRef` only for items you checked.',
    '4. Keep unreviewed items with blank reviewer, timestamp, evidence, and notes fields.',
    '5. Return the completed area artifact for merge and handoff-response verification.',
    '',
    '## Useful Commands',
    '- Verify this handoff package: `npm run face-audit:verify-handoff -- .\\face-audit-reviewer-handoff.json`',
    '- Summarize returned area artifacts: `npm run face-audit:handoff-response -- .\\face-audit-reviewer-handoff.json .\\path\\to\\returned-area-review.json`',
    '- Merge returned area artifacts: `npm run face-audit:merge -- .\\path\\to\\returned-area-review.json`',
    '- Check final readiness: `npm run face-audit:ready -- .\\path\\to\\face-audit-review.json`',
  ].join('\n');
}

function faceAuditAreaReviewArtifactFromReview(
  area: FaceAuditArea,
  review: FaceAuditReviewTemplateExport,
  checklist: FaceAuditChecklistExport,
): FaceAuditAreaReviewTemplateExport {
  const template = buildFaceAuditAreaReviewTemplate(area, checklist);
  const items = review.items
    .filter((item) => item.area === area)
    .map((item) => ({
      ...item,
      expectedFields: [...item.expectedFields],
    }));
  const areaSummary = summarizeFaceAuditReviewAreas(checklist.areas, items)
    .find((summary) => summary.area === area) ?? template.areaSummary;

  return {
    artifactType: 'face_audit_area_review',
    version: 1,
    area,
    checklistFingerprint: template.checklistFingerprint,
    checklistItemCount: template.checklistItemCount,
    areaItemCount: template.areaItemCount,
    evidenceSources: review.evidenceSources.map((source) => ({...source})),
    areaSummary,
    items,
    completion: summarizeFaceAuditReviewCompletion(items),
  };
}

export function buildFaceAuditReviewerHandoff(
  artifacts: readonly unknown[],
  checklist: FaceAuditChecklistExport = buildFaceAuditChecklistExport(),
): FaceAuditReviewerHandoffReport {
  const validation = mergeFaceAuditReviewArtifacts(artifacts, checklist);
  const todo = buildFaceAuditReviewTodo(artifacts, checklist);
  const areas = todo.areas.map((areaTodo) => ({
    area: areaTodo.area,
    todo: {
      ...areaTodo,
      evidenceSourceIds: [...areaTodo.evidenceSourceIds],
      nextItemKeys: [...areaTodo.nextItemKeys],
      commands: {...areaTodo.commands},
    },
    reviewArtifact: faceAuditAreaReviewArtifactFromReview(areaTodo.area, validation.review, checklist),
  }));

  return {
    artifactType: 'face_audit_reviewer_handoff',
    version: 1,
    ok: validation.ok && todo.ok,
    artifactCount: todo.artifactCount,
    checklistFingerprint: todo.checklistFingerprint,
    reviewFingerprint: todo.reviewFingerprint,
    checklistItemCount: todo.checklistItemCount,
    evidenceSourceCount: validation.review.evidenceSources.length,
    evidenceSources: validation.review.evidenceSources.map((source) => ({...source})),
    completion: {...todo.completion},
    pendingAreaCount: todo.pendingAreaCount,
    readyAreaCount: todo.readyAreaCount,
    issueCount: todo.issueCount,
    todo: {
      ...todo,
      completion: {...todo.completion},
      areas: todo.areas.map((areaTodo) => ({
        ...areaTodo,
        evidenceSourceIds: [...areaTodo.evidenceSourceIds],
        nextItemKeys: [...areaTodo.nextItemKeys],
        commands: {...areaTodo.commands},
      })),
      issues: todo.issues.map((issue) => ({...issue})),
    },
    areas,
    issues: todo.issues.map((issue) => ({...issue})),
  };
}

function faceAuditReviewCompletionStatus(value: unknown): FaceAuditReviewCompletionStatus | undefined {
  return value === 'not_started' ||
    value === 'in_progress' ||
    value === 'ready_to_lock' ||
    value === 'has_differences' ||
    value === 'needs_better_reference'
    ? value
    : undefined;
}

function reviewCompletionSummaryFromPayload(value: unknown): FaceAuditReviewCompletionSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const status = faceAuditReviewCompletionStatus(value.status);
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

function prefixedIssue(fieldPrefix: string, issue: FaceAuditReviewValidationIssue): FaceAuditReviewValidationIssue {
  return {
    ...issue,
    field: `${fieldPrefix}.${issue.field}`,
  };
}

function handoffResponseAreaReportFromReview(
  review: FaceAuditAreaReviewTemplateExport,
  status: StaticDataAuditStatus,
): FaceAuditReviewerHandoffResponseAreaReport {
  const evidenceRefs = uniqueSorted(review.items
    .map((item) => item.evidenceRef)
    .filter((ref) => ref.length > 0));
  const reviewedItems = review.items.filter((item) => item.reviewStatus !== 'unreviewed');
  const reviewedAtValues = dateSorted(reviewedItems
    .map((item) => item.reviewedAt)
    .filter(validReviewTimestamp));
  return {
    area: review.area,
    status,
    completionStatus: review.completion.status,
    itemCount: review.areaItemCount,
    reviewedItemCount: review.completion.reviewedItemCount,
    matchingItemCount: review.completion.matchingItemCount,
    differenceItemCount: review.completion.differenceItemCount,
    needsReferenceItemCount: review.completion.needsReferenceItemCount,
    unreviewedItemCount: review.completion.unreviewedItemCount,
    remainingItemCount: review.completion.differenceItemCount +
      review.completion.needsReferenceItemCount +
      review.completion.unreviewedItemCount,
    ...evidenceCoverageForArea(review.area, evidenceRefs),
    evidenceSourceIds: usedEvidenceSourceIdsFromRefs(evidenceRefs),
    reviewers: uniqueSorted(reviewedItems
      .map((item) => item.reviewer)
      .filter((reviewer) => reviewer.length > 0)),
    firstReviewedAt: reviewedAtValues[0] ?? '',
    lastReviewedAt: reviewedAtValues[reviewedAtValues.length - 1] ?? '',
  };
}

export function summarizeFaceAuditReviewerHandoffResponse(
  handoffArtifact: unknown,
  artifacts: readonly unknown[],
  checklist: FaceAuditChecklistExport = buildFaceAuditChecklistExport(),
): FaceAuditReviewerHandoffResponseReport {
  const handoffValidation = validateFaceAuditReviewerHandoffArtifact(handoffArtifact, checklist);
  const issues: FaceAuditReviewValidationIssue[] = handoffValidation.issues
    .map((issue) => prefixedIssue('handoff', issue));
  const handoff = handoffValidation.handoff;
  const handoffAreaByArea = new Map<FaceAuditArea, FaceAuditReviewerHandoffArea>(
    handoff?.areas.map((area) => [area.area, area]) ?? [],
  );
  const seenAreas = new Set<FaceAuditArea>();
  const areas: FaceAuditReviewerHandoffResponseAreaReport[] = [];

  for (const [artifactIndex, artifact] of artifacts.entries()) {
    const rawArea = isRecord(artifact) ? faceAuditArea(artifact.area) : undefined;
    const validation = validateFaceAuditAreaReviewArtifact(artifact, rawArea, checklist);
    const artifactIssues: FaceAuditReviewValidationIssue[] = [...validation.issues];

    if (rawArea && handoff && !handoffAreaByArea.has(rawArea)) {
      artifactIssues.push({
        field: 'area',
        message: 'Face-audit handoff response area is not part of the reviewer handoff pending areas',
      });
    }
    if (rawArea && seenAreas.has(rawArea)) {
      artifactIssues.push({
        field: 'area',
        message: 'Face-audit handoff response area appears more than once',
      });
    }
    if (artifactIssues.length > 0) {
      issues.push(...artifactIssues.map((issue) => prefixedIssue(`artifacts[${artifactIndex}]`, issue)));
      continue;
    }

    const area = validation.review.area;
    seenAreas.add(area);
    const handoffArea = handoffAreaByArea.get(area);
    areas.push(handoffResponseAreaReportFromReview(
      validation.review,
      handoffArea?.todo.status ?? validation.review.areaSummary.status,
    ));
  }

  const readyAreaCount = areas.filter((area) => area.completionStatus === 'ready_to_lock').length;
  const unfinishedReturnedAreaCount = areas.length - readyAreaCount;
  const missingAreaCount = Math.max(0, (handoff?.pendingAreaCount ?? 0) - areas.length);

  return {
    artifactType: 'face_audit_reviewer_handoff_response',
    version: 1,
    ok: issues.length === 0,
    checklistFingerprint: faceAuditChecklistFingerprint(checklist),
    handoffReviewFingerprint: handoff?.reviewFingerprint,
    handoffPendingAreaCount: handoff?.pendingAreaCount ?? 0,
    responseArtifactCount: artifacts.length,
    acceptedAreaCount: areas.length,
    readyAreaCount,
    unfinishedReturnedAreaCount,
    missingAreaCount,
    remainingAreaCount: missingAreaCount + unfinishedReturnedAreaCount,
    areas,
    issueCount: issues.length,
    issues,
  };
}

function handoffScalarFieldsMatch(
  artifact: Record<string, unknown>,
  todo: Record<string, unknown>,
  fields: readonly string[],
  issues: FaceAuditReviewValidationIssue[],
): void {
  for (const field of fields) {
    if (stableJson(artifact[field]) !== stableJson(todo[field])) {
      issues.push({
        field,
        message: `Face-audit reviewer handoff ${field} must match embedded todo`,
      });
    }
  }
}

function equivalentJson(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

export function validateFaceAuditReviewerHandoffArtifact(
  artifact: unknown,
  checklist: FaceAuditChecklistExport = buildFaceAuditChecklistExport(),
): FaceAuditReviewerHandoffValidationResult {
  const issues: FaceAuditReviewValidationIssue[] = [];

  if (!isRecord(artifact)) {
    return {
      ok: false,
      issues: [{field: 'artifact', message: 'Face-audit reviewer handoff must be an object'}],
    };
  }

  if (artifact.artifactType !== 'face_audit_reviewer_handoff') {
    issues.push({field: 'artifactType', message: 'Face-audit reviewer handoff type must be face_audit_reviewer_handoff'});
  }
  if (artifact.version !== 1) {
    issues.push({field: 'version', message: 'Face-audit reviewer handoff must be version 1'});
  }
  if (artifact.ok !== true) {
    issues.push({field: 'ok', message: 'Face-audit reviewer handoff must be ok before it can be verified'});
  }
  if (artifact.checklistFingerprint !== faceAuditChecklistFingerprint(checklist)) {
    issues.push({field: 'checklistFingerprint', message: 'Face-audit reviewer handoff does not match the current checklist'});
  }
  if (artifact.checklistItemCount !== checklist.checklistItemCount) {
    issues.push({field: 'checklistItemCount', message: 'Face-audit reviewer handoff item count does not match the current checklist'});
  }
  const reviewFingerprint = stringValue(artifact.reviewFingerprint);
  if (!validFingerprint(reviewFingerprint)) {
    issues.push({field: 'reviewFingerprint', message: 'Face-audit reviewer handoff must include a normalized review fnv1a32 fingerprint'});
  }

  const evidenceSources = evidenceSourcesFromPayload(artifact.evidenceSources, issues);
  if (artifact.evidenceSourceCount !== evidenceSources.length) {
    issues.push({field: 'evidenceSourceCount', message: 'Face-audit reviewer handoff evidence source count must match evidenceSources'});
  }
  const completion = reviewCompletionSummaryFromPayload(artifact.completion);
  if (completion === undefined) {
    issues.push({field: 'completion', message: 'Face-audit reviewer handoff must include a completion summary'});
  } else if (completion.totalItemCount !== checklist.checklistItemCount) {
    issues.push({field: 'completion.totalItemCount', message: 'Face-audit reviewer handoff total count must match the current checklist'});
  }

  const rawEmbeddedIssues = Array.isArray(artifact.issues) ? artifact.issues : undefined;
  if (!rawEmbeddedIssues) {
    issues.push({field: 'issues', message: 'Face-audit reviewer handoff issues must be an array'});
  } else if (rawEmbeddedIssues.length > 0) {
    issues.push({field: 'issues', message: 'Face-audit reviewer handoff must not contain embedded issues'});
  }
  if (artifact.issueCount !== (rawEmbeddedIssues?.length ?? 0)) {
    issues.push({field: 'issueCount', message: 'Face-audit reviewer handoff issue count must match issues'});
  }

  const todo = isRecord(artifact.todo) ? artifact.todo : undefined;
  if (!todo) {
    issues.push({field: 'todo', message: 'Face-audit reviewer handoff must include embedded todo'});
  } else {
    if (todo.artifactType !== 'face_audit_review_todo') {
      issues.push({field: 'todo.artifactType', message: 'Face-audit reviewer handoff embedded todo type must be face_audit_review_todo'});
    }
    if (todo.version !== 1) {
      issues.push({field: 'todo.version', message: 'Face-audit reviewer handoff embedded todo must be version 1'});
    }
    if (todo.ok !== true) {
      issues.push({field: 'todo.ok', message: 'Face-audit reviewer handoff embedded todo must be ok'});
    }
    handoffScalarFieldsMatch(artifact, todo, [
      'artifactCount',
      'checklistFingerprint',
      'reviewFingerprint',
      'checklistItemCount',
      'completion',
      'pendingAreaCount',
      'readyAreaCount',
      'issueCount',
      'issues',
    ], issues);
  }

  const pendingAreaCount = nonNegativeInteger(artifact.pendingAreaCount);
  const readyAreaCount = nonNegativeInteger(artifact.readyAreaCount);
  if (pendingAreaCount === undefined) {
    issues.push({field: 'pendingAreaCount', message: 'Face-audit reviewer handoff pending area count must be a non-negative integer'});
  }
  if (readyAreaCount === undefined) {
    issues.push({field: 'readyAreaCount', message: 'Face-audit reviewer handoff ready area count must be a non-negative integer'});
  }
  if (
    pendingAreaCount !== undefined &&
    readyAreaCount !== undefined &&
    pendingAreaCount + readyAreaCount > FACE_AUDIT_AREAS.length
  ) {
    issues.push({field: 'pendingAreaCount', message: 'Face-audit reviewer handoff pending and ready area counts exceed the current checklist area count'});
  }

  const topTodoAreas = todo && Array.isArray(todo.areas) ? todo.areas : [];
  const topTodoAreaByArea = new Map<FaceAuditArea, unknown>();
  for (const rawTodoArea of topTodoAreas) {
    const todoArea = isRecord(rawTodoArea) ? faceAuditArea(rawTodoArea.area) : undefined;
    if (todoArea) {
      topTodoAreaByArea.set(todoArea, rawTodoArea);
    }
  }

  const seenAreas = new Set<FaceAuditArea>();
  const handoffAreas: FaceAuditReviewerHandoffArea[] = [];
  if (!Array.isArray(artifact.areas)) {
    issues.push({field: 'areas', message: 'Face-audit reviewer handoff areas must be an array'});
  } else {
    if (pendingAreaCount !== undefined && artifact.areas.length !== pendingAreaCount) {
      issues.push({field: 'areas', message: 'Face-audit reviewer handoff must include one area artifact for every pending area'});
    }
    if (todo && Array.isArray(todo.areas) && artifact.areas.length !== todo.areas.length) {
      issues.push({field: 'areas', message: 'Face-audit reviewer handoff areas must match embedded todo areas'});
    }

    for (const [index, rawArea] of artifact.areas.entries()) {
      if (!isRecord(rawArea)) {
        issues.push({field: `areas[${index}]`, message: 'Face-audit reviewer handoff area must be an object'});
        continue;
      }
      const area = faceAuditArea(rawArea.area);
      if (!area) {
        issues.push({field: `areas[${index}].area`, message: 'Face-audit reviewer handoff area must be a known face-audit area'});
        continue;
      }
      if (seenAreas.has(area)) {
        issues.push({field: `areas[${index}].area`, message: 'Face-audit reviewer handoff area appears more than once'});
        continue;
      }
      seenAreas.add(area);

      const rawAreaTodo = rawArea.todo;
      if (!isRecord(rawAreaTodo)) {
        issues.push({field: `areas[${index}].todo`, message: 'Face-audit reviewer handoff area must include todo'});
        continue;
      }
      const rawTopTodoArea = topTodoAreaByArea.get(area);
      if (!rawTopTodoArea) {
        issues.push({field: `areas[${index}].todo`, message: 'Face-audit reviewer handoff area todo must also appear in embedded todo'});
      } else if (!equivalentJson(rawAreaTodo, rawTopTodoArea)) {
        issues.push({field: `areas[${index}].todo`, message: 'Face-audit reviewer handoff area todo must match embedded todo area'});
      }

      const reviewArtifactValidation = validateFaceAuditAreaReviewArtifact(rawArea.reviewArtifact, area, checklist);
      if (!reviewArtifactValidation.ok) {
        issues.push(...reviewArtifactValidation.issues.map((issue) => prefixedIssue(`areas[${index}].reviewArtifact`, issue)));
        continue;
      }
      if (!equivalentJson(reviewArtifactValidation.review.evidenceSources, evidenceSources)) {
        issues.push({field: `areas[${index}].reviewArtifact.evidenceSources`, message: 'Face-audit reviewer handoff area evidence sources must match top-level evidenceSources'});
      }

      const expectedAreaTodo = buildFaceAuditReviewTodo([reviewArtifactValidation.review], checklist)
        .areas.find((candidate) => candidate.area === area);
      if (!expectedAreaTodo) {
        issues.push({field: `areas[${index}].todo`, message: 'Face-audit reviewer handoff area todo must describe an unfinished area'});
        continue;
      }
      if (!equivalentJson(rawAreaTodo, expectedAreaTodo)) {
        issues.push({field: `areas[${index}].todo`, message: 'Face-audit reviewer handoff area todo does not match its review artifact'});
      }

      handoffAreas.push({
        area,
        todo: expectedAreaTodo,
        reviewArtifact: reviewArtifactValidation.review,
      });
    }
  }

  const handoff = issues.length === 0
    ? {
        artifactType: 'face_audit_reviewer_handoff' as const,
        version: 1 as const,
        ok: true,
        artifactCount: nonNegativeInteger(artifact.artifactCount) ?? 0,
        checklistFingerprint: stringValue(artifact.checklistFingerprint),
        reviewFingerprint,
        checklistItemCount: checklist.checklistItemCount,
        evidenceSourceCount: evidenceSources.length,
        evidenceSources,
        completion: completion!,
        pendingAreaCount: pendingAreaCount!,
        readyAreaCount: readyAreaCount!,
        issueCount: 0,
        todo: artifact.todo as FaceAuditReviewTodoReport,
        areas: handoffAreas,
        issues: [],
      }
    : undefined;

  return {
    ok: issues.length === 0,
    handoff,
    issues,
  };
}

export function validateFaceAuditReadyArtifact(
  artifact: unknown,
  checklist: FaceAuditChecklistExport = buildFaceAuditChecklistExport(),
): FaceAuditReviewValidationResult {
  const validation = validateFaceAuditReviewArtifact(artifact, checklist);
  const issues: FaceAuditReviewValidationIssue[] = [...validation.issues];
  const completion = validation.review.completion;

  if (completion.status !== 'ready_to_lock') {
    issues.push({
      field: 'completion.status',
      message: 'Face-audit review must be ready_to_lock before audit statuses can be locked',
    });
  }
  if (completion.unreviewedItemCount > 0) {
    issues.push({
      field: 'completion.unreviewedItemCount',
      message: `Face-audit review still has ${completion.unreviewedItemCount} unreviewed item(s)`,
    });
  }
  if (completion.differenceItemCount > 0) {
    issues.push({
      field: 'completion.differenceItemCount',
      message: `Face-audit review still has ${completion.differenceItemCount} item(s) that differ from official faces`,
    });
  }
  if (completion.needsReferenceItemCount > 0) {
    issues.push({
      field: 'completion.needsReferenceItemCount',
      message: `Face-audit review still has ${completion.needsReferenceItemCount} item(s) needing better official references`,
    });
  }
  const unusedEvidenceSourceIds = unusedEvidenceSourceIdsForReview(validation.review);
  if (unusedEvidenceSourceIds.length > 0) {
    issues.push({
      field: 'evidenceSources',
      message: `Face-audit ready review declares unused evidence source(s): ${joinedValues(unusedEvidenceSourceIds)}`,
    });
  }
  const untraceableSourceIds = untraceableEvidenceSourceIds(validation.review.evidenceSources);
  if (untraceableSourceIds.length > 0) {
    issues.push({
      field: 'evidenceSources',
      message: `Face-audit ready review evidence source(s) must include locator or contentHash: ${joinedValues(untraceableSourceIds)}`,
    });
  }

  return {
    ok: issues.length === 0,
    review: validation.review,
    issues,
  };
}

export function buildFaceAuditLockPreview(
  artifact: unknown,
  checklist: FaceAuditChecklistExport = buildFaceAuditChecklistExport(),
): FaceAuditLockPreviewResult {
  const validation = validateFaceAuditReadyArtifact(artifact, checklist);
  if (!validation.ok) {
    return validation;
  }

  const areas = FACE_AUDIT_AREAS.map((area) => {
    const items = validation.review.items.filter((item) => item.area === area);
    const reviewedAtValues = dateSorted(items.map((item) => item.reviewedAt));
    const evidenceRefs = uniqueSorted(items.map((item) => item.evidenceRef));
    const evidenceCoverage = evidenceCoverageForArea(area, evidenceRefs);
    return {
      area,
      currentStatus: staticConfig.audit[area].status,
      nextStatus: 'manifest_locked' as const,
      itemCount: items.length,
      reviewedItemCount: items.length,
      reviewers: uniqueSorted(items.map((item) => item.reviewer)),
      evidenceRefs,
      ...evidenceCoverage,
      firstReviewedAt: reviewedAtValues[0] ?? '',
      lastReviewedAt: reviewedAtValues[reviewedAtValues.length - 1] ?? '',
    };
  });

  return {
    ...validation,
    lockPreview: {
      version: 1,
      checklistFingerprint: validation.review.checklistFingerprint,
      reviewFingerprint: faceAuditReviewFingerprint(validation.review),
      checklistItemCount: validation.review.checklistItemCount,
      evidenceSources: validation.review.evidenceSources.map((source) => ({...source})),
      areas,
    },
  };
}

export function buildFaceAuditLockArtifact(
  artifact: unknown,
  checklist: FaceAuditChecklistExport = buildFaceAuditChecklistExport(),
): FaceAuditLockArtifactResult {
  const preview = buildFaceAuditLockPreview(artifact, checklist);
  if (!preview.ok || !preview.lockPreview) {
    return {
      ok: preview.ok,
      review: preview.review,
      issues: preview.issues,
    };
  }
  const usedEvidenceSourceIds = new Set(usedEvidenceSourceIdsFromRefs(
    preview.lockPreview.areas.flatMap((area) => area.evidenceRefs),
  ));
  const evidenceSources = preview.review.evidenceSources
    .filter((source) => usedEvidenceSourceIds.has(source.id))
    .map((source) => ({...source}));

  return {
    ok: true,
    review: preview.review,
    issues: [],
    lockArtifact: {
      artifactType: 'face_audit_lock_evidence',
      ...preview.lockPreview,
      areas: preview.lockPreview.areas.map((area) => ({
        ...area,
        reviewers: [...area.reviewers],
        evidenceRefs: [...area.evidenceRefs],
      })),
      evidenceSources,
      completion: {...preview.review.completion},
    },
  };
}

export function validateFaceAuditLockArtifact(
  artifact: unknown,
  checklist: FaceAuditChecklistExport = buildFaceAuditChecklistExport(),
): FaceAuditLockArtifactValidationResult {
  const issues: FaceAuditReviewValidationIssue[] = [];

  if (!isRecord(artifact)) {
    return {
      ok: false,
      issues: [{field: 'artifact', message: 'Face-audit lock artifact must be an object'}],
    };
  }

  if (artifact.artifactType !== 'face_audit_lock_evidence') {
    issues.push({field: 'artifactType', message: 'Face-audit lock artifact type must be face_audit_lock_evidence'});
  }
  if (artifact.version !== 1) {
    issues.push({field: 'version', message: 'Face-audit lock artifact must be version 1'});
  }
  if (artifact.checklistItemCount !== checklist.checklistItemCount) {
    issues.push({field: 'checklistItemCount', message: 'Face-audit lock artifact item count does not match the current checklist'});
  }

  const reviewFingerprint = stringValue(artifact.reviewFingerprint);
  if (!validFingerprint(reviewFingerprint)) {
    issues.push({field: 'reviewFingerprint', message: 'Face-audit lock artifact must include a normalized review fnv1a32 fingerprint'});
  }

  const completion = isRecord(artifact.completion) ? artifact.completion : undefined;
  if (!completion) {
    issues.push({field: 'completion', message: 'Face-audit lock artifact must include a completion summary'});
  } else {
    if (completion.status !== 'ready_to_lock') {
      issues.push({field: 'completion.status', message: 'Face-audit lock artifact completion must be ready_to_lock'});
    }
    if (completion.reviewedItemCount !== checklist.checklistItemCount) {
      issues.push({field: 'completion.reviewedItemCount', message: 'Face-audit lock artifact reviewed count must match the current checklist'});
    }
    if (completion.matchingItemCount !== checklist.checklistItemCount) {
      issues.push({field: 'completion.matchingItemCount', message: 'Face-audit lock artifact matching count must match the current checklist'});
    }
    if (completion.differenceItemCount !== 0) {
      issues.push({field: 'completion.differenceItemCount', message: 'Face-audit lock artifact must not include differing official faces'});
    }
    if (completion.needsReferenceItemCount !== 0) {
      issues.push({field: 'completion.needsReferenceItemCount', message: 'Face-audit lock artifact must not include items needing better references'});
    }
    if (completion.unreviewedItemCount !== 0) {
      issues.push({field: 'completion.unreviewedItemCount', message: 'Face-audit lock artifact must not include unreviewed items'});
    }
    if (completion.totalItemCount !== checklist.checklistItemCount) {
      issues.push({field: 'completion.totalItemCount', message: 'Face-audit lock artifact total count must match the current checklist'});
    }
  }

  const evidenceSources = evidenceSourcesFromPayload(artifact.evidenceSources, issues);
  const evidenceSourceIds = new Set(evidenceSources.map((source) => source.id));
  const checklistAreaByArea = new Map(checklist.areas.map((area) => [area.area, area]));
  const checklistItemIdsByArea = new Map<FaceAuditArea, Set<string>>(FACE_AUDIT_AREAS.map((area) => [
    area,
    new Set(checklist.items.filter((item) => item.area === area).map((item) => item.id)),
  ]));
  const seenAreas = new Set<FaceAuditArea>();
  const areas: FaceAuditLockPreviewArea[] = [];
  const usedEvidenceSourceIds = new Set<string>();

  if (!Array.isArray(artifact.areas)) {
    issues.push({field: 'areas', message: 'Face-audit lock artifact areas must be an array'});
  } else {
    if (artifact.areas.length !== FACE_AUDIT_AREAS.length) {
      issues.push({field: 'areas', message: 'Face-audit lock artifact must include every face-audit area exactly once'});
    }

    for (const [index, rawArea] of artifact.areas.entries()) {
      if (!isRecord(rawArea)) {
        issues.push({field: `areas[${index}]`, message: 'Face-audit lock artifact area must be an object'});
        continue;
      }

      const area = faceAuditArea(rawArea.area);
      if (!area) {
        issues.push({field: `areas[${index}].area`, message: 'Face-audit lock artifact area must be a known face-audit area'});
        continue;
      }
      if (seenAreas.has(area)) {
        issues.push({field: `areas[${index}].area`, message: 'Face-audit lock artifact area appears more than once'});
        continue;
      }
      seenAreas.add(area);

      const checklistArea = checklistAreaByArea.get(area);
      const currentStatus = staticDataAuditStatus(rawArea.currentStatus);
      const reviewers = stringArray(rawArea.reviewers);
      const evidenceRefs = stringArray(rawArea.evidenceRefs);
      const rawEvidenceRefCount = nonNegativeInteger(rawArea.evidenceRefCount);
      const rawAreaLevelEvidenceRefCount = nonNegativeInteger(rawArea.areaLevelEvidenceRefCount);
      const rawItemSpecificEvidenceRefCount = nonNegativeInteger(rawArea.itemSpecificEvidenceRefCount);
      const rawItemSpecificEvidenceItemCount = nonNegativeInteger(rawArea.itemSpecificEvidenceItemCount);
      const firstReviewedAt = stringValue(rawArea.firstReviewedAt);
      const lastReviewedAt = stringValue(rawArea.lastReviewedAt);

      if (!currentStatus) {
        issues.push({field: `areas[${index}].currentStatus`, message: 'Face-audit lock artifact area current status must be a known static-data audit status'});
      } else if (checklistArea && !currentStatusCanProveLockArtifact(currentStatus, checklistArea.status)) {
        issues.push({field: `areas[${index}].currentStatus`, message: 'Face-audit lock artifact area current status does not match the current or just-locked static-data status'});
      }
      if (rawArea.nextStatus !== 'manifest_locked') {
        issues.push({field: `areas[${index}].nextStatus`, message: 'Face-audit lock artifact area next status must be manifest_locked'});
      }
      if (checklistArea && rawArea.itemCount !== checklistArea.itemCount) {
        issues.push({field: `areas[${index}].itemCount`, message: 'Face-audit lock artifact area item count does not match the current checklist'});
      }
      if (checklistArea && rawArea.reviewedItemCount !== checklistArea.itemCount) {
        issues.push({field: `areas[${index}].reviewedItemCount`, message: 'Face-audit lock artifact area reviewed count does not match the current checklist'});
      }
      if (!reviewers || reviewers.length === 0) {
        issues.push({field: `areas[${index}].reviewers`, message: 'Face-audit lock artifact area must include at least one reviewer'});
      }
      if (rawArea.evidenceRefCount !== undefined && rawEvidenceRefCount === undefined) {
        issues.push({field: `areas[${index}].evidenceRefCount`, message: 'Face-audit lock artifact area evidence ref count must be a non-negative integer'});
      }
      if (rawArea.areaLevelEvidenceRefCount !== undefined && rawAreaLevelEvidenceRefCount === undefined) {
        issues.push({field: `areas[${index}].areaLevelEvidenceRefCount`, message: 'Face-audit lock artifact area area-level evidence ref count must be a non-negative integer'});
      }
      if (rawArea.itemSpecificEvidenceRefCount !== undefined && rawItemSpecificEvidenceRefCount === undefined) {
        issues.push({field: `areas[${index}].itemSpecificEvidenceRefCount`, message: 'Face-audit lock artifact area item-specific evidence ref count must be a non-negative integer'});
      }
      if (rawArea.itemSpecificEvidenceItemCount !== undefined && rawItemSpecificEvidenceItemCount === undefined) {
        issues.push({field: `areas[${index}].itemSpecificEvidenceItemCount`, message: 'Face-audit lock artifact area item-specific evidence item count must be a non-negative integer'});
      }
      let evidenceCoverage: FaceAuditEvidenceCoverage | undefined;
      if (!evidenceRefs || evidenceRefs.length === 0) {
        issues.push({field: `areas[${index}].evidenceRefs`, message: 'Face-audit lock artifact area must include at least one official evidence reference'});
      } else {
        evidenceCoverage = evidenceCoverageForArea(area, evidenceRefs);
        if (rawEvidenceRefCount !== undefined && rawEvidenceRefCount !== evidenceCoverage.evidenceRefCount) {
          issues.push({field: `areas[${index}].evidenceRefCount`, message: 'Face-audit lock artifact area evidence ref count must match its evidenceRefs'});
        }
        if (rawAreaLevelEvidenceRefCount !== undefined && rawAreaLevelEvidenceRefCount !== evidenceCoverage.areaLevelEvidenceRefCount) {
          issues.push({field: `areas[${index}].areaLevelEvidenceRefCount`, message: 'Face-audit lock artifact area area-level evidence ref count must match its evidenceRefs'});
        }
        if (rawItemSpecificEvidenceRefCount !== undefined && rawItemSpecificEvidenceRefCount !== evidenceCoverage.itemSpecificEvidenceRefCount) {
          issues.push({field: `areas[${index}].itemSpecificEvidenceRefCount`, message: 'Face-audit lock artifact area item-specific evidence ref count must match its evidenceRefs'});
        }
        if (rawItemSpecificEvidenceItemCount !== undefined && rawItemSpecificEvidenceItemCount !== evidenceCoverage.itemSpecificEvidenceItemCount) {
          issues.push({field: `areas[${index}].itemSpecificEvidenceItemCount`, message: 'Face-audit lock artifact area item-specific evidence item count must match its evidenceRefs'});
        }
        const areaItemIds = checklistItemIdsByArea.get(area) ?? new Set<string>();
        for (const evidenceRef of evidenceRefs) {
          const evidenceTarget = parseFaceAuditEvidenceRef(evidenceRef);
          if (!evidenceTarget) {
            issues.push({
              field: `areas[${index}].evidenceRefs`,
              message: 'Face-audit lock artifact evidence refs must use official-component:<source>#<area> or official-component:<source>#<area>:<item-id>',
            });
          } else if (evidenceTarget.area !== area) {
            issues.push({
              field: `areas[${index}].evidenceRefs`,
              message: 'Face-audit lock artifact evidence ref area must match its audit area',
            });
          } else if (evidenceTarget.itemId !== undefined && !areaItemIds.has(evidenceTarget.itemId)) {
            issues.push({
              field: `areas[${index}].evidenceRefs`,
              message: 'Face-audit lock artifact evidence ref item id must exist in its audit area',
            });
          } else if (!evidenceSourceIds.has(evidenceTarget.sourceId)) {
            issues.push({
              field: `areas[${index}].evidenceRefs`,
              message: 'Face-audit lock artifact evidence ref source id must be declared in evidenceSources',
            });
          } else {
            usedEvidenceSourceIds.add(evidenceTarget.sourceId);
          }
        }
      }
      if (!validReviewTimestamp(firstReviewedAt)) {
        issues.push({field: `areas[${index}].firstReviewedAt`, message: 'Face-audit lock artifact area must include a valid first review timestamp'});
      }
      if (!validReviewTimestamp(lastReviewedAt)) {
        issues.push({field: `areas[${index}].lastReviewedAt`, message: 'Face-audit lock artifact area must include a valid last review timestamp'});
      }
      if (
        validReviewTimestamp(firstReviewedAt) &&
        validReviewTimestamp(lastReviewedAt) &&
        Date.parse(firstReviewedAt) > Date.parse(lastReviewedAt)
      ) {
        issues.push({field: `areas[${index}].firstReviewedAt`, message: 'Face-audit lock artifact area first review timestamp must not be after the last review timestamp'});
      }

      if (currentStatus && checklistArea && reviewers && evidenceRefs && evidenceCoverage) {
        areas.push({
          area,
          currentStatus,
          nextStatus: 'manifest_locked',
          itemCount: Number(rawArea.itemCount),
          reviewedItemCount: Number(rawArea.reviewedItemCount),
          reviewers,
          evidenceRefs,
          ...evidenceCoverage,
          firstReviewedAt,
          lastReviewedAt,
        });
      }
    }

    for (const area of FACE_AUDIT_AREAS) {
      if (!seenAreas.has(area)) {
        issues.push({field: 'areas', message: `Face-audit lock artifact is missing area ${area}`});
      }
    }
  }
  const unusedEvidenceSourceIds = uniqueSorted(evidenceSources
    .map((source) => source.id)
    .filter((sourceId) => !usedEvidenceSourceIds.has(sourceId)));
  if (unusedEvidenceSourceIds.length > 0) {
    issues.push({
      field: 'evidenceSources',
      message: `Face-audit lock artifact declares unused evidence source(s): ${joinedValues(unusedEvidenceSourceIds)}`,
    });
  }
  const untraceableSourceIds = untraceableEvidenceSourceIds(evidenceSources);
  if (untraceableSourceIds.length > 0) {
    issues.push({
      field: 'evidenceSources',
      message: `Face-audit lock artifact evidence source(s) must include locator or contentHash: ${joinedValues(untraceableSourceIds)}`,
    });
  }

  const checklistFingerprint = stringValue(artifact.checklistFingerprint);
  const acceptedChecklistFingerprints = new Set([
    checklist.checklistFingerprint,
    projectedChecklistFingerprintForLockArtifact(checklist, areas),
  ]);
  if (!acceptedChecklistFingerprints.has(checklistFingerprint)) {
    issues.push({
      field: 'checklistFingerprint',
      message: 'Face-audit lock artifact does not match the current or lock-transition checklist fingerprint',
    });
  }

  if (issues.length > 0 || !completion) {
    return {
      ok: false,
      issues,
    };
  }

  return {
    ok: true,
    issues: [],
    lockArtifact: {
      artifactType: 'face_audit_lock_evidence',
      version: 1,
      checklistFingerprint,
      reviewFingerprint,
      checklistItemCount: checklist.checklistItemCount,
      areas,
      evidenceSources,
      completion: {
        status: 'ready_to_lock',
        reviewedItemCount: checklist.checklistItemCount,
        matchingItemCount: checklist.checklistItemCount,
        differenceItemCount: 0,
        needsReferenceItemCount: 0,
        unreviewedItemCount: 0,
        totalItemCount: checklist.checklistItemCount,
      },
    },
  };
}

export function validateFaceAuditStaticLockGate(
  lockArtifact?: unknown,
  checklist: FaceAuditChecklistExport = buildFaceAuditChecklistExport(),
): FaceAuditStaticLockGateResult {
  const issues: FaceAuditReviewValidationIssue[] = [];
  const lockedAreaCount = checklist.areas.filter((area) => area.status === 'manifest_locked').length;
  const pendingAreaCount = checklist.areas.filter((area) => area.status === 'manifest_locked_face_audit_pending').length;

  if (lockedAreaCount === 0) {
    if (lockArtifact !== undefined) {
      const lockArtifactValidation = validateFaceAuditLockArtifact(lockArtifact, checklist);
      return {
        ok: lockArtifactValidation.ok,
        pendingAreaCount,
        lockedAreaCount,
        lockArtifactValidation,
        issues: lockArtifactValidation.issues,
      };
    }
    return {
      ok: true,
      pendingAreaCount,
      lockedAreaCount,
      issues: [],
    };
  }

  if (pendingAreaCount > 0) {
    issues.push({
      field: 'areas',
      message: 'Face-audit areas must be locked as one evidence-backed batch, not partially locked',
    });
  }

  if (lockArtifact === undefined) {
    issues.push({
      field: 'lockArtifact',
      message: 'Locked face-audit static data requires a compact face_audit_lock_evidence artifact',
    });
    return {
      ok: false,
      pendingAreaCount,
      lockedAreaCount,
      issues,
    };
  }

  const lockArtifactValidation = validateFaceAuditLockArtifact(lockArtifact, checklist);
  if (!lockArtifactValidation.ok) {
    issues.push(...lockArtifactValidation.issues);
  }

  return {
    ok: issues.length === 0,
    pendingAreaCount,
    lockedAreaCount,
    lockArtifactValidation,
    issues,
  };
}
