import 'fastify';
import type { PolicyEngine } from './policy/engine.js';
import type { AuditStore } from './audit/store.js';
import type { EventStream } from './ws/stream.js';
import type { TenantManager } from './tenant/manager.js';

declare module 'fastify' {
  interface FastifyInstance {
    engine: PolicyEngine;
    auditStore: AuditStore;
    stream: EventStream;
    policyFile: string;
    tenantManager: TenantManager;
    tenantsMode: boolean;
  }
}

export {};