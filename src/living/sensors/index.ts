/**
 * Vitals sensor algorithms (energy SPEC §V2 and Addendum A.1.2): pure, versioned, node-tested. V3 (living plan) and V4
 * (screens) read these; nothing here does IO, reads a clock or changes a plan.
 */
export * from './types';
export * from './hrProfile';
export * from './hrZones';
export * from './heartPoints';
export * from './activityEnergy';
export * from './activityDetect';
export * from './energyDay';
export * from './sleepNight';
export * from './indices';
export * from './trainingLoad';
export * from './projectActivity';
