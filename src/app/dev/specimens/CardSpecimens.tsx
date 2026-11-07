/**
 * Gallery section "g-cards" (r071 0B): the card and its parts. GradientCard in every domain hue (the glow encodes the
 * domain, never the value), the head with its (i), the foot, the slim action card, the stretched open target, the
 * panel the (i) opens (add `?info` to the page URL to open it on load), HeroNumber in every size, MonoMeta, StatusDot
 * and the quiet form. Numbers are synthetic (PRODUCT.md); the ones RESEARCH §0 gave are used as given.
 */
import { useState, type CSSProperties } from 'react';
import { Activity, Check, Flame, Footprints, HeartPulse, Moon, Scale, Utensils, Video } from 'lucide-react';
import { CardFoot, CardHead, GradientCard, HeroNumber, InfoPanel, Key, MonoMeta, StatusDot, DOMAIN_LABEL, HUE_DOMAINS, type Domain, type IconComponent } from '@/components';
import { ChartTwin } from '@/components/viz/twin';
import { GallerySection, Row, Spec } from './kit';

const HUES: Array<[Domain, IconComponent, number, string, string]> = [
  ['heart', HeartPulse, 79, 'bpm', '79 beats per minute'],
  ['energy', Flame, 1096, 'kcal', '1,096 kilocalories'],
  ['food', Utensils, 750, 'kcal', '750 kilocalories'],
  ['steps', Footprints, 7605, '', '7,605 steps'],
  ['recovery', Activity, 48, 'ms', '48 milliseconds'],
  ['body', Scale, 85.2, 'kg', '85.2 kilograms'],
  ['sleep', Moon, 8, 'h', '8 hours'],
  ['videos', Video, 42, 'min', '42 minutes'],
];

const WIDE: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 330px), 1fr))', gap: 'var(--lm-card-gap)', alignItems: 'start' };
const MINI: CSSProperties = { height: 64, display: 'flex', alignItems: 'flex-end' };

const INFO = {
  body: 'The calories your body has used since midnight: resting burn plus movement. The total shown is today’s forecast, so it moves as you go.',
  source: { kind: 'estimate' as const, words: 'Resting burn from your body basics, movement from your ring.' },
  range: <span>Usually 2 300 to 2 800 for your size.</span>,
  terms: [{ term: 'Resting burn', text: 'What your body uses just staying alive.' }],
  evidence: [
    { to: '/evidence/10-wearable-calorie-error', label: 'Resting energy needs', grade: 'B' as const },
    { to: '/evidence/10-steps-and-health', label: 'Activity energy and step counts', grade: 'B' as const },
  ],
  twin: (
    <ChartTwin
      data={{ title: 'Energy by hour, table', caption: 'Energy burned through the day', head: ['Time', 'kcal'], rows: [['00:00', '0'], ['06:00', '412'], ['12:00', '842'], ['14:58', '1 096']], fileName: 'vitals-energy.csv', rowNoun: ['hour', 'hours'] }}
    />
  ),
  footer: (
    <Key variant="text" size="sm">
      Remove from Today
    </Key>
  ),
};

export default function CardSpecimens() {
  const [open, setOpen] = useState(() => typeof location !== 'undefined' && new URLSearchParams(location.search).has('info'));
  const [replay, setReplay] = useState(0);
  return (
    <GallerySection id="g-cards" title="Cards" caption="GradientCard · CardHead · InfoPanel · CardFoot · HeroNumber · MonoMeta · StatusDot">
      <Spec name="GradientCard, one per domain" note="one eased glow in the domain hue; it says what, never how much" cols="tiles">
        {HUES.map(([d, icon, v, unit, label]) => (
          <GradientCard key={d} domain={d} size="tile" head={<CardHead icon={icon} title={DOMAIN_LABEL[d]} info={{ body: `About ${DOMAIN_LABEL[d].toLowerCase()}.` }} />} foot={<CardFoot state={{ word: 'Usual' }} right="Range 60–100" />}>
            <HeroNumber value={v} decimals={d === 'body' ? 1 : 0} unit={unit || undefined} size="num" label={label} key={`${d}-${replay}`} />
          </GradientCard>
        ))}
      </Spec>

      <Spec name="Hero, card and slim" note="hero: a big number, its likely range, a state word and the range; slim: the one action of the day">
        <div style={WIDE}>
          <GradientCard
            domain="energy"
            size="hero"
            head={<CardHead icon={Flame} title="Energy" info={INFO} />}
            foot={<CardFoot state={{ word: 'On plan' }} right="By bedtime 2 595" tone="ink" />}
          >
            <HeroNumber value={1096} unit="kcal" size="hero" range={[983, 1209]} label="1,096 kilocalories so far, likely 983 to 1,209" key={`h-${replay}`} />
            <MonoMeta tone="hue">Of 2 595 today</MonoMeta>
            <div style={MINI}>
              <span style={{ display: 'block', width: '100%', height: 2, background: 'var(--lm-ink)', opacity: 0.6, borderRadius: 2 }} />
            </div>
          </GradientCard>
          <div style={{ display: 'grid', gap: 'var(--lm-card-gap)' }}>
            <GradientCard
              domain="plan"
              size="slim"
              aria-label="Snack"
              head={undefined}
            >
              <button type="button" aria-label="Log Snack" style={{ width: 48, height: 48, borderRadius: 999, border: 0, background: 'var(--lm-signal)', color: 'var(--lm-signal-ink)', display: 'grid', placeItems: 'center', flex: 'none' }}>
                <Check size={22} strokeWidth={2.25} />
              </button>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ margin: 0, font: '600 17px/22px var(--lm-font-sans)' }}>Snack</p>
                <MonoMeta tone="hue" as="p">
                  <StatusDot tone="live" label="Next up · in 1 h 32" />
                </MonoMeta>
              </div>
              <HeroNumber value="16:30" size="time" label="16:30" />
            </GradientCard>
            <GradientCard domain="sleep" size="card" head={<CardHead icon={Moon} title="Sleep" info={{ body: 'Last night, from your ring.' }} />} foot={<CardFoot state={{ word: 'Goal met' }} right="Goal 7 h 30" />}>
              <HeroNumber parts={[{ value: 7, unit: 'h' }, { value: 56, unit: 'm' }]} size="num-l" label="7 hours 56 minutes" key={`s-${replay}`} />
              <MonoMeta tone="hue">23:12 – 07:08</MonoMeta>
            </GradientCard>
          </div>
        </div>
        <Row>
          <Key variant="text" size="sm" onClick={() => setReplay((r) => r + 1)}>
            Replay the count-up and glow fade
          </Key>
          <MonoMeta>Needs motion allowed; reduced motion shows the final frame at once</MonoMeta>
        </Row>
      </Spec>

      <Spec name="Open targets and glow positions" note="the whole card opens through its title; the (i) and keys sit above it; `glow` moves the glow, never resizes it" cols="tiles">
        {(['tl', 'tr', 'bl', 'br'] as const).map((g) => (
          <GradientCard key={g} domain="steps" size="tile" glow={g} onOpen={() => undefined} openLabel={`Open steps, glow ${g}`} head={<CardHead icon={Footprints} title={`Glow ${g}`} info={{ body: 'Open target.' }} />}>
            <HeroNumber value={7605} size="num" label="7,605 steps" />
          </GradientCard>
        ))}
        <GradientCard domain="body" size="tile" glow="none" head={<CardHead icon={Scale} title="No glow" />}>
          <HeroNumber value={85.2} decimals={1} unit="kg" size="num" label="85.2 kilograms" />
        </GradientCard>
        <GradientCard domain="neutral" size="tile" head={<CardHead icon={Activity} title="Neutral" />}>
          <HeroNumber value={12} size="num" label="12" />
        </GradientCard>
        <GradientCard domain="neutral" size="tile" variant="inset" head={<CardHead icon={Activity} title="Inset" />}>
          <HeroNumber value={12} size="num" label="12" />
        </GradientCard>
        <GradientCard domain="heart" size="tile" glow={{ pos: '50% 50%', size: '70% 70%', a: 0.45 }} head={<CardHead icon={HeartPulse} title="Custom" />}>
          <HeroNumber value={79} unit="bpm" size="num" label="79 beats per minute" />
        </GradientCard>
      </Spec>

      <Spec name="The (i) panel" note="a sheet on a phone, a 392 px side panel from 1024; one way out, the ✕; a foot action is allowed">
        <Row>
          <Key variant="outlined" size="sm" onClick={() => setOpen(true)}>
            Open the panel
          </Key>
        </Row>
        <InfoPanel open={open} onClose={() => setOpen(false)} title="Energy" {...INFO} />
      </Spec>

      <Spec name="HeroNumber" note="Geist 300, proportional; clocks and figures tabular; the unit small and muted; the digits are hidden from assistive technology, the label is the spoken value">
        <div style={{ display: 'grid', gap: 18, justifyItems: 'start' }}>
          <HeroNumber value={1096} unit="kcal" size="hero" label="1,096 kilocalories" key={`a-${replay}`} />
          <HeroNumber value={7605} size="num-l" label="7,605 steps" key={`b-${replay}`} />
          <HeroNumber value={85.2} decimals={1} unit="kg" size="num" label="85.2 kilograms" key={`c-${replay}`} />
          <HeroNumber parts={[{ value: 7, unit: 'h' }, { value: 56, unit: 'm' }]} size="num" label="7 hours 56 minutes" key={`d-${replay}`} />
          <HeroNumber value="16:30" size="time" label="16:30" />
          <HeroNumber value={32} unit="g" size="stat" label="32 grams" />
          <HeroNumber value={1096} unit="kcal" unitPlacement="below" size="num" range={[983, 1209]} label="1,096 kilocalories, likely 983 to 1,209" key={`e-${replay}`} />
          <HeroNumber value={null} size="num" label="No weigh-in yet" />
        </div>
      </Spec>

      <Spec name="Quiet mode" note="a word, never a digit; the glow and the picture stay" cols="tiles">
        <GradientCard domain="food" size="tile" head={<CardHead icon={Utensils} title="Eaten" info={{ body: 'Quiet mode shows words, not numbers.' }} />} foot={<CardFoot state={{ word: 'On plan' }} />}>
          <HeroNumber value={750} unit="kcal" size="num" label="About a third of today’s food" quietWord="A third" />
        </GradientCard>
        <GradientCard domain="body" size="tile" head={<CardHead icon={Scale} title="Weight" />} foot={<CardFoot state={{ word: 'Behind', tone: 'caution' }} />}>
          <HeroNumber value={85.2} unit="kg" size="num" label="Trending down" quietWord="Down" />
        </GradientCard>
      </Spec>

      <Spec name="MonoMeta, state words and StatusDot" note="mono caps for facts only; a state is a mark plus a word, never colour alone">
        <Row>
          <MonoMeta>Fri, 30 Oct · W44</MonoMeta>
          <MonoMeta tone="ink">Next up · in 1 h 32</MonoMeta>
          <MonoMeta items={['Of 2 050', '1 300 left']} />
          <StatusDot tone="live" label="Recording" pulse />
          <StatusDot tone="ok" label="Synced · 14:58" />
          <StatusDot tone="caution" label="Stale" />
          <StatusDot tone="danger" label="Paused" />
          <StatusDot tone="neutral" label="Off" />
        </Row>
      </Spec>

      <Spec name="The wheel" note="eight domains in their fixed order, plus gold for plan: solid · ink · deep · dim" cols={2}>
        <div style={{ display: 'grid', gap: 8 }}>
          {[...HUE_DOMAINS, 'plan' as const].map((d) => (
            <div key={d} data-hue={d} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <MonoMeta style={{ width: 96 }}>{DOMAIN_LABEL[d]}</MonoMeta>
              {(['--lm-hue', '--lm-ink-h', '--lm-deep', '--lm-dim'] as const).map((v) => (
                <span key={v} title={v} style={{ width: 44, height: 22, borderRadius: 6, background: `var(${v})`, border: '0.5px solid var(--lm-line)' }} />
              ))}
            </div>
          ))}
        </div>
      </Spec>
    </GallerySection>
  );
}
