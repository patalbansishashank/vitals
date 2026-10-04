/**
 * Supplements faceplate: the prescription's supplements with a "taken" tick (logs it), then either the food-first
 * text (safety-relevant flags and food-first suggestions, no products) or — when the person chose "open" — cards for
 * supplements relevant to the plan's goals with the standing third-party-testing line. "Things that won't help your
 * goals" opens the no-benefit list.
 */
import { Check, ChevronRight } from 'lucide-react';
import { Faceplate, GradeBadge, InlineWarning, Key, KeyLink, KeyValueList, Section } from '@/components';
import type { PrescribedDaySnapshot } from '@/living';
import { fmtClock } from '../../format';
import { FOOD_COPY } from '../copy';
import type { FoodProfileView } from '../profile';
import { foodFirstLines, mergedSupplementLine, ownTakingRow, sameSupplement, supplementCards, supplementName } from '../supplements';
import { CLOCK_OF_TIME, rowsIn } from '@/catalogues/supplements';
import { SupplementRow } from '@/features/components/SupplementRow';
import { saveSupplementRow } from '@/features/components/SupplementRowWriter';

const S = FOOD_COPY.supplements;

export interface SupplementsFaceProps {
  supplements: PrescribedDaySnapshot['supplements'];
  /** Supplement ids already taken on this date. */
  taken: ReadonlySet<string>;
  canLog: boolean;
  profile: FoodProfileView;
  onTaken(s: PrescribedDaySnapshot['supplements'][number]): void;
  onNoBenefit(): void;
}

export function SupplementsFace({ supplements, taken, canLog, profile, onTaken, onNoBenefit }: SupplementsFaceProps) {
  const open = profile.supplementStance === 'open';
  // the person's own rows (taking · at home · not for me); a row the plan also prescribes ("creatine" ↔
  // creatine_monohydrate) is merged into the plan's line above — one line, one Taken key per supplement (Q6-11)
  const rows = profile.supplements?.rows ?? [];
  const prescribed = new Set(supplements.map((s) => s.supplementId));
  const mine = rows.filter((r) => !supplements.some((s) => sameSupplement(s.supplementId, r)));
  const listed = [...rowsIn(profile.supplements ?? null, 'taking'), ...rowsIn(profile.supplements ?? null, 'onHand'), ...rowsIn(profile.supplements ?? null, 'notForMe')].flatMap((r) => (r.supplementId ? [r.supplementId] : []));
  const { cards, hiddenForSafety } = open ? supplementCards({ prescribed: [...prescribed, ...listed], dietKind: profile.dietKind, safetyFlags: profile.safetyFlags }) : { cards: [], hiddenForSafety: 0 };
  const ff = foodFirstLines(profile.dietKind);
  return (
    <Faceplate id="supplements" className="lv-food-supps" title={S.title} caption={open ? S.open : S.foodFirst}>
      {supplements.length === 0 ? (
        <p className="lv-food-note">{S.none}</p>
      ) : (
        <ul className="lv-food-supps__rows">
          {supplements.map((s) => {
            const own = ownTakingRow(s.supplementId, rows);
            const merged = own ? mergedSupplementLine(s, own) : null;
            const name = merged?.name ?? supplementName(s.supplementId);
            const done = taken.has(s.supplementId);
            return (
              <li key={s.supplementId} className="lv-food-supps__row">
                <span className="lv-food-supps__what">
                  <span className="lv-food-supps__name">{name}</span>{' '}
                  {merged ? (
                    <span className="lv-food-note lm-num">· {merged.line}</span>
                  ) : (
                    <>
                      <span className="lm-num">
                        {s.dose} {s.unit}
                      </span>
                      <span className="lv-food-note"> · {s.clockH !== undefined ? S.at(fmtClock(s.clockH)) : S.anyTime}</span>
                    </>
                  )}
                </span>
                {canLog ? (
                  <Key size="sm" icon={done ? Check : undefined} pressed={done} onClick={() => onTaken(s)} aria-label={done ? S.undoTakenName(name) : S.takenName(name)}>
                    {S.taken}
                  </Key>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {mine.length ? (
        <Section label={S.yours} labelAs="h3">
          {mine.map((r) => (
            <SupplementRow
              key={r.supplementId ?? `text:${r.text ?? ''}`}
              variant="today"
              row={r}
              onChange={(next) => void saveSupplementRow(next)}
              taken={!!r.supplementId && taken.has(r.supplementId)}
              onTaken={
                canLog && r.supplementId && r.dose !== undefined && r.unit
                  ? () => onTaken({ supplementId: r.supplementId!, dose: r.dose!, unit: r.unit!, ...(r.timesOfDay[0] ? { clockH: CLOCK_OF_TIME[r.timesOfDay[0]] } : {}) })
                  : undefined
              }
            />
          ))}
        </Section>
      ) : null}

      {open ? (
        <>
          {cards.map((c) => (
            <Section
              key={c.record.id}
              label={c.name}
              aside={c.grade ? <GradeBadge grade={c.grade} size="sm" /> : undefined}
              labelAs="h3"
            >
              <KeyValueList
                items={[
                  { key: S.dose, value: c.dose },
                  { key: S.when, value: c.when },
                  ...(c.why ? [{ key: S.why, value: c.why }] : []),
                  ...(c.caution ? [{ key: S.caution, value: c.caution }] : []),
                  ...(c.foodFirst ? [{ key: S.foodFirstAlt, value: c.foodFirst }] : []),
                ]}
              />
            </Section>
          ))}
          {cards.length > 0 ? <p className="lv-food-note">{S.thirdParty}</p> : null}
          {hiddenForSafety > 0 ? (
            <InlineWarning severity="info">{S.hiddenForSafety(hiddenForSafety)}</InlineWarning>
          ) : null}
        </>
      ) : (
        <Section label={S.foodFirst} labelAs="h3">
          {ff.flags.map((f) => (
            <InlineWarning key={f} severity="info">
              {f}
            </InlineWarning>
          ))}
          <ul className="lv-food-supps__ff">
            {ff.suggestions.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <p className="lv-food-note">
            {S.stanceNote}{' '}
            <KeyLink to="/onboarding/supplements" variant="quiet" size="sm">
              {S.stanceLink}
            </KeyLink>
          </p>
        </Section>
      )}

      <p className="lv-food-note">{S.takingChanges}</p>
      <Key variant="quiet" size="sm" trailingIcon={ChevronRight} onClick={onNoBenefit}>
        {S.noBenefitKey}
      </Key>
    </Faceplate>
  );
}
