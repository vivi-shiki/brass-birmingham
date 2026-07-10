import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

type PackageJson = {
  scripts: Record<string, string>;
};

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as PackageJson;

describe('package scripts', () => {
  it('keeps the project verify command wired to build, tests, and the face-audit release gate', () => {
    expect(packageJson.scripts.build).toBe('tsc --noEmit && vite build');
    expect(packageJson.scripts.test).toBe('vitest run');
    expect(packageJson.scripts['face-audit:area-template']).toBe('tsx src/tools/faceAuditCli.ts area-template');
    expect(packageJson.scripts['face-audit:template-with-sources'])
      .toBe('tsx src/tools/faceAuditCli.ts template-with-sources');
    expect(packageJson.scripts['face-audit:area-template-with-sources'])
      .toBe('tsx src/tools/faceAuditCli.ts area-template-with-sources');
    expect(packageJson.scripts['face-audit:merge']).toBe('tsx src/tools/faceAuditCli.ts merge');
    expect(packageJson.scripts['face-audit:status']).toBe('tsx src/tools/faceAuditCli.ts status');
    expect(packageJson.scripts['face-audit:todo']).toBe('tsx src/tools/faceAuditCli.ts todo');
    expect(packageJson.scripts['face-audit:review-plan']).toBe('tsx src/tools/faceAuditCli.ts review-plan');
    expect(packageJson.scripts['face-audit:review-sheet']).toBe('tsx src/tools/faceAuditCli.ts review-sheet');
    expect(packageJson.scripts['face-audit:area-review-sheet'])
      .toBe('tsx src/tools/faceAuditCli.ts area-review-sheet');
    expect(packageJson.scripts['face-audit:apply-review-sheet'])
      .toBe('tsx src/tools/faceAuditCli.ts apply-review-sheet');
    expect(packageJson.scripts['face-audit:reviewer-instructions'])
      .toBe('tsx src/tools/faceAuditCli.ts reviewer-instructions');
    expect(packageJson.scripts['face-audit:area-reviewer-instructions'])
      .toBe('tsx src/tools/faceAuditCli.ts area-reviewer-instructions');
    expect(packageJson.scripts['face-audit:ci-artifacts']).toBe('tsx src/tools/faceAuditCli.ts ci-artifacts');
    expect(packageJson.scripts['face-audit:verify-ci-artifacts'])
      .toBe('tsx src/tools/faceAuditCli.ts verify-ci-artifacts');
    expect(packageJson.scripts['face-audit:ci-artifacts-self-check'])
      .toBe('tsx src/tools/faceAuditCli.ts ci-artifacts-self-check');
    expect(packageJson.scripts['face-audit:review-kit']).toBe('tsx src/tools/faceAuditCli.ts review-kit');
    expect(packageJson.scripts['face-audit:verify-review-kit'])
      .toBe('tsx src/tools/faceAuditCli.ts verify-review-kit');
    expect(packageJson.scripts['face-audit:review-kit-self-check'])
      .toBe('tsx src/tools/faceAuditCli.ts review-kit-self-check');
    expect(packageJson.scripts['face-audit:handoff']).toBe('tsx src/tools/faceAuditCli.ts handoff');
    expect(packageJson.scripts['face-audit:verify-handoff'])
      .toBe('tsx src/tools/faceAuditCli.ts verify-handoff');
    expect(packageJson.scripts['face-audit:handoff-response'])
      .toBe('tsx src/tools/faceAuditCli.ts handoff-response');
    expect(packageJson.scripts['face-audit:release-gate']).toBe('tsx src/tools/faceAuditCli.ts release-gate');
    expect(packageJson.scripts['face-audit:hash-source']).toBe('tsx src/tools/faceAuditCli.ts hash-source');
    expect(packageJson.scripts['face-audit:source-template']).toBe('tsx src/tools/faceAuditCli.ts source-template');
    expect(packageJson.scripts['face-audit:source-ids-by-area-template'])
      .toBe('tsx src/tools/faceAuditCli.ts source-ids-by-area-template');
    expect(packageJson.scripts['face-audit:evidence-ref-template'])
      .toBe('tsx src/tools/faceAuditCli.ts evidence-ref-template');
    expect(packageJson.scripts['face-audit:area-match-template'])
      .toBe('tsx src/tools/faceAuditCli.ts area-match-template');
    expect(packageJson.scripts['face-audit:review-match-template'])
      .toBe('tsx src/tools/faceAuditCli.ts review-match-template');
    expect(packageJson.scripts['face-audit:review-match-template-by-area'])
      .toBe('tsx src/tools/faceAuditCli.ts review-match-template-by-area');
    expect(packageJson.scripts.verify)
      .toBe('npm run build && npm test -- --reporter=dot && npm run face-audit:release-gate && npm run face-audit:ci-artifacts-self-check && npm run face-audit:review-kit-self-check');

    const verifySteps = packageJson.scripts.verify.split(' && ');
    expect(verifySteps).toEqual([
      'npm run build',
      'npm test -- --reporter=dot',
      'npm run face-audit:release-gate',
      'npm run face-audit:ci-artifacts-self-check',
      'npm run face-audit:review-kit-self-check',
    ]);
  });
});
