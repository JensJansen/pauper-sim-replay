import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import Header from '../Header'
import Term from '../components/Term'
import Curve from '../components/Curve'
import { ArchDown, ArchNode, Callout, Card, DataTable, Drill, FlowRow, MergeConnector } from '../components/ui'
import '../components/ui.css'
import './methodology.css'

const TOC = [
  ['overview', 'Overview'], ['league', 'Self-Play League'], ['model', 'Model'], ['actions', 'Action Space'],
  ['reward', 'Reward'], ['ppo', 'PPO'], ['mulligan', 'Mulligan Net'], ['validation', 'Validation'],
  ['config', 'Config & Checkpoints'], ['experiments', 'Experiments'],
]

const hill = (x, c, p) => (x <= 0 ? 0 : x ** p / (x ** p + c ** p))
const kFmt = v => `${v / 1000}k`

function Overview() {
  return (
    <section id="overview">
      <h1 className="title">How this agent is trained</h1>
      <p className="lede">
        A fixed pauper card pool, several decks, and one loop: play games against
        varied opponents, turn the outcome into a policy-gradient update, and
        periodically check the result against fixed benchmarks.
      </p>

      <h3 className="sub">Two loops, two timescales</h3>
      <FlowRow label="Per-decision — every single legal action, many times a game" items={[
        { t: 'Game State', d: "the engine's live board, both seats" },
        { t: 'Observation Encoding', d: 'zones → token set + scalar globals' },
        { t: 'Policy / Value Net', d: 'per-deck encoder + trunk + GRU' },
        { t: 'Sample Action', d: 'masked to legal moves only' },
        { t: 'Engine Step', d: 'applied, reward attributed' },
      ]} />
      <div className="flow-loop">↻ loops back to Game State until the game ends</div>

      <FlowRow label="Training — every iteration / snapshot cadence / validation cadence" items={[
        { t: 'Collect Episodes', d: <>rollouts vs a <Term k="pfsp">PFSP</Term>-sampled opponent</> },
        { t: <><Term k="ppo">PPO</Term> Update</>, d: 'clipped policy-gradient step' },
        { t: 'League Snapshot', d: 'freeze into the opponent pool' },
        { t: 'Validation', d: 'round robins, history ladder, mulligan audit' },
      ]} />

      <p className="intro" style={{ marginTop: 22 }}>
        Jump to a stage: League structure → model architecture → action space → reward → PPO → mulligan net →
        validation → config/checkpoints → experiments.
      </p>
    </section>
  )
}

function League() {
  return (
    <section id="league">
      <div className="kicker">Stage 1</div>
      <h2>Self-Play League Structure</h2>
      <p className="intro">
        Training runs as a <b>league</b>: a roster of decks that all improve
        together, playing each other and their own past selves. Three
        populations exist per league, and only one of them is the actual
        training target.
      </p>

      <div className="league-diagram">
        <div className="pop-box">
          <h4>Primary League</h4>
          <div className="pop-sub">e.g. <code>small_league</code> — the actual thing being trained</div>
          <div className="sub-item"><b>Live nets</b> — one <code>live.pt</code> per deck, updated every PPO step</div>
          <div className="sub-item"><b>Archive</b> — rolling window of 32 frozen historical snapshots per deck (PFSP opponent pool)</div>
          <div className="sub-item"><b><Term k="pfsp">PFSP</Term> sampler</b> — picks which deck, then live-vs-snapshot, weighted toward opponents this deck is currently losing to</div>
        </div>
        <div className="pop-box dim">
          <h4>Training League <span className="hint">(twin)</span></h4>
          <div className="pop-sub">same roster/mechanics, independent trajectory, frozen size</div>
          <div className="sub-item"><b>Fixed at ~10,000 games/deck</b> (10,008 in practice) — never extended, even as the primary keeps training</div>
          <div className="sub-item">Exists purely as a <b>benchmark opponent pool</b> — since it stops improving, a rising win rate against it isn't confounded by "everyone got better together"</div>
          <div className="sub-item">Built only if the config sets <code>create_training_league: true</code>. Experiment arms can <b>share one copy</b> of the twin, so every arm is measured against the same fixed opponent (see <a href="#experiments">Experiments</a>)</div>
        </div>
      </div>
      <div className="pop-link">both populations feed round-robin evaluation ↓ (see <a href="#validation">Validation</a>)</div>

      <h3 className="sub">One training session, step by step</h3>
      <Card>
        <ol style={{ color: '#b8c0d0', paddingLeft: 20, fontSize: 13, margin: 0 }}>
          <li>Load (or resume) every train deck's network and optimizer state from <code>live.pt</code>, plus its mulligan net with a separate optimizer.</li>
          <li>Per iteration, per train deck: sample an opponent (PFSP-weighted deck, then live-vs-snapshot), collect rollout games, run a PPO update on that deck's own buffer — and also update any <i>other</i> train deck whose buffer was generated as a live opponent in those same games ("salvaging"). With <code>overlap_collect</code>, workers collect the next deck's games while the GPU updates the current one.</li>
          <li>Every 8 iterations (or the session's last one), flush accumulated mulligan-decision transitions through one REINFORCE step per deck.</li>
          <li>When cumulative games cross the snapshot cadence (<code>snapshot_every_games</code>, 200; snapshots land on iteration boundaries, so about every 192 games/deck), freeze a new snapshot per deck into the league pool, save live checkpoints + optimizer state + opponent stats, and update <code>progress.json</code>.</li>
          <li>Always re-save live checkpoints at session end.</li>
        </ol>
      </Card>
      <p className="intro">
        A real run is many separate process invocations of this session, chained by the higher-level pipeline runner
        until a deck hits its configured <code>total_games</code>, with the full validation suite run after each chunk.
      </p>

      <div className="grid">
        <Card title="PFSP opponent weighting — weight vs. this deck's win rate against a candidate">
          <Curve fn={wr => 0.1 + (1 - wr) ** 0.5} xMin={0} xMax={1} yMin={0.1} yMax={1.1}
                 xTicks={[0, 0.5, 1]} yTicks={[0.1, 0.6, 1.1]} xFmt={v => `${(v * 100).toFixed(0)}%`} yFmt={v => v.toFixed(1)} />
          <p className="hint" style={{ margin: '8px 0 0' }}>
            weight = 0.1 + (1 − win_rate)^<code>pfsp_power</code>, with <code>pfsp_power</code> = 0.5 (shown). A never-played opponent starts at a
            neutral 0.5 win-rate prior. The 0.1 floor keeps even lopsided matchups in rotation instead of dropping to zero.
          </p>
        </Card>
      </div>
      <Drill summary="Why pfsp_power 0.5, not 2.0">
        2.0 sharpened the weighting backwards for this league: it sent three of four decks into 58–77% of their games
        in matchups they win under 25% of. 0.5 keeps the pull toward hard opponents gentle. Also: 24 games per iteration
        (not one per worker) — at 6 games per update, every PPO update spent its whole trust region on six games
        (<code>approx_kl</code> 0.044 against a 0.03 target).
      </Drill>
      <Drill summary="Archive & snapshot eviction">
        Each deck keeps at most 32 snapshots as PFSP opponents. When a new
        snapshot would overflow that window, the oldest one is moved (never
        deleted) into <code>&lt;deck&gt;/archive/</code>. Archived snapshots
        stay playable — every snapshot a deck ever took is kept (one per
        <code>snapshot_every_games</code>), which is what lets the history checks
        (<a href="#history-checks">below</a>) play the
        current net against its own past selves at any age, even long after
        they left the active window.
      </Drill>
    </section>
  )
}

function Model() {
  return (
    <section id="model">
      <div className="kicker">Stage 2</div>
      <h2>Model Architecture</h2>
      <p className="intro">
        Every deck owns its <b>own</b> encoder and trunk — nothing is shared
        across decks. That costs cross-deck transfer, but means one deck's
        representation never has to compromise for another's.
      </p>

      <div className="arch-flow">
        <ArchNode t="Card tokens, both seats" d="battlefield · graveyard · stack · exile (both) + own hand" />
        <ArchDown />
        <ArchNode t={<><Term k="set_transformer">SetTransformer</Term> encoder</>}
                  d={<>2-layer <Term k="self_attention">self-attention</Term>, 4 heads, d_model=64 (defaults) — every token attends to every other</>} />
        <ArchDown />
        <div className="arch-branch">
          <ArchNode t={<><Term k="pma">PMA</Term> pool + sum pool → "mine" summary</>} d="attention pool (a weighted mean) ‖ plain sum, so counts survive" />
          <ArchNode t={'PMA pool + sum pool → "theirs" summary'} d="split by side flag; an empty side pools to an exact zero" />
        </div>
        <MergeConnector />
        <div className="merge-label"><b>↓</b>both summaries feed the trunk below — mine_summary directly, theirs_summary by modulating it (<Term k="film">FiLM</Term>)</div>
        <ArchNode t="Trunk — 2×128, FiLM-conditioned" d="mine_summary + scalar globals in, gated by γ·h+β from theirs_summary" />
        <ArchDown> + previous action embedding, and which token the previous pick pointed at</ArchDown>
        <ArchNode t={<><Term k="gru">GRU</Term> (recurrent memory)</>} d={'carries history the board alone doesn\'t show, e.g. "opponent held up mana and passed"'} />
        <ArchDown />
        <div className="arch-heads">
          <ArchNode t="Critic head" d="scalar value estimate" />
          <ArchNode t="Fixed-action head" d="logits over the menu-shaped action table" />
          <ArchNode t="Pointer head" d="scores legal targets against token representations" />
        </div>
      </div>
      <p className="hint" style={{ textAlign: 'center' }}>
        the fixed-action logits and pointer scores are concatenated into one softmax — see <a href="#actions">Action Space</a>
      </p>

      <Drill summary="Per-token features (what each card contributes)">
        <b>Static half</b> — doesn't change turn to turn: mana cost pips (normalised by the largest printed cost), card
        type one-hot, base power/toughness, keyword multi-hot, mana-production features, spec-key multi-hot,
        pending-kind multi-hot, extra-flag multi-hot (artifact / basic / defender / indestructible / devoid), subtype
        multi-hot — plus a <b>card-behavior block derived from the card's own code</b> (<code>card_behavior.py</code>):
        the engine primitives a card's <code>resolve</code> reaches and how big its numbers are. Without it Cast Down
        and Unexpected Fangs, Lightning Bolt and Galvanic Blast, or Dispel and Mental Note collapsed to the same vector.
        <br /><br />
        <b>Dynamic half</b> — current state: tapped, effective P/T (signed), blocked
        / attacking / summoning-sick flags, aura attachment, targeted-by-mine
        / targeted-by-theirs, revealed-hand disposition bits, counter counts,
        zone one-hot, side flag, and two copy counts (how many identical
        cards, and how many identical-state cards, are present — attention is
        a weighted mean, so without these six Mountains would look like one),
        and link slots pairing an aura with its host, a spell with its target
        and a blocker with its attacker (numbered canonically, so token order never matters), plus which player a spell targets.
        Every feature is scaled into [0, 1] (life capped at 200); only effective power is signed, in [−1, 1].
        <br /><br />
        Opponent's hand and both libraries are hidden by default — aggregate
        counts only via the scalar globals — except two narrow reveal cases
        (Mesmeric-Fiend-style effects, and scry/surveil/ponder/tuck "revealed"
        holding areas), which get real tokens.
      </Drill>
      <Drill summary="Scalar globals (non-tokenized state)">
        Turn number, lands played this turn, mulligans taken (both seats),
        life totals, mana pools by color, phase one-hot, library sizes, opponent
        hand size, stack-targeting flags, on-the-play, opponent discard count,
        and exact per-side counts (permanents by card type, untapped by type,
        graveyard, exile, stack entries; plus the agent's own hand size).
        Concatenated with the "mine" summary before the trunk.
      </Drill>
      <Drill summary="Configurable capacity (encoder shape, trunk width)">
        The encoder's <code>d_model</code>, <code>n_layers</code> and <code>dim_feedforward</code> and the trunk's
        <code>trunk_hidden</code> are config keys for freshly built decks; every loader reads the shape back off the
        checkpoint, so a run can't be resumed into a different architecture by accident. The head count follows from
        <code>d_model</code> (16 dimensions per head), and the pooled summary is <code>2 × d_model</code> wide (attention pool ‖ sum pool).
        Defaults are the 64-wide / 2-layer / 2×128 net described above. The run's <code>manifest.json</code> records the
        resolved architecture.
      </Drill>
      <Drill summary="Why FiLM instead of just concatenating the opponent summary">
        A small conditioner MLP turns <code>theirs_summary</code> into
        per-layer <code>(γ, β)</code> pairs that rescale and shift each trunk
        layer's activations (<code>γ·h + β</code>), rather than appending it
        as extra input features. The opponent's board state gates how the
        trunk processes your own state, instead of just being one more thing
        concatenated in.
      </Drill>
      <Drill summary="Why a GRU on top of an already-Markov board state">
        The encoded board is itself close to fully observable, but recent
        history still carries information the current snapshot doesn't —
        what mana got held up and passed, what was declined last turn. The
        GRU is fed the trunk output plus an embedding of the agent's own
        previous action (and which token that pick pointed at), giving it that short-term memory. PPO updates replay
        whole episodes through it in order from a zero hidden state — see <a href="#ppo">PPO Training</a>.
      </Drill>
    </section>
  )
}

function Actions() {
  return (
    <section id="actions">
      <div className="kicker">Stage 3</div>
      <h2>Action Space</h2>
      <p className="intro">
        Actions come from <b>one combined <Term k="softmax">softmax</Term></b>, not two separate
        distributions — a fixed-table entry and a pointer-scored target can
        both be legal at the same decision, so they compete in a single
        masked distribution rather than being chosen in two stages.
      </p>

      <div className="compare">
        <div className="col">
          <h4>Fixed table — menu-shaped</h4>
          <ul>
            <li>Play land / Cast a spell / Activate an ability</li>
            <li>Forestcycle</li>
            <li>Pass</li>
            <li>Mana-payment choices</li>
            <li>"Choose: X" / "Choose: X as color" resolution picks</li>
            <li>Keep / Dispose, Decline, Abandon payment</li>
            <li>Mulligan actions, "Done blocking"</li>
          </ul>
          <p className="hint">fixed shape per deck, built once from its decklist (row order is load-bearing: checkpoints index into it)</p>
        </div>
        <div className="col">
          <h4>Pointer head — context-shaped</h4>
          <ul>
            <li>Attack, assign blocker</li>
            <li>Choose target / opponent's permanent</li>
            <li>Assign combat damage</li>
            <li>Choose-any-target effects</li>
            <li>Identity-matched picks: choose cast copy, choose graveyard card, choose stack target</li>
          </ul>
          <p className="hint">variable length — one score per currently legal token, masked by what's actually pending</p>
        </div>
      </div>
      <MergeConnector viewBox="0 0 700 26" left={175} right={525} mid={350} wide />
      <div className="merge-label"><b>↓</b>both halves concatenate into one decision below</div>
      <div className="merge-box">
        <Card title="Single masked softmax over both halves" style={{ display: 'inline-block', textAlign: 'left', maxWidth: 460 }}>
          <p className="hint" style={{ margin: '6px 0 0' }}>
            Pointer targets are addressed by object identity for graveyard / stack
            / hand-reveal picks, or by <code>(name, slot)</code>
            for battlefield permanents — so two identically-named permanents or
            spells are still targeted correctly.
          </p>
        </Card>
      </div>
    </section>
  )
}

function Reward() {
  return (
    <section id="reward">
      <div className="kicker">Stage 4</div>
      <h2>Reward Function</h2>
      <p className="intro">
        The reward is almost entirely win/loss. The only shaping on top is a
        small, capped, saturating penalty for wasting mana — applied only to
        the seat that ends up winning, so a losing trajectory is never worse
        off for having burned mana along the way.
      </p>

      <div className="grid-2">
        <Card title="deploy_reward_v6 — the production reward">
          <pre className="code">{`with_dense_mana_burn_penalty(
    flat_win_loss_reward(),
    mana_burn_c=2.9,
    mana_burn_p=4.0,
    game_penalty_cap=1.5,
    refund_on_loss=True,
    mana_burn_weight=0.5,
)`}</pre>
        </Card>
        <Card title="Terminal band">
          <p className="hint" style={{ margin: 0 }}>
            +1.0 win · −1.0 loss or no-winner timeout · 0.0 every non-terminal step. No efficiency or sloppiness term
            at this level — every win scores the same, every loss scores the same.
          </p>
        </Card>
        <Card title="Marginal single-pip mana-burn penalty, by turn" style={{ gridColumn: '1 / -1' }}>
          <Curve fn={x => 0.5 * hill(x, 2.9, 4.0)} w={860} h={150} xMin={0} xMax={8} yMin={0} yMax={0.5}
                 xTicks={[0, 1, 2, 3, 4, 5, 6, 7, 8]} yTicks={[0, 0.25, 0.5]} yFmt={v => v.toFixed(2)} />
          <p className="hint" style={{ margin: '8px 0 0' }}>
            0.5 · <Term k="hill">hill</Term>(x, c=2.9, p=4.0) — reset every turn, only charged if this seat wins the game, capped at 1.5 total across the whole game.
          </p>
        </Card>
      </div>

      <p className="intro">
        Worst-case win reward is <code>1.0 − 1.5 = −0.5</code>; every loss is exactly <code>−1.0</code>.
        A win always outscores any loss by at least 0.5 — the shaping term can
        never flip a win into looking worse than a loss.
      </p>

      <Drill summary={'What counts as "burn" (single-pip tagging)'}>
        Only mana-producing events that add exactly <b>one</b> floating
        symbol are tagged — a plain land or a one-mana dork like Llanowar
        Elves. Board-scaled abilities (Priest of Titania's count-all tap, a
        fully-online Tron land) are never blamed, because spending always
        consumes an untagged pip first. So the penalty targets genuinely
        avoidable waste, not correct big taps that happen to leave some
        unused.
      </Drill>
      <Drill summary={'Why "winner-only" and why deferred, not a terminal refund'}>
        Charging the loser too would make passive, mana-inefficient-but-safe
        play look better than a real attempt to win — so the penalty is
        deferred per-turn and only actually applied at game end if this seat
        won. That's <i>not</i> the same as computing the whole game's burn and
        refunding it as one lump sum at the end: under <Term k="gae">GAE</Term>, a charge written
        at step t lands directly in that step's advantage estimate, while a
        terminal-only refund would reach step t discounted by
        <code>(γ·λ)^k</code> — leaving early-game burns mostly un-refunded. Per-turn
        deferral keeps a losing trajectory bit-for-bit identical to one that
        never burned any mana.
      </Drill>
    </section>
  )
}

function Ppo() {
  return (
    <section id="ppo">
      <div className="kicker">Stage 5</div>
      <h2>PPO Training</h2>
      <p className="intro">
        Standard clipped-surrogate PPO, with two schedules that ramp over the
        first 50,000 cumulative games per deck: minibatch size grows in steps
        as training stabilizes, and the entropy bonus anneals down as
        exploration matters less. The learning rate is flat by default; a
        linear decay is an experiment arm (see <a href="#experiments">Experiments</a>).
      </p>

      <Card>
        <DataTable head={['Hyperparameter', 'Value']} rows={[
          [<>Learning rate (<Term k="adam">Adam</Term>, per-deck)</>, <span className="num">2e-4 (flat)</span>],
          ['Mulligan-net learning rate (separate Adam)', '1e-3'],
          [<Term k="gamma">γ (discount)</Term>, '0.99'],
          [<Term k="gae_lambda">GAE λ</Term>, '0.95'],
          [<Term k="clip_range">Clip range</Term>, '0.2'],
          [<Term k="vf_coef">Value-function coefficient</Term>, '0.5'],
          [<Term k="max_grad_norm">Max grad norm</Term>, '0.5'],
          [<Term k="target_kl">Target KL (epoch-level early stop)</Term>, '0.03'],
          [<Term k="epochs_per_update">Epochs per update</Term>, '4'],
          [<Term k="minibatch">Minibatch size</Term>, '4 → 16 episodes (stepped)'],
          [<Term k="entropy_coef">Entropy coefficient</Term>, '0.02 → 0.005 (linear anneal)'],
          ['Games per iteration', '24'],
        ]} />
      </Card>

      <div className="grid">
        <Card title="Entropy coefficient — linear anneal">
          <Curve fn={g => 0.02 + (0.005 - 0.02) * Math.min(1, g / 50000)} xMin={0} xMax={60000} yMin={0} yMax={0.02}
                 xTicks={[0, 25000, 50000]} yTicks={[0, 0.01, 0.02]} xFmt={kFmt} yFmt={v => v.toFixed(3)} />
          <p className="hint" style={{ margin: '8px 0 0' }}>start 0.02, floor 0.005, held flat after 50,000 cumulative games/deck</p>
        </Card>
        <Card title="Minibatch size — stepped ramp (in episodes)">
          <Curve fn={g => Math.min(4 * 2 ** Math.floor(Math.min(1, g / 50000) * 6), 16)} xMin={0} xMax={60000} yMin={0} yMax={16}
                 xTicks={[0, 25000, 50000]} yTicks={[4, 8, 16]} step xFmt={kFmt} />
          <p className="hint" style={{ margin: '8px 0 0' }}>doubles at fixed fractions of the 50,000-game horizon, capped at 16</p>
        </Card>
      </div>

      <Drill summary="Why minibatches are counted in episodes, and shuffled by episode">
        The recurrent trunk needs each episode replayed through the GRU in
        temporal order from a zero hidden state — so PPO's update never
        shuffles individual transitions, only which whole episodes land
        together in a minibatch. The buffer is padded once per update, and the update refuses
        to run if a stored action violates the legal-action mask it was stored with.
      </Drill>
      <Drill id="metrics" summary="What each logged metric means">
        These are the exact numbers charted per deck, per PPO update, on the{' '}
        <Link to="/stats">Validation Stats</Link> page:
        <ul>
          <li><b>entropy</b> — masked mean entropy of the action distribution over real (non-padded) steps</li>
          <li><b>approx_kl</b> — Schulman's k3 estimator, a non-negative post-step diagnostic (not the clipping trigger)</li>
          <li><b>clip_fraction</b> — share of steps where the probability ratio moved outside the clip range</li>
          <li><b>explained_variance</b> — how well the value head predicts returns, measured before the update</li>
          <li><b>adv_std</b> — raw (pre-normalization) advantage standard deviation</li>
        </ul>
      </Drill>
    </section>
  )
}

function Mulligan() {
  return (
    <section id="mulligan">
      <div className="kicker">Stage 6</div>
      <h2>Mulligan Net</h2>
      <p className="intro">
        A separate, small network makes the keep/mulligan and bottoming
        decisions — trained with <Term k="reinforce">REINFORCE</Term>, not PPO, because a mulligan is one
        pregame decision scored by the whole game's eventual outcome: a <Term k="bandit">bandit
        problem</Term>, not a sequential-credit-assignment one.
      </p>

      <div className="arch-flow" style={{ marginTop: 14 }}>
        <ArchNode t="Opening hand, tokenized" d="same token pipeline as the main net" />
        <ArchDown />
        <ArchNode t="Shared encoder — frozen (no_grad)" d="reused from this deck's DeckNetwork, PPO trains it — the mulligan optimizer never touches it" />
        <ArchDown />
        <ArchNode t="Mulligan trunk — 64 → 64, Tanh" d="mine_summary + mulligans-taken + on-the-play" />
        <ArchDown />
        <div className="arch-heads">
          <ArchNode t="Keep / mulligan head" />
          <ArchNode t="Bottom-card pointer" />
          <ArchNode t={<Term k="baseline">Value baseline</Term>} />
        </div>
      </div>

      <p className="intro">Reward is symmetric and game-level: +1.0 if this seat wins, −1.0 otherwise — no separate penalty for mulliganing more.</p>

      <Drill id="probe-hands" summary="Probe hands — why evaluation needs synthetic hands">
        Self-play rarely draws extreme opening hands naturally (0-land or
        7-land hands are just unlikely with a normal deck), so there isn't
        enough natural data to see how the net behaves at those land counts.
        The <code>mulligan_audit</code> validation check builds synthetic,
        seeded 7-card hands at every achievable land count (skipping counts a
        deck's list literally can't produce), runs them through the current
        live weights, and reports P(mulligan), its spread across variants, and
        decision entropy in bits at each land count — comparable across
        training checkpoints since the sampling is seeded.
      </Drill>

      <Callout kind="warn" title="Marked experimental in the code">
        The mulligan loss's entropy coefficient currently sits at 1.0 (loss =
        policy loss + 0.5·value loss − 1.0·entropy), tuned up from a much
        smaller value specifically to fight entropy collapse toward
        "always keep." The source flags this magnitude as not yet validated on
        the main league loop — included here for accuracy, not as settled
        methodology. The mulligan net is also queued for its own review in the
        training-improvement plan.
      </Callout>
    </section>
  )
}

const CHECKS = [
  [<b>primary_vs_primary_round_robin</b>,
    <>Every primary-league deck vs. every other, mirrors included, <Term k="greedy_argmax">greedy (argmax)</Term> play. Mirror games are excluded from each deck's win totals (they used to count as guaranteed wins).</>,
    'current live weights, within the same league'],
  [<b>primary_vs_training_round_robin</b>,
    'Full cross product, primary roster × training-league twin; also sums per-deck mana-burn totals',
    <>the frozen training-league twin (see <a href="#league">Self-Play League</a>)</>],
  [<b>mulligan_audit</b>,
    "Buckets the round robins' own opening-hand decisions by land count, plus a fresh seeded probe-hand pass",
    'n/a — post-hoc + synthetic hands'],
  [<b>strength_history</b>,
    <>Current agents vs. their own snapshots <em>and</em> every deck's snapshots, at a ladder of ages (1k … 500k games/deck) — the steady-improvement curve</>,
    'frozen past selves; the opponent cannot change underneath it'],
  [<b>policy_movement</b>,
    'How far the current policy has moved from its past policies, on a fixed suite of mid-game decisions (Jensen–Shannon divergence, top-1 agreement, entropy)',
    'n/a — a fixed probe suite, no games'],
  [<b>progress_indicator</b>,
    <>The one-line answer to "is the league still learning?" — <b>IMPROVING / CHURNING / STUCK / FLAT / WARMUP</b>, built from the two checks above. Report only.</>,
    'n/a — summarises strength_history + policy_movement'],
  [<b>round_robin_review</b>,
    <>Human-review only, 2 games/pairing, writes full replay logs into the webapp's <Link to="/replay">Game Replay</Link> viewer</>,
    'current live weights'],
]

function Validation() {
  return (
    <section id="validation">
      <div className="kicker">Stage 7</div>
      <h2>Validation & Evaluation</h2>
      <p className="intro">
        Seven checks run after each training chunk (every <code>checks_cadence_pct</code> = 10% of a
        league's <code>total_games</code>, <code>checks_games</code> = 50 games per pairing by default). A check that raises is logged and
        skipped — a bad validation run never aborts training.
      </p>

      <Card><DataTable head={['Check', 'What it measures', 'Opponent']} rows={CHECKS} /></Card>

      <h3 className="sub" id="history-checks">History checks — is the league still learning?</h3>
      <p className="intro">
        The three history checks exist because a league's own win rates cannot answer that:
        everyone improves together, so the primary-vs-primary rate sits near 50% whatever
        happens. They measure against <em>frozen</em> agents instead, read off the archived
        snapshots (one per <code>snapshot_every_games</code> games/deck, so a finished run can be
        evaluated at any earlier age).
      </p>
      <Card>
        <DataTable head={['Measurement', 'How to read it']} rows={[
          [<><b>Current vs own past selves</b><br /><span className="hint">strength_history · own</span></>,
            'Score against the deck\'s own snapshot at each ladder age. Steady improvement means older selves are beaten more and more clearly; a plateau is the same row reading the same at later ticks. Against recent selves it sinks toward 50%; against very old ones it saturates near 100% and says little.'],
          [<><b>Current vs every deck's history</b><br /><span className="hint">strength_history · field</span></>,
            "All decks' current agents (pooled) against deck B at each age. It falls as B improves and flattens where B stopped improving — a fixed yardstick on each deck's learning, and a check that progress generalises beyond a deck's own history."],
          [<><b>Policy movement</b><br /><span className="hint">policy_movement</span></>,
            <>A fixed suite of mid-game decisions (turn ≥ 5, ≥ 6 permanents, ≥ 3 legal actions) recorded from reference games; each checkpoint is replayed over the same games (recorded actions fed back in, so its GRU sees the same history) and its action distribution compared with the current policy's.
              Two scale references are printed: snapshots one interval apart (a normal step) and a random net (unrelated policies).
              <b> Movement is not progress</b> — a flat strength curve with a moving policy is churning; with a frozen one, stuck.</>],
        ]} />
      </Card>
      <p className="intro" id="indicator">
        <b>The indicator's rule.</b> For each deck the reference is its own snapshot at the largest ladder age that is no newer than 0.6× its current age
        and at least 10k games old (the reference cell plays 4× the usual games). The pooled score of the current agents against their reference selves gets a 95% interval:
        <b> IMPROVING</b> if the interval is above 50%; otherwise <b>CHURNING</b> if the policy has moved ≥ 25% of the way to an unrelated policy, <b>STUCK</b> if it has not,
        <b> FLAT</b> if there is no probe, and <b>WARMUP</b> before any reference exists. The thresholds are <em>provisional</em>: replayed over the old 11-deck run
        the label flickered between IMPROVING and CHURNING once the true gain per interval fell below what a few hundred games can resolve, so read the printed numbers, not just the label.
        It never stops or changes training. The same verdict rule (<code>evaluation/verdicts.py</code>) is used by the in-run check and by the offline report, which re-derives the label at every tick.
      </p>
      <Callout title="Retired: vs_history">
        An earlier check pitted each deck against only two past selves (its oldest active and oldest archived snapshot). The first saturates by ~7k games
        and the second moves with the window, so the ladder above replaced it; old <code>vs_history</code> lines remain readable in archived runs.
      </Callout>

      <Drill summary="Offline evaluation (python -m evaluation)">
        The same machinery runs outside training: <code>evaluation/</code> plays agents from arbitrary checkpoint
        directories against each other through one shared play path (the round robins and <code>run_league --eval</code> use it too), and can
        run retrospective sweeps over a finished run's archived snapshots — strength matrices, field sweeps, policy-movement probes.
        That's how the experiment arms below are compared head-to-head at matched ages.
      </Drill>
      <Drill summary="Correctness tests behind the numbers">
        The pipeline sits on layered tests (unit / component / integration): encoder contract, independent-oracle and metamorphic
        checks, a golden pin of the encoded observation, action-space and training suites, and engine state-integrity /
        determinism suites. The encoder suite's planted-bug sweep (48 injected defects) catches all 48. Changing the encoder
        changes its input width, so existing checkpoints become invalid by design.
      </Drill>

      <p className="intro">
        Win rate is consistently <code>wins / games</code> per deck or pairing side, from the engine's own <code>game_over</code> event;
        a no-winner horizon timeout is excluded from that denominator.
      </p>

      <Callout title="Where this data goes">
        Every check's output and every <code>metrics.jsonl</code> line gets
        mirrored into this webapp as training runs, which is what powers the{' '}
        <Link to="/stats">Validation Stats</Link> page — the
        metric names there (entropy, approx_kl, win_rate, keep_rate, score, js, …) are
        exactly the ones described on this page. The run's <code>manifest.json</code>
        (resolved config, network architecture, git commit, sessions) is mirrored too and shown
        on the Overview tab, the Progress tab charts the history checks, and the Opponents tab shows each
        deck's cumulative PFSP tallies per opponent.
      </Callout>
    </section>
  )
}

const CONFIG_ROWS = [
  ['league_name', 'checkpoint directory name'],
  ['extends', 'inherit run mechanics from another config (e.g. baseline_settings.json); only differences are retyped'],
  ['roster', 'which decks this league trains and plays'],
  ['total_games', 'target cumulative games per deck'],
  ['create_training_league', <>build the frozen benchmark twin (see <a href="#league">Self-Play League</a>)</>],
  ['checkpoint_opponent_rate', 'probability a sampled opponent is a frozen snapshot rather than the live net (0.15)'],
  ['pfsp / pfsp_power', 'PFSP on/off, and the sharpness exponent on the weighting curve (0.5)'],
  ['games_per_iteration', 'games collected per deck before each PPO update (24)'],
  ['n_workers', 'rollout worker processes — speed only, does not change what is learned'],
  ['snapshot_every_games', 'cumulative-game cadence for freezing a new league snapshot (200)'],
  ['checks_cadence_pct / checks_games', 'how often the validation suite runs (every 10% of total_games) and games per pairing (50)'],
  ['stratify_0land_pct', 'chance of forcing a 0-land opening hand when the opponent is a frozen snapshot'],
  ['overlap_collect', 'pipeline collection and the PPO update: workers collect the next deck\'s games while the GPU updates the current one (one update stale for decks seen as opponents). Measured ~24% faster with no detectable cost to learning; on in small_league.json'],
  ['probe_states_dir / history_ladder / history_checks', 'the fixed probe suite for policy_movement, the ladder of anchor ages for strength_history, and an off switch for all three history checks'],
  ['encoder / trunk_hidden', 'network capacity for freshly built decks (d_model, n_layers, dim_feedforward; trunk widths) — see Model Architecture'],
  ['ppo', 'partial override of the PPO defaults table above — unknown keys are a hard error, not silently ignored'],
]

const TREE = `checkpoints/
├── <b>vocab.json</b>                <span class="c"># shared card-name → index, append-only across every league</span>
└── &lt;league&gt;/
    ├── <b>session.txt</b>           <span class="c"># last session number</span>
    ├── <b>progress.json</b>         <span class="c"># cumulative_games_per_deck, last_batch_size</span>
    ├── <b>manifest.json</b>         <span class="c"># what this run IS: config, network architecture, git commit, sessions (+ history of changes)</span>
    ├── <b>metrics.jsonl</b>         <span class="c"># one line per PPO update / mulligan flush / validation result</span>
    ├── &lt;deck&gt;/
    │   ├── <b>live.pt</b>           <span class="c"># current net + optimizer state</span>
    │   ├── <b>mulligan.pt</b>       <span class="c"># current mulligan net + its own optimizer</span>
    │   ├── <b>snapshot_&lt;id&gt;.pt</b>  <span class="c"># the newest 32 frozen historical selves (the PFSP window)</span>
    │   ├── <b>opponent_stats.json</b> <span class="c"># PFSP win/loss tallies per opponent key</span>
    │   └── archive/
    │       └── <b>snapshot_&lt;id&gt;.pt</b> <span class="c"># every older snapshot, moved not deleted: the full history</span>
    └── checks/
        └── <b>&lt;check&gt;_&lt;N&gt;games.json</b> <span class="c"># full validation output for one cadence point</span>`

function Config() {
  return (
    <section id="config">
      <div className="kicker">Stage 8</div>
      <h2>Config & Checkpoints</h2>
      <p className="intro">
        A league is defined by one JSON config (optionally extending a shared
        base) and persists everything needed to resume — including surviving a
        crash mid-write — under <code>checkpoints/&lt;league&gt;/</code>.
      </p>

      <Card><DataTable head={['Field', 'Meaning']} rows={CONFIG_ROWS.map(([f, m]) => [<b>{f}</b>, m])} /></Card>

      <p className="hint">
        The league everything is currently built on is the 4-deck <code>small_league.json</code> (rakdos_madness, dmir_terror,
        elves, mono_red_rally; twin and <code>overlap_collect</code> enabled, history checks on). Experiments run as 50,000-game/deck
        arms extending it (see <a href="#experiments">Experiments</a>). <code>main_league.json</code> is the 11-deck league the first long run used (100,000 games/deck).
      </p>

      <h3 className="sub">Checkpoint layout</h3>
      <Card><pre className="tree" dangerouslySetInnerHTML={{ __html: TREE }} /></Card>
      {/* ponytail: the tree is a static, hand-authored literal (no user input), so raw HTML is the shortest faithful port */}

      <p className="hint">Writes go through a temp file + atomic replace, with retry/backoff specifically to survive OneDrive's transient file-locking on Windows.</p>

      <Callout kind="warn" title="Historical note from the 11-deck main league (2026-08-17)">
        <code>mono_red_rally</code>{' '}
        wins 85.5% of its non-mirror games in the main league while its own
        mirror match sits at 49.6% — diluting the training gradient for the
        other ten decks. Documented in the config as a strategic/architectural
        problem, not something a hyperparameter change fixes, and still open.
      </Callout>
    </section>
  )
}

const ARMS = [
  ['small_baseline', 'Control: the 4-deck league under the current methodology, from scratch to 50,000 games/deck (past the entropy/batch schedule horizon). Everything else inherited from small_league.'],
  ['small_control50k', 'Identical replicate of the baseline (unseeded, name only differs). Its head-to-head vs the baseline at matched ages is the run-to-run noise floor every other arm is read against.'],
  ['small_gamma1', 'PPO discounting: γ 1.0 and GAE λ 0.97 (baseline 0.99 / 0.95). The baseline\'s 0.9405 per-step advantage decay leaves a decision 100 steps before the end ~0.2% of the terminal signal; 0.97 leaves ~4.8%.'],
  ['small_lrdecay50k', 'Deck-net learning rate decays linearly 2e-4 → 2e-5 over the full 50,000 games/deck, launched through analysis/eval/run_lr_decay.py (the stock loop has no lr schedule). The mulligan net\'s lr is not decayed.'],
  ['small_bigA', 'Capacity: encoder d_model 128, 4 layers, feed-forward 512, trunk 256×256; 25,000 games, no twin, history checks off. Prepared in the improvement plan; check its status there before reading anything into it.'],
]

function Experiments() {
  return (
    <section id="experiments">
      <div className="kicker">Stage 9</div>
      <h2>Methodology Experiments</h2>
      <p className="intro">
        Since the encoder overhaul the repo runs a controlled screen of one-change-per-arm experiments
        on the 4-deck league, each from scratch and read against the baseline with the history checks and
        head-to-head snapshot matches at matched ages.
      </p>

      <Card><DataTable head={['Arm (league)', 'What differs from the baseline']} rows={ARMS.map(([n, d]) => [<b>{n}</b>, d])} /></Card>

      <Callout title="Shared twin">
        The training-league twin is built once, for the baseline (frozen at 10,008 games/deck), then copied into each
        arm's <code>-training</code> directory. Every arm is therefore measured against the same fixed opponent on
        <code>primary_vs_training_round_robin</code>; the pipeline finds each copy already at its cap and skips training it.
        Training itself never uses the twin.
      </Callout>
      <Callout kind="warn" title="Read single runs with the noise floor in mind">
        In the earlier 25,000-game lr-decay screen, a control identical to the baseline lost to it by 4.1 points — as large as
        the effect being measured — so run-to-run variation between identical runs is about 4 points and per-game
        confidence intervals understate the real uncertainty. A single arm's lead is only evidence relative to the
        replicate, which is why <code>small_control50k</code> exists. See the training-improvement plan in the repo's
        <code> docs/</code> for the full decision rules and results.
      </Callout>
    </section>
  )
}

// Links from the stats page (and glossary terms) arrive as /methodology#<id>. A client-side navigation doesn't
// scroll to the hash by itself, and the target may sit inside a collapsed <details>, so open its ancestors first.
function useHashTarget() {
  const { hash } = useLocation()
  useEffect(() => {
    const el = hash && document.getElementById(decodeURIComponent(hash.slice(1)))
    if (!el) return
    for (let d = el.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true
    el.scrollIntoView({ block: 'start' })
  }, [hash])
}

export default function Methodology() {
  useHashTarget()
  return (
    <div className="meth">
      <Header title="Training Methodology" subtitle="How self-play, the model, and PPO fit together." current="/methodology" />
      <div className="toc">{TOC.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}</div>
      <main>
        <Overview />
        <League />
        <Model />
        <Actions />
        <Reward />
        <Ppo />
        <Mulligan />
        <Validation />
        <Config />
        <Experiments />
      </main>
      <footer>
        Describes the training path (deploy_reward_v6) as implemented in rl/, src/evaluation/ and src/validation/. Numbers reflect the configs in training_configs/ and the current source — not a simplified approximation of it.
      </footer>
    </div>
  )
}
