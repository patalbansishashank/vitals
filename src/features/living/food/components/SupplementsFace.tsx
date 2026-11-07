/**
 * Supplements faceplate: the prescription's supplements with a "taken" tick (logs it) and the person's own rows, then
 * either the food-first lines (safety-relevant flags and food suggestions, no products; the stance is the card's one
 * fact line) or — when the person chose "open" — the options relevant to the plan's goals under one "Options" label,
 * one named line each (name, grade, dose), whose details (when, why, good to know, the food-first way, buying) open on
 * tap. The options are always listed by name, never folded behind a count. "Things that won't help" is in the header ⋯.
 * D7-03: the options take the shared policy decision from the real safety state (screening answers, blood markers,
 * allergies, clinician stops). A caution option keeps its card with the word; products not suggested, needing review or
 * Unchecked (the fact they depend on is not answered) are named with status and reason under one tap-open line (never a
 * bare count); a product the person already takes keeps its row and Taken key with its status.
 */
import { Pill } from 'lucide-react';
import {
  CardFoot,
  CardHead,
  HeroNumber,
  GradientCard,
  GradeBadge,
  Key,
  KeyValueList,
  MonoMeta,
  RailNode,
  Section,
  StatusMark,
} from '@/components';
import type { PrescribedDaySnapshot } from '@/living';
import { fmtClock } from '../../format';
import { FOOD_COPY, INFO } from '../copy';
import { infoSpec } from '../../components/info';
import './foodLists.css';
import { useFoodSafety, type FoodProfileView } from '../profile';
import {
  SUGGESTION_WORD,
  confirmedAllergens,
  foodFirstLines,
  mergedSupplementLine,
  ownTakingRow,
  sameSupplement,
  supplementCards,
  supplementName,
  takingCaution,
  type HeldSupplement,
} from '../supplements';
import { CLOCK_OF_TIME, rowsIn } from '@/catalogues/supplements';
import { SupplementRow } from '@/features/components/SupplementRow';
import { saveSupplementRow } from '@/features/components/SupplementRowWriter';

const S = FOOD_COPY.supplements;
/** The details row of an option's policy status (D7-03): "Caution · bowel obstruction (not asked)". */
const STATUS_KEY = 'Status';

export interface SupplementsFaceProps {
  supplements: PrescribedDaySnapshot['supplements'];
  /** Supplement ids already taken on this date. */
  taken: ReadonlySet<string>;
  canLog: boolean;
  profile: FoodProfileView;
  onTaken(s: PrescribedDaySnapshot['supplements'][number]): void;
  quiet?: boolean;
  onNoBenefit?(): void;
}

type Card = ReturnType<typeof supplementCards>['cards'][number];

function OptionList({ cards }: { cards: readonly Card[] }) {
  return (
    <ul className="lv-food-opts">
      {cards.map((c) => (
        <li key={c.record.id}>
          <details className="lv-food-opt">
            <summary className="lv-food-opt__sum">
              <h4 className="lv-food-opt__name">
                <span>{c.name}</span>
                {c.status && SUGGESTION_WORD[c.status] ? (
                  <span className="lv-food-opt__flag">{SUGGESTION_WORD[c.status]}</span>
                ) : null}
              </h4>
              {c.grade ? <GradeBadge grade={c.grade} size="sm" /> : null}
              <span className="lv-food-opt__dose">{c.dose}</span>
            </summary>
            <KeyValueList
              items={[
                { key: S.when, value: c.when },
                ...(c.why ? [{ key: S.why, value: c.why }] : []),
                ...(c.caution ? [{ key: S.caution, value: c.caution }] : []),
                ...(c.reasons?.length
                  ? [{ key: STATUS_KEY, value: `${SUGGESTION_WORD.caution} · ${c.reasons.join(', ')}` }]
                  : []),
                ...(c.foodFirst ? [{ key: S.foodFirstAlt, value: c.foodFirst }] : []),
                { key: S.buying, value: S.thirdParty },
              ]}
            />
          </details>
        </li>
      ))}
    </ul>
  );
}

/**
 * "Not suggested · 2": one tap-open line naming each held product with its status and reasons (D7-03): "milk allergy"
 * (not suggested), "Review · kidney disease", "Unchecked · soy allergy (not answered)".
 */
function HeldList({ held }: { held: readonly HeldSupplement[] }) {
  return (
    <details className="lv-food-opt">
      <summary className="lv-food-opt__sum">
        <span className="lv-food-note">
          {SUGGESTION_WORD.noSuggest} · {held.length}
        </span>
      </summary>
      <KeyValueList
        items={held.map((h) => ({
          key: h.name,
          value:
            h.state === 'noSuggest'
              ? h.reason
              : [SUGGESTION_WORD[h.state], h.reason].filter(Boolean).join(' · '),
        }))}
      />
    </details>
  );
}

export function SupplementsFace({
  supplements,
  taken,
  canLog,
  profile,
  onTaken,
  quiet = false,
  onNoBenefit,
}: SupplementsFaceProps) {
  const safety = useFoodSafety(profile);
  const open = profile.supplementStance === 'open';
  // the person's own rows (taking · at home · not for me); a row the plan also prescribes ("creatine" ↔
  // creatine_monohydrate) is merged into the plan's line above — one line, one Taken key per supplement (Q6-11)
  const rows = profile.supplements?.rows ?? [];
  const prescribed = new Set(supplements.map((s) => s.supplementId));
  const mine = rows.filter((r) => !supplements.some((s) => sameSupplement(s.supplementId, r)));
  const listed = [
    ...rowsIn(profile.supplements ?? null, 'taking'),
    ...rowsIn(profile.supplements ?? null, 'onHand'),
    ...rowsIn(profile.supplements ?? null, 'notForMe'),
  ].flatMap((r) => (r.supplementId ? [r.supplementId] : []));
  const { cards, held } = open
    ? supplementCards({ prescribed: [...prescribed, ...listed], dietKind: profile.dietKind, safety })
    : { cards: [], held: [] };
  const ff = foodFirstLines(profile.dietKind, confirmedAllergens(safety));
  const planned = new Set([
    ...supplements.map((s) => s.supplementId),
    ...mine.filter((r) => r.state === 'taking' && r.supplementId).map((r) => r.supplementId!),
  ]);
  const doses = planned.size;
  const doneCount = [...planned].filter((id) => taken.has(id)).length;
  const word =
    doses === 0
      ? 'Nothing planned'
      : doneCount === doses
        ? 'All taken'
        : doneCount === 0
          ? 'Not taken yet'
          : 'Partly taken';
  const advice = (
    <div className="lv-food-supps__advice">
      <ul>
        {ff.suggestions.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      {onNoBenefit ? (
        <Key variant="text" onClick={onNoBenefit}>
          {FOOD_COPY.noBenefit.title}
        </Key>
      ) : null}
    </div>
  );
  return (
    <GradientCard
      id="supplements"
      domain="food"
      glow="tr"
      className="lv-food-supps lv-food-list-card"
      head={<CardHead icon={Pill} title={S.title} info={infoSpec(INFO.supplements, { range: advice })} />}
      foot={
        <CardFoot
          state={{ word: open ? word : S.foodFirst }}
          link={{ to: '/onboarding/supplements', label: 'Supplement options' }}
        />
      }
    >
      {doses > 0 ? (
        <HeroNumber value={`${doneCount} of ${doses}`} unit="taken" size="num"
          label={quiet ? word : `${doneCount} of ${doses} taken`} quietWord={quiet ? word : undefined} />
      ) : null}
      {supplements.length > 0 ? (
        <ul className="lv-food-supps__rows">
          {supplements.map((s) => {
            const own = ownTakingRow(s.supplementId, rows);
            const merged = own ? mergedSupplementLine(s, own) : null;
            const name = merged?.name ?? supplementName(s.supplementId);
            const done = taken.has(s.supplementId);
            // a prescribed product the current safety state no longer suggests: still loggable, with its Review status
            const review = takingCaution(s.supplementId, safety);
            return (
              <li key={s.supplementId} className="lv-food-supps__row">
                <span className="lv-food-supps__what">
                  <span className="lv-food-supps__name">{name}</span>
                  <MonoMeta tone="hue">
                    {merged
                      ? merged.line
                      : `${s.dose} ${s.unit} · ${s.clockH !== undefined ? S.at(fmtClock(s.clockH)) : S.anyTime}`}
                  </MonoMeta>
                  {review ? (
                    <span className="lv-food-supps__status">
                      <StatusMark severity="caution" />
                      <MonoMeta>{review}</MonoMeta>
                    </span>
                  ) : null}
                </span>
                <RailNode
                  status={done ? 'done' : 'empty'}
                  hue="food"
                  label={done ? S.undoTakenName(name) : S.takenName(name)}
                  onPress={canLog ? () => onTaken(s) : undefined}
                />
              </li>
            );
          })}
        </ul>
      ) : null}

      {mine.length ? (
        <Section label={S.yours} labelAs="h3">
          {mine.map((r) => (
            <SupplementRow
              key={r.supplementId ?? `text:${r.text ?? ''}`}
              variant="today"
              row={r}
              caution={r.state === 'taking' ? takingCaution(r.supplementId, safety) : null}
              onChange={(next) => void saveSupplementRow(next)}
              taken={!!r.supplementId && taken.has(r.supplementId)}
              onTaken={
                canLog && r.supplementId && r.dose !== undefined && r.unit
                  ? () =>
                      onTaken({
                        supplementId: r.supplementId!,
                        dose: r.dose!,
                        unit: r.unit!,
                        ...(r.timesOfDay[0] ? { clockH: CLOCK_OF_TIME[r.timesOfDay[0]] } : {}),
                      })
                  : undefined
              }
            />
          ))}
        </Section>
      ) : null}

      {open ? (
        <>
          {/* r068 L25: the options are a reference: folded under one line until opened */}
          {cards.length > 0 ? (
            <details className="lv-food-supps__more">
              <summary className="lv-food-supps__more-sum">
                <span>{S.options}</span>
                <span className="lv-food-note lm-num">{cards.length}</span>
              </summary>
              <OptionList cards={cards} />
            </details>
          ) : null}
          {held.length > 0 ? <HeldList held={held} /> : null}
        </>
      ) : null}
    </GradientCard>
  );
}
