// @vitest-environment node
/**
 * D4-09 (domain side): the production comparison policy and the planner-side capability rules key optimizer
 * checkpoints and result provenance, so a policy change invalidates checkpoints without touching stored plans.
 */
import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from '../../../core/defaults';
import { MODULES } from '../../../core/moduleRegistry';
import { buildModelParams } from '../../../core/paramsRegistry';
import { PLANNER_COMPARISON_POLICY, PLANNER_POLICY_FINGERPRINT } from '../../optim/policy';
import { hashString } from '../../optim/rng';
import { PLANNER_CAPABILITY_VERSION } from '../capabilities';
import { COMPOSITION_TISSUE_BINDING } from '../../../model/composition';
import { PLANNER_POLICY_KEY, PLANNER_VERSION, checkpointKeyOf } from '../ladderPlanner';
import { LIBRARY_VERSION } from '../registry/blocks';
import { FAT_LOSS_KEEP_LEAN, MAN_95, request } from './personas';

describe('D4-09 policy fingerprint in checkpoints and provenance', () => {
  it('the planner policy key joins the comparison policy fingerprint, the capability rules and the tissue binding versions', () => {
    expect(PLANNER_POLICY_KEY).toBe(`${PLANNER_POLICY_FINGERPRINT}.cap${PLANNER_CAPABILITY_VERSION}.tissue${COMPOSITION_TISSUE_BINDING.version}`);
    expect(PLANNER_COMPARISON_POLICY.version).toBe(2);
  });

  it('checkpoint keys include the policy key: a checkpoint from the previous policy never matches', () => {
    const req = request(MAN_95, FAT_LOSS_KEEP_LEAN);
    const key = checkpointKeyOf(req);
    const previous = `ckpt-${hashString(JSON.stringify([req, ENGINE_VERSION, buildModelParams(MODULES).registryHash, LIBRARY_VERSION, PLANNER_VERSION])).toString(16)}`;
    expect(key).toMatch(/^ckpt-[0-9a-f]+$/);
    expect(key).not.toBe(previous);
    expect(checkpointKeyOf({ ...req, budget: { tier: 'X' } })).toBe(key);
  });
});
