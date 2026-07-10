import type {
  FaceAuditAreaSummaryView,
  FaceAuditChecklistItemView,
  FaceAuditChecklistView,
} from './faceAuditViewOptions';
import {
  FACE_AUDIT_REVIEW_STATUSES,
  faceAuditChecklistFingerprint,
  type FaceAuditReviewStatus,
} from '../common/faceAudit';

export {faceAuditChecklistFingerprint} from '../common/faceAudit';

export type FaceAuditProgressStorageAdapter = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type FaceAuditProgressCount = {
  reviewed: number;
  total: number;
};

export type FaceAuditAreaProgress = FaceAuditProgressCount & {
  area: FaceAuditAreaSummaryView['area'];
};

export type FaceAuditProgressArtifact = {
  version: 2;
  checklistFingerprint: string;
  checklistItemCount: number;
  areaProgress: FaceAuditAreaProgress[];
  reviewedItemKeys: string[];
};

export type FaceAuditProgressImportResult =
  | {ok: true; reviewedItemKeys: string[]; ignoredItemKeyCount: number}
  | {ok: false; error: string};

export const faceAuditProgressStorageKey = 'brass.faceAuditProgress.v1';

const completedReviewStatusSet = new Set<FaceAuditReviewStatus>(
  FACE_AUDIT_REVIEW_STATUSES.filter((status) => status !== 'unreviewed'),
);

function browserLocalStorage(): FaceAuditProgressStorageAdapter | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || undefined;
}

export function faceAuditItemKey(item: Pick<FaceAuditChecklistItemView, 'area' | 'id'>): string {
  return `${item.area}:${item.id}`;
}

function checklistItemKeys(checklist: FaceAuditChecklistView): string[] {
  return checklist.items.map(faceAuditItemKey);
}

function normalizedReviewedKeys(value: unknown, checklist: FaceAuditChecklistView): string[] {
  const knownKeys = new Set(checklistItemKeys(checklist));
  const source = isRecord(value) && Array.isArray(value.reviewedItemKeys)
    ? value.reviewedItemKeys
    : [];
  const reviewed = new Set<string>();
  for (const rawKey of source) {
    const key = nonEmptyString(rawKey);
    if (key && knownKeys.has(key)) {
      reviewed.add(key);
    }
  }
  return checklistItemKeys(checklist).filter((key) => reviewed.has(key));
}

function rawReviewedKeys(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.reviewedItemKeys)) {
    return [];
  }
  return value.reviewedItemKeys.flatMap((rawKey) => {
    const key = nonEmptyString(rawKey);
    return key === undefined ? [] : [key];
  });
}

function reviewArtifactItemKey(item: Record<string, unknown>): string | undefined {
  const area = nonEmptyString(item.area);
  const id = nonEmptyString(item.id);
  if (area !== undefined && id !== undefined) {
    return `${area}:${id}`;
  }
  return nonEmptyString(item.key);
}

export function readFaceAuditReviewedKeys(
  checklist: FaceAuditChecklistView,
  storage: FaceAuditProgressStorageAdapter | undefined = browserLocalStorage(),
): string[] {
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(faceAuditProgressStorageKey);
    return raw ? normalizedReviewedKeys(JSON.parse(raw) as unknown, checklist) : [];
  } catch {
    return [];
  }
}

export function writeFaceAuditReviewedKeys(
  checklist: FaceAuditChecklistView,
  reviewedItemKeys: readonly string[],
  storage: FaceAuditProgressStorageAdapter | undefined = browserLocalStorage(),
): string[] {
  const normalizedKeys = normalizedReviewedKeys({reviewedItemKeys}, checklist);
  if (!storage) {
    return normalizedKeys;
  }

  try {
    storage.setItem(faceAuditProgressStorageKey, JSON.stringify({reviewedItemKeys: normalizedKeys}));
  } catch {
    // localStorage can throw when disabled, private, or quota-limited.
  }
  return normalizedKeys;
}

export function updateFaceAuditReviewedKeys(
  checklist: FaceAuditChecklistView,
  currentKeys: readonly string[],
  item: FaceAuditChecklistItemView,
  reviewed: boolean,
): string[] {
  const current = new Set(writeFaceAuditReviewedKeys(checklist, currentKeys, undefined));
  const key = faceAuditItemKey(item);
  if (reviewed) {
    current.add(key);
  } else {
    current.delete(key);
  }
  return writeFaceAuditReviewedKeys(checklist, [...current], undefined);
}

export function faceAuditProgressCount(
  checklist: FaceAuditChecklistView,
  reviewedItemKeys: readonly string[],
): FaceAuditProgressCount {
  const reviewed = new Set(writeFaceAuditReviewedKeys(checklist, reviewedItemKeys, undefined));
  return {
    reviewed: checklist.items.filter((item) => reviewed.has(faceAuditItemKey(item))).length,
    total: checklist.items.length,
  };
}

export function faceAuditAreaProgress(
  checklist: FaceAuditChecklistView,
  summary: FaceAuditAreaSummaryView,
  reviewedItemKeys: readonly string[],
): FaceAuditAreaProgress {
  const reviewed = new Set(writeFaceAuditReviewedKeys(checklist, reviewedItemKeys, undefined));
  const areaItems = checklist.items.filter((item) => item.area === summary.area);
  return {
    area: summary.area,
    reviewed: areaItems.filter((item) => reviewed.has(faceAuditItemKey(item))).length,
    total: areaItems.length,
  };
}

export function faceAuditProgressLabel(progress: FaceAuditProgressCount): string {
  return `${progress.reviewed} / ${progress.total} reviewed`;
}

export function buildFaceAuditProgressArtifact(
  checklist: FaceAuditChecklistView,
  reviewedItemKeys: readonly string[],
): FaceAuditProgressArtifact {
  const normalizedKeys = writeFaceAuditReviewedKeys(checklist, reviewedItemKeys, undefined);
  return {
    version: 2,
    checklistFingerprint: faceAuditChecklistFingerprint(checklist),
    checklistItemCount: checklist.items.length,
    areaProgress: checklist.areas.map((summary) => faceAuditAreaProgress(checklist, summary, normalizedKeys)),
    reviewedItemKeys: normalizedKeys,
  };
}

export function serializeFaceAuditProgressArtifact(
  checklist: FaceAuditChecklistView,
  reviewedItemKeys: readonly string[],
): string {
  return JSON.stringify(buildFaceAuditProgressArtifact(checklist, reviewedItemKeys), null, 2);
}

export function parseFaceAuditProgressArtifact(
  checklist: FaceAuditChecklistView,
  serializedArtifact: string,
): FaceAuditProgressImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serializedArtifact) as unknown;
  } catch {
    return {ok: false, error: 'Progress artifact must be valid JSON'};
  }
  if (!isRecord(parsed) || parsed.version !== 2 || !Array.isArray(parsed.reviewedItemKeys)) {
    return {ok: false, error: 'Progress artifact must be a version 2 face-audit progress object'};
  }
  if (parsed.checklistFingerprint !== faceAuditChecklistFingerprint(checklist)) {
    return {ok: false, error: 'Progress artifact does not match the current face-audit checklist'};
  }
  const rawKeys = rawReviewedKeys(parsed);
  const reviewedItemKeys = normalizedReviewedKeys({reviewedItemKeys: rawKeys}, checklist);
  const uniqueRawKeyCount = new Set(rawKeys).size;
  return {
    ok: true,
    reviewedItemKeys,
    ignoredItemKeyCount: Math.max(0, uniqueRawKeyCount - reviewedItemKeys.length),
  };
}

export function reviewedKeysFromFaceAuditReviewArtifact(
  checklist: FaceAuditChecklistView,
  artifact: unknown,
): FaceAuditProgressImportResult {
  if (
    !isRecord(artifact) ||
    artifact.version !== 1 ||
    (artifact.artifactType !== undefined && artifact.artifactType !== 'face_audit_area_review') ||
    !Array.isArray(artifact.items)
  ) {
    return {ok: false, error: 'Review artifact must be a version 1 full or area face-audit review object'};
  }
  if (artifact.checklistFingerprint !== faceAuditChecklistFingerprint(checklist)) {
    return {ok: false, error: 'Review artifact does not match the current face-audit checklist'};
  }
  if (artifact.checklistItemCount !== checklist.items.length) {
    return {ok: false, error: 'Review artifact item count does not match the current face-audit checklist'};
  }

  const rawReviewedKeys = new Set<string>();
  let ignoredMissingKeyCount = 0;
  let invalidStatusCount = 0;
  for (const rawItem of artifact.items) {
    if (!isRecord(rawItem)) {
      return {ok: false, error: 'Review artifact items must be JSON objects'};
    }
    const status = nonEmptyString(rawItem.reviewStatus);
    if (status === undefined || status === 'unreviewed') {
      continue;
    }
    if (!completedReviewStatusSet.has(status as FaceAuditReviewStatus)) {
      invalidStatusCount += 1;
      continue;
    }
    const key = reviewArtifactItemKey(rawItem);
    if (key === undefined) {
      ignoredMissingKeyCount += 1;
    } else {
      rawReviewedKeys.add(key);
    }
  }

  if (invalidStatusCount > 0) {
    return {ok: false, error: `Review artifact contains ${invalidStatusCount} unknown review status value(s)`};
  }

  const reviewedItemKeys = normalizedReviewedKeys({reviewedItemKeys: [...rawReviewedKeys]}, checklist);
  return {
    ok: true,
    reviewedItemKeys,
    ignoredItemKeyCount: ignoredMissingKeyCount + Math.max(0, rawReviewedKeys.size - reviewedItemKeys.length),
  };
}

export function parseFaceAuditReviewArtifactProgress(
  checklist: FaceAuditChecklistView,
  serializedArtifact: string,
): FaceAuditProgressImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serializedArtifact) as unknown;
  } catch {
    return {ok: false, error: 'Review artifact must be valid JSON'};
  }
  return reviewedKeysFromFaceAuditReviewArtifact(checklist, parsed);
}
