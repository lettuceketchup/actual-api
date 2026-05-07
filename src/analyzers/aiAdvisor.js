import Anthropic from '@anthropic-ai/sdk';
import { amountToDollars } from '../utils/formatter.js';

// ── Prompt builders ────────────────────────────────────────────────────────────

export function buildAuditPrompt(enrichedRules, meta) {
  const categories = meta.categories.map(c => ({
    id: c.id,
    name: c.name,
    group: meta.categoryGroupsById.get(c.group_id)?.name ?? '',
  }));

  const rulesForPrompt = enrichedRules.map(r => ({
    id: r.id,
    stage: r.stage ?? null,
    conditionsOp: r.conditionsOp,
    conditions: r._humanConditions.map(c => c.displayStr),
    actions: r._humanActions.map(a => a.displayStr),
  }));

  return `You are a budget rule optimization assistant for Actual Budget.
Analyse the provided rules and suggest improvements.
Respond with ONLY a valid JSON object — no prose, no markdown.

## Available categories:
${JSON.stringify(categories, null, 2)}

## Current rules (${enrichedRules.length} total):
${JSON.stringify(rulesForPrompt, null, 2)}

## Task:
Identify issues and suggest improvements. Return this exact JSON shape:
{
  "proposals": [
    {
      "type": "modify_rule" | "delete_rule" | "create_rule",
      "targetRuleId": "<existing rule id — required for modify_rule and delete_rule>",
      "reason": "<one sentence explaining why>",
      "confidence": <0.0 to 1.0>,
      "newRule": {
        "stage": null | "pre" | "post",
        "conditionsOp": "and" | "any",
        "conditions": [{ "field": "<field>", "op": "<op>", "value": "<value>" }],
        "actions": [{ "op": "<op>", "field": "<field>", "value": "<value>" }]
      }
    }
  ]
}

Valid condition fields: payee, imported_payee, notes, category, account, amount, date, cleared, reconciled
Valid condition ops: is, isNot, oneOf, notOneOf, contains, doesNotContain, matches, isapprox, isbetween, gt, gte, lt, lte, hasTags
Valid action ops: set, prepend-notes, append-notes, link-schedule, set-split-amount
For "set" actions: include "field" (payee, category, notes, cleared, account) and "value"
For note actions (prepend-notes, append-notes): include "value" (the text string)
omit "newRule" for delete_rule proposals.`;
}

export function buildGapsPrompt(unmatchedGroups, enrichedRules, meta, nearMisses = []) {
  const categories = meta.categories.map(c => ({
    id: c.id,
    name: c.name,
    group: meta.categoryGroupsById.get(c.group_id)?.name ?? '',
  }));

  const payeesForPrompt = meta.payees
    .filter(p => !p.transfer_acct)
    .slice(0, 80)
    .map(p => ({ id: p.id, name: p.name }));

  const rulesSummary = enrichedRules.map(r => ({
    id: r.id,
    conditions: r._humanConditions.map(c => c.displayStr),
    actions: r._humanActions.map(a => a.displayStr),
  }));

  const groups = unmatchedGroups.map(g => ({
    importedPayee: g.importedPayee,
    payeeName: g.payeeName,
    payeeId: g.payeeId,
    count: g.count,
    amounts: g.amounts.slice(0, 5).map(a => amountToDollars(a)),
    dateRange: `${g.dateRange.from} to ${g.dateRange.to}`,
    sampleNotes: g.sampleNotes,
  }));

  const nearMissSummary = nearMisses.slice(0, 20).map(nm => ({
    txnPayee: nm.txn.payeeName,
    ruleId: nm.rule.id,
    failedCondition: `${nm.failedCondition?.field} ${nm.failedCondition?.op} '${nm.failedCondition?.value}'`,
  }));

  return `You are a budget rule creation assistant for Actual Budget.
Your job is to create transaction categorization rules for uncategorized transactions.
Respond with ONLY a valid JSON object — no prose, no markdown.

## Available categories:
${JSON.stringify(categories, null, 2)}

## Available payees (sample):
${JSON.stringify(payeesForPrompt, null, 2)}

## Existing rules (${enrichedRules.length} total — for reference, avoid duplication):
${JSON.stringify(rulesSummary, null, 2)}

## Uncategorized transaction groups (${groups.length} groups needing rules):
${JSON.stringify(groups, null, 2)}

${nearMissSummary.length ? `## Near-misses (existing rules that almost matched):
${JSON.stringify(nearMissSummary, null, 2)}

` : ''}## Task:
For each uncategorized group, propose either:
1. A modification to an existing rule to also cover these transactions (type: "modify_rule")
2. A brand new rule (type: "create_rule")

Use "imported_payee" with "contains" or "matches" as the primary condition when possible.
Use the payeeId in conditions only if the payee already exists in the payees list.
Set the stage to null for standard categorisation rules.

Return this exact JSON shape:
{
  "proposals": [
    {
      "type": "modify_rule" | "create_rule",
      "targetRuleId": "<existing rule id — required for modify_rule>",
      "coveredGroup": "<importedPayee or payeeName from input>",
      "reason": "<one sentence>",
      "confidence": <0.0 to 1.0>,
      "newRule": {
        "stage": null | "pre" | "post",
        "conditionsOp": "and" | "any",
        "conditions": [{ "field": "<field>", "op": "<op>", "value": "<value>" }],
        "actions": [{ "op": "set", "field": "category", "value": "<category-id>" }]
      }
    }
  ]
}`;
}

// ── AI backend abstraction ─────────────────────────────────────────────────────

async function callAnthropic(prompt, config) {
  const client = new Anthropic({ apiKey: config.apiKey });
  const response = await client.messages.create({
    model: config.model ?? 'claude-opus-4-7',
    max_tokens: 4096,
    system: 'You are a budget rule assistant. Always respond with valid JSON only.',
    messages: [{ role: 'user', content: prompt }],
  });
  return response.content[0].text;
}

async function callOllama(prompt, config) {
  const baseUrl = config.baseUrl ?? 'http://localhost:11434';
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model ?? 'llama3.2',
      prompt,
      stream: false,
      format: 'json',
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.response;
}

async function callAi(prompt, config) {
  const backend = config.backend ?? process.env.AI_BACKEND ?? 'ollama';

  if (backend === 'anthropic') {
    return callAnthropic(prompt, {
      apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY,
      model: config.model ?? process.env.ANTHROPIC_MODEL,
    });
  }

  if (backend === 'ollama') {
    return callOllama(prompt, {
      baseUrl: config.baseUrl ?? process.env.OLLAMA_BASE_URL,
      model: config.model ?? process.env.OLLAMA_MODEL,
    });
  }

  throw new Error(`Unknown AI backend: '${backend}'. Set AI_BACKEND to 'anthropic' or 'ollama'.`);
}

// ── Response validation ────────────────────────────────────────────────────────

const VALID_FIELDS = new Set(['payee', 'imported_payee', 'notes', 'category', 'account', 'amount', 'date', 'cleared', 'reconciled', 'saved']);
const VALID_OPS = new Set(['is', 'isNot', 'oneOf', 'notOneOf', 'contains', 'doesNotContain', 'matches', 'isapprox', 'isbetween', 'gt', 'gte', 'lt', 'lte', 'hasTags']);
const VALID_ACTION_OPS = new Set(['set', 'prepend-notes', 'append-notes', 'link-schedule', 'set-split-amount']);
const VALID_TYPES = new Set(['create_rule', 'modify_rule', 'delete_rule']);

function validateProposal(proposal, knownRuleIds) {
  if (!VALID_TYPES.has(proposal.type)) return `invalid type: ${proposal.type}`;

  if ((proposal.type === 'modify_rule' || proposal.type === 'delete_rule') && !proposal.targetRuleId) {
    return `${proposal.type} requires targetRuleId`;
  }

  if (proposal.targetRuleId && !knownRuleIds.has(proposal.targetRuleId)) {
    return `targetRuleId '${proposal.targetRuleId}' not found`;
  }

  if (proposal.type !== 'delete_rule') {
    if (!proposal.newRule) return 'missing newRule';
    const { conditions, actions } = proposal.newRule;

    if (!Array.isArray(conditions) || conditions.length === 0) return 'newRule.conditions must be a non-empty array';
    for (const c of conditions) {
      if (!VALID_FIELDS.has(c.field)) return `invalid condition field: ${c.field}`;
      if (!VALID_OPS.has(c.op)) return `invalid condition op: ${c.op}`;
    }

    if (!Array.isArray(actions) || actions.length === 0) return 'newRule.actions must be a non-empty array';
    for (const a of actions) {
      if (!VALID_ACTION_OPS.has(a.op)) return `invalid action op: ${a.op}`;
    }
  }

  if (proposal.confidence != null && (typeof proposal.confidence !== 'number' || proposal.confidence < 0 || proposal.confidence > 1)) {
    return 'confidence must be a number between 0 and 1';
  }

  return null; // valid
}

function parseAiResponse(rawText, knownRuleIds) {
  let parsed;
  try {
    // Strip markdown code fences if present
    const cleaned = rawText.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`AI returned invalid JSON: ${rawText.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed.proposals)) {
    throw new Error('AI response missing "proposals" array');
  }

  const valid = [];
  for (const p of parsed.proposals) {
    const error = validateProposal(p, knownRuleIds);
    if (error) {
      console.warn(`  [AI] Discarding invalid proposal: ${error}`);
    } else {
      valid.push(p);
    }
  }

  return valid;
}

// ── Batching ───────────────────────────────────────────────────────────────────

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

// ── Public interface ───────────────────────────────────────────────────────────

export async function getAuditSuggestions(enrichedRules, meta, config = {}) {
  const knownRuleIds = new Set(enrichedRules.map(r => r.id));
  const batchSize = parseInt(process.env.AI_MAX_RULES_PER_REQUEST ?? '20', 10);
  const batches = chunk(enrichedRules, batchSize);
  const allProposals = [];

  for (let i = 0; i < batches.length; i++) {
    if (batches.length > 1) {
      process.stdout.write(`  [AI] Audit batch ${i + 1}/${batches.length}...`);
    }
    const prompt = buildAuditPrompt(batches[i], meta);
    const raw = await callAi(prompt, config);
    if (batches.length > 1) process.stdout.write(' done\n');
    const proposals = parseAiResponse(raw, knownRuleIds);
    allProposals.push(...proposals);
  }

  return allProposals;
}

export async function getGapSuggestions(unmatchedGroups, enrichedRules, meta, nearMisses = [], config = {}) {
  const knownRuleIds = new Set(enrichedRules.map(r => r.id));
  const batchSize = 15;
  const batches = chunk(unmatchedGroups, batchSize);
  const allProposals = [];

  for (let i = 0; i < batches.length; i++) {
    if (batches.length > 1) {
      process.stdout.write(`  [AI] Gap batch ${i + 1}/${batches.length}...`);
    }
    const prompt = buildGapsPrompt(batches[i], enrichedRules, meta, nearMisses);
    const raw = await callAi(prompt, config);
    if (batches.length > 1) process.stdout.write(' done\n');
    const proposals = parseAiResponse(raw, knownRuleIds);
    allProposals.push(...proposals);
  }

  return allProposals;
}
