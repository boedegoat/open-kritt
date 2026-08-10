import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { configuredModelCatalog } from '../lib/modelProviders.js';
import WorkflowModelConfiguration, {
  workflowBaseConfigurationChange,
  workflowModelConfigurationForCatalog,
  workflowModelConfigurationIsValid,
} from './WorkflowModelConfiguration.jsx';

const providers = ['codex', 'claude'];
const catalog = configuredModelCatalog({
  providers: [
    {
      provider: 'codex',
      input: 'select',
      status: 'ready',
      defaultModel: 'gpt-5-codex',
      models: [{ id: 'gpt-5-codex', thinkingEfforts: ['medium', 'high'] }],
    },
    {
      provider: 'claude',
      input: 'select',
      status: 'ready',
      defaultModel: 'claude-sonnet',
      models: [{ id: 'claude-sonnet', thinkingEfforts: ['medium'] }],
    },
  ],
});

const configured = {
  model: 'gpt-5-codex',
  model_provider: 'codex',
  harness: 'codex',
  thinking_effort: 'high',
  post_processing_model_override: true,
  post_processing_model: 'claude-sonnet',
  post_processing_model_provider: 'claude',
  post_processing_harness: 'claude-code',
  post_processing_thinking_effort: 'medium',
  model_overrides: {
    0: {
      model: 'gpt-5-codex',
      model_provider: 'codex',
      harness: 'codex',
      thinking_effort: 'high',
    },
    1: {
      model: 'claude-sonnet',
      model_provider: 'claude',
      harness: 'claude-code',
      thinking_effort: 'medium',
    },
  },
};

describe('WorkflowModelConfiguration', () => {
  it('validates the fallback and every configured workflow depth', () => {
    expect(workflowModelConfigurationIsValid(configured, [0, 1], providers, catalog)).toBe(true);
    expect(
      workflowModelConfigurationIsValid(
        {
          ...configured,
          model_overrides: {
            ...configured.model_overrides,
            1: { ...configured.model_overrides[1], model: 'missing-model' },
          },
        },
        [0, 1],
        providers,
        catalog
      )
    ).toBe(false);
    expect(workflowModelConfigurationIsValid(configured, [0], providers, catalog)).toBe(false);
  });

  it('normalizes the fallback and each override against provider catalogs', () => {
    expect(workflowModelConfigurationForCatalog(configured, providers, catalog)).toEqual(configured);
  });

  it('renders the default and one model picker per depth in custom mode', () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(WorkflowModelConfiguration, {
          value: configured,
          onChange: () => {},
          depths: [0, 1],
          depthChips: [
            { depth: 0, count: 1 },
            { depth: 1, count: 2 },
          ],
          providers,
          catalog,
        })
      )
    );

    expect(html).toContain('One model for all depths');
    expect(html).toContain('Customize by depth');
    expect(html).toContain('DEFAULT WORKFLOW MODEL');
    expect(html).toContain('POST-PROCESSING MODEL');
    expect(html).toContain('Use scan model');
    expect(html).toContain('Use different model');
    expect(html).toContain('DEPTH 0');
    expect(html).toContain('DEPTH 1');
    expect(html).toContain('2 steps');
  });

  it('keeps the post-processing effort valid when the scan model switches provider', () => {
    const value = {
      model: 'gpt-5-codex',
      model_provider: 'codex',
      harness: 'codex',
      thinking_effort: 'high',
      post_processing_model_override: false,
      post_processing_thinking_effort: 'high',
    };
    const next = workflowBaseConfigurationChange({
      value,
      configuration: {
        model: 'claude-sonnet',
        model_provider: 'claude',
        harness: 'claude-code',
        thinking_effort: 'medium',
      },
      postProcessingModelOverride: false,
      catalog,
    });
    expect(next.post_processing_thinking_effort).toBe('medium');
    expect(
      workflowModelConfigurationIsValid(
        {
          ...value,
          ...next,
        },
        [0, 1],
        providers,
        catalog
      )
    ).toBe(true);
  });

  it('preserves a deliberately different post-processing effort while it is still supported', () => {
    const next = workflowBaseConfigurationChange({
      value: {
        model: 'gpt-5-codex',
        model_provider: 'codex',
        harness: 'codex',
        thinking_effort: 'high',
        post_processing_model_override: false,
        post_processing_thinking_effort: 'medium',
      },
      configuration: {
        model: 'gpt-5-codex',
        model_provider: 'codex',
        harness: 'codex',
        thinking_effort: 'high',
      },
      postProcessingModelOverride: false,
      catalog,
    });
    expect(next.post_processing_thinking_effort).toBe('medium');
  });

  it('leaves the post-processing configuration alone when it is overridden', () => {
    const next = workflowBaseConfigurationChange({
      value: {
        ...configured,
        post_processing_model_override: true,
        post_processing_thinking_effort: 'medium',
      },
      configuration: { model: 'gpt-5-codex', model_provider: 'codex', harness: 'codex', thinking_effort: 'high' },
      postProcessingModelOverride: true,
      catalog,
    });
    expect(next.post_processing_thinking_effort).toBe('medium');
    expect(next.post_processing_model_provider).toBe('claude');
  });
});
