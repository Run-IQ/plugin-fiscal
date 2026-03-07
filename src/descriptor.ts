import type { PluginDescriptor } from '@run-iq/plugin-sdk';

export const fiscalDescriptor: PluginDescriptor = {
  name: '@run-iq/plugin-fiscal',
  version: '0.1.0',
  domainLabel: 'fiscal',
  description:
    'Fiscal domain plugin for tax calculation. Provides 6 universal calculation models applicable to any tax system worldwide: flat rates (VAT/GST/Sales Tax), progressive brackets (income tax), minimum tax floors, threshold-based taxes, fixed levies, and composite multi-step calculations.',

  ruleExtensions: [
    {
      name: 'jurisdiction',
      type: 'string',
      required: true,
      description:
        'Tax jurisdiction level. Determines rule priority: NATIONAL (3000) > REGIONAL (2000) > MUNICIPAL (1000). National laws override regional, which override municipal.',
      enum: ['NATIONAL', 'REGIONAL', 'MUNICIPAL'],
    },
    {
      name: 'scope',
      type: 'string',
      required: true,
      description:
        'Rule application scope. Refines priority within a jurisdiction: USER (x1.2) > ORGANIZATION (x1.1) > GLOBAL (x1.0). More specific scope wins over general.',
      enum: ['GLOBAL', 'ORGANIZATION', 'USER'],
    },
    {
      name: 'country',
      type: 'string',
      required: true,
      description:
        'ISO 3166-1 alpha-2 country code (e.g. "TG" for Togo, "FR" for France, "US" for United States, "IN" for India). Rules are filtered by country at evaluation time via input.meta.context.country.',
    },
    {
      name: 'category',
      type: 'string',
      required: true,
      description:
        'Tax category identifier for grouping in fiscal breakdown. Common values: "TVA" (VAT), "IRPP" (income tax), "IS" (corporate tax), "IMF" (minimum tax), "GST", "SALES_TAX". Free-form string — use consistent naming per tax system.',
    },
  ],

  inputFields: [
    {
      name: 'revenue',
      type: 'number',
      description:
        "Business revenue / turnover (chiffre d'affaires). Used as base for VAT, corporate tax, minimum tax.",
      examples: [1_000_000, 5_000_000, 50_000_000],
    },
    {
      name: 'income',
      type: 'number',
      description:
        'Taxable income (revenu imposable). Used as base for progressive income tax brackets.',
      examples: [500_000, 2_000_000, 10_000_000],
    },
    {
      name: 'expenses',
      type: 'number',
      description: 'Deductible expenses. Can be used in conditions or composite calculations.',
      examples: [200_000, 1_000_000],
    },
    {
      name: 'netProfit',
      type: 'number',
      description: 'Net profit (benefice net). Used as base for corporate income tax.',
      examples: [300_000, 5_000_000],
    },
  ],

  examples: [
    {
      title: 'VAT / TVA — Flat Rate',
      description:
        'Value-added tax at a flat rate on revenue. Applicable to any country (adjust rate and country code).',
      rule: {
        id: 'tg-tva-18',
        model: 'FLAT_RATE',
        params: { rate: 0.18, base: 'revenue' },
        jurisdiction: 'NATIONAL',
        scope: 'GLOBAL',
        country: 'TG',
        category: 'TVA',
        effectiveFrom: '2025-01-01T00:00:00.000Z',
        effectiveUntil: null,
        tags: ['tva', 'vat'],
      },
      input: { revenue: 1_000_000 },
    },
    {
      title: 'Income Tax — Progressive Brackets',
      description:
        'Progressive income tax with cumulative brackets. Each bracket applies its rate only to the portion of income within its range.',
      rule: {
        id: 'tg-irpp-2025',
        model: 'PROGRESSIVE_BRACKET',
        params: {
          base: 'income',
          brackets: [
            { from: 0, to: 500_000, rate: 0 },
            { from: 500_000, to: 1_000_000, rate: 0.1 },
            { from: 1_000_000, to: 3_000_000, rate: 0.15 },
            { from: 3_000_000, to: 5_000_000, rate: 0.25 },
            { from: 5_000_000, to: null, rate: 0.35 },
          ],
        },
        jurisdiction: 'NATIONAL',
        scope: 'GLOBAL',
        country: 'TG',
        category: 'IRPP',
        effectiveFrom: '2025-01-01T00:00:00.000Z',
        effectiveUntil: null,
        tags: ['irpp', 'income-tax'],
      },
      input: { income: 2_000_000 },
    },
    {
      title: 'Minimum Tax Floor',
      description:
        'Minimum tax: MAX(base * rate, fixed minimum). Ensures a minimum tax amount regardless of the proportional calculation.',
      rule: {
        id: 'tg-imf-2025',
        model: 'MINIMUM_TAX',
        params: { rate: 0.01, base: 'revenue', minimum: 50_000 },
        jurisdiction: 'NATIONAL',
        scope: 'GLOBAL',
        country: 'TG',
        category: 'IMF',
        effectiveFrom: '2025-01-01T00:00:00.000Z',
        effectiveUntil: null,
        tags: ['imf', 'minimum-tax'],
      },
      input: { revenue: 3_000_000 },
    },
  ],

  promptGuidelines: [
    // Domain universality
    'This plugin provides universal tax calculation models applicable to ANY tax system worldwide — not limited to any specific country or legal framework.',
    'Always specify the correct ISO 3166-1 alpha-2 country code — rules are filtered by country at evaluation time.',

    // Model selection
    'Choose the right model for each tax type: FLAT_RATE for proportional taxes (VAT/TVA/GST/Sales Tax), PROGRESSIVE_BRACKET for income tax with cumulative brackets, MINIMUM_TAX for minimum tax floors (MAX of proportional and fixed amount), THRESHOLD for taxes that only apply above a threshold, FIXED_AMOUNT for fixed levies regardless of base, COMPOSITE for multi-step calculations combining sub-models (SUM/MAX/MIN).',

    // Jurisdiction & scope
    'Jurisdiction determines rule priority hierarchy: NATIONAL (3000) > REGIONAL (2000) > MUNICIPAL (1000). When rules conflict, higher jurisdiction wins.',
    'Scope refines priority within the same jurisdiction: USER (x1.2) > ORGANIZATION (x1.1) > GLOBAL (x1.0). A user-specific rule overrides an organization-wide rule at the same jurisdiction level.',

    // Category & breakdown
    'Use the category field consistently to group related taxes (e.g. "TVA", "IRPP", "IS"). The afterEvaluate hook produces a fiscal breakdown grouped by category — inconsistent naming breaks grouping.',

    // Analyzing tax legislation
    'When analyzing tax legislation, identify: (1) the tax base — what amount is being taxed (revenue, income, profit), (2) the rate structure — flat rate, progressive brackets, minimum floor, (3) any thresholds or exemptions, (4) the jurisdiction level and applicable scope, (5) effective dates and expiry.',

    // Best practices
    'For progressive bracket taxes, ensure brackets are contiguous (each bracket starts where the previous ends) and the last bracket has "to: null" for uncapped top bracket.',
    'Use conditions (JSONLogic DSL) to restrict rules to specific taxpayer categories (e.g. revenue >= threshold, business type == "enterprise").',
    'When multiple taxes apply to the same base, create separate rules for each — the engine evaluates all matching rules and produces a combined breakdown.',
    'Always validate rules after creation to catch missing fields, invalid enums, and checksum mismatches.',
  ],
};
