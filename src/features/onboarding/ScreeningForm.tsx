import { Fragment, useId, useMemo, type ReactNode } from 'react';
import { Checkbox, Engraved, Faceplate, KeyBank, MQ, Notice, useMediaQuery, type KeyBankOption } from '@/components';
import { MESSAGES, QUESTIONS, QUESTION_GROUP, SCREENING, YES_NO, YES_NO_PREFER } from './copy';
import {
  CONDITION_ITEMS,
  DIABETES_ITEMS,
  MEDICATION_ITEMS,
  METABOLIC_ITEMS,
  SARCF_ITEMS,
  SCOFF_ITEMS,
  evaluateScreening,
  scoffScore,
  visibleQuestions,
  type AgeBand,
  type PregnancyAnswer,
  type QuestionId,
  type SafetyMessage,
  type SarcfScore,
  type ScreeningAnswers,
  type YesNo,
  type YesNoPrefer,
} from './safetyRules';
import './onboarding.css';

const yesNoPrefer: KeyBankOption<YesNoPrefer>[] = (['yes', 'no', 'prefer-not'] as const).map((v) => ({ value: v, label: YES_NO_PREFER[v] }));
const yesNo: KeyBankOption<YesNo>[] = (['yes', 'no'] as const).map((v) => ({ value: v, label: YES_NO[v] }));

function toggleItem<I>(list: readonly I[] | undefined, item: I, on: boolean): I[] {
  const cur = list ?? [];
  return on ? (cur.includes(item) ? [...cur] : [...cur, item]) : cur.filter((x) => x !== item);
}

/** DOM id of a question card (used to scroll to the first unanswered one). */
export const questionDomId = (q: QuestionId) => `q-${q}`;

export interface ScreeningFormProps {
  answers: ScreeningAnswers;
  /** Receives an updater (compatible with a React state setter), so quick successive answers never overwrite each other. */
  onChange: (update: (prev: ScreeningAnswers) => ScreeningAnswers) => void;
  /** Show the note that SCOFF answers are never kept (review of stored answers). */
  scoffPrivacyNote?: boolean;
}

/**
 * The screening questions (design §6.2, dossier §4.1): one faceplate per question, follow-ups expand
 * inline, and every answer that changes the mode shows its consequence immediately in a polite live region.
 * Each question is a fieldset + legend; yes/no answers are KeyBank radio groups; lists are checkbox groups.
 */
export function ScreeningForm({ answers, onChange, scoffPrivacyNote = false }: ScreeningFormProps) {
  const wide = useMediaQuery(MQ.md);
  const visible = visibleQuestions(answers);
  const outcome = useMemo(() => evaluateScreening(answers), [answers]);
  const set = (patch: Partial<ScreeningAnswers> | ((prev: ScreeningAnswers) => Partial<ScreeningAnswers>)) =>
    onChange((prev) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }));

  const messagesFor = (...sources: QuestionId[]) => outcome.messages.filter((m) => (sources as string[]).includes(m.source));

  const cards: Array<{ q: QuestionId; node: ReactNode }> = [];
  for (const q of visible) {
    switch (q) {
      case 'ageBand':
        cards.push({
          q,
          node: (
            <QuestionCard q={q} title={QUESTIONS.ageBand.title} help={QUESTIONS.ageBand.help} messages={messagesFor('ageBand', 'sarcf')}>
              {({ legendId, helpId }) => (
                <>
                  <KeyBank<AgeBand>
                    labelledBy={legendId}
                    describedBy={helpId}
                    size="lg"
                    block={!wide}
                    orientation={wide ? 'horizontal' : 'vertical'}
                    value={answers.ageBand}
                    onChange={(v) => set({ ageBand: v })}
                    options={(Object.keys(QUESTIONS.ageBand.options) as AgeBand[]).map((v) => ({ value: v, label: QUESTIONS.ageBand.options[v] }))}
                  />
                  {answers.ageBand === '65-74' ? (
                    <SubRows title={QUESTIONS.sarcf.title} help={QUESTIONS.sarcf.help}>
                      {SARCF_ITEMS.map((item) => (
                        <RowQuestion<'0' | '1' | '2'>
                          key={item}
                          text={QUESTIONS.sarcf.items[item]}
                          value={answers.sarcf?.[item] === undefined ? undefined : (String(answers.sarcf[item]) as '0' | '1' | '2')}
                          options={(['0', '1', '2'] as const).map((v) => ({ value: v, label: (item === 'falls' ? QUESTIONS.sarcf.fallsOptions : QUESTIONS.sarcf.options)[v] }))}
                          onChange={(v) => set((prev) => ({ sarcf: { ...prev.sarcf, [item]: Number(v) as SarcfScore } }))}
                        />
                      ))}
                    </SubRows>
                  ) : null}
                </>
              )}
            </QuestionCard>
          ),
        });
        break;
      case 'sarcf':
      case 'scoff':
        break; // rendered inside their parent card
      case 'pregnancy':
        cards.push({
          q,
          node: (
            <QuestionCard q={q} title={QUESTIONS.pregnancy.title} messages={messagesFor('pregnancy')}>
              {({ legendId }) => (
                <KeyBank<PregnancyAnswer>
                  labelledBy={legendId}
                  size="lg"
                  block={!wide}
                  orientation="vertical"
                  value={answers.pregnancy}
                  onChange={(v) => set({ pregnancy: v })}
                  options={(Object.keys(QUESTIONS.pregnancy.options) as PregnancyAnswer[]).map((v) => ({ value: v, label: QUESTIONS.pregnancy.options[v] }))}
                />
              )}
            </QuestionCard>
          ),
        });
        break;
      case 'eatingDisorder':
        cards.push({
          q,
          node: (
            <QuestionCard q={q} title={QUESTIONS.eatingDisorder.title} help={QUESTIONS.eatingDisorder.help} messages={messagesFor('eatingDisorder', 'scoff')}>
              {({ legendId, helpId }) => (
                <>
                  <KeyBank<YesNoPrefer> labelledBy={legendId} describedBy={helpId} size="lg" value={answers.eatingDisorder} onChange={(v) => set({ eatingDisorder: v })} options={yesNoPrefer} />
                  {visible.includes('scoff') ? (
                    <SubRows
                      title={QUESTIONS.scoff.title}
                      help={QUESTIONS.scoff.help}
                      note={
                        typeof answers.scoffRisk === 'boolean' && scoffScore(answers.scoff) === null
                          ? SCREENING.scoffKept(answers.scoffRisk)
                          : scoffPrivacyNote
                            ? SCREENING.scoffPrivacy
                            : undefined
                      }
                    >
                      {SCOFF_ITEMS.map((item) => (
                        <RowQuestion<YesNo>
                          key={item}
                          text={QUESTIONS.scoff.items[item]}
                          value={answers.scoff?.[item]}
                          options={yesNo}
                          onChange={(v) => set((prev) => ({ scoff: { ...prev.scoff, [item]: v } }))}
                        />
                      ))}
                    </SubRows>
                  ) : null}
                </>
              )}
            </QuestionCard>
          ),
        });
        break;
      case 'diabetes':
        cards.push({
          q,
          node: (
            <ChecklistQuestion
              q={q}
              copy={QUESTIONS.diabetes}
              answer={answers.diabetes}
              items={DIABETES_ITEMS}
              selected={answers.diabetesItems ?? []}
              onAnswer={(v) => set({ diabetes: v })}
              onToggle={(item, on) => set((prev) => ({ diabetesItems: toggleItem(prev.diabetesItems, item, on) }))}
              messages={messagesFor('diabetes')}
            />
          ),
        });
        break;
      case 'conditions':
        cards.push({
          q,
          node: (
            <ChecklistQuestion
              q={q}
              copy={QUESTIONS.conditions}
              answer={answers.conditions}
              items={CONDITION_ITEMS}
              selected={answers.conditionItems ?? []}
              onAnswer={(v) => set({ conditions: v })}
              onToggle={(item, on) => set((prev) => ({ conditionItems: toggleItem(prev.conditionItems, item, on) }))}
              messages={messagesFor('conditions')}
            />
          ),
        });
        break;
      case 'metabolic':
        cards.push({
          q,
          node: (
            <ChecklistQuestion
              q={q}
              copy={QUESTIONS.metabolic}
              answer={answers.metabolic}
              items={METABOLIC_ITEMS}
              selected={answers.metabolicItems ?? []}
              onAnswer={(v) => set({ metabolic: v })}
              onToggle={(item, on) => set((prev) => ({ metabolicItems: toggleItem(prev.metabolicItems, item, on) }))}
              messages={messagesFor('metabolic')}
            />
          ),
        });
        break;
      case 'medications':
        cards.push({
          q,
          node: (
            <ChecklistQuestion
              q={q}
              copy={QUESTIONS.medications}
              answer={answers.medications}
              items={MEDICATION_ITEMS}
              selected={answers.medicationItems ?? []}
              onAnswer={(v) => set({ medications: v })}
              onToggle={(item, on) => set((prev) => ({ medicationItems: toggleItem(prev.medicationItems, item, on) }))}
              messages={messagesFor('medications')}
              columns={2}
            />
          ),
        });
        break;
      case 'symptoms':
      case 'supervisedExercise':
      case 'musculoskeletal':
      case 'alcohol': {
        const copy = QUESTIONS[q];
        cards.push({
          q,
          node: (
            <QuestionCard q={q} title={copy.title} messages={messagesFor(q)}>
              {({ legendId }) => <KeyBank<YesNoPrefer> labelledBy={legendId} size="lg" value={answers[q]} onChange={(v) => set({ [q]: v })} options={yesNoPrefer} />}
            </QuestionCard>
          ),
        });
        break;
      }
    }
  }

  let lastGroup: string | null = null;
  return (
    <div className="grid gap-4">
      {cards.map(({ q, node }) => {
        const group = QUESTION_GROUP[q];
        const head = group !== lastGroup && cards.length > 1;
        lastGroup = group;
        return (
          <Fragment key={q}>
            {head ? (
              <Engraved as="p" className="lm-onb-group" aria-hidden="true">
                {SCREENING.groups[group]}
              </Engraved>
            ) : null}
            {node}
          </Fragment>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Building blocks
   --------------------------------------------------------------------------- */

interface QuestionCardProps {
  q: QuestionId;
  title: string;
  help?: string;
  messages: SafetyMessage[];
  children: (ids: { legendId: string; helpId?: string }) => ReactNode;
}

function QuestionCard({ q, title, help, messages, children }: QuestionCardProps) {
  const id = useId();
  const legendId = `${id}-legend`;
  const helpId = help ? `${id}-help` : undefined;
  return (
    <Faceplate as="div" id={questionDomId(q)} className="lm-onb-q">
      <fieldset className="lm-onb-fs">
        <legend className="lm-onb-q__legend" id={legendId}>
          {title}
        </legend>
        {help ? (
          <p className="lm-onb-q__help" id={helpId}>
            {help}
          </p>
        ) : null}
        {children({ legendId, helpId })}
      </fieldset>
      {/* Persistent polite live region: consequences are announced as they appear (design §9). */}
      <div className="lm-onb-consequence" role="status">
        {messages.map((m) => (
          <Notice key={m.id} severity={m.severity} layout="ruled" title={MESSAGES[m.id].title}>
            <p className="m-0">{MESSAGES[m.id].body}</p>
          </Notice>
        ))}
      </div>
    </Faceplate>
  );
}

function SubRows({ title, help, note, children }: { title: string; help?: string; note?: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="lm-onb-follow" role="group" aria-labelledby={`${id}-t`} aria-describedby={help ? `${id}-h` : undefined}>
      <p className="lm-onb-follow__legend m-0" id={`${id}-t`}>
        {title}
      </p>
      {help ? (
        <p className="m-0 -mt-1 text-sm text-ink-2" id={`${id}-h`}>
          {help}
        </p>
      ) : null}
      {note ? <p className="m-0 text-sm text-ink">{note}</p> : null}
      <div className="lm-onb-rows">{children}</div>
    </div>
  );
}

function RowQuestion<V extends string>({ text, value, options, onChange }: { text: string; value: V | undefined; options: KeyBankOption<V>[]; onChange: (v: V) => void }) {
  const id = useId();
  return (
    <fieldset className="lm-onb-row lm-onb-fs">
      <legend id={id}>{text}</legend>
      <KeyBank<V> labelledBy={id} size="lg" value={value} onChange={onChange} options={options} />
    </fieldset>
  );
}

interface ChecklistCopy<I extends string> {
  title: string;
  help?: string;
  itemsLabel: string;
  items: Readonly<Record<I, string>>;
}

function ChecklistQuestion<I extends string>({
  q,
  copy,
  answer,
  items,
  selected,
  onAnswer,
  onToggle,
  messages,
  columns = 1,
}: {
  q: QuestionId;
  copy: ChecklistCopy<I>;
  answer: YesNoPrefer | undefined;
  items: readonly I[];
  selected: readonly I[];
  onAnswer: (v: YesNoPrefer) => void;
  onToggle: (item: I, on: boolean) => void;
  messages: SafetyMessage[];
  columns?: 1 | 2;
}) {
  const followId = useId();
  return (
    <QuestionCard q={q} title={copy.title} help={copy.help} messages={messages}>
      {({ legendId, helpId }) => (
        <>
          <KeyBank<YesNoPrefer> labelledBy={legendId} describedBy={helpId} size="lg" value={answer} onChange={onAnswer} options={yesNoPrefer} />
          {answer === 'yes' ? (
            <fieldset className="lm-onb-follow lm-onb-fs" aria-describedby={selected.length === 0 ? `${followId}-need` : undefined}>
              <legend className="lm-onb-follow__legend">{copy.itemsLabel}</legend>
              <div className="lm-onb-checks" data-columns={columns}>
                {items.map((item) => (
                  <Checkbox
                    key={item}
                    checked={selected.includes(item)}
                    label={copy.items[item]}
                    onChange={(on) => onToggle(item, on)}
                  />
                ))}
              </div>
              {selected.length === 0 ? (
                <p className="m-0 text-xs text-ink-2" id={`${followId}-need`}>
                  {SCREENING.tickOne}
                </p>
              ) : null}
            </fieldset>
          ) : null}
        </>
      )}
    </QuestionCard>
  );
}
