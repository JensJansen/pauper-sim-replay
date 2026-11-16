const METHODOLOGY_TERMS = {
  pfsp: ["PFSP", "Prioritized Fictitious Self-Play (AlphaStar-style): weight opponent choice toward whoever this deck is currently losing to, instead of sampling opponents uniformly."],
  ppo: ["PPO", "Proximal Policy Optimization — a policy-gradient method that clips how far one update can shift the policy from what generated the data, trading a bit of update size for training stability."],
  set_transformer: ["SetTransformer", "A transformer variant built for an unordered, variable-length set of items (here: every visible card) rather than a fixed sequence — order shouldn't matter, only which cards are present."],
  self_attention: ["Self-attention", "Every token computes a weighted mixture of every other token's representation, so e.g. a creature's encoding can be shaped by what else is on the stack targeting it."],
  pma: ["PMA — pooling by multihead attention", "Compresses a variable-length set of token representations into one fixed-size summary vector using attention, rather than a plain average."],
  film: ["FiLM", "Feature-wise Linear Modulation — one part of the network learns to rescale and shift (γ·h + β) another part's activations, instead of just concatenating in more input features."],
  gru: ["GRU — gated recurrent unit", "A small recurrent network that carries a hidden state across decisions, giving the policy short-term memory beyond what's visible in the current board snapshot."],
  softmax: ["Softmax", "Turns a set of raw scores into a valid probability distribution (all values 0–1, summing to 1) — how logits become action probabilities before sampling."],
  gae: ["GAE", "Generalized Advantage Estimation — blends short- and long-horizon reward information to estimate how much better an action was than expected, smoothing the bias/variance trade-off of that estimate."],
  hill: ["Hill function", "A saturating, S-shaped curve: near zero for small x, rises steeply around its midpoint c, then flattens out approaching (but never reaching) its ceiling."],
  gae_lambda: ["GAE λ", "The smoothing weight in Generalized Advantage Estimation — higher trusts longer-horizon reward information more, lower leans on the value function's own (lower-variance, more biased) short-horizon estimate."],
  gamma: ["γ — discount factor", "How much a future reward is worth today. Closer to 1.0 weighs long-horizon consequences more; closer to 0 focuses on immediate reward."],
  clip_range: ["Clip range", "How far the new policy's probability for an action can move from the old policy's before PPO's objective stops rewarding further change in that direction — caps how much one update can shift behavior."],
  vf_coef: ["Value-function coefficient", "Weight on the value (critic) head's prediction-error loss relative to the policy loss, inside PPO's combined objective."],
  max_grad_norm: ["Max grad norm", "Ceiling on the size of the gradient before a weight update — rescaled down if exceeded, so one unusually large update can't destabilize training."],
  target_kl: ["Target KL", "KL-divergence threshold: if this epoch's mean divergence between the new and old policy crosses it, PPO stops updating early on this batch rather than moving further from the data it was collected under."],
  epochs_per_update: ["Epochs per update", "How many passes PPO makes over the same batch of collected experience before discarding it and collecting fresh games."],
  minibatch: ["Minibatch (in episodes)", "One gradient step's worth of data, measured in whole episodes rather than individual steps — needed because the recurrent trunk has to replay each episode in order from a zero hidden state."],
  entropy_coef: ["Entropy coefficient", "Weight on a bonus for keeping the action distribution spread out, discouraging the policy from collapsing onto one action too early and losing the ability to explore."],
  adam: ["Adam", "A gradient-descent optimizer that adapts its per-parameter step size from running estimates of recent gradients — used for both the main policy net and the mulligan net here, with separate instances and learning rates."],
  reinforce: ["REINFORCE", "The simplest policy-gradient method: push up the probability of actions that led to a good outcome, push down the ones that led to a bad one, weighted directly by the total reward — no clipping."],
  bandit: ["Bandit problem", "A decision problem with no intermediate steps to assign credit across — one choice, one reward. Contrasted with a full sequential RL problem, where credit has to be split across many decisions."],
  baseline: ["Value baseline", "A learned estimate of expected outcome, subtracted from the actual reward so the learning signal reflects 'better or worse than expected' rather than raw reward magnitude — reduces variance without changing what's optimal."],
  greedy_argmax: ["Greedy / argmax play", "Always picking the single highest-probability action instead of sampling from the distribution — used for evaluation so results reflect the policy's best move, not its exploration noise."],
}

// Terms that appear on the stats page. Same shape: key -> [title, body, optional methodology anchor].
const STATS_TERMS = {
  win_rate: ["Win rate", "wins / games for a deck or pairing, from the engine's own game_over event. A no-winner horizon timeout is excluded from the denominator, and mirror games are excluded from a deck's totals in the primary-vs-primary round robin."],
  twin: ["Frozen training-league twin", "A second copy of the league trained to a fixed ~10,000 games/deck and never extended. Because it stops improving, win rate against it is a fixed yardstick: it rises only if the primary league actually got stronger."],
  primary_vs_primary: ["Primary vs primary", "Every primary-league deck against every other, current weights, greedy play. All decks improve together, so the field average sits near 50% whatever happens; read it as relative deck strength, not progress."],
  approx_kl: ["Approx KL", "Schulman's k3 estimate of how far the policy moved in the last PPO minibatch. It is a diagnostic: if the epoch's mean crosses target_kl, PPO stops early on that batch.", "metrics"],
  clip_fraction: ["Clip fraction", "Share of PPO steps whose probability ratio moved outside the clip range. Persistently high means updates are hitting the trust-region edge.", "metrics"],
  explained_variance: ["Explained variance", "How well the value head predicts the returns, measured before the update. 1 is perfect, 0 is no better than predicting the mean, negative is worse. Low values mean the critic isn't helping yet.", "metrics"],
  entropy: ["Entropy", "How spread out the policy's action distribution is, averaged over real decisions. It anneals down as training goes; a collapse to near zero early means the policy stopped exploring.", "metrics"],
  adv_std: ["Advantage std", "Standard deviation of the raw (pre-normalization) advantages in the update.", "metrics"],
  anchor_age: ["Anchor age", "The size of a frozen snapshot, in games/deck, that the current agent is measured against. A small anchor is a recent self; a large one is a much older self.", "history-checks"],
  past_selves: ["Strength vs past selves", "Score of the current agent against its own frozen snapshot at a given anchor age (50% = no difference). Steady improvement means older selves lose more and more clearly.", "history-checks"],
  pooled: ["Pooled score", "All decks' games against the reference combined into one score, with a 95% interval. Pooling is what makes a few hundred games per deck resolvable.", "indicator"],
  improving: ["IMPROVING", "The pooled score against the reference self has a 95% interval entirely above 50%: the current agents clearly beat their older selves.", "indicator"],
  churning: ["CHURNING", "No clear strength gain, but the policy has moved at least 25% of the way to an unrelated policy: it is changing without getting better.", "indicator"],
  stuck: ["STUCK", "No clear strength gain and the policy has stopped moving.", "indicator"],
  flat: ["FLAT", "No clear strength gain, and the policy probe wasn't available to say whether it is still moving.", "indicator"],
  warmup: ["WARMUP", "Too early: no snapshot is old enough to be a fair reference yet.", "indicator"],
  js: ["Jensen-Shannon divergence", "A symmetric distance between two action distributions, in nats: 0 means identical, 0.693 means completely disjoint. Here it measures how far the current policy has moved from a past snapshot on a fixed suite of mid-game decisions.", "history-checks"],
  top1: ["Top-1 agreement", "How often the current policy and a past snapshot pick the same most-likely action on the probe suite.", "history-checks"],
  policy_entropy: ["Probe-suite entropy", "The policy's average action entropy on the fixed probe decisions: how undecided it is on the same positions over time.", "history-checks"],
  keep_rate: ["Keep rate", "Share of opening hands with this land count that the mulligan net kept, from the round robins' own games.", "mulligan"],
  win_after_keep: ["Win rate after keep", "Win rate of games where the opening hand with this land count was kept.", "mulligan"],
  decision_entropy: ["Decision entropy", "How undecided the mulligan net is about keep vs. mulligan, in bits: 1 is a coin flip, 0 is certain.", "mulligan"],
  probe_hands: ["Probe hands", "Synthetic, seeded 7-card hands at every achievable land count, run through the current weights. They show how the net behaves at extreme land counts that self-play rarely produces.", "probe-hands"],
  mana_burn: ["Mana burn", "Mana produced and then wasted. The reward penalizes only the single-pip part, and only for the winning seat.", "reward"],
  single_pip: ["Single-pip burn", "Waste from mana-producing events that add exactly one floating symbol (a basic land, a one-mana dork). Board-scaled taps are never blamed, so this is the part the reward actually charges.", "reward"],
  noise_floor: ["Noise floor", "How far two runs with identical settings differ by chance alone. An arm's head-to-head result only means something if it clears this.", "validation"],
  matrix_cell: ["Pairing cell", "The row deck's win rate against the column deck's agent in that check's snapshot, with the wins/games in the tooltip.", "validation"],
}

// Where in the methodology page (element id) each older term is explained.
const ANCHORS = {
  pfsp: 'league', ppo: 'ppo', set_transformer: 'model', self_attention: 'model', pma: 'model', film: 'model', gru: 'model',
  softmax: 'actions', gae: 'reward', hill: 'reward', gae_lambda: 'ppo', gamma: 'ppo', clip_range: 'ppo', vf_coef: 'ppo',
  max_grad_norm: 'ppo', target_kl: 'ppo', epochs_per_update: 'ppo', minibatch: 'ppo', entropy_coef: 'ppo', adam: 'ppo',
  reinforce: 'mulligan', bandit: 'mulligan', baseline: 'mulligan', greedy_argmax: 'validation',
}

// key -> [title, body, methodology anchor | undefined]
export default Object.fromEntries(
  Object.entries({ ...METHODOLOGY_TERMS, ...STATS_TERMS }).map(([k, [title, body, anchor]]) => [k, [title, body, anchor ?? ANCHORS[k]]]),
)
