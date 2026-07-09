import {existsSync, readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {staticConfig} from '../src/common/staticData';
import type {StaticDataAuditStatus} from '../src/common/types';

const docs = readFileSync('docs/Brass_Birmingham_rules_data_model_cn.md', 'utf8');
const typesSource = readFileSync('src/common/types.ts', 'utf8');

function extractSection(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading);
  if (start < 0) {
    throw new Error(`Missing heading: ${heading}`);
  }
  const next = markdown.indexOf('\n## ', start + heading.length);
  return next < 0 ? markdown.slice(start) : markdown.slice(start, next);
}

function extractTypeBlock(source: string, typeName: string, nextExport: string): string {
  const start = source.indexOf(`export type ${typeName} =`);
  if (start < 0) {
    throw new Error(`Missing type: ${typeName}`);
  }
  const end = source.indexOf(nextExport, start);
  return end < 0 ? source.slice(start) : source.slice(start, end);
}

function extractInterfaceBlock(source: string, interfaceName: string): string {
  const match = new RegExp(`(?:export\\s+)?interface\\s+${interfaceName}\\s*\\{`).exec(source);
  if (!match) {
    throw new Error(`Missing interface: ${interfaceName}`);
  }

  let depth = 0;
  for (let index = match.index; index < source.length; index++) {
    const char = source[index];
    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(match.index, index + 1);
      }
    }
  }

  throw new Error(`Unclosed interface: ${interfaceName}`);
}

function topLevelFieldNames(interfaceBlock: string): string[] {
  const names: string[] = [];
  let depth = 0;

  for (const line of interfaceBlock.split(/\r?\n/)) {
    if (depth === 1) {
      const match = /^\s*([A-Za-z]\w*)\??:\s/.exec(line);
      if (match) {
        names.push(match[1]);
      }
    }

    for (const char of line) {
      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
      }
    }
  }

  return names.sort();
}

function eventTypeNames(source: string): string[] {
  return [...source.matchAll(/type:\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1])
    .sort();
}

function commandTypeNames(source: string): string[] {
  const gameCommandBlock = extractTypeBlock(source, 'GameCommand', 'export interface BuildCommand');

  return [...gameCommandBlock.matchAll(/\|\s*([A-Z]\w+)/g)]
    .map((match) => match[1])
    .concat('SellStep')
    .sort();
}

function interfaceNames(source: string): string[] {
  return [...source.matchAll(/interface\s+([A-Z]\w+)\s*\{/g)]
    .map((match) => match[1])
    .sort();
}

function referencedTestSpecPaths(markdown: string): string[] {
  return [...new Set([...markdown.matchAll(/`(tests\/[^`]+\.spec\.ts)`/g)]
    .map((match) => match[1]))]
    .sort();
}

function auditKeysWithStatus(status: StaticDataAuditStatus): string[] {
  return Object.entries(staticConfig.audit)
    .filter(([, entry]) => entry.status === status)
    .map(([key]) => key)
    .sort();
}

function backtickListAfter(section: string, marker: string): string[] {
  const start = section.indexOf(marker);
  if (start < 0) {
    throw new Error(`Missing marker: ${marker}`);
  }

  const items: string[] = [];
  let foundList = false;
  for (const line of section.slice(start + marker.length).split(/\r?\n/)) {
    const match = /^- `([^`]+)`$/.exec(line.trim());
    if (match) {
      foundList = true;
      items.push(match[1]);
      continue;
    }
    if (foundList && line.trim() !== '') {
      break;
    }
  }

  return items.sort();
}

describe('rules data-model documentation', () => {
  it('keeps the documented GameEvent event names aligned with the source type', () => {
    const docsEventSection = extractSection(docs, '## 10. 事件模型');
    const sourceEventType = extractTypeBlock(typesSource, 'GameEvent', 'export type ResourceSource');

    expect(eventTypeNames(docsEventSection)).toEqual(eventTypeNames(sourceEventType));
  });

  it('keeps the documented action command interfaces aligned with the source type', () => {
    const docsActionSection = extractSection(docs, '## 6. 动作规则');
    const documentedInterfaces = interfaceNames(docsActionSection);

    expect(documentedInterfaces).toEqual(commandTypeNames(typesSource));
  });

  it('keeps the documented StaticConfig top-level fields aligned with the source interface', () => {
    expect(topLevelFieldNames(extractInterfaceBlock(docs, 'StaticConfig')))
      .toEqual(topLevelFieldNames(extractInterfaceBlock(typesSource, 'StaticConfig')));
  });

  it('keeps the documented static-data audit interfaces aligned with the source interfaces', () => {
    expect(topLevelFieldNames(extractInterfaceBlock(docs, 'StaticDataAuditArea')))
      .toEqual(topLevelFieldNames(extractInterfaceBlock(typesSource, 'StaticDataAuditArea')));
    expect(topLevelFieldNames(extractInterfaceBlock(docs, 'StaticDataAuditManifest')))
      .toEqual(topLevelFieldNames(extractInterfaceBlock(typesSource, 'StaticDataAuditManifest')));
  });

  it('keeps the documented static-data audit status lists aligned with staticConfig', () => {
    const auditSection = extractSection(docs, '## 13. 静态数据审计状态');

    expect(backtickListAfter(auditSection, '已标记为 `manifest_locked` 的项目：'))
      .toEqual(auditKeysWithStatus('manifest_locked'));
    expect(backtickListAfter(auditSection, '`manifest_locked_face_audit_pending` 的项目：'))
      .toEqual(auditKeysWithStatus('manifest_locked_face_audit_pending'));
  });

  it('keeps the face-audit checklist aligned with every pending staticConfig audit area', () => {
    const checklistSection = extractSection(docs, '### 13.3 发布前逐面核对清单');
    const checklistMarkers: Record<string, string> = {
      industryTiles: '全部 `45` 张每色产业牌',
      linkLines: '全部连接线',
      locationsAndSlots: '地图上 `20` 个城市',
      merchantTiles: '全部 `9` 张商人牌',
      regularCards: '全部 `64` 张 Location/Industry 普通牌',
      wildCards: '全部 `8` 张 Wild 牌',
    };
    const pendingKeys = auditKeysWithStatus('manifest_locked_face_audit_pending');

    expect(Object.keys(checklistMarkers).sort()).toEqual(pendingKeys);
    for (const key of pendingKeys) {
      expect(checklistSection).toContain(checklistMarkers[key]);
    }
  });

  it('keeps every documented test spec reference pointing at a real Vitest file', () => {
    const referencedSpecs = referencedTestSpecPaths(docs);

    expect(referencedSpecs.length).toBeGreaterThan(0);
    for (const specPath of referencedSpecs) {
      expect(existsSync(specPath), `Missing documented test spec: ${specPath}`).toBe(true);
      expect(readFileSync(specPath, 'utf8'), `${specPath} should contain Vitest tests`).toMatch(/\b(describe|it|test)\(/);
    }
  });

  it('does not describe legacy command or state field names that no longer exist', () => {
    expect(docs).not.toContain('resourcePlan');
    expect(docs).not.toContain('coalPlansByLink');
    expect(docs).not.toContain('ironPlan');
    expect(docs).not.toContain('beerPlan');
    expect(docs).not.toContain('currentTurnOrder');
    expect(docs).not.toContain('finalRoundOfGame');
  });
});
