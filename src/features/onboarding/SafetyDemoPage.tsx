import { useMemo, useState } from 'react';
import { EmptyStage, Faceplate, KeyBank, Page } from '@/components';
import { TopBar } from '@/app/shell';
import { AcknowledgeDialog, SimulationStrip } from './AcknowledgeDialog';
import { DisclaimerLine, PlannerDisclaimer, StopAndGetHelp } from './Disclaimer';
import { FastingTierControls } from './FastingTierControls';
import { HelpCard } from './HelpCard';
import { SafetyGate } from './SafetyGate';
import { SafetyModeChip } from './SafetyModeChip';
import { SafetySummary } from './SafetySummary';
import { evaluateScreening, type ScreeningAnswers } from './safetyRules';

const BASE: ScreeningAnswers = {
  ageBand: '18-64',
  pregnancy: 'no',
  eatingDisorder: 'no',
  scoffRisk: false,
  diabetes: 'no',
  conditions: 'no',
  metabolic: 'no',
  medications: 'no',
  symptoms: 'no',
  supervisedExercise: 'no',
  musculoskeletal: 'no',
  alcohol: 'no',
};

const PROFILES = {
  standard: BASE,
  gentle: { ...BASE, eatingDisorder: 'yes' },
  clinician: { ...BASE, conditions: 'yes', conditionItems: ['kidney'] },
  simulator: { ...BASE, diabetes: 'yes', diabetesItems: ['sglt2'] },
} satisfies Record<string, ScreeningAnswers>;
type ProfileId = keyof typeof PROFILES;

const SAMPLE_DANGER = [
  {
    id: 'W-F04',
    title: 'Water-only fast of 5 days.',
    message:
      'Water fasts of 3–7 days are studied under medical supervision (grade ≥ 3 adverse events in about 20 % by day 5). Risks: fainting, arrhythmia, low sodium, gout, refeeding problems.',
  },
];

/**
 * /dev/safety — the safety surfaces for the Planner and Simulator engineers: gate outcomes for sample
 * profiles, the live gate for the stored answers, the danger acknowledgement, the strip and the
 * disclaimer placements. Never in navigation.
 */
export default function SafetyDemoPage() {
  const [profile, setProfile] = useState<ProfileId>('standard');
  const [acked, setAcked] = useState(false);
  const outcome = useMemo(() => evaluateScreening(PROFILES[profile], { bmi: 26, sex: 'female', bodyFatPct: 31, ageYears: 40 }), [profile]);
  return (
    <>
      <TopBar title="Safety surfaces" actions={<SafetyModeChip />} />
      <Page>
        <div className="grid gap-6 pb-10 lg:grid-cols-2">
          <div className="grid min-w-0 content-start gap-4">
            <Faceplate title="Gate outcome for a sample profile" caption="evaluateScreening + body context">
              <KeyBank<ProfileId>
                label="Sample profile"
                value={profile}
                onChange={setProfile}
                options={[
                  { value: 'standard', label: 'standard' },
                  { value: 'gentle', label: 'gentle' },
                  { value: 'clinician', label: 'kidney' },
                  { value: 'simulator', label: 'SGLT2' },
                ]}
              />
              <pre className="mt-3 max-h-64 overflow-auto rounded-sm bg-well p-3 text-xs">
                {JSON.stringify({ mode: outcome.mode, planner: outcome.plannerAccess, simulator: outcome.simulatorAccess, fasting: outcome.fasting.maxFastHours, locks: outcome.plannerLocks.map((l) => `${l.id}${l.value !== undefined ? `=${l.value}` : ''}`) }, null, 1)}
              </pre>
            </Faceplate>
            <SafetySummary outcome={outcome} title="Safety summary (sample)" />
            <Faceplate title="Fasting opt-ins (stored answers)" caption="expert mode shown for review">
              <FastingTierControls expertModeAvailable />
            </Faceplate>
            <Faceplate title="Help card">
              <HelpCard />
            </Faceplate>
          </div>
          <div className="grid min-w-0 content-start gap-4">
            <Faceplate title="Planner gate (stored answers)" variant="inset">
              <SafetyGate feature="planner" summary={false}>
                <EmptyStage title="The Planner renders here." art={null} />
              </SafetyGate>
            </Faceplate>
            {acked ? (
              <Faceplate variant="flush">
                <SimulationStrip />
                <EmptyStage title="Danger projection (chart area)" art={null} perforated />
                <DisclaimerLine />
                <div className="p-3">
                  <StopAndGetHelp />
                </div>
              </Faceplate>
            ) : (
              <AcknowledgeDialog rules={SAMPLE_DANGER} onAcknowledge={() => setAcked(true)} />
            )}
            <Faceplate title="Plan card footer">
              <PlannerDisclaimer />
            </Faceplate>
          </div>
        </div>
      </Page>
    </>
  );
}
