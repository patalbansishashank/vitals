/**
 * Shared fragments for command definitions: surface sets with their written exclusion reasons, undo and idempotency
 * shorthands (the §1.9 legend), and the stub factory for commands other packages implement.
 */
import { defineCommand, notImplemented } from '../registry';
import { T, type TSchema } from '../schema';
import type { CommandDef, CommandId, Impact, Perm, SideEffect, Surface, UndoStrategy } from '../types';

export const ALL: readonly Surface[] = ['ui', 'ai', 'webmcp', 'mcp'];

/** "UI" in the catalogue: the person's own consent or a device gesture is required. */
export const UI_ONLY = {
  surfaces: ['ui'] as readonly Surface[],
  excludedReason: (reason: string): Partial<Record<Surface, string>> => ({ ai: reason, webmcp: reason, mcp: reason }),
};
export const CONSENT = "requires the person's own consent in the app";
export const DEVICE = 'needs a device gesture (file picker, Bluetooth pairing or download) in the app';
export const SCREEN = 'screen progress of the app itself, not a change an agent should make';

export const UNDO = {
  none: { kind: 'none' } as UndoStrategy,
  IP: { kind: 'inversePatch' } as UndoStrategy,
  RT: { kind: 'retract' } as UndoStrategy,
  TS: { kind: 'tombstone' } as UndoStrategy,
  CP: (command: CommandId, windowMs = 24 * 3600 * 1000): UndoStrategy => ({ kind: 'compensating', command, windowMs }),
};

/** A placeholder output for stub commands (the owner fixes the view schema when implementing). */
export const PENDING_VIEW = T.OpenObject({ description: 'View defined by the implementing package.' });

export const Id = T.String({ minLength: 1, maxLength: 64 });
export const LocalDate = T.Date();

export interface StubSpec {
  id: CommandId;
  title: string;
  description: string;
  input: TSchema;
  output?: TSchema;
  perm: Perm;
  impact?: Impact;
  surfaces?: readonly Surface[];
  excludedReason?: Partial<Record<Surface, string>>;
  undo?: UndoStrategy;
  idempotency?: CommandDef['idempotency'];
  sideEffects?: readonly SideEffect[];
  longRunning?: CommandDef['longRunning'];
  owner: string;
  /** Who builds the screen that will call it (the UI census needs a reason until then). */
  uiOwner?: string;
}

/** Register a command whose id and schemas are fixed here and whose executor another package writes. */
export function stub(s: StubSpec): CommandDef {
  return defineCommand({
    id: s.id,
    version: 1,
    title: s.title,
    description: s.description,
    input: s.input,
    output: s.output ?? PENDING_VIEW,
    perm: s.perm,
    ...(s.impact ? { impact: s.impact } : s.perm === 'write' ? { impact: 'low' as const } : {}),
    surfaces: s.surfaces ?? ALL,
    excludedReason: {
      ...((s.surfaces ?? ALL).includes('ui') ? { ui: `no screen calls it yet (${s.uiOwner ?? s.owner})` } : {}),
      ...(s.excludedReason ?? {}),
    },
    undo: s.undo ?? UNDO.none,
    idempotency: s.idempotency ?? (s.perm === 'read' ? 'none' : 'natural'),
    ...(s.longRunning ? { longRunning: s.longRunning } : {}),
    sideEffects: s.sideEffects ?? (s.perm === 'read' ? [] : ['docs']),
    notImplemented: { owner: s.owner },
    execute: notImplemented(s.owner),
  });
}
