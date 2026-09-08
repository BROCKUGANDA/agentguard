import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { metrics, trace } from '@opentelemetry/api';

/**
 * Initialize OpenTelemetry only if an OTLP endpoint is configured.
 * Returns a shutdown function, or null when telemetry is disabled.
 *
 * This is intentionally opt-in — the sidecar works fine with no telemetry
 * backend (tests, local dev), but lights up automatically in any environment
 * that exports OTEL_EXPORTER_OTLP_ENDPOINT.
 */
export function initTelemetry(serviceName = 'agentguard-sidecar'): (() => Promise<void>) | null {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return null;

  const baseUrl = endpoint.replace(/\/$/, '');
  const traceExporter = new OTLPTraceExporter({ url: `${baseUrl}/v1/traces` });
  const metricExporter = new OTLPMetricExporter({ url: `${baseUrl}/v1/metrics` });
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 15_000,
  });

  const sdk = new NodeSDK({
    serviceName,
    traceExporter,
    metricReader,
  });

  sdk.start();

  // Ensure traces/metrics flush before process exit.
  const shutdown = async (): Promise<void> => {
    try {
      await sdk.shutdown();
    } catch (err) {
      console.error('OTel shutdown failed:', err);
    }
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return shutdown;
}

export function getTracer(): typeof trace {
  return trace;
}

export function getMeter(): typeof metrics {
  return metrics;
}
