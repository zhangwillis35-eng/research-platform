/**
 * Organizational Behavior Theory Knowledge Base
 *
 * Curated from:
 * - CPCRN Organization Theory Abstraction Forms (70 constructs, 65 propositions)
 * - IS Theory Wiki (theorizeit.org)
 * - Serrat's "A Taxonomy of Management Theories"
 * - AMJ/ASQ/JAP canonical theory classifications
 *
 * Used to ground AI analysis of workplace narratives in established OB theory.
 */

export interface OBTheory {
  name: string;
  category: string; // maps to obCategory
  coreConstructs: string[];
  keyPropositions: string[];
  seminalAuthors: string[];
  boundaryConditions?: string[];
  relatedTheories?: string[];
}

export const OB_THEORY_KB: OBTheory[] = [
  // ─── Leadership ─────────────────────────────────────────────────────────
  {
    name: "Transformational Leadership Theory",
    category: "leadership",
    coreConstructs: [
      "idealized influence",
      "inspirational motivation",
      "intellectual stimulation",
      "individualized consideration",
      "charisma",
    ],
    keyPropositions: [
      "Transformational leaders elevate followers' motivation beyond self-interest toward collective goals",
      "Intellectual stimulation encourages creative problem solving and challenges assumptions",
      "Individualized consideration addresses each follower's unique developmental needs",
    ],
    seminalAuthors: ["Bass (1985)", "Burns (1978)", "Avolio & Bass (2004)"],
    boundaryConditions: [
      "Effectiveness varies by cultural context (power distance)",
      "Less impactful in highly mechanistic organizations",
    ],
    relatedTheories: [
      "Charismatic Leadership",
      "Full Range Leadership Model",
    ],
  },
  {
    name: "Leader-Member Exchange (LMX) Theory",
    category: "leadership",
    coreConstructs: [
      "in-group vs out-group",
      "dyadic relationship quality",
      "trust",
      "mutual obligation",
      "role negotiation",
      "LMX differentiation",
    ],
    keyPropositions: [
      "Leaders form unique exchange relationships with each subordinate",
      "High-quality LMX leads to greater job satisfaction, commitment, and OCB",
      "LMX differentiation within teams can harm team-level outcomes",
    ],
    seminalAuthors: [
      "Graen & Uhl-Bien (1995)",
      "Dansereau, Graen & Haga (1975)",
    ],
    boundaryConditions: [
      "Cultural norms around egalitarianism moderate LMX effects",
      "Team interdependence amplifies differentiation effects",
    ],
    relatedTheories: ["Social Exchange Theory", "Role Theory"],
  },
  {
    name: "Servant Leadership Theory",
    category: "leadership",
    coreConstructs: [
      "empowerment",
      "humility",
      "authenticity",
      "stewardship",
      "interpersonal acceptance",
      "providing direction",
    ],
    keyPropositions: [
      "Servant leaders prioritize followers' needs, fostering trust and engagement",
      "Servant leadership promotes organizational citizenship behavior through ethical climate",
    ],
    seminalAuthors: ["Greenleaf (1977)", "van Dierendonck (2011)", "Liden et al. (2008)"],
    relatedTheories: ["Ethical Leadership", "Authentic Leadership"],
  },
  {
    name: "Authentic Leadership Theory",
    category: "leadership",
    coreConstructs: [
      "self-awareness",
      "relational transparency",
      "balanced processing",
      "internalized moral perspective",
    ],
    keyPropositions: [
      "Authentic leaders foster psychological capital and trust in followers",
      "Authentic leadership creates positive organizational climates through moral modeling",
    ],
    seminalAuthors: ["Avolio & Gardner (2005)", "Walumbwa et al. (2008)"],
    relatedTheories: ["Positive Organizational Behavior", "Ethical Leadership"],
  },
  {
    name: "Situational Leadership Theory",
    category: "leadership",
    coreConstructs: [
      "task behavior",
      "relationship behavior",
      "follower readiness/maturity",
      "telling",
      "selling",
      "participating",
      "delegating",
    ],
    keyPropositions: [
      "Effective leadership style is contingent on follower maturity level",
      "Leaders must adjust directive vs supportive behavior based on follower competence and commitment",
    ],
    seminalAuthors: ["Hersey & Blanchard (1969)"],
    relatedTheories: ["Contingency Theory", "Path-Goal Theory"],
  },

  // ─── Motivation ─────────────────────────────────────────────────────────
  {
    name: "Self-Determination Theory (SDT)",
    category: "motivation",
    coreConstructs: [
      "autonomy",
      "competence",
      "relatedness",
      "intrinsic motivation",
      "extrinsic motivation",
      "amotivation",
      "internalization continuum",
    ],
    keyPropositions: [
      "Satisfaction of basic psychological needs (autonomy, competence, relatedness) fosters intrinsic motivation",
      "Controlling environments undermine intrinsic motivation and autonomous regulation",
      "Internalization of external regulations ranges from external to integrated",
    ],
    seminalAuthors: ["Deci & Ryan (1985, 2000)", "Gagné & Deci (2005)"],
    boundaryConditions: [
      "Cultural variation in autonomy need salience",
      "Task complexity moderates autonomy effects",
    ],
    relatedTheories: [
      "Cognitive Evaluation Theory",
      "Job Characteristics Theory",
    ],
  },
  {
    name: "Expectancy Theory",
    category: "motivation",
    coreConstructs: [
      "expectancy (effort→performance)",
      "instrumentality (performance→outcome)",
      "valence (outcome desirability)",
    ],
    keyPropositions: [
      "Motivation = Expectancy × Instrumentality × Valence",
      "People are rational decision-makers who allocate effort based on expected payoffs",
    ],
    seminalAuthors: ["Vroom (1964)", "Porter & Lawler (1968)"],
    relatedTheories: ["Goal-Setting Theory", "Equity Theory"],
  },
  {
    name: "Goal-Setting Theory",
    category: "motivation",
    coreConstructs: [
      "goal specificity",
      "goal difficulty",
      "goal commitment",
      "feedback",
      "task complexity",
      "self-efficacy",
    ],
    keyPropositions: [
      "Specific, difficult goals lead to higher performance than vague or easy goals",
      "Feedback is necessary for goals to regulate performance",
      "Goal commitment moderates the goal-difficulty–performance relationship",
    ],
    seminalAuthors: ["Locke & Latham (1990, 2002)"],
    boundaryConditions: [
      "Complex tasks may require learning goals rather than performance goals",
      "Goal conflict undermines performance",
    ],
    relatedTheories: ["Self-Regulation Theory", "Social Cognitive Theory"],
  },
  {
    name: "Job Characteristics Model",
    category: "motivation",
    coreConstructs: [
      "skill variety",
      "task identity",
      "task significance",
      "autonomy",
      "feedback",
      "experienced meaningfulness",
      "critical psychological states",
      "growth need strength",
    ],
    keyPropositions: [
      "Five core job dimensions create three critical psychological states that enhance motivation",
      "Growth need strength moderates the relationship between job characteristics and outcomes",
    ],
    seminalAuthors: ["Hackman & Oldham (1976, 1980)"],
    relatedTheories: ["Job Demands-Resources Model", "Self-Determination Theory"],
  },
  {
    name: "Job Demands-Resources (JD-R) Model",
    category: "motivation",
    coreConstructs: [
      "job demands",
      "job resources",
      "personal resources",
      "burnout",
      "work engagement",
      "health impairment process",
      "motivational process",
    ],
    keyPropositions: [
      "Job demands lead to burnout through energy depletion (health impairment process)",
      "Job resources foster engagement through motivational process",
      "Resources buffer the impact of demands on burnout",
    ],
    seminalAuthors: ["Bakker & Demerouti (2007)", "Schaufeli & Bakker (2004)"],
    relatedTheories: [
      "Conservation of Resources Theory",
      "Effort-Recovery Model",
    ],
  },

  // ─── Team Dynamics ──────────────────────────────────────────────────────
  {
    name: "Psychological Safety Theory",
    category: "team_dynamics",
    coreConstructs: [
      "psychological safety",
      "interpersonal risk-taking",
      "team learning behavior",
      "voice behavior",
      "error reporting",
    ],
    keyPropositions: [
      "Teams with high psychological safety engage in more learning behaviors",
      "Psychological safety enables voice, error reporting, and innovation",
      "Leader inclusiveness and team norms shape psychological safety climate",
    ],
    seminalAuthors: ["Edmondson (1999, 2019)", "Kahn (1990)"],
    relatedTheories: ["Team Learning Theory", "Voice Behavior"],
  },
  {
    name: "Social Identity Theory / Self-Categorization",
    category: "team_dynamics",
    coreConstructs: [
      "social identity",
      "in-group/out-group categorization",
      "social comparison",
      "group prototypicality",
      "depersonalization",
    ],
    keyPropositions: [
      "People derive self-esteem from group memberships and favor in-group members",
      "Salient social identities shape intergroup attitudes and behavior",
      "Group prototypicality influences perceived leadership",
    ],
    seminalAuthors: ["Tajfel & Turner (1979)", "Hogg (2001)"],
    relatedTheories: [
      "Identity Theory",
      "Optimal Distinctiveness Theory",
    ],
  },
  {
    name: "Tuckman's Group Development Model",
    category: "team_dynamics",
    coreConstructs: [
      "forming",
      "storming",
      "norming",
      "performing",
      "adjourning",
    ],
    keyPropositions: [
      "Teams progress through predictable developmental stages",
      "Conflict (storming) is a natural part of team development preceding norm establishment",
    ],
    seminalAuthors: ["Tuckman (1965)", "Tuckman & Jensen (1977)"],
    relatedTheories: ["Punctuated Equilibrium Model", "Team Effectiveness Models"],
  },
  {
    name: "Shared Mental Model Theory",
    category: "team_dynamics",
    coreConstructs: [
      "task mental model",
      "team interaction mental model",
      "mental model similarity",
      "mental model accuracy",
      "implicit coordination",
    ],
    keyPropositions: [
      "Teams with shared mental models coordinate more effectively with less explicit communication",
      "Both similarity and accuracy of mental models predict team performance",
    ],
    seminalAuthors: ["Cannon-Bowers et al. (1993)", "Mathieu et al. (2000)"],
    relatedTheories: ["Transactive Memory Systems", "Team Cognition"],
  },
  {
    name: "Transactive Memory Systems (TMS)",
    category: "team_dynamics",
    coreConstructs: [
      "specialization",
      "credibility",
      "coordination",
      "expertise recognition",
      "knowledge differentiation",
    ],
    keyPropositions: [
      "Teams perform better when members know who knows what",
      "TMS develops through direct experience and communication",
      "Well-developed TMS enables efficient division of cognitive labor",
    ],
    seminalAuthors: ["Wegner (1987)", "Lewis (2003)", "Austin (2003)"],
    relatedTheories: ["Shared Mental Models", "Team Learning"],
  },

  // ─── Organizational Justice ─────────────────────────────────────────────
  {
    name: "Organizational Justice Theory",
    category: "organizational_justice",
    coreConstructs: [
      "distributive justice",
      "procedural justice",
      "interactional justice (informational + interpersonal)",
      "justice climate",
      "fairness heuristic",
    ],
    keyPropositions: [
      "Procedural justice predicts organizational-level outcomes (commitment, trust) more than distributive justice",
      "Interpersonal and informational justice predict supervisor-directed outcomes",
      "Justice perceptions form quickly and serve as heuristics for subsequent trust judgments",
    ],
    seminalAuthors: [
      "Adams (1965)",
      "Thibaut & Walker (1975)",
      "Colquitt (2001)",
      "Bies & Moag (1986)",
    ],
    relatedTheories: ["Equity Theory", "Fairness Theory", "Social Exchange Theory"],
  },
  {
    name: "Equity Theory",
    category: "organizational_justice",
    coreConstructs: [
      "input/outcome ratio",
      "comparison other",
      "equity sensitivity",
      "over-reward / under-reward",
      "cognitive distortion",
    ],
    keyPropositions: [
      "Perceived inequity (under-reward or over-reward) motivates corrective action",
      "People compare their input/outcome ratios with referent others",
    ],
    seminalAuthors: ["Adams (1963, 1965)"],
    relatedTheories: [
      "Organizational Justice Theory",
      "Relative Deprivation Theory",
    ],
  },

  // ─── Conflict ───────────────────────────────────────────────────────────
  {
    name: "Dual Concern Model of Conflict",
    category: "conflict",
    coreConstructs: [
      "concern for self",
      "concern for other",
      "competing",
      "collaborating",
      "compromising",
      "avoiding",
      "accommodating",
    ],
    keyPropositions: [
      "Conflict handling style depends on the interplay of concern for self and concern for other",
      "Collaboration yields best joint outcomes but requires high trust and time",
    ],
    seminalAuthors: ["Thomas (1976)", "Rahim (1983)", "Pruitt & Rubin (1986)"],
    relatedTheories: ["Negotiation Theory", "Game Theory"],
  },
  {
    name: "Task vs Relationship Conflict",
    category: "conflict",
    coreConstructs: [
      "task conflict",
      "relationship conflict",
      "process conflict",
      "conflict asymmetry",
    ],
    keyPropositions: [
      "Task conflict can benefit performance when relationship conflict is low",
      "Relationship conflict consistently harms team performance and satisfaction",
      "Task and relationship conflict are positively correlated, making pure task conflict rare",
    ],
    seminalAuthors: ["Jehn (1995, 1997)", "De Dreu & Weingart (2003)"],
    relatedTheories: ["Information Processing Theory", "Psychological Safety"],
  },

  // ─── Communication ──────────────────────────────────────────────────────
  {
    name: "Media Richness Theory",
    category: "communication",
    coreConstructs: [
      "media richness",
      "equivocality",
      "cue multiplicity",
      "feedback immediacy",
      "language variety",
      "personal focus",
    ],
    keyPropositions: [
      "Rich media (face-to-face) best suits equivocal/ambiguous messages",
      "Lean media (text, email) suits unequivocal/routine messages",
      "Mismatch between media richness and task equivocality reduces communication effectiveness",
    ],
    seminalAuthors: ["Daft & Lengel (1986)", "Daft, Lengel & Trevino (1987)"],
    relatedTheories: [
      "Social Presence Theory",
      "Channel Expansion Theory",
    ],
  },
  {
    name: "Organizational Silence / Voice",
    category: "communication",
    coreConstructs: [
      "employee voice",
      "employee silence",
      "acquiescent silence",
      "defensive silence",
      "prosocial silence",
      "promotive voice",
      "prohibitive voice",
    ],
    keyPropositions: [
      "Silence and voice are distinct constructs, not mere opposites",
      "Psychological safety and perceived efficacy predict voice behavior",
      "Silence can stem from resignation (acquiescent), fear (defensive), or altruism (prosocial)",
    ],
    seminalAuthors: [
      "Morrison & Milliken (2000)",
      "Van Dyne et al. (2003)",
      "Liang et al. (2012)",
    ],
    relatedTheories: ["Psychological Safety", "Social Exchange Theory"],
  },

  // ─── Power & Politics ──────────────────────────────────────────────────
  {
    name: "Resource Dependence Theory",
    category: "power_politics",
    coreConstructs: [
      "resource dependence",
      "power asymmetry",
      "environmental uncertainty",
      "interorganizational relations",
      "buffering strategies",
    ],
    keyPropositions: [
      "Organizations seek to reduce dependence on critical external resources",
      "Power accrues to those who control critical and scarce resources",
      "Organizations engage in mergers, alliances, or political action to manage dependencies",
    ],
    seminalAuthors: ["Pfeffer & Salancik (1978)"],
    relatedTheories: [
      "Strategic Contingencies Theory",
      "Institutional Theory",
    ],
  },
  {
    name: "French & Raven's Bases of Power",
    category: "power_politics",
    coreConstructs: [
      "legitimate power",
      "reward power",
      "coercive power",
      "expert power",
      "referent power",
      "informational power",
    ],
    keyPropositions: [
      "Different power bases elicit different compliance mechanisms",
      "Expert and referent power (personal bases) generate more commitment than positional bases",
    ],
    seminalAuthors: ["French & Raven (1959)", "Raven (1965)"],
    relatedTheories: ["Influence Tactics", "Political Skill Theory"],
  },
  {
    name: "Micropolitics / Political Skill Theory",
    category: "power_politics",
    coreConstructs: [
      "political skill",
      "social astuteness",
      "interpersonal influence",
      "networking ability",
      "apparent sincerity",
      "impression management",
    ],
    keyPropositions: [
      "Political skill buffers the negative effects of organizational politics on outcomes",
      "Politically skilled individuals are more effective at influence attempts",
    ],
    seminalAuthors: ["Ferris et al. (2005, 2007)", "Mintzberg (1983)"],
    relatedTheories: ["Impression Management Theory", "Social Capital Theory"],
  },

  // ─── Organizational Culture ─────────────────────────────────────────────
  {
    name: "Schein's Organizational Culture Model",
    category: "organizational_culture",
    coreConstructs: [
      "artifacts",
      "espoused beliefs and values",
      "underlying assumptions",
      "cultural embedding mechanisms",
    ],
    keyPropositions: [
      "Culture operates at three levels: artifacts (visible), values (stated), assumptions (unconscious)",
      "Leaders create and embed culture through what they attend to, reward, and model",
      "Underlying assumptions are the most powerful but least visible level of culture",
    ],
    seminalAuthors: ["Schein (1985, 2010)"],
    relatedTheories: [
      "Competing Values Framework",
      "Institutional Theory",
    ],
  },
  {
    name: "Competing Values Framework (CVF)",
    category: "organizational_culture",
    coreConstructs: [
      "clan culture (collaborate)",
      "adhocracy culture (create)",
      "market culture (compete)",
      "hierarchy culture (control)",
      "flexibility vs stability",
      "internal vs external focus",
    ],
    keyPropositions: [
      "Organizational effectiveness criteria vary by cultural type",
      "Organizations can simultaneously embody competing cultural values",
      "Culture-strategy alignment predicts organizational performance",
    ],
    seminalAuthors: ["Cameron & Quinn (2011)", "Quinn & Rohrbaugh (1983)"],
    relatedTheories: ["Schein's Culture Model", "Organizational Climate Theory"],
  },

  // ─── Change Management ──────────────────────────────────────────────────
  {
    name: "Lewin's Change Model",
    category: "change_management",
    coreConstructs: [
      "unfreezing",
      "changing (moving)",
      "refreezing",
      "force field analysis",
      "driving forces",
      "restraining forces",
    ],
    keyPropositions: [
      "Successful change requires unfreezing existing mindsets before introducing new ones",
      "Change involves altering the balance of driving and restraining forces",
      "New behaviors must be refrozen through reinforcement to become permanent",
    ],
    seminalAuthors: ["Lewin (1947, 1951)"],
    relatedTheories: ["Kotter's 8-Step Model", "Organizational Development"],
  },
  {
    name: "Kotter's 8-Step Change Model",
    category: "change_management",
    coreConstructs: [
      "urgency",
      "guiding coalition",
      "vision",
      "communication",
      "empowerment",
      "short-term wins",
      "consolidation",
      "anchoring in culture",
    ],
    keyPropositions: [
      "Change fails most often at the first step—establishing sufficient urgency",
      "A powerful guiding coalition is necessary to overcome organizational inertia",
      "Short-term wins maintain momentum and demonstrate progress",
    ],
    seminalAuthors: ["Kotter (1995, 1996)"],
    relatedTheories: ["Lewin's Change Model", "Sensemaking Theory"],
  },
  {
    name: "Sensemaking Theory",
    category: "change_management",
    coreConstructs: [
      "enactment",
      "selection",
      "retention",
      "retrospective sensemaking",
      "plausibility over accuracy",
      "identity construction",
    ],
    keyPropositions: [
      "People make sense of equivocal situations retrospectively through enacted interpretive frames",
      "Sensemaking is driven by plausibility rather than accuracy",
      "Organizational crises trigger intensified sensemaking that can redefine identity",
    ],
    seminalAuthors: ["Weick (1995)", "Weick, Sutcliffe & Obstfeld (2005)"],
    relatedTheories: [
      "Social Construction Theory",
      "Institutional Theory",
    ],
  },

  // ─── Decision Making ────────────────────────────────────────────────────
  {
    name: "Bounded Rationality",
    category: "decision_making",
    coreConstructs: [
      "satisficing",
      "cognitive limitations",
      "information asymmetry",
      "heuristics",
      "aspiration levels",
    ],
    keyPropositions: [
      "Decision-makers satisfice rather than optimize due to cognitive limitations",
      "Organizational structures serve as mechanisms to bound and channel rationality",
    ],
    seminalAuthors: ["Simon (1947, 1955)", "March & Simon (1958)"],
    relatedTheories: ["Behavioral Decision Theory", "Garbage Can Model"],
  },
  {
    name: "Groupthink Theory",
    category: "decision_making",
    coreConstructs: [
      "group cohesion",
      "insulation",
      "illusion of invulnerability",
      "collective rationalization",
      "self-censorship",
      "mindguards",
      "illusion of unanimity",
    ],
    keyPropositions: [
      "Highly cohesive groups with insulated leadership are vulnerable to defective decision-making",
      "Groupthink symptoms include self-censorship, illusion of unanimity, and stereotyping out-groups",
    ],
    seminalAuthors: ["Janis (1972, 1982)"],
    relatedTheories: ["Group Polarization", "Devil's Advocacy"],
  },
  {
    name: "Prospect Theory",
    category: "decision_making",
    coreConstructs: [
      "loss aversion",
      "reference point",
      "framing effects",
      "probability weighting",
      "value function (S-shaped curve)",
    ],
    keyPropositions: [
      "Losses loom larger than equivalent gains (loss aversion)",
      "Framing a decision as a loss vs gain changes risk preferences",
      "People overweight small probabilities and underweight moderate-to-large probabilities",
    ],
    seminalAuthors: ["Kahneman & Tversky (1979)", "Tversky & Kahneman (1992)"],
    relatedTheories: ["Behavioral Economics", "Escalation of Commitment"],
  },

  // ─── Emotions & Stress ──────────────────────────────────────────────────
  {
    name: "Affective Events Theory (AET)",
    category: "emotions_stress",
    coreConstructs: [
      "work events",
      "affective reactions",
      "work attitudes",
      "affect-driven behaviors",
      "judgment-driven behaviors",
    ],
    keyPropositions: [
      "Discrete work events trigger emotional reactions that influence attitudes and behavior",
      "Emotions at work have both direct behavioral effects and indirect effects through attitudes",
      "Work environment features influence the frequency of affective events",
    ],
    seminalAuthors: ["Weiss & Cropanzano (1996)"],
    relatedTheories: [
      "Emotional Labor Theory",
      "Broaden-and-Build Theory",
    ],
  },
  {
    name: "Emotional Labor Theory",
    category: "emotions_stress",
    coreConstructs: [
      "surface acting",
      "deep acting",
      "emotional dissonance",
      "display rules",
      "emotional exhaustion",
    ],
    keyPropositions: [
      "Surface acting (faking emotions) leads to emotional exhaustion and burnout",
      "Deep acting (modifying felt emotions) is less depleting than surface acting",
      "Organizational display rules dictate which emotions are appropriate to express",
    ],
    seminalAuthors: ["Hochschild (1983)", "Grandey (2000)"],
    relatedTheories: [
      "Affective Events Theory",
      "Conservation of Resources",
    ],
  },
  {
    name: "Conservation of Resources (COR) Theory",
    category: "emotions_stress",
    coreConstructs: [
      "resource loss",
      "resource gain",
      "loss spirals",
      "gain spirals",
      "resource investment",
      "resource caravans",
    ],
    keyPropositions: [
      "Resource loss is disproportionately more impactful than resource gain (primacy of loss)",
      "Those with fewer resources are more vulnerable to further loss (loss spirals)",
      "People invest resources to protect against loss, recover from loss, and gain new resources",
    ],
    seminalAuthors: ["Hobfoll (1989, 2001)"],
    relatedTheories: [
      "JD-R Model",
      "Burnout Theory",
    ],
  },
  {
    name: "Psychological Capital (PsyCap)",
    category: "emotions_stress",
    coreConstructs: [
      "self-efficacy",
      "optimism",
      "hope",
      "resilience",
      "HERO resources",
    ],
    keyPropositions: [
      "PsyCap is a higher-order construct comprising efficacy, optimism, hope, and resilience",
      "PsyCap predicts performance, satisfaction, and well-being beyond individual components",
      "PsyCap is state-like and can be developed through micro-interventions",
    ],
    seminalAuthors: ["Luthans et al. (2007)", "Avey et al. (2011)"],
    relatedTheories: ["Positive Organizational Behavior", "Broaden-and-Build Theory"],
  },

  // ─── Diversity & Inclusion ──────────────────────────────────────────────
  {
    name: "Relational Demography Theory",
    category: "diversity_inclusion",
    coreConstructs: [
      "demographic similarity/dissimilarity",
      "surface-level diversity",
      "deep-level diversity",
      "faultlines",
      "inclusion climate",
    ],
    keyPropositions: [
      "Demographic dissimilarity between an individual and the group predicts lower attachment",
      "Surface-level diversity effects diminish over time as deep-level similarities emerge",
      "Strong faultlines (aligned demographic splits) amplify subgroup conflict",
    ],
    seminalAuthors: [
      "Tsui, Egan & O'Reilly (1992)",
      "Harrison et al. (2002)",
      "Lau & Murnighan (1998)",
    ],
    relatedTheories: [
      "Social Identity Theory",
      "Similarity-Attraction Paradigm",
    ],
  },

  // ─── Cross-cutting Theories ─────────────────────────────────────────────
  {
    name: "Social Exchange Theory",
    category: "organizational_justice",
    coreConstructs: [
      "reciprocity norm",
      "trust",
      "perceived organizational support",
      "obligation",
      "exchange ideology",
    ],
    keyPropositions: [
      "Social exchanges generate obligations and trust through reciprocal actions over time",
      "Perceived organizational support triggers felt obligation to reciprocate with positive attitudes and OCB",
      "Violations of exchange expectations reduce trust and commitment",
    ],
    seminalAuthors: [
      "Blau (1964)",
      "Eisenberger et al. (1986)",
      "Cropanzano & Mitchell (2005)",
    ],
    relatedTheories: [
      "Organizational Justice",
      "Psychological Contract",
      "LMX Theory",
    ],
  },
  {
    name: "Psychological Contract Theory",
    category: "organizational_justice",
    coreConstructs: [
      "transactional contract",
      "relational contract",
      "contract breach",
      "contract violation (emotional response)",
      "fulfillment",
    ],
    keyPropositions: [
      "Perceived breach of psychological contract reduces trust, satisfaction, and OCB",
      "Breach (cognitive) and violation (affective) are distinct but related constructs",
      "Relational contracts are more vulnerable to breach perceptions than transactional ones",
    ],
    seminalAuthors: ["Rousseau (1989, 1995)", "Morrison & Robinson (1997)"],
    relatedTheories: ["Social Exchange Theory", "Organizational Justice"],
  },
  {
    name: "Social Cognitive Theory / Self-Efficacy",
    category: "motivation",
    coreConstructs: [
      "self-efficacy",
      "outcome expectations",
      "observational learning",
      "mastery experience",
      "vicarious experience",
      "verbal persuasion",
      "triadic reciprocal determinism",
    ],
    keyPropositions: [
      "Self-efficacy beliefs are the most powerful predictor of performance across domains",
      "Efficacy is built through mastery experiences, modeling, persuasion, and physiological states",
      "People, behavior, and environment mutually influence each other (reciprocal determinism)",
    ],
    seminalAuthors: ["Bandura (1977, 1986, 1997)"],
    relatedTheories: ["Goal-Setting Theory", "Psychological Capital"],
  },
  {
    name: "Institutional Theory",
    category: "organizational_culture",
    coreConstructs: [
      "coercive isomorphism",
      "mimetic isomorphism",
      "normative isomorphism",
      "legitimacy",
      "institutional logics",
      "decoupling",
    ],
    keyPropositions: [
      "Organizations adopt structures and practices to gain legitimacy, not just efficiency",
      "Three isomorphic pressures (coercive, mimetic, normative) drive organizational similarity",
      "Decoupling occurs when formal structures diverge from actual organizational practices",
    ],
    seminalAuthors: [
      "DiMaggio & Powell (1983)",
      "Meyer & Rowan (1977)",
      "Scott (2001)",
    ],
    relatedTheories: [
      "Resource Dependence Theory",
      "Organizational Ecology",
    ],
  },
  {
    name: "Person-Environment Fit Theory",
    category: "emotions_stress",
    coreConstructs: [
      "person-job fit",
      "person-organization fit",
      "person-group fit",
      "person-supervisor fit",
      "supplementary fit",
      "complementary fit",
    ],
    keyPropositions: [
      "Greater fit between individual and environment predicts satisfaction, commitment, and lower turnover",
      "Supplementary fit (value congruence) and complementary fit (need-supply) are distinct mechanisms",
    ],
    seminalAuthors: ["Kristof (1996)", "Edwards (2008)", "Chatman (1989)"],
    relatedTheories: ["Attraction-Selection-Attrition", "Job Demands-Resources"],
  },
  {
    name: "Social Learning Theory / Behavioral Modeling",
    category: "leadership",
    coreConstructs: [
      "observational learning",
      "role modeling",
      "vicarious reinforcement",
      "attention",
      "retention",
      "reproduction",
      "motivation",
    ],
    keyPropositions: [
      "People learn behaviors by observing and imitating role models",
      "Leaders serve as behavioral models; their actions set norms for acceptable behavior",
      "Ethical/unethical leadership cascades through organizations via social learning",
    ],
    seminalAuthors: ["Bandura (1977)", "Brown, Treviño & Harrison (2005)"],
    relatedTheories: ["Ethical Leadership", "Social Cognitive Theory"],
  },
];

/**
 * Build a compact theory reference for AI prompts.
 * Groups theories by category and formats as a readable reference.
 */
export function buildTheoryPromptReference(): string {
  const byCategory = new Map<string, OBTheory[]>();
  for (const t of OB_THEORY_KB) {
    const list = byCategory.get(t.category) || [];
    list.push(t);
    byCategory.set(t.category, list);
  }

  const sections: string[] = [];
  for (const [cat, theories] of byCategory) {
    const theoryLines = theories
      .map(
        (t) =>
          `  - ${t.name} [${t.seminalAuthors[0]}]: constructs={${t.coreConstructs.join(", ")}}; proposition="${t.keyPropositions[0]}"`,
      )
      .join("\n");
    sections.push(`[${cat}]\n${theoryLines}`);
  }

  return sections.join("\n\n");
}

/**
 * Get all theory names for validation.
 */
export function getAllTheoryNames(): string[] {
  return OB_THEORY_KB.map((t) => t.name);
}

/**
 * Get theories relevant to a specific OB category.
 */
export function getTheoriesByCategory(category: string): OBTheory[] {
  return OB_THEORY_KB.filter((t) => t.category === category);
}
