import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';

import { CORE_RPC_METHODS, LEGACY_METHOD_ALIASES, normalizeRpcMethod } from '../rpcMethods';

const EXPECTED_REGISTRY_METHODS = {
  youpetRegistryListAgents: 'openhuman.youpet_registry_list_agents',
  youpetRegistryGetAgentVersion: 'openhuman.youpet_registry_get_agent_version',
  youpetRegistryListToolDefinitions: 'openhuman.youpet_registry_list_tool_definitions',
  youpetRegistryGetToolDefinitionVersion: 'openhuman.youpet_registry_get_tool_definition_version',
  youpetRegistryListToolEnablements: 'openhuman.youpet_registry_list_tool_enablements',
  youpetRegistryGetToolEnablementVersion: 'openhuman.youpet_registry_get_tool_enablement_version',
  youpetRegistryListConnectorTypes: 'openhuman.youpet_registry_list_connector_types',
  youpetRegistryGetConnectorTypeVersion: 'openhuman.youpet_registry_get_connector_type_version',
  youpetRegistryListConnectorBindings: 'openhuman.youpet_registry_list_connector_bindings',
  youpetRegistryGetConnectorBindingVersion:
    'openhuman.youpet_registry_get_connector_binding_version',
} as const;

function parseCoreRpcMethodsFromSource(): Record<string, string> {
  const source = fs.readFileSync(path.resolve(__dirname, '../rpcMethods.ts'), 'utf8');
  const start = source.indexOf('export const CORE_RPC_METHODS = {');
  const end = source.indexOf('} as const;', start);

  if (start === -1 || end === -1) {
    throw new Error('CORE_RPC_METHODS source block not found');
  }

  const body = source
    .slice(start + 'export const CORE_RPC_METHODS = {'.length, end)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('//'));

  return Object.fromEntries(
    body.map(line => {
      const entry = line.match(/^([A-Za-z0-9]+):\s*(['"])(.+)\2,$/);
      if (!entry) {
        throw new Error(`CORE_RPC_METHODS entry is not a single-line quoted value: ${line}`);
      }
      return [entry[1], entry[3]];
    })
  );
}

describe('rpcMethods catalog', () => {
  describe('normalizeRpcMethod', () => {
    test('resolves all legacy aliases to their canonical core method', () => {
      for (const [legacyMethod, coreMethod] of Object.entries(LEGACY_METHOD_ALIASES)) {
        expect(normalizeRpcMethod(legacyMethod)).toBe(coreMethod);
      }
    });

    test('transforms auth methods by replacing dots with underscores', () => {
      expect(normalizeRpcMethod('openhuman.auth.login')).toBe('openhuman.auth_login');
      expect(normalizeRpcMethod('openhuman.auth.get.state')).toBe('openhuman.auth_get_state');
      expect(normalizeRpcMethod('openhuman.auth.a.b.c')).toBe('openhuman.auth_a_b_c');
    });

    test('transforms accessibility prefix to screen_intelligence prefix', () => {
      expect(normalizeRpcMethod('openhuman.accessibility_status')).toBe(
        'openhuman.screen_intelligence_status'
      );
      expect(normalizeRpcMethod('openhuman.accessibility_enable')).toBe(
        'openhuman.screen_intelligence_enable'
      );
    });

    test('returns unmapped or unrecognized methods unchanged', () => {
      expect(normalizeRpcMethod('openhuman.threads_list')).toBe('openhuman.threads_list');
      expect(normalizeRpcMethod('openhuman.unknown_method')).toBe('openhuman.unknown_method');
      expect(normalizeRpcMethod('')).toBe('');
      expect(normalizeRpcMethod('random_string')).toBe('random_string');
    });

    test('trims whitespace and converts to lower case', () => {
      expect(normalizeRpcMethod('  OpenHuman.Auth.Login  ')).toBe('openhuman.auth_login');
      expect(normalizeRpcMethod('  OPENHUMAN.GET_CONFIG ')).toBe(CORE_RPC_METHODS.configGet);
      expect(normalizeRpcMethod('OpenHuman.Accessibility_Status  ')).toBe(
        'openhuman.screen_intelligence_status'
      );
      expect(normalizeRpcMethod('   some_RANDOM_method  ')).toBe('some_random_method');
    });
  });

  test('legacy aliases point at canonical method values', () => {
    expect(LEGACY_METHOD_ALIASES['openhuman.update_model_settings']).toBe(
      CORE_RPC_METHODS.inferenceUpdateModelSettings
    );
    expect(LEGACY_METHOD_ALIASES['openhuman.workspace_onboarding_flag_set']).toBe(
      CORE_RPC_METHODS.configWorkspaceOnboardingFlagSet
    );
  });

  test('registers all ten Core Registries RPC methods with the Rust spellings', () => {
    expect(
      Object.fromEntries(
        Object.keys(EXPECTED_REGISTRY_METHODS).map(key => [
          key,
          CORE_RPC_METHODS[key as keyof typeof EXPECTED_REGISTRY_METHODS],
        ])
      )
    ).toEqual(EXPECTED_REGISTRY_METHODS);
  });

  test('keeps every CORE_RPC_METHODS entry parseable as a single-line quoted source value', () => {
    expect(parseCoreRpcMethodsFromSource()).toEqual(CORE_RPC_METHODS);
  });

  describe('MCP client legacy alias resolution (Sentry CORE-RUST-DW/DV/DT/DS/DR)', () => {
    test('mcp_clients.list resolves to mcp_clients_installed_list', () => {
      expect(normalizeRpcMethod('mcp_clients.list')).toBe(CORE_RPC_METHODS.mcpClientsInstalledList);
    });

    test('openhuman.mcp_clients_list resolves to mcp_clients_installed_list', () => {
      expect(normalizeRpcMethod('openhuman.mcp_clients_list')).toBe(
        CORE_RPC_METHODS.mcpClientsInstalledList
      );
    });

    test('openhuman.mcp_list resolves to mcp_clients_installed_list', () => {
      expect(normalizeRpcMethod('openhuman.mcp_list')).toBe(
        CORE_RPC_METHODS.mcpClientsInstalledList
      );
    });

    test('openhuman.mcp_servers_list resolves to mcp_clients_installed_list', () => {
      expect(normalizeRpcMethod('openhuman.mcp_servers_list')).toBe(
        CORE_RPC_METHODS.mcpClientsInstalledList
      );
    });

    test('openhuman.tool_registry_call resolves to mcp_clients_tool_call', () => {
      expect(normalizeRpcMethod('openhuman.tool_registry_call')).toBe(
        CORE_RPC_METHODS.mcpClientsToolCall
      );
    });

    test('canonical mcp_clients_installed_list passes through unchanged', () => {
      expect(normalizeRpcMethod('openhuman.mcp_clients_installed_list')).toBe(
        'openhuman.mcp_clients_installed_list'
      );
    });

    test('canonical mcp_clients_tool_call passes through unchanged', () => {
      expect(normalizeRpcMethod('openhuman.mcp_clients_tool_call')).toBe(
        'openhuman.mcp_clients_tool_call'
      );
    });
  });

  describe('health legacy alias resolution (Sentry CORE-RUST-FG / CORE-RUST-G0)', () => {
    test('health_snapshot resolves to openhuman.health_snapshot', () => {
      expect(normalizeRpcMethod('health_snapshot')).toBe(CORE_RPC_METHODS.healthSnapshot);
    });

    test('openhuman.system_info resolves to openhuman.health_system_info (Sentry CORE-RUST-G0)', () => {
      // Older clients called openhuman.system_info before the method was
      // namespaced under health as openhuman.health_system_info.
      expect(normalizeRpcMethod('openhuman.system_info')).toBe(CORE_RPC_METHODS.healthSystemInfo);
    });

    test('canonical health_system_info passes through unchanged', () => {
      expect(normalizeRpcMethod('openhuman.health_system_info')).toBe(
        'openhuman.health_system_info'
      );
    });
  });

  test('catalog canonical methods exist in core schema registry (drift guard)', () => {
    const schemaSources = [
      fs.readFileSync(
        path.resolve(__dirname, '../../../../src/openhuman/config/schemas.rs'),
        'utf8'
      ),
      fs.readFileSync(
        path.resolve(__dirname, '../../../../src/openhuman/screen_intelligence/schemas.rs'),
        'utf8'
      ),
      fs.readFileSync(
        path.resolve(__dirname, '../../../../src/openhuman/inference/provider/schemas.rs'),
        'utf8'
      ),
      fs.readFileSync(
        path.resolve(__dirname, '../../../../src/openhuman/inference/schemas.rs'),
        'utf8'
      ),
      fs.readFileSync(
        path.resolve(__dirname, '../../../../src/openhuman/embeddings/schemas.rs'),
        'utf8'
      ),
      fs.readFileSync(
        path.resolve(__dirname, '../../../../src/openhuman/mcp_registry/schemas.rs'),
        'utf8'
      ),
      fs.readFileSync(
        path.resolve(__dirname, '../../../../src/openhuman/health/schemas.rs'),
        'utf8'
      ),
      fs.readFileSync(
        path.resolve(__dirname, '../../../../src/openhuman/youpet/schemas.rs'),
        'utf8'
      ),
      fs.readFileSync(
        path.resolve(__dirname, '../../../../src/openhuman/youpet/registry/schemas.rs'),
        'utf8'
      ),
    ].join('\n');

    for (const method of Object.values(CORE_RPC_METHODS)) {
      // core.* methods (e.g. core.ping) are special dispatch methods, not in the schema catalog.
      if (!method.startsWith('openhuman.')) continue;
      const methodRoot = method.slice('openhuman.'.length);
      const namespace = methodRoot.startsWith('screen_intelligence_')
        ? 'screen_intelligence'
        : methodRoot.startsWith('inference_')
          ? 'inference'
          : methodRoot.startsWith('embeddings_')
            ? 'embeddings'
            : methodRoot.startsWith('providers_')
              ? 'providers'
              : methodRoot.startsWith('mcp_clients_')
                ? 'mcp_clients'
                : methodRoot.startsWith('health_')
                  ? 'health'
                  : methodRoot.startsWith('youpet_')
                    ? 'youpet'
                    : 'config';
      const fnName = methodRoot.slice(`${namespace}_`.length);
      expect(schemaSources).toContain(`namespace: "${namespace}"`);
      expect(schemaSources).toContain(`function: "${fnName}"`);
    }
  });
});
